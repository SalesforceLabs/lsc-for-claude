/**
 * collectFeatureMap() — gather every configuration surface for one LSC feature
 * from a live org into a `FeatureMap` for LSC Studio.
 *
 * Each surface is collected independently and in parallel; a failing query
 * marks only that surface with `error` so one missing permission or object
 * doesn't blank the whole board. Health findings are attached per item and
 * per surface, then cross-surface checks (e.g. mobile sync coverage) run last.
 */

import { recordTriggeredFlows } from "./flows.js";
import { collectCategoryRecords, collectCategoryRecordsWhere } from "../config/collect.js";
import { sharedRead } from "../config/read-cache.js";
import { chunkIds } from "../tools/helpers.js";
import { cachedDescribeSObject } from "../salesforce/cli.js";
import { MAX_SIDEBAR_RELATED_LISTS, relatedListNames, retrieveLayoutXml } from "../salesforce/visit-layout.js";
import { layoutableRelatedLists, relatedListOptions } from "./metadata/live.js";
import type { ConfigRecord } from "../config/types.js";
import { FEATURES, type FeatureDefinition } from "./features.js";
import type { FeatureMap, ItemDetail, DetailKind, LaneDef, ProfileOption, StudioFinding, StudioItem, StudioSurface, Lane } from "./types.js";
import {
  ID_PATTERN,
  audienceOf,
  buildSurface,
  configItem,
  inList,
  item,
  matchesAny,
  query,
  scalar,
  type Row,
} from "./helpers.js";
import { collectMobileSync } from "./collectors/mobile-sync.js";
import { collectTerritoryUsers } from "./collectors/territory-users.js";
import { collectActionsHome } from "./collectors/actions-home.js";
import { collectBriefings } from "./collectors/briefings.js";
import { actionAudience, newDbSchema, profilesOf } from "./collectors/shared.js";
import { mapKey, trackMap } from "./map-progress.js";
import { describeFlow, outlineText } from "./flow-outline.js";
import { analyzeScript, type ScriptCheckContext, type ScriptType } from "./scripts/checks.js";

/** An org-wide feature's own collector — returns everything but the envelope. */
export type CustomCollector = (org: string) => Promise<Pick<FeatureMap, "summary" | "lanes" | "surfaces" | "checklist" | "checkTitle">>;

const CUSTOM_COLLECTORS: Record<string, CustomCollector> = {
  "mobile-sync": collectMobileSync,
  "territory-users": collectTerritoryUsers,
  "actions-home": collectActionsHome,
  briefings: collectBriefings,
};

const OBJECT_LANES: LaneDef[] = [
  { id: "data", title: "Data model" },
  { id: "logic", title: "Business logic" },
  { id: "mobile", title: "Mobile" },
  { id: "settings", title: "Settings" },
];

type StandardSurfaceId =
  | "objects"
  | "recordTypes"
  | "layouts"
  | "customScripts"
  | "validationRules"
  | "apexTriggers"
  | "flows"
  | "triggerHandlers"
  | "dbSchema"
  | "actions"
  | "adminSettings"
  | "compliance";

const SURFACES: Record<StandardSurfaceId, { title: string; lane: Lane; description: string }> = {
  objects: { title: "Objects", lane: "data", description: "Objects that make up this feature." },
  recordTypes: { title: "Record Types", lane: "data", description: "Record types on the feature's objects." },
  layouts: { title: "Page Layouts", lane: "data", description: "Page layouts on the feature's objects. On Visit, related lists drive the mobile engagement sidebar." },
  customScripts: { title: "Custom Scripts", lane: "logic", description: "LifeScienceCustomScript records — Visit Action Validation, workflow validations, and checklists. Runs online and offline." },
  validationRules: { title: "Validation Rules", lane: "logic", description: "Standard validation rules on the feature's objects." },
  apexTriggers: { title: "Apex Triggers", lane: "logic", description: "Custom Apex triggers. Server-side only — not evaluated offline on the iPad." },
  flows: { title: "Record-Triggered Flows", lane: "logic", description: "Record-triggered flows on the feature's objects." },
  triggerHandlers: { title: "LSC Trigger Handlers", lane: "logic", description: "Managed LifeScienceTriggerHandler records. Only active/inactive can be changed." },
  dbSchema: { title: "Mobile Sync (DB Schema)", lane: "mobile", description: "DB Schema records that control which records sync to LSC Mobile." },
  actions: { title: "Quick & Custom Actions", lane: "mobile", description: "LSC Quick Actions and Custom Actions related to this feature." },
  adminSettings: { title: "Admin Console Settings", lane: "settings", description: "Admin Console configuration records for this feature." },
  compliance: { title: "Compliance Statements", lane: "settings", description: "ComplianceStatementDef records shown during this feature's workflow." },
};

