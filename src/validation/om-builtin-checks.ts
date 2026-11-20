/**
 * Order Management checks too involved for a SOQL condition, registered into the `builtin` map
 * (`check: { type: builtin, name: setting-revenue-adjustment, expect: "none" }`). Each is read-only.
 */

import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";
import { retrieveMetadata, runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import type { CheckContext, CheckOutcome } from "./rules-executor.js";

type Row = Record<string, unknown>;
type BuiltinCheck = (targetOrg: string, context: CheckContext) => Promise<CheckOutcome>;

/** A read that failed; the check is reported as couldn't-check, never as a pass. */
class ReadError extends Error {}

const pass = (message: string): CheckOutcome => ({ passed: true, message });
const fail = (message: string, names: string[]): CheckOutcome => ({
  passed: false,
  message,
  details: { records: names.map((Name) => ({ Name })) },
});

/** Runs a check, turning a failed read into an unavailable outcome. */
function guarded(run: (org: string) => Promise<CheckOutcome>): BuiltinCheck {
  return async (org) => {
    try {
      return await run(org);
    } catch (e) {
      return {
        passed: false,
        message: e instanceof ReadError ? e.message : `Couldn't run the check: ${String(e)}`,
        unavailable: true,
      };
    }
  };
}

async function rows(
  what: string,
  result: Awaited<ReturnType<typeof runSoqlQuery>>
): Promise<Row[]> {
  if (!result.success || !result.data)
    throw new ReadError(`Couldn't read ${what}: ${result.error ?? "no result"}`);
  return result.data.records as Row[];
}
const soql = async (what: string, query: string, org: string) =>
  rows(what, await runSoqlQuery(query, org));
const tooling = async (what: string, query: string, org: string) =>
  rows(what, await runToolingQuery(query, org));

const str = (v: unknown) => (v == null ? "" : String(v));
const quoteList = (ids: string[]) => ids.map((i) => `'${i.replace(/'/g, "\\'")}'`).join(",");

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** One query per chunk of an IN list, rows concatenated. */
async function inChunks(
  what: string,
  ids: string[],
  org: string,
  build: (list: string) => string
): Promise<Row[]> {
  const out: Row[] = [];
  for (const part of chunks(ids, 200)) out.push(...(await soql(what, build(quoteList(part)), org)));
  return out;
}

// ── Metadata retrieve ───────────────────────────────────────────────────────

const xml = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) =>
    ["versions", "steps", "parameters", "orchestratedStages", "stageSteps"].includes(name),
});

