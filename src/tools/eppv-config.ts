import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import { validateOrgConnection } from "../salesforce/auth.js";
import { chunkIds, queryAssignments, queryFieldValues, extractFieldValue } from "./helpers.js";

/** DB Schema records Account Compliance needs on the iPad (SObject → record DeveloperName `DbSchema_<SObject>`). */
export const EPPV_DB_SCHEMA_OBJECTS = [
  "CareProgram",
  "CareProgramProduct",
  "ActionPlan",
  "ActionPlanItem",
  "ActionPlanTemplate",
  "ActionPlanTemplateVersion",
  "ActionPlanTemplateAssignment",
  "ActionPlanTemplateItem",
  "ActionPlanTemplateItemValue",
  "PrvdEngmtComplianceCycle",
  "AssessmentTask",
] as const;

/** The four flows to clone, schedule and activate. Clones are matched by API name prefix. */
export const EPPV_FLOWS: Array<{ prefix: string; role: string }> = [
  { prefix: "Schedule_Action_Plan_Sharing", role: "visibility: Action Plans to territories" },
  { prefix: "Schedule_Care_Program_Sharing", role: "visibility: Care Programs to territories" },
  { prefix: "Schedule_Assessment_Task_Update", role: "scheduled assessment task and cycle update" },
  {
    prefix: "Update_Assessment_Task_On_Visit_Completion",
    role: "completes a cycle when the visit is Completed",
  },
];

export const EPPV_TAB_NAME = "standard-AccountCompliance";
export const EPPV_QUICK_ACTION = "AssociateCareProgram";
export const EPPV_PLAN_TYPE = "PrvdEngmtCompliance";
export const EPPV_CATEGORY = "ProviderEngagementCompliance";

type Row = Record<string, unknown>;
export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export interface EppvCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const inList = (ids: string[]) => ids.map(q).join(",");

/** Plans that are In Progress but have no cycles at all (cycles are generated on Start). */
export function plansWithoutCycles(
  plans: Array<{ Id: string; ActionPlanState?: unknown }>,
  cycleCountByPlan: Map<string, number>
): string[] {
  return plans
    .filter((p) => p.ActionPlanState === "In Progress" && !(cycleCountByPlan.get(p.Id) ?? 0))
    .map((p) => p.Id);
}