function surface(
  id: StandardSurfaceId,
  collect: Parameters<typeof buildSurface>[1]
): Promise<StudioSurface> {
  return buildSurface({ id, ...SURFACES[id] }, collect);
}

// ─── Reads shared across features ──────────────────────────────────────────

/** Every object any feature owns — the scope of the one read each per-object surface shares. */
const ALL_OBJECTS = [...new Set(FEATURES.flatMap((f) => f.objects))];
const ALL_OBJECTS_LOWER = new Set(ALL_OBJECTS.map((o) => o.toLowerCase()));

/** Start the reads every feature's surfaces share, so they overlap with the first one. */
function warmSharedReads(org: string): void {
  for (const warm of [
    () => recordTriggeredFlows(org),
    () => unionRows(org, "recordTypes", false, recordTypesSql),
    () => unionRows(org, "layouts", true, layoutsSql),
    () => unionRows(org, "validationRules", true, validationRulesSql),
    () => unionRows(org, "apexTriggers", true, apexTriggersSql),
    () => unionRows(org, "customScripts", false, customScriptsSql),
    () => triggerHandlerRows(org),
  ]) {
    warm().catch(() => undefined);
  }
}

/**
 * One read of a per-object surface for every feature's objects at once, kept for a minute and shared
 * by all the object features (each used to run its own IN-list query for the same table).
 */
function unionRows(org: string, kind: string, tooling: boolean, sql: (objects: string) => string): Promise<Row[]> {
  return sharedRead(org, `studio:union:${kind}`, () => query(sql(inList(ALL_OBJECTS)), org, tooling));
}

/**
 * A feature's rows of a per-object surface, taken from the shared read. Whatever the shared read can't
 * answer exactly (it failed or was cut short, a row names an object outside the feature objects, or the
 * feature asks about an object no feature owns) goes to the feature's own query, as before.
 */
async function rowsForObjects(
  org: string,
  kind: string,
  tooling: boolean,
  sql: (objects: string) => string,
  objects: string[],
  keyOf: (r: Row) => unknown
): Promise<Row[]> {
  const own = () => query(sql(inList(objects)), org, tooling);
  if (objects.some((o) => !ALL_OBJECTS_LOWER.has(o.toLowerCase()))) return own();
  let all: Row[];
  try {
    all = await unionRows(org, kind, tooling, sql);
  } catch {
    return own();
  }
  const keyOfLower = (r: Row) => String(keyOf(r) ?? "").toLowerCase();
  if (!all.every((r) => ALL_OBJECTS_LOWER.has(keyOfLower(r)))) return own();
  const wanted = new Set(objects.map((o) => o.toLowerCase()));
  return all.filter((r) => wanted.has(keyOfLower(r)));
}

const recordTypesSql = (list: string) =>
  `SELECT Id, Name, DeveloperName, SobjectType, IsActive, Description FROM RecordType WHERE SobjectType IN (${list}) ORDER BY SobjectType, Name, Id`;
const layoutsSql = (list: string) => `SELECT Id, Name, TableEnumOrId FROM Layout WHERE TableEnumOrId IN (${list}) ORDER BY Name`;
const validationRulesSql = (list: string) =>
  `SELECT Id, ValidationName, Active, Description, ErrorMessage, ErrorDisplayField, EntityDefinition.QualifiedApiName FROM ValidationRule WHERE EntityDefinition.QualifiedApiName IN (${list}) ORDER BY ValidationName`;
const apexTriggersSql = (list: string) =>
  `SELECT Id, Name, TableEnumOrId, Status, NamespacePrefix FROM ApexTrigger WHERE TableEnumOrId IN (${list}) ORDER BY Name`;
const entitiesSql = (list: string) => `SELECT QualifiedApiName, Label, PluralLabel, KeyPrefix FROM EntityDefinition WHERE QualifiedApiName IN (${list})`;
const customScriptsSql = (list: string) =>
  `SELECT Id, Name, ComponentName, Type, ObjectName, OperationEventType, CodeText, CreatedDate FROM LifeScienceCustomScript WHERE ObjectName IN (${list}) OR Type = 'VisitActionValidation' ORDER BY CreatedDate, Id`;

/** The org's trigger handlers — the same list for every feature, which picks its own by keyword. */
function triggerHandlerRows(org: string): Promise<Row[]> {
  return sharedRead(org, "studio:trigger-handlers", () =>
    query(`SELECT Id, DeveloperName, MasterLabel, IsActive, Description FROM LifeScienceTriggerHandler ORDER BY MasterLabel`, org, true)
  );
}