/** Retrieves metadata and returns each file's text by file name. */
async function retrieveFiles(org: string, members: string[]): Promise<Map<string, string>> {
  const r = await retrieveMetadata("", members, org);
  if (!r.success || !r.data)
    throw new ReadError(`Couldn't retrieve ${members.join(", ")}: ${r.error ?? "no result"}`);
  const dir = r.data.outputDir;
  const files = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.set(e.name, fs.readFileSync(p, "utf-8"));
    }
  };
  try {
    walk(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return files;
}

const asList = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

// ── Quote owners' permissions ────────────────────────────────────────────────

/** Active users who own a quote created in the last year. */
async function quoteOwners(org: string): Promise<Row[]> {
  return soql(
    "quote owners",
    "SELECT Id, Name FROM User WHERE IsActive = true AND Id IN (SELECT OwnerId FROM Quote WHERE CreatedDate = LAST_N_DAYS:365)",
    org
  );
}

/**
 * The permission set ids each user holds: direct assignments (a profile's own set included) and,
 * for a permission set group, the sets in it. Muting permission sets aren't applied.
 */
async function permissionSetsOf(org: string, userIds: string[]): Promise<Map<string, Set<string>>> {
  const assigned = await inChunks(
    "permission set assignments",
    userIds,
    org,
    (list) =>
      `SELECT AssigneeId, PermissionSetId, PermissionSetGroupId FROM PermissionSetAssignment WHERE AssigneeId IN (${list})`
  );
  const groupIds = [...new Set(assigned.map((a) => str(a.PermissionSetGroupId)).filter(Boolean))];
  const inGroup = new Map<string, string[]>();
  if (groupIds.length) {
    const comps = await inChunks(
      "permission set group members",
      groupIds,
      org,
      (list) =>
        `SELECT PermissionSetGroupId, PermissionSetId FROM PermissionSetGroupComponent WHERE PermissionSetGroupId IN (${list})`
    );
    for (const c of comps) {
      const g = str(c.PermissionSetGroupId);
      inGroup.set(g, [...(inGroup.get(g) ?? []), str(c.PermissionSetId)]);
    }
  }
  const out = new Map<string, Set<string>>();
  for (const a of assigned) {
    const set = out.get(str(a.AssigneeId)) ?? new Set<string>();
    if (a.PermissionSetId) set.add(str(a.PermissionSetId));
    for (const id of inGroup.get(str(a.PermissionSetGroupId)) ?? []) set.add(id);
    out.set(str(a.AssigneeId), set);
  }
  return out;
}

/** Quote owners none of whose permission sets grant something. */
async function ownersWithout(
  org: string,
  grantQuery: (list: string) => string,
  what: string,
  lack: string
): Promise<CheckOutcome> {
  const owners = await quoteOwners(org);
  if (!owners.length)
    return pass("No quotes were created in the last year, so there are no owners to check.");
  const held = await permissionSetsOf(
    org,
    owners.map((o) => str(o.Id))
  );
  const all = [...new Set([...held.values()].flatMap((s) => [...s]))];
  const granting = new Set(
    (await inChunks(what, all, org, grantQuery)).map((r) => str(r.ParentId))
  );
  const lacking = owners.filter(
    (o) => ![...(held.get(str(o.Id)) ?? [])].some((id) => granting.has(id))
  );
  return lacking.length
    ? fail(
        `${lacking.length} of ${owners.length} quote owners ${lack}.`,
        lacking.map((o) => str(o.Name || o.Id))
      )
    : pass(`All ${owners.length} quote owners get it through a permission set.`);
}

const quoteOwnerStatusEdit = guarded((org) =>
  ownersWithout(
    org,
    (list) =>
      `SELECT ParentId FROM FieldPermissions WHERE Field = 'Quote.Status' AND PermissionsEdit = true AND ParentId IN (${list})`,
    "Quote.Status field permissions",
    "can't edit Quote.Status through any permission set"
  )
);

const quoteOwnerQuoteDocumentCreate = guarded((org) =>
  ownersWithout(
    org,
    (list) =>
      `SELECT ParentId FROM ObjectPermissions WHERE SobjectType = 'QuoteDocumentCreationEvent' AND PermissionsCreate = true AND ParentId IN (${list})`,
    "QuoteDocumentCreationEvent object permissions",
    "can't create QuoteDocumentCreationEvent through any permission set"
  )
);

// ── Settings flags ───────────────────────────────────────────────────────────

function settingFlag(settings: string, flag: string, label: string): BuiltinCheck {
  return guarded(async (org) => {
    const files = await retrieveFiles(org, [`Settings:${settings}`]);
    const text = files.get(`${settings}.settings-meta.xml`);
    if (!text)
      throw new ReadError(`Couldn't read the ${settings} settings: the retrieve returned no file.`);
    const root = Object.values(xml.parse(text) as Row).find((v) => v && typeof v === "object") as
      | Row
      | undefined;
    // A flag missing from a file that was read is off.
    return str(root?.[flag]) === "true"
      ? pass(`${label} is on.`)
      : fail(`${label} is off.`, [`${label} (${settings} settings, ${flag})`]);
  });
}

// ── Pricing procedures ───────────────────────────────────────────────────────

/** Life Sciences Commercial pricing procedures with an active version, at most this many are read. */
const PROCEDURE_LIMIT = 15;

interface Step {
  actionType?: string;
  label?: string;
  name?: string;
  customElement?: { parameters?: Array<{ name?: string; type?: string; value?: string }> };
}
interface ProcedureStep {
  procedure: string;
  step: Step;
}

async function activeProcedureSteps(
  org: string
): Promise<{ steps: ProcedureStep[]; note: string }> {
  const list = await soql(
    "pricing procedures",
    "SELECT ApiName FROM ExpressionSet WHERE UsageSubtype = 'LifeSciencesCommercial' AND Id IN (SELECT ExpressionSetId FROM ExpressionSetVersion WHERE IsActive = true)",
    org
  );
  const names = list.map((r) => str(r.ApiName)).filter(Boolean);
  const read = names.slice(0, PROCEDURE_LIMIT);
  const note =
    names.length > read.length
      ? ` Only the first ${read.length} of ${names.length} procedures were read.`
      : "";
  if (!read.length) return { steps: [], note };
  const files = await retrieveFiles(
    org,
    read.map((n) => `ExpressionSetDefinition:${n}`)
  );
  const steps: ProcedureStep[] = [];
  for (const name of read) {
    const text = files.get(`${name}.expressionSetDefinition-meta.xml`);
    if (!text) continue;
    const def = (xml.parse(text) as Row).ExpressionSetDefinition as {
      versions?: Array<{ status?: string; steps?: Step[] }>;
    };
    for (const v of asList(def?.versions))
      if (v.status === "Active")
        for (const step of asList(v.steps)) steps.push({ procedure: name, step });
  }
  return { steps, note };
}

const stepName = (s: ProcedureStep) =>
  `${s.procedure}: ${s.step.label ?? s.step.name ?? s.step.actionType}`;

const pricingRoundingStep = guarded(async (org) => {
  const { steps, note } = await activeProcedureSteps(org);
  // The Help calls it the "Rounding Values" element; its exact actionType name isn't confirmed on a
  // reference org (none of the procedures there has one), so match any action type containing "round".
  const found = steps.filter((s) => /round/i.test(str(s.step.actionType)));
  return found.length
    ? fail(
        `${found.length} active pricing procedure steps round values.${note}`,
        found.map(stepName)
      )
    : pass(`No active pricing procedure step rounds values.${note}`);
});

const pamEffectiveDates = guarded(async (org) => {
  const { steps, note } = await activeProcedureSteps(org);
  const tables = new Map<string, Set<string>>();
  for (const s of steps) {
    if (s.step.actionType !== "PriceAdjustmentMatrix") continue;
    for (const p of asList(s.step.customElement?.parameters))
      if (p.name === "LookUpApiName" && p.type === "Literal" && p.value)
        tables.set(p.value, (tables.get(p.value) ?? new Set()).add(s.procedure));
  }
  if (!tables.size) return pass(`No active procedure has a Price Adjustment Matrix step.${note}`);
  const params = await soql(
    "decision table parameters",
    `SELECT DecisionTable.DeveloperName, DecisionTable.SourceObject, FieldName FROM DecisionTableParameter WHERE DecisionTable.DeveloperName IN (${quoteList([...tables.keys()])}) AND FieldName IN ('EffectiveFrom','EffectiveTo')`,
    org
  );
  // Tier tables need dates (see the tier effective dates cause).
  const flagged = params.filter(
    (p) => str((p.DecisionTable as Row | undefined)?.SourceObject) !== "PriceAdjustmentTier"
  );
  return flagged.length
    ? fail(
        `${flagged.length} Price Adjustment Matrix lookups use effective dates.${note}`,
        flagged.map((p) => {
          const t = str((p.DecisionTable as Row | undefined)?.DeveloperName);
          return `${t} (${[...(tables.get(t) ?? [])].join(", ")}): ${str(p.FieldName)}`;
        })
      )
    : pass(`${tables.size} Price Adjustment Matrix lookup tables use no effective dates.${note}`);
});

const pricingProcedureSelectors = guarded(async (org) => {
  // selector label -> procedure ApiName (null: nothing chosen)
  const named: Array<{ selector: string; procedure: string | null }> = [];
  const views = await tooling(
    "Product Views pricing procedures",
    "SELECT LifeSciConfigRecord.DeveloperName, PicklistValue FROM LifeSciConfigFieldValue WHERE FieldName = 'PricingProcedure' AND LifeSciConfigRecord.IsActive = true AND LifeSciConfigRecord.LifeSciConfigCategory.DeveloperName = 'OrderProductViewsSettings'",
    org
  );
  for (const v of views)
    named.push({
      selector: `Product Views ${str((v.LifeSciConfigRecord as Row | undefined)?.DeveloperName)}`,
      procedure: str(v.PicklistValue) || null,
    });

  const stts = await soql(
    "Sales Transaction Types used by quotes",
    "SELECT SalesTransactionType.Name, SalesTransactionType.PricingProcedureId FROM Quote WHERE CreatedDate = LAST_N_DAYS:365 AND SalesTransactionTypeId != null GROUP BY SalesTransactionType.Name, SalesTransactionType.PricingProcedureId",
    org
  );
  const defIds = [
    ...new Set(
      stts
        .map((r) =>
          str(
            (r.SalesTransactionType as Row | undefined)?.PricingProcedureId ?? r.PricingProcedureId
          )
        )
        .filter(Boolean)
    ),
  ];
  const defs = new Map<string, string>();
  if (defIds.length)
    for (const d of await soql(
      "pricing procedure definitions",
      `SELECT Id, DeveloperName FROM ExpressionSetDefinition WHERE Id IN (${quoteList(defIds)})`,
      org
    ))
      defs.set(str(d.Id), str(d.DeveloperName));
  for (const r of stts) {
    const t = (r.SalesTransactionType as Row | undefined) ?? r;
    const id = str(t.PricingProcedureId);
    named.push({
      selector: `Sales Transaction Type ${str(t.Name)}`,
      procedure: id ? (defs.get(id) ?? `(unknown ${id})`) : null,
    });
  }
  if (!named.length) return pass("No Product Views setting or quote names a pricing procedure.");

  const apiNames = [...new Set(named.map((n) => n.procedure).filter((n): n is string => !!n))];
  const sets = new Map<string, string>();
  const active = new Set<string>();
  if (apiNames.length) {
    for (const s of await soql(
      "pricing procedures",
      `SELECT ApiName, UsageSubtype FROM ExpressionSet WHERE ApiName IN (${quoteList(apiNames)})`,
      org
    ))
      sets.set(str(s.ApiName), str(s.UsageSubtype));
    for (const v of await soql(
      "pricing procedure versions",
      `SELECT ExpressionSet.ApiName FROM ExpressionSetVersion WHERE IsActive = true AND ExpressionSet.ApiName IN (${quoteList(apiNames)})`,
      org
    ))
      active.add(str((v.ExpressionSet as Row | undefined)?.ApiName));
  }
  const problems: string[] = [];
  for (const n of named) {
    if (!n.procedure) problems.push(`${n.selector}: no procedure chosen`);
    else if (!sets.has(n.procedure)) problems.push(`${n.selector}: ${n.procedure} (not found)`);
    else if (sets.get(n.procedure) !== "LifeSciencesCommercial")
      problems.push(`${n.selector}: ${n.procedure} (not a Life Sciences Commercial procedure)`);
    else if (!active.has(n.procedure))
      problems.push(`${n.selector}: ${n.procedure} (no active version)`);
  }
  return problems.length
    ? fail(`${problems.length} pricing procedure choices don't line up.`, problems)
    : pass(
        `All ${named.length} pricing procedure choices are active Life Sciences Commercial procedures.`
      );
});

// ── Quote approval flow ──────────────────────────────────────────────────────

const quoteApprovalRunAs = guarded(async (org) => {
  const flows = await soql(
    "Quote approval flows",
    "SELECT ApiName FROM FlowDefinitionView WHERE ProcessType = 'ApprovalWorkflow' AND IsActive = true AND TriggerObjectOrEventId = 'Quote'",
    org
  );
  const names = flows.map((f) => str(f.ApiName)).filter(Boolean);
  if (!names.length) return pass("No active approval flow on Quote.");
  const files = await retrieveFiles(
    org,
    names.map((n) => `Flow:${n}`)
  );
  const found: string[] = [];
  let read = 0;
  for (const name of names) {
    const text = files.get(`${name}.flow-meta.xml`);
    if (!text) continue;
    read++;
    const flow = (xml.parse(text) as Row).Flow as {
      orchestratedStages?: Array<{ stageSteps?: Row[] }>;
    };
    for (const stage of asList(flow?.orchestratedStages))
      for (const step of asList(stage.stageSteps))
        if (step.stepSubtype === "BackgroundStep" && str(step.runAsUser) !== "true")
          found.push(`${name}: ${str(step.label || step.name)}`);
  }
  if (!read)
    throw new ReadError("Couldn't read the Quote approval flow: the retrieve returned no file.");
  return found.length
    ? fail(`${found.length} background steps run as the Automated Process user.`, found)
    : pass(`${read} Quote approval flows read; every background step runs as a named user.`);
});

// ── Standard price book first ────────────────────────────────────────────────

const ENTRY_LIMIT = { custom: 2000, standard: 5000 };

const standardPriceFirst = guarded(async (org) => {
  const fields = ["Id", "Name", "Product2Id", "CurrencyIsoCode", "ProductSellingModelId"];
  const read = async (standard: boolean, limit: number): Promise<Row[]> => {
    const cols = [...fields];
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await runSoqlQuery(
        `SELECT ${cols.join(", ")} FROM PricebookEntry WHERE IsActive = true AND Pricebook2.IsStandard = ${standard} LIMIT ${limit}`,
        org
      );
      if (r.success && r.data) return r.data.records as Row[];
      const missing = cols.find(
        (c) => c !== "Id" && c !== "Name" && c !== "Product2Id" && r.error?.includes(c)
      );
      if (!missing)
        throw new ReadError(`Couldn't read price book entries: ${r.error ?? "no result"}`);
      cols.splice(cols.indexOf(missing), 1);
    }
    throw new ReadError("Couldn't read price book entries.");
  };
  const [custom, standard] = await Promise.all([
    read(false, ENTRY_LIMIT.custom),
    read(true, ENTRY_LIMIT.standard),
  ]);
  const key = (r: Row) =>
    [str(r.Product2Id), str(r.CurrencyIsoCode), str(r.ProductSellingModelId)].join("|");
  const have = new Set(standard.map(key));
  const missing = custom.filter((r) => !have.has(key(r)));
  const cut = [
    custom.length >= ENTRY_LIMIT.custom ? `custom entries stopped at ${ENTRY_LIMIT.custom}` : "",
    standard.length >= ENTRY_LIMIT.standard
      ? `standard entries stopped at ${ENTRY_LIMIT.standard}`
      : "",
  ].filter(Boolean);
  const note = cut.length ? ` Not every entry was read (${cut.join("; ")}).` : "";
  return missing.length
    ? fail(
        `${missing.length} of ${custom.length} custom price book entries have no active standard entry.${note}`,
        missing.map((r) => str(r.Name || r.Id))
      )
    : pass(
        `All ${custom.length} custom price book entries read have an active standard entry.${note}`
      );
});

export const OM_BUILTIN: Record<string, BuiltinCheck> = {
  "quote-owner-status-edit": quoteOwnerStatusEdit,
  "quote-owner-quote-document-create": quoteOwnerQuoteDocumentCreate,
  "setting-revenue-adjustment": settingFlag(
    "RevenueManagement",
    "enableRevenueAdjustment",
    "Revenue Adjustment"
  ),
  "setting-product-configurator": settingFlag(
    "ProductConfigurator",
    "enableProductConfigurator",
    "Product Configurator"
  ),
  "setting-translation-workbench": settingFlag(
    "Language",
    "enableTranslationWorkbench",
    "Translation Workbench"
  ),
  "pricing-rounding-step": pricingRoundingStep,
  "pam-effective-dates": pamEffectiveDates,
  "pricing-procedure-selectors": pricingProcedureSelectors,
  "quote-approval-run-as": quoteApprovalRunAs,
  "standard-price-first": standardPriceFirst,
};