/** Pairs of plans on the same HCO and Care Program, which show as duplicate hospitals on the iPad. */
export function duplicatePlans(
  plans: Array<{ Id: string; TargetId?: unknown; TargetReferenceRecordId?: unknown }>
): string[][] {
  const groups = new Map<string, string[]>();
  for (const p of plans) {
    if (!p.TargetId) continue;
    const key = `${p.TargetId}|${p.TargetReferenceRecordId ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), p.Id]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Which of the expected flows (by API-name prefix) has no active, unmanaged flow. */
export function missingFlows(flows: Row[]): Array<{ prefix: string; role: string; state: string }> {
  const out: Array<{ prefix: string; role: string; state: string }> = [];
  for (const exp of EPPV_FLOWS) {
    const matches = flows.filter(
      (f) => !f.NamespacePrefix && String(f.ApiName ?? "").startsWith(exp.prefix)
    );
    if (matches.length === 0) out.push({ ...exp, state: "not found (not cloned)" });
    else if (!matches.some((f) => f.IsActive === true))
      out.push({ ...exp, state: "found but not active" });
  }
  return out;
}

async function tooling(query: string, org: string): Promise<{ rows: Row[]; error?: string }> {
  const r = await runToolingQuery(query, org);
  if (!r.success) return { rows: [], error: r.error || "query failed" };
  if (r.data?.truncated)
    return { rows: (r.data.records ?? []) as Row[], error: "result truncated" };
  return { rows: (r.data?.records ?? []) as Row[] };
}

async function soql(query: string, org: string): Promise<{ rows: Row[]; error?: string }> {
  const r = await runSoqlQuery(query, org);
  if (!r.success) return { rows: [], error: r.error || "query failed" };
  if (r.data?.truncated)
    return { rows: (r.data.records ?? []) as Row[], error: "result truncated" };
  return { rows: (r.data?.records ?? []) as Row[] };
}

export async function collectEppvChecks(org: string, profileName?: string): Promise<EppvCheck[]> {
  const checks: EppvCheck[] = [];
  const add = (c: EppvCheck) => checks.push(c);
  const couldNot = (id: string, title: string, err: string): EppvCheck => ({
    id,
    title,
    status: "skip",
    detail: `Couldn't check: ${err}`,
  });

  // 1. Care Programs
  const programs = await soql(
    `SELECT Id, Name, Status, StartDate, EndDate FROM CareProgram WHERE Category = ${q(EPPV_CATEGORY)} ORDER BY Name LIMIT 200`,
    org
  );
  if (programs.error && programs.rows.length === 0) {
    add(couldNot("care-programs", "Care Programs", programs.error));
  } else if (programs.rows.length === 0) {
    add({
      id: "care-programs",
      title: "Care Programs",
      status: "fail",
      detail: `No Care Program with Category ${EPPV_CATEGORY}.`,
      fix: "Create a Care Program with Category ProviderEngagementCompliance. Announce Date must be today or later; Start >= Pre-cycle Start >= Announce.",
    });
  } else {
    add({
      id: "care-programs",
      title: "Care Programs",
      status: "pass",
      detail: `${programs.rows.length} program(s): ${programs.rows.map((p) => `${p.Name} (${p.Status})`).join(", ")}.`,
    });
  }
  const programIds = programs.rows.map((p) => p.Id as string);

  // 2. Products on each program
  if (programIds.length > 0) {
    const withProduct = new Set<string>();
    let err: string | undefined;
    for (const chunk of chunkIds(programIds)) {
      const r = await soql(
        `SELECT CareProgramId FROM CareProgramProduct WHERE CareProgramId IN (${inList(chunk)})`,
        org
      );
      err ??= r.error;
      for (const row of r.rows) withProduct.add(row.CareProgramId as string);
    }
    const bare = programs.rows.filter((p) => !withProduct.has(p.Id as string));
    if (err) add(couldNot("program-products", "Care Program Products", err));
    else
      add({
        id: "program-products",
        title: "Care Program Products",
        status: bare.length ? "warn" : "pass",
        detail: bare.length
          ? `No product on: ${bare.map((p) => p.Name).join(", ")}.`
          : "Every program has at least one product.",
        fix: bare.length
          ? "A product can't be added once the announce date is today or earlier. Insert the program with dates at today+2, add the product, then set the dates to today."
          : undefined,
      });
  }

  // 3. Action Plans
  const plans = await soql(
    `SELECT Id, Name, ActionPlanState, TargetId, TargetReferenceRecordId, ActionPlanTemplateVersionId FROM ActionPlan WHERE ActionPlanType = ${q(EPPV_PLAN_TYPE)} LIMIT 2000`,
    org
  );
  const planRows = plans.rows as Array<Row & { Id: string }>;
  if (plans.error && planRows.length === 0) {
    add(couldNot("action-plans", "Action Plans", plans.error));
  } else if (planRows.length === 0) {
    add({
      id: "action-plans",
      title: "Action Plans",
      status: "warn",
      detail: `No Action Plan of type ${EPPV_PLAN_TYPE}. Reps have nothing in Account Compliance.`,
      fix: "Create an Action Plan per target HCO (TargetId = account, TargetReferenceRecordId = Care Program), then press Start Compliance Action Plan.",
    });
  } else {
    const byState = new Map<string, number>();
    for (const p of planRows)
      byState.set(String(p.ActionPlanState), (byState.get(String(p.ActionPlanState)) ?? 0) + 1);
    add({
      id: "action-plans",
      title: "Action Plans",
      status: "pass",
      detail: `${planRows.length} plan(s): ${[...byState].map(([s, n]) => `${n} ${s}`).join(", ")}.${plans.error ? " (list cut short)" : ""}`,
    });

    const noTarget = planRows.filter((p) => !p.TargetId);
    add({
      id: "plan-target",
      title: "Plans have a target HCO",
      status: noTarget.length ? "fail" : "pass",
      detail: noTarget.length
        ? `${noTarget.length} plan(s) have no TargetId: ${noTarget
            .slice(0, 5)
            .map((p) => p.Name)
            .join(
              ", "
            )}. The iPad shows "Unknown Account" and visit save fails with "Account and Place cannot be empty".`
        : "Every plan has a TargetId.",
      fix: noTarget.length
        ? "Set TargetId to the HCO account (it can't be edited after Start; recreate the plan)."
        : undefined,
    });

    const noProgram = planRows.filter((p) => !p.TargetReferenceRecordId);
    if (noProgram.length)
      add({
        id: "plan-program",
        title: "Plans point at a Care Program",
        status: "fail",
        detail: `${noProgram.length} plan(s) have no TargetReferenceRecordId (Care Program).`,
      });

    const dups = duplicatePlans(planRows);
    if (dups.length)
      add({
        id: "plan-duplicates",
        title: "Duplicate plans",
        status: "warn",
        detail: `${dups.length} HCO/Care Program pair(s) have more than one plan, which shows duplicate hospitals on the iPad.`,
        fix: "Delete or stop the old plans.",
      });

    // Cycles for In Progress plans
    const started = planRows.filter((p) => p.ActionPlanState === "In Progress").map((p) => p.Id);
    if (started.length) {
      const counts = new Map<string, number>();
      let err: string | undefined;
      for (const chunk of chunkIds(started)) {
        const r = await soql(
          `SELECT ActionPlanId, COUNT(Id) c FROM PrvdEngmtComplianceCycle WHERE ActionPlanId IN (${inList(chunk)}) GROUP BY ActionPlanId`,
          org
        );
        err ??= r.error;
        for (const row of r.rows) counts.set(row.ActionPlanId as string, Number(row.c));
      }
      const empty = plansWithoutCycles(planRows, counts);
      if (err) add(couldNot("plan-cycles", "In Progress plans have cycles", err));
      else
        add({
          id: "plan-cycles",
          title: "In Progress plans have cycles",
          status: empty.length ? "fail" : "pass",
          detail: empty.length
            ? `${empty.length} In Progress plan(s) have no cycles (set to In Progress without the Start button?).`
            : `All ${started.length} In Progress plan(s) have cycles.`,
          fix: empty.length
            ? "Only the Start Compliance Action Plan button generates cycles. Recreate the plan and start it with the button."
            : undefined,
        });
    }

    // Completed cycles must have a completion task
    const done = await runSoqlQuery(
      `SELECT COUNT() FROM PrvdEngmtComplianceCycle WHERE Status = 'Completed' AND CompletionAssessmentTaskId = NULL`,
      org
    );
    if (done.success) {
      const n = done.data?.totalSize ?? 0;
      add({
        id: "cycle-completion-task",
        title: "Completed cycles have a completion task",
        status: n ? "warn" : "pass",
        detail: n
          ? `${n} Completed cycle(s) have no CompletionAssessmentTaskId (completed by hand rather than by a visit's compliance activity).`
          : "Every Completed cycle links to its AssessmentTask.",
      });
    }
  }

  // 4. Flows
  const flows = await soql(
    `SELECT ApiName, Label, ProcessType, TriggerType, IsActive, NamespacePrefix FROM FlowDefinitionView WHERE ${EPPV_FLOWS.map((f) => `ApiName LIKE '${f.prefix}%'`).join(" OR ")}`,
    org
  );
  if (flows.error && flows.rows.length === 0) {
    add(couldNot("flows", "Cloned flows", flows.error));
  } else {
    const missing = missingFlows(flows.rows);
    add({
      id: "flows",
      title: "Cloned flows active",
      status: missing.length ? "fail" : "pass",
      detail: missing.length
        ? missing.map((m) => `${m.prefix}* (${m.role}): ${m.state}`).join("; ")
        : "All four flows are cloned and active.",
      fix: missing.length
        ? "Clone each missing flow, schedule the scheduled ones, then activate. Update_Assessment_Task_On_Visit_Completion_Clone is what completes a cycle."
        : undefined,
    });
  }

  // 5. DB Schema (Tooling)
  const names = EPPV_DB_SCHEMA_OBJECTS.map((o) => `DbSchema_${o}`);
  const db = await tooling(
    `SELECT Id, DeveloperName, IsActive FROM LifeSciConfigRecord WHERE DeveloperName IN (${inList(names)})`,
    org
  );
  if (db.error && db.rows.length === 0) {
    add(couldNot("db-schema", "DB Schema records", db.error));
  } else {
    const byName = new Map(db.rows.map((r) => [r.DeveloperName as string, r]));
    const missing = names.filter((n) => !byName.has(n));
    const inactive = names.filter((n) => byName.has(n) && byName.get(n)!.IsActive !== true);
    const ids = db.rows.map((r) => r.Id as string);
    const [assign, fv] = await Promise.all([
      queryAssignments(ids, org).catch(() => new Map()),
      queryFieldValues(ids, org, true),
    ]);
    const unassigned = names.filter((n) => {
      const r = byName.get(n);
      if (!r) return false;
      const a = assign.get(r.Id as string) ?? [];
      return profileName
        ? !a.some((x: { name: string }) => x.name === profileName)
        : a.length === 0;
    });
    const filtered = names.filter((n) => {
      const r = byName.get(n);
      if (!r) return false;
      const w = (fv.fieldValuesByRecord.get(r.Id as string) ?? []).find(
        (f) => f.FieldName === "WhereSoql"
      );
      return !!w && !!extractFieldValue(w);
    });
    const problems = [
      missing.length ? `missing: ${missing.map((n) => n.replace("DbSchema_", "")).join(", ")}` : "",
      inactive.length
        ? `inactive: ${inactive.map((n) => n.replace("DbSchema_", "")).join(", ")}`
        : "",
      unassigned.length
        ? `not assigned${profileName ? ` to ${profileName}` : " to any profile"}: ${unassigned.map((n) => n.replace("DbSchema_", "")).join(", ")}`
        : "",
    ].filter(Boolean);
    add({
      id: "db-schema",
      title: "DB Schema records (11)",
      status: missing.length || inactive.length || unassigned.length ? "fail" : "pass",
      detail: problems.length
        ? problems.join("; ") + "."
        : "All 11 exist, are active and assigned.",
      fix: problems.length
        ? "create_db_schema / toggle_db_schema for each, assigned to the rep profile, then regenerate the cache."
        : undefined,
    });
    if (filtered.length)
      add({
        id: "db-schema-filters",
        title: "DB Schema records have no field filters",
        status: "warn",
        detail: `WhereSoql set on: ${filtered.map((n) => n.replace("DbSchema_", "")).join(", ")}. The working setup has no filters on these.`,
      });
  }

  // 6. Account Compliance tab and quick action (Admin Console)
  const ui = await tooling(
    `SELECT Id, DeveloperName, IsActive, (SELECT FieldName, TextValue FROM LifeSciConfigFieldValues) FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId IN (SELECT Id FROM LifeSciConfigCategory WHERE Category = 'UISchema')`,
    org
  );
  const hasField = (r: Row, field: string, value: string) =>
    (((r.LifeSciConfigFieldValues as Row | null)?.records as Row[] | undefined) ?? []).some(
      (f) => f.FieldName === field && f.TextValue === value
    );
  if (ui.error && ui.rows.length === 0) add(couldNot("tab", "Account Compliance tab", ui.error));
  else {
    const tab = ui.rows.filter((r) => hasField(r, "TabName", EPPV_TAB_NAME));
    const active = tab.filter((r) => r.IsActive === true);
    const profs = active.length
      ? await queryAssignments(
          active.map((r) => r.Id as string),
          org
        ).catch(() => new Map())
      : new Map();
    const assigned = active.some((r) => {
      const a = profs.get(r.Id as string) ?? [];
      return profileName ? a.some((x: { name: string }) => x.name === profileName) : a.length > 0;
    });
    add({
      id: "tab",
      title: "Account Compliance tab",
      status: active.length && assigned ? "pass" : "fail",
      detail: !tab.length
        ? `No navigation tab with TabName ${EPPV_TAB_NAME}.`
        : !active.length
          ? "The tab exists but is inactive."
          : assigned
            ? "Active and assigned."
            : `Active but not assigned${profileName ? ` to ${profileName}` : " to any profile"}.`,
      fix:
        active.length && assigned
          ? undefined
          : "add_navigation_tab with tabName standard-AccountCompliance, enabled for the rep profile.",
    });
  }

  const qa = await tooling(
    `SELECT Id, DeveloperName, IsActive, (SELECT FieldName, TextValue, PicklistValue FROM LifeSciConfigFieldValues) FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId IN (SELECT Id FROM LifeSciConfigCategory WHERE Category = 'QuickAction')`,
    org
  );
  if (qa.error && qa.rows.length === 0)
    add(couldNot("quick-action", "Report Compliance Activity", qa.error));
  else {
    const hit = qa.rows.filter(
      (r) =>
        (((r.LifeSciConfigFieldValues as Row | null)?.records as Row[] | undefined) ?? []).some(
          (f) => f.FieldName === "ActionName" && f.PicklistValue === EPPV_QUICK_ACTION
        ) && r.IsActive === true
    );
    // Quick actions keep their profiles in a semicolon-separated Profiles text field.
    const assigned = hit.some((r) => {
      const names =
        (
          (((r.LifeSciConfigFieldValues as Row | null)?.records as Row[] | undefined) ?? []).find(
            (f) => f.FieldName === "Profiles"
          )?.TextValue as string | undefined
        )
          ?.split(";")
          .map((n) => n.trim())
          .filter(Boolean) ?? [];
      return profileName ? names.includes(profileName) : names.length > 0;
    });
    add({
      id: "quick-action",
      title: "Capture Compliance Activity quick action",
      status: hit.length && assigned ? "pass" : "fail",
      detail: !hit.length
        ? `No active quick action of type ${EPPV_QUICK_ACTION}.`
        : assigned
          ? "Active and assigned (labelled Report Compliance Activity on the iPad)."
          : `Active but not assigned${profileName ? ` to ${profileName}` : " to any profile"}.`,
      fix:
        hit.length && assigned
          ? undefined
          : `create_quick_action with action type ${EPPV_QUICK_ACTION}, location Visit, assigned to the rep profile.`,
    });
  }

  // 7. Mobile cache
  const cache = await soql(
    `SELECT Id, Status, LastModifiedDate FROM LifeSciMobileMetadataRecord WHERE Status = 'Active' ORDER BY LastModifiedDate DESC LIMIT 5`,
    org
  );
  add(
    cache.error && cache.rows.length === 0
      ? couldNot("cache", "Mobile metadata cache", cache.error)
      : {
          id: "cache",
          title: "Mobile metadata cache",
          status: cache.rows.length ? "pass" : "fail",
          detail: cache.rows.length
            ? `Newest active cache ${String(cache.rows[0].LastModifiedDate).slice(0, 10)}. Regenerate it after any DB Schema, tab or action change.`
            : "No active metadata cache.",
          fix: cache.rows.length
            ? undefined
            : "generate_mobile_metadata_cache for one profile at a time (many at once hit REQUEST_LIMIT_EXCEEDED).",
        }
  );

  return checks;
}