// ─── Surface collectors ─────────────────────────────────────────────────────

interface ObjectInfo {
  name: string;
  label: string;
}

async function collectObjects(feature: FeatureDefinition, org: string): Promise<{ surface: StudioSurface; found: ObjectInfo[] }> {
  const found: ObjectInfo[] = [];
  const s = await surface("objects", async () => {
    const rows = await rowsForObjects(org, "entities", true, entitiesSql, feature.objects, (r) => r.QualifiedApiName);
    const byName = new Map(rows.map((r) => [r.QualifiedApiName as string, r]));
    const items: StudioItem[] = [];
    const findings: StudioFinding[] = [];
    for (const name of feature.objects) {
      const r = byName.get(name);
      if (!r) {
        findings.push({
          severity: "info",
          title: `${name} not found in this org`,
          detail: "The object isn't available — the feature may not be enabled or licensed.",
        });
        continue;
      }
      found.push({ name, label: r.Label as string });
      items.push(
        item(name, r.Label as string, {
          sublabel: name,
          properties: { "API name": name, "Plural label": scalar(r.PluralLabel), "Key prefix": scalar(r.KeyPrefix) },
        })
      );
    }
    return { items, findings };
  });
  return { surface: s, found };
}

function collectRecordTypes(objects: string[], org: string): Promise<StudioSurface> {
  return surface("recordTypes", async () => {
    if (objects.length === 0) return { items: [] };
    const rows = await rowsForObjects(org, "recordTypes", false, recordTypesSql, objects, (r) => r.SobjectType);
    return {
      items: rows.map((r) =>
        item(r.Id as string, r.Name as string, {
          sublabel: r.SobjectType as string,
          active: r.IsActive as boolean,
          properties: {
            "Developer name": scalar(r.DeveloperName),
            Object: scalar(r.SobjectType),
            Description: scalar(r.Description),
          },
        })
      ),
    };
  });
}

const SIDEBAR_OBJECT = "Visit";

function collectLayouts(objects: string[], org: string): Promise<StudioSurface> {
  return surface("layouts", async () => {
    if (objects.length === 0) return { items: [] };
    const rows = await rowsForObjects(org, "layouts", true, layoutsSql, objects, (r) => r.TableEnumOrId);
    return {
      items: rows.map((r) =>
        item(r.Id as string, r.Name as string, {
          sublabel: r.TableEnumOrId as string,
          properties: { Object: scalar(r.TableEnumOrId) },
          // Visit layouts drive the mobile engagement sidebar, which Studio can edit.
          ...(r.TableEnumOrId === SIDEBAR_OBJECT ? { detailKind: "layout" as const } : {}),
        })
      ),
    };
  });
}

/** Static checks against a custom script's code, as board findings (the same rules the script editor shows live). */
export function scriptCodeFindings(code: string, ctx: ScriptCheckContext = { type: "Validation" }): StudioFinding[] {
  return (
    analyzeScript(code, ctx)
      // The Visit Action Validation setup problems are reported by the collector itself, with the running script in mind.
      .filter((d) => !d.id.startsWith("vav-"))
      // The board lists what needs attention; the editor shows the hints too.
      .filter((d) => d.severity !== "info")
      .map((d) => ({ severity: d.severity, title: d.message, ...(d.detail ? { detail: d.detail } : {}) }))
  );
}

