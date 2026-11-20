import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateOrgConnection } from "../salesforce/auth.js";
import { getKnownCauses, type KnownCause } from "../validation/known-causes.js";
import { executeCheck, type CheckOutcome } from "../validation/rules-executor.js";
import { recordNames } from "../validation/diagnose.js";

/**
 * Order Management (quoted orders, Store Check) configuration check.
 *
 * The checks are the Order Management known causes in
 * knowledge/troubleshooting/known-causes.yaml that carry a `check`, so this
 * report and `diagnose_lsc_issue` always agree. A cause with no check is listed
 * under "Not checked here".
 */

export const OM_MODULE = "order-management";

/**
 * Causes whose check can flag a setup the org chose on purpose (an editable
 * Submitted stage, owners approved some other way): a warning, not a failure.
 */
export const OM_WARN_ONLY = new Set([
  "om-submitted-stage-not-locked",
  "om-unlock-no-manager",
  "om-locked-quote-no-view-line-items",
]);

/** Passes when the org uses Order Management at all: a Quote product alignment exists. */
export const OM_IN_USE_QUERY =
  "SELECT Id FROM ProductTerritoryAvailability WHERE Purpose = 'Quote' LIMIT 1";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export interface OmCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
  scope?: string;
}

/** The Order Management causes that can be checked against an org. */
export function omCheckableCauses(causes: KnownCause[] = getKnownCauses()): KnownCause[] {
  return causes.filter((c) => c.module === OM_MODULE && c.check && !c.by_design);
}

/** Order Management causes with no automatic check, by title. */
export function omUncheckedCauses(causes: KnownCause[] = getKnownCauses()): KnownCause[] {
  return causes.filter((c) => c.module === OM_MODULE && !c.check && !c.by_design);
}

const oneLine = (s: string) => s.trim().replace(/\s*\n\s*/g, " ");

/** Turns one cause's check outcome into a report row. `applies` is its applies_if outcome. */
export function toOmCheck(
  cause: KnownCause,
  outcome: CheckOutcome,
  applies?: CheckOutcome
): OmCheck {
  const base = {
    id: cause.id,
    title: cause.title,
    scope: cause.check_scope ? oneLine(cause.check_scope) : undefined,
  };
  if (applies && !applies.unavailable && !applies.passed)
    return {
      ...base,
      status: "pass",
      detail: "Doesn't apply: the feature it concerns isn't in use.",
    };
  if (outcome.unavailable || applies?.unavailable)
    return {
      ...base,
      status: "skip",
      detail: `Couldn't check: ${oneLine((applies?.unavailable ? applies : outcome).message)}`,
    };
  if (outcome.passed) return { ...base, status: "pass", detail: "Not found in the org." };
  const names = recordNames(outcome);
  const shown = names.slice(0, 5).join(", ");
  const more = names.length > 5 ? ` and ${names.length - 5} more` : "";
  return {
    ...base,
    status: OM_WARN_ONLY.has(cause.id) ? "warn" : "fail",
    detail: names.length ? `Found: ${shown}${more}` : oneLine(outcome.message),
    fix: cause.fix.join(" "),
  };
}

export async function collectOmChecks(org: string): Promise<OmCheck[]> {
  const causes = omCheckableCauses();
  // Four at a time: each is one query, and the limiter caps sf calls anyway.
  const out: OmCheck[] = new Array(causes.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, causes.length) }, async () => {
      while (next < causes.length) {
        const i = next++;
        const cause = causes[i];
        const applies = cause.applies_if ? await executeCheck(cause.applies_if, org) : undefined;
        const outcome =
          applies && !applies.unavailable && !applies.passed
            ? { passed: true, message: "" }
            : await executeCheck(cause.check!, org);
        out[i] = toOmCheck(cause, outcome, applies);
      }
    })
  );
  return out;
}

/** True when the org has any Quote product alignment; null when that couldn't be read. */
export async function omInUse(org: string): Promise<boolean | null> {
  const r = await executeCheck(
    { type: "soql", query: OM_IN_USE_QUERY, expect: "records.length > 0" } as never,
    org
  );
  return r.unavailable ? null : r.passed;
}

export function renderOmReport(org: string, checks: OmCheck[], inUse: boolean | null): string {
  let out = `# Order Management Configuration Report\n\n**Org:** ${org}\n\n`;
  if (inUse === false)
    out +=
      "No product is aligned to a territory for quotes (`ProductTerritoryAvailability` with Purpose Quote), so Order Management doesn't look set up here. The checks still ran.\n\n";
  out += "| Check | Result | Detail |\n|---|---|---|\n";
  for (const c of checks)
    out += `| ${c.title} | ${c.status.toUpperCase()} | ${c.detail.replace(/\|/g, "\\|")} |\n`;
  const bad = checks.filter((c) => c.status === "fail" || c.status === "warn");
  out += `\n## Overall: ${checks.some((c) => c.status === "fail") ? "NEEDS ATTENTION" : bad.length ? "READY WITH WARNINGS" : "READY"}\n\n`;
  const fixes = bad.filter((c) => c.fix);
  if (fixes.length) {
    out += "### Fixes\n\n";
    fixes.forEach((c, i) => (out += `${i + 1}. **${c.title}:** ${c.fix}\n`));
    out += "\n";
  }
  if (checks.some((c) => c.status === "skip"))
    out += "Checks marked SKIP couldn't run; they are not passes.\n\n";
  const scoped = checks.filter((c) => c.scope);
  if (scoped.length) {
    out += "### What a pass doesn't cover\n\n";
    for (const c of scoped) out += `- **${c.title}:** ${c.scope}\n`;
    out += "\n";
  }
  const unchecked = omUncheckedCauses();
  if (unchecked.length)
    out += `Not checked here (${unchecked.length} known causes need a look by hand or an error message; \`diagnose_lsc_issue\` matches them): ${unchecked.map((c) => c.title).join("; ")}.\n`;
  return out;
}

export function register(server: McpServer) {
  server.tool(
    "check_om_config",
    "Check Order Management (quoted orders, Store Check) configuration against the known setup mistakes: DB Schema pairs (Quote/QuoteLineItem, Pricebook2/PricebookEntry) half assigned to a profile, price adjustment schedules with no EffectiveFrom, the Life Sciences Commercial pricing recipe mappings, StagePathPermissionsHandler, the Submitted quote stage lock, unpublished Quote product alignments (ProductTerritoryAvailability with no ProductTerrDtlAvailability), quote owners with no manager for Request for Unlock, locked stages with no View Line Items, and Store Check visit routing. Read-only. CORRECT object names: Quote, QuoteLineItem, Pricebook2, PricebookEntry, ProductTerritoryAvailability, ProductTerrDtlAvailability, PriceAdjustmentSchedule, LifeSciStagePath, LifeSciStageOperation. WRONG names (DO NOT USE): Order__c, QuotedOrder__c, ProductAvailability__c.",
    {
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to check. Uses current target org if not specified."),
    },
    async ({ targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;
      if (!effectiveOrg) {
        return {
          content: [
            { type: "text", text: `# Cannot Check Order Management\n\n${validation.error}` },
          ],
        };
      }
      try {
        const [checks, inUse] = await Promise.all([
          collectOmChecks(effectiveOrg),
          omInUse(effectiveOrg),
        ]);
        return { content: [{ type: "text", text: renderOmReport(effectiveOrg, checks, inUse) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `# Failed to Check Order Management\n\n${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