export function renderEppvReport(org: string, checks: EppvCheck[]): string {
  const icon: Record<CheckStatus, string> = {
    pass: "PASS",
    warn: "WARN",
    fail: "FAIL",
    skip: "SKIP",
  };
  let out = `# Account Compliance (EPPV) Configuration Report\n\n**Org:** ${org}\n\n| Check | Result | Detail |\n|---|---|---|\n`;
  for (const c of checks)
    out += `| ${c.title} | ${icon[c.status]} | ${c.detail.replace(/\|/g, "\\|")} |\n`;
  const bad = checks.filter((c) => c.status === "fail" || c.status === "warn");
  out += `\n## Overall: ${checks.some((c) => c.status === "fail") ? "NEEDS ATTENTION" : bad.length ? "READY WITH WARNINGS" : "READY"}\n\n`;
  const fixes = bad.filter((c) => c.fix);
  if (fixes.length) {
    out += "### Fixes\n\n";
    fixes.forEach((c, i) => (out += `${i + 1}. **${c.title}:** ${c.fix}\n`));
  }
  if (checks.some((c) => c.status === "skip"))
    out += "\nChecks marked SKIP couldn't run; they are not passes.\n";
  out +=
    "\nNot checked here: Action Plan State picklist and Admin Console status mappings, Action Plan page layout actions list, Action Plan Status field-level security, template and care program page layouts, sharing rules. See the module doc `support-engineering-eppv-setup-and-troubleshooting`.\n";
  return out;
}