function collectCustomScripts(feature: FeatureDefinition, org: string): Promise<StudioSurface> {
  return surface("customScripts", async () => {
    // Only this feature's scripts — CodeText is long text, so pulling every script in the org is the heavy part.
    const scope = [
      feature.objects.length ? `ObjectName IN (${inList(feature.objects)})` : "",
      feature.includeVisitActionValidation ? "Type = 'VisitActionValidation'" : "",
    ].filter(Boolean);
    if (scope.length === 0) return { items: [] };
    const own = () =>
      query(
        `SELECT Id, Name, ComponentName, Type, ObjectName, OperationEventType, CodeText, CreatedDate FROM LifeScienceCustomScript WHERE ${scope.join(" OR ")} ORDER BY CreatedDate, Id`,
        org
      );
    // The shared read covers every feature's objects plus Visit Action Validation; the filter below keeps this feature's.
    const rows = feature.objects.every((o) => ALL_OBJECTS_LOWER.has(o.toLowerCase()))
      ? await unionRows(org, "customScripts", false, customScriptsSql).catch(own)
      : await own();
    const objects = new Set(feature.objects.map((o) => o.toLowerCase()));
    const isVav = (r: Row) => r.Type === "VisitActionValidation";
    const relevant = rows.filter(
      (r) =>
        objects.has(String(r.ObjectName || "").toLowerCase()) ||
        (feature.includeVisitActionValidation && isVav(r))
    );

    // Only the first Visit Action Validation (by creation) executes.
    const vavs = relevant.filter(isVav);
    const runningVavId = vavs[0]?.Id;

    const items = relevant.map((r) => {
      const code = String(r.CodeText || "");
      const findings = scriptCodeFindings(code, {
        type: r.Type as ScriptType,
        objectName: (r.ObjectName as string | null) ?? null,
        operationEventType: (r.OperationEventType as string | null) ?? null,
      });
      if (isVav(r)) {
        if (r.Id !== runningVavId) {
          findings.unshift({
            severity: "error",
            title: "Will not run",
            detail: `Only one Visit Action Validation runs per org — the earliest created ("${vavs[0].Name}"). Merge this script's checks into it.`,
          });
        }
        if (r.ObjectName !== "ProviderVisit") {
          findings.unshift({
            severity: "error",
            title: "ObjectName must be ProviderVisit",
            detail: "Visit Action Validation scripts without ObjectName = ProviderVisit silently don't execute.",
          });
        }
        if (r.OperationEventType !== "OnUpdate") {
          findings.unshift({
            severity: "error",
            title: "OperationEventType must be OnUpdate",
            detail: "Visit Action Validation scripts without OperationEventType = OnUpdate silently don't execute.",
          });
        }
      }
      return item(r.Id as string, r.Name as string, {
        sublabel: [r.Type, r.ObjectName].filter(Boolean).join(" · "),
        properties: {
          Type: scalar(r.Type),
          Component: scalar(r.ComponentName),
          Object: scalar(r.ObjectName),
          "Operation event": scalar(r.OperationEventType),
          Created: scalar(r.CreatedDate),
          ...(isVav(r) ? { "Executes at Sign/Submit": r.Id === runningVavId } : {}),
        },
        code: { language: "javascript", text: code },
        detailKind: "customScript",
        findings,
      });
    });

    const findings: StudioFinding[] = [];
    if (vavs.length > 1) {
      findings.push({
        severity: "error",
        title: `${vavs.length} Visit Action Validation scripts — only 1 runs`,
        detail: `"${vavs[0].Name}" runs; the other ${vavs.length - 1} are ignored.`,
      });
    }
    return { items, findings };
  });
}

function collectValidationRules(objects: string[], org: string): Promise<StudioSurface> {
  return surface("validationRules", async () => {
    if (objects.length === 0) return { items: [] };
    const rows = await rowsForObjects(
      org,
      "validationRules",
      true,
      validationRulesSql,
      objects,
      (r) => (r.EntityDefinition as Row | null)?.QualifiedApiName
    );
    return {
      items: rows.map((r) => {
        const obj = (r.EntityDefinition as Row | undefined)?.QualifiedApiName as string | undefined;
        return item(r.Id as string, r.ValidationName as string, {
          sublabel: obj,
          active: r.Active as boolean,
          edit: { record: { type: "validationRule", id: String(r.Id), label: String(r.ValidationName) }, active: !!r.Active },
          properties: {
            Object: scalar(obj),
            "Error message": scalar(r.ErrorMessage),
            "Error location": scalar(r.ErrorDisplayField) ?? "Top of page",
            Description: scalar(r.Description),
          },
          detailKind: "validationRule",
        });
      }),
    };
  });
}

function collectApexTriggers(objects: string[], org: string): Promise<StudioSurface> {
  return surface("apexTriggers", async () => {
    if (objects.length === 0) return { items: [] };
    const rows = await rowsForObjects(org, "apexTriggers", true, apexTriggersSql, objects, (r) => r.TableEnumOrId);
    const items = rows.map((r) =>
      item(r.Id as string, r.Name as string, {
        sublabel: r.TableEnumOrId as string,
        active: r.Status === "Active",
        properties: {
          Object: scalar(r.TableEnumOrId),
          Status: scalar(r.Status),
          Namespace: scalar(r.NamespacePrefix),
        },
        detailKind: "apexTrigger",
      })
    );
    const findings: StudioFinding[] = [];
    if (items.some((i) => i.active)) {
      findings.push({
        severity: "info",
        title: "Server-side only",
        detail:
          "Apex triggers don't run offline on the iPad — offline edits aren't checked until they sync. Prefer validation rules or custom scripts for rules reps must see in the moment.",
      });
    }
    return { items, findings };
  });
}

function collectFlows(objects: ObjectInfo[], org: string): Promise<StudioSurface> {
  return surface("flows", async () => {
    if (objects.length === 0) return { items: [] };
    // The same org-wide list serves every feature, so it's read once and shared.
    const rows = await recordTriggeredFlows(org);
    const labels = new Set(objects.map((o) => o.label));
    return {
      items: rows
        .filter((r) => labels.has(r.TriggerObjectOrEventLabel as string))
        .map((r) =>
          item(r.DurableId as string, r.Label as string, {
            sublabel: `${r.TriggerObjectOrEventLabel} · ${r.TriggerType}`,
            active: r.IsActive as boolean,
            detailKind: "flow",
            properties: {
              "API name": scalar(r.ApiName),
              Object: scalar(r.TriggerObjectOrEventLabel),
              Trigger: scalar(r.TriggerType),
              "Process type": scalar(r.ProcessType),
            },
          })
        ),
    };
  });
}

function collectTriggerHandlers(feature: FeatureDefinition, org: string): Promise<StudioSurface> {
  return surface("triggerHandlers", async () => {
    const rows = await triggerHandlerRows(org);
    return {
      items: rows
        .filter((r) =>
          matchesAny(`${r.DeveloperName} ${r.MasterLabel} ${r.Description || ""}`, feature.handlerKeywords)
        )
        .map((r) =>
          item(r.Id as string, r.MasterLabel as string, {
            sublabel: r.DeveloperName as string,
            active: r.IsActive as boolean,
            properties: { "Developer name": scalar(r.DeveloperName), Description: scalar(r.Description) },
            edit: {
              record: { type: "triggerHandler", developerName: String(r.DeveloperName), label: String(r.MasterLabel) },
              active: !!r.IsActive,
            },
            findings: r.IsActive
              ? []
              : [{ severity: "info", title: "Inactive", detail: "This handler's managed logic is skipped." }],
          })
        ),
    };
  });
}

function collectDbSchema(feature: FeatureDefinition, found: ObjectInfo[], org: string): Promise<StudioSurface> {
  return surface("dbSchema", async () => {
    const catQuery = `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category = 'DbSchema'`;
    const objects = new Set(feature.objects.map((o) => o.toLowerCase()));
    const isMine = (v: unknown) => objects.has(String(v || "").toLowerCase());
    // Only this feature's records need their values: read the SObject of every record, then the rest of the matches.
    let records: Pick<ConfigRecord, "developerName">[];
    let mine: ConfigRecord[];
    try {
      const narrowed = await collectCategoryRecordsWhere(org, catQuery, { field: "SObject", keep: isMine });
      mine = narrowed.records;
      records = narrowed.developerNames.map((developerName) => ({ developerName }));
    } catch {
      const all = await collectCategoryRecords(org, catQuery, { cache: true });
      mine = all.filter((r) => isMine(r.fields.SObject));
      records = all;
    }
    // New records go to the profiles that already sync this feature's other objects.
    const profiles = [...new Set(mine.filter((r) => r.isActive).flatMap(profilesOf))].sort();
    return {
      items: mine.map((r) => ({ ...configItem(r, String(r.fields.SObject), r.developerName), audience: audienceOf(r) })),
      findings: mobileSyncFindings(feature, found, mine, records, profiles),
      // Unsynced objects get their own "Add … to iPad sync" on the finding; this is for any other object.
      creates: [newDbSchema("", records, profiles)],
    };
  });
}

const isFor = (r: ConfigRecord, obj: ObjectInfo) => String(r.fields.SObject || "").toLowerCase() === obj.name.toLowerCase();

/** Flag feature objects that exist in the org but have no active DB Schema record. */
function mobileSyncFindings(
  feature: FeatureDefinition,
  found: ObjectInfo[],
  mine: ConfigRecord[],
  all: Pick<ConfigRecord, "developerName">[],
  profiles: string[]
): StudioFinding[] {
  const findings: StudioFinding[] = [];
  for (const obj of found) {
    const records = mine.filter((r) => isFor(r, obj));
    if (records.some((r) => r.isActive)) continue;
    const primary = obj.name === feature.objects[0];
    findings.push({
      severity: primary ? "warning" : "info",
      title: `${obj.name} isn't synced to LSC Mobile`,
      detail: records.length
        ? "Its DB Schema record is switched off — iPad users won't have these records offline. Switch it on in the inspector."
        : "No DB Schema record — iPad users won't have these records offline.",
      // An inactive record exists: switching it on is the change, not adding a second one.
      fixes: records.length ? undefined : [newDbSchema(obj.name, all, profiles)],
    });
  }
  return findings;
}