export function register(server: McpServer) {
  server.tool(
    "check_eppv_config",
    "Check Account Compliance (Japan EPPV/MID, Provider Engagement Compliance) configuration: Care Programs and products, compliance Action Plans (target HCO, cycles generated), the four cloned flows, the 11 DB Schema records, the Account Compliance tab, the Capture Compliance Activity quick action and the mobile cache. CORRECT object names: CareProgram, CareProgramProduct, ActionPlan, ActionPlanTemplate, ActionPlanTemplateVersion, ActionPlanTemplateAssignment, PrvdEngmtComplianceCycle, AssessmentTask. WRONG names (DO NOT USE): EPPV__c, ComplianceCycle__c, AccountCompliance__c.",
    {
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to check. Uses current target org if not specified."),
      profileName: z
        .string()
        .optional()
        .describe(
          "Optional: rep profile name. When given, DB Schema, tab and quick action must be assigned to this profile."
        ),
    },
    async ({ targetOrg, profileName }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;
      if (!effectiveOrg) {
        return {
          content: [
            { type: "text", text: `# Cannot Check Account Compliance\n\n${validation.error}` },
          ],
        };
      }
      try {
        const checks = await collectEppvChecks(effectiveOrg, profileName);
        return { content: [{ type: "text", text: renderEppvReport(effectiveOrg, checks) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Check Account Compliance\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