function collectActions(feature: FeatureDefinition, org: string): Promise<StudioSurface> {
  return surface("actions", async () => {
    const records = await collectCategoryRecords(
      org,
      `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category IN ('QuickAction', 'CustomAction') ORDER BY Category`,
      { cache: true }
    );
    return {
      items: records
        .filter((r) =>
          matchesAny(
            [r.developerName, r.label, ...Object.values(r.fields).filter((v) => typeof v === "string")].join(" "),
            feature.actionKeywords
          )
        )
        .map((r) => ({
          ...configItem(r, r.label || r.developerName, r.category === "QuickAction" ? "Quick Action" : "Custom Action"),
          audience: actionAudience(r),
        })),
    };
  });
}

function collectAdminSettings(feature: FeatureDefinition, org: string): Promise<StudioSurface> {
  return surface("adminSettings", async () => {
    if (feature.adminCategoryKeywords.length === 0) return { items: [] };
    const like = feature.adminCategoryKeywords.map((k) => `Category LIKE '%${k.replace(/'/g, "\\'")}%'`).join(" OR ");
    const records = await collectCategoryRecords(
      org,
      `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE (${like}) AND Category NOT IN ('DbSchema', 'QuickAction', 'CustomAction') ORDER BY Category`,
      { cache: true }
    );
    const names = await resolveIdNames(records, org);
    return {
      items: records.map((r) => {
        const it = configItem(r, r.label || r.developerName, r.category);
        for (const [k, v] of Object.entries(it.properties)) {
          if (typeof v === "string" && splitIds(v).some((id) => names.has(id))) {
            it.properties[k] = splitIds(v).map((id) => names.get(id) ?? id).join(", ");
          }
        }
        // Auto-generated labels (e.g. CDRT_<productId>_<recordTypeId>) — name the record by what it references.
        if (ID_TOKEN.test(it.label)) {
          const referenced = Object.values(r.fields).flatMap((v) => splitIds(v)).map((id) => names.get(id));
          if (referenced.every(Boolean) && referenced.length > 0) it.label = referenced.join(" · ");
        }
        return it;
      }),
    };
  });
}

const ID_TOKEN = /(?:^|_)(?:012|1Ke)[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?(?:_|$)/;
const ID_LOOKUPS: { prefix: string; soql: string }[] = [
  { prefix: "012", soql: "SELECT Id, Name FROM RecordType WHERE Id IN" },
  { prefix: "1Ke", soql: "SELECT Id, Name FROM LifeSciMarketableProduct WHERE Id IN" },
];

function splitIds(v: unknown): string[] {
  if (typeof v !== "string") return [];
  const parts = v.split(",").map((s) => s.trim());
  return parts.every((p) => ID_PATTERN.test(p) && ID_LOOKUPS.some((l) => p.startsWith(l.prefix))) ? parts : [];
}

/** Best-effort Id → Name for record types and products referenced by config field values. */
async function resolveIdNames(records: ConfigRecord[], org: string): Promise<Map<string, string>> {
  const ids = new Set(records.flatMap((r) => Object.values(r.fields).flatMap(splitIds)));
  const names = new Map<string, string>();
  await Promise.all(
    ID_LOOKUPS.map(async ({ prefix, soql }) => {
      const batch = [...ids].filter((id) => id.startsWith(prefix));
      if (batch.length === 0) return;
      try {
        const chunks = await Promise.all(chunkIds(batch).map((ids) => query(`${soql} (${inList(ids)})`, org)));
        for (const r of chunks.flat()) {
          const id = String(r.Id);
          names.set(id, String(r.Name));
          names.set(id.slice(0, 15), String(r.Name));
        }
      } catch {
        // Labels fall back to raw Ids.
      }
    })
  );
  return names;
}

function collectCompliance(moduleType: string, org: string): Promise<StudioSurface> {
  return surface("compliance", async () => {
    const rows = await query(
      `SELECT Id, Name, ModuleType, StatementType FROM ComplianceStatementDef WHERE ModuleType = '${moduleType.replace(/'/g, "\\'")}' ORDER BY Name`,
      org
    );
    return {
      items: rows.map((r) =>
        item(r.Id as string, r.Name as string, {
          sublabel: r.StatementType as string,
          properties: { Module: scalar(r.ModuleType), "Statement type": scalar(r.StatementType) },
        })
      ),
    };
  });
}

// ─── Cross-surface checks ───────────────────────────────────────────────────

/**
 * Record-triggered flows on objects that sync to LSC Mobile run on the server
 * when the iPad uploads the record, not when the rep taps Save.
 */
function flagSyncedFlows(flows: StudioSurface, dbSchema: StudioSurface, objects: ObjectInfo[]): void {
  const synced = new Set(dbSchema.items.filter((i) => i.active).map((i) => String(i.properties.SObject ?? "").toLowerCase()));
  const byLabel = new Map(objects.map((o) => [o.label, o.name]));
  for (const flow of flows.items) {
    const name = byLabel.get(String(flow.properties.Object));
    if (!flow.active || !name || !synced.has(name.toLowerCase())) continue;
    flow.findings.push({
      severity: "info",
      title: "Runs when the iPad syncs, not on Save",
      detail: `${name} syncs to LSC Mobile. Offline, nothing this flow does happens until the record uploads — reps won't see its changes on the iPad until they sync back down. To check or default values on the iPad itself, use a custom script.`,
    });
  }
}

// ─── Entry points ───────────────────────────────────────────────────────────

/** Collect a feature's map, reporting each surface to `studio_feature_map_progress` as it goes. */
export function collectFeatureMap(feature: FeatureDefinition, org: string): Promise<FeatureMap> {
  return trackMap(mapKey(feature.id), feature.id, feature.title, (tracker) => {
    if (!CUSTOM_COLLECTORS[feature.id]) {
      const ids = (Object.keys(SURFACES) as StandardSurfaceId[]).filter((id) => id !== "compliance" || feature.complianceModuleType);
      tracker.plan(ids.map((id) => ({ key: id, label: SURFACES[id].title })));
    }
    return gatherFeatureMap(feature, org);
  });
}

async function gatherFeatureMap(feature: FeatureDefinition, org: string): Promise<FeatureMap> {
  const envelope = { featureId: feature.id, title: feature.title, org, objects: feature.objects };
  const custom = CUSTOM_COLLECTORS[feature.id];
  if (custom) return { ...envelope, ...(await custom(org)), collectedAt: new Date().toISOString() };

  warmSharedReads(org);

  // Surfaces that don't depend on which objects exist start now, beside the objects describe.
  const objectsRead = collectObjects(feature, org);
  const independent = Promise.all([
    collectCustomScripts(feature, org),
    collectTriggerHandlers(feature, org),
    collectActions(feature, org),
    collectAdminSettings(feature, org),
    feature.complianceModuleType ? collectCompliance(feature.complianceModuleType, org) : Promise.resolve(null),
  ]);

  // Later surfaces only query objects that actually exist.
  const { surface: objects, found } = await objectsRead;
  const names = objects.error ? feature.objects : found.map((o) => o.name);

  const [[recordTypes, layouts, validationRules, apexTriggers, flows, dbSchema], [customScripts, triggerHandlers, actions, adminSettings, compliance]] =
    await Promise.all([
      Promise.all([
        collectRecordTypes(names, org),
        collectLayouts(names, org),
        collectValidationRules(names, org),
        collectApexTriggers(names, org),
        collectFlows(found, org),
        collectDbSchema(feature, found, org),
      ]),
      independent,
    ]);

  flagSyncedFlows(flows, dbSchema, found);

  const surfaces = [
    objects,
    recordTypes,
    layouts,
    customScripts,
    validationRules,
    apexTriggers,
    flows,
    triggerHandlers,
    dbSchema,
    actions,
    adminSettings,
    compliance,
  ].filter((s): s is StudioSurface => s !== null);

  return {
    ...envelope,
    collectedAt: new Date().toISOString(),
    summary: `${found.length} objects`,
    lanes: OBJECT_LANES,
    surfaces,
  };
}

/** Profiles for the "View as" lens, busiest first. Profiles with no active users are left out. */
export async function collectProfileOptions(org: string): Promise<ProfileOption[]> {
  const rows = await query(
    `SELECT Profile.Name pn, COUNT(Id) cnt FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY Profile.Name ORDER BY COUNT(Id) DESC`,
    org
  );
  return rows.filter((r) => r.pn).map((r) => ({ name: String(r.pn), users: Number(r.cnt ?? r.expr0 ?? 0) }));
}

/** Fetch heavyweight fields (formula, trigger body, script code) for one item. */
export async function collectItemDetail(kind: DetailKind, id: string, org: string): Promise<ItemDetail> {
  // Flows are keyed by FlowDefinitionView.DurableId, which is a developer name for packaged flows.
  if (!(kind === "flow" ? FLOW_KEY_PATTERN : ID_PATTERN).test(id)) throw new Error(`Invalid record Id: ${id}`);

  switch (kind) {
    case "flow":
      return collectFlowDetail(id, org);
    case "validationRule": {
      const [r] = await query(
        `SELECT Id, ValidationName, Active, ErrorMessage, ErrorDisplayField, Metadata FROM ValidationRule WHERE Id = '${id}'`,
        org,
        true
      );
      if (!r) throw new Error("Validation rule not found");
      const meta = (r.Metadata || {}) as Row;
      return {
        kind,
        id,
        properties: { "Error message": scalar(r.ErrorMessage), Active: scalar(r.Active) },
        code: { language: "formula", text: String(meta.errorConditionFormula || "") },
      };
    }
    case "apexTrigger": {
      const [r] = await query(
        `SELECT Id, Name, TableEnumOrId, Status, ApiVersion, Body FROM ApexTrigger WHERE Id = '${id}'`,
        org,
        true
      );
      if (!r) throw new Error("Apex trigger not found");
      // Managed-package triggers (e.g. lsc4ce) come back with Body "(hidden)".
      const body = String(r.Body || "");
      const hidden = body.trim() === "(hidden)";
      return {
        kind,
        id,
        properties: {
          Status: scalar(r.Status),
          "API version": scalar(r.ApiVersion),
          ...(hidden ? { Source: "Hidden — managed package" } : {}),
        },
        code: hidden ? undefined : { language: "apex", text: body },
      };
    }
    case "layout": {
      const [r] = await query(`SELECT Id, Name, NamespacePrefix, TableEnumOrId FROM Layout WHERE Id = '${id}'`, org, true);
      if (!r || r.TableEnumOrId !== SIDEBAR_OBJECT) throw new Error("Only Visit page layouts have an engagement sidebar");
      // Packaged layouts are retrieved as Visit-ns__Name.
      const layoutName = `${SIDEBAR_OBJECT}-${r.NamespacePrefix ? `${r.NamespacePrefix}__` : ""}${r.Name}`;
      // The layout's current related lists need a metadata retrieve; if it fails the candidates still load.
      const layout = await retrieveLayoutXml(layoutName, org).catch(() => null);
      const relatedLists = layout?.ok ? relatedListNames(layout.xml) : null;
      const described = await cachedDescribeSObject(SIDEBAR_OBJECT, org);
      const candidates = described.data
        ? relatedListOptions(described.data, relatedLists ?? [], await layoutableRelatedLists(SIDEBAR_OBJECT, org)).map((c) => ({ objectName: c.object, relationshipName: c.relationshipName }))
        : [];
      return {
        kind,
        id,
        properties: { "Layout name": layoutName },
        sidebar: { layoutName, relatedLists, max: MAX_SIDEBAR_RELATED_LISTS, candidates },
      };
    }
    case "customScript": {
      const [r] = await query(
        `SELECT Id, Name, Type, ObjectName, OperationEventType, CodeText FROM LifeScienceCustomScript WHERE Id = '${id}'`,
        org
      );
      if (!r) throw new Error("Custom script not found");
      return {
        kind,
        id,
        properties: { Type: scalar(r.Type), Object: scalar(r.ObjectName) },
        code: { language: "javascript", text: String(r.CodeText || "") },
      };
    }
  }
}

const FLOW_KEY_PATTERN = /^\w{1,120}$/;

/** A flow's active version (or latest, if none is active) as an outline plus health checks. */
async function collectFlowDetail(durableId: string, org: string): Promise<ItemDetail> {
  const [def] = await query(
    `SELECT ActiveVersionId, LatestVersionId, Description FROM FlowDefinitionView WHERE DurableId = '${durableId}'`,
    org
  );
  if (!def) throw new Error("Flow not found");
  const versionId = String(def.ActiveVersionId || def.LatestVersionId || "");
  const showing = def.ActiveVersionId ? "Active version" : "Latest version (not active)";
  const base = { kind: "flow" as const, id: durableId };
  // Packaged flows have no readable versions — their DurableIds aren't record Ids.
  const [r] = ID_PATTERN.test(versionId)
    ? await query(`SELECT Id, VersionNumber, Metadata FROM Flow WHERE Id = '${versionId}'`, org, true)
    : [];
  if (!r?.Metadata) {
    return { ...base, properties: { Description: scalar(def.Description), Source: "Managed package — its steps aren't readable" } };
  }
  const { outline, findings } = describeFlow(r.Metadata as Row);
  return {
    ...base,
    properties: { Description: scalar(def.Description), Showing: `${showing} (v${r.VersionNumber})` },
    flow: outline,
    findings,
    // Not shown as code — it's what "Ask Claude about this" and Copy hand over.
    code: { language: "flow outline", text: outlineText(outline) },
  };
}
