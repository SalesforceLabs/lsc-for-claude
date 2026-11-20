/**
 * Diagnose an LSC error or symptom
 *
 * Matches what the user pasted against known causes and validation rules, then — when an org
 * is connected — runs the checks of the best matches, so the answer says which causes are
 * actually present in this org rather than listing everything that might apply.
 */

import { executeCheck, type CheckOutcome } from "./rules-executor.js";
import { getAllRules, getRuleById, type ValidationRule } from "./rules-loader.js";
import { getKnownCauses, type KnownCause } from "./known-causes.js";
import { matchSymptom, possibleCauses, type SymptomMatch } from "./symptom-match.js";

export type CheckStatus = "found" | "not-found" | "unchecked" | "no-check";

export interface CauseFinding {
  match: SymptomMatch;
  status: CheckStatus;
  outcome?: CheckOutcome;
  /** The cause's `applies_if` failed: the feature it concerns isn't in use. */
  notApplicable?: boolean;
  /** Linked validation rules that failed. */
  failedRules: Array<{ rule: ValidationRule; outcome: CheckOutcome }>;
  /** A weaker match offered as a possible cause, not as an answer. */
  possible?: boolean;
}

export interface Diagnosis {
  symptom: string;
  targetOrg?: string;
  findings: CauseFinding[];
}

/** How many matches to keep and check. */
export const MAX_MATCHES = 6;
export const MAX_RULE_MATCHES = 3;

function statusOf(outcome: CheckOutcome | undefined): CheckStatus {
  if (!outcome) return "no-check";
  if (outcome.unavailable) return "unchecked";
  return outcome.passed ? "not-found" : "found";
}

const STATUS_ORDER: Record<CheckStatus, number> = {
  found: 0,
  unchecked: 1,
  "no-check": 2,
  "not-found": 3,
};

export async function diagnose(
  symptom: string,
  targetOrg?: string,
  deps: { causes?: KnownCause[]; rules?: ValidationRule[]; run?: typeof executeCheck } = {}
): Promise<Diagnosis> {
  const causes = deps.causes ?? getKnownCauses();
  const rules = deps.rules ?? getAllRules();
  const exec = deps.run ?? executeCheck;
  // Checks that look for something the user named (a tab) read it from the symptom.
  const run = (check: Parameters<typeof executeCheck>[0], org: string) =>
    exec(check, org, { symptom });

  // A rule linked from a matched cause is checked as part of that cause, not listed again.
  const matches = matchSymptom(symptom, causes, rules);
  const linked = new Set(matches.flatMap((m) => (m.kind === "cause" ? (m.item.rules ?? []) : [])));
  // Several rule files share generic symptoms; a few rules are enough beside the causes.
  let rulesLeft = MAX_RULE_MATCHES;
  const kept = matches
    .filter((m) => m.kind === "cause" || (!linked.has(m.item.id) && rulesLeft-- > 0))
    .slice(0, MAX_MATCHES);
  // Weaker matches are worth a look when the message is a paraphrase no symptom covers.
  const possible = new Set(possibleCauses(symptom, causes, matches));
  kept.push(...possible);

  const findById = (id: string) => rules.find((r) => r.id === id) ?? getRuleById(id);

  const checked = await Promise.all(
    kept.map(async (match): Promise<CauseFinding> => {
      if (!targetOrg)
        return { match, status: match.item.check ? "unchecked" : "no-check", failedRules: [] };
      if (match.kind === "rule") {
        const outcome = await run(match.item.check, targetOrg);
        return { match, status: statusOf(outcome), outcome, failedRules: [] };
      }
      const cause = match.item;
      if (cause.applies_if && cause.check && !cause.by_design) {
        const applies = await run(cause.applies_if, targetOrg);
        if (!applies.passed && !applies.unavailable) {
          return {
            match,
            status: "not-found",
            outcome: applies,
            notApplicable: true,
            failedRules: [],
          };
        }
      }
      const [outcome, ruleOutcomes] = await Promise.all([
        cause.by_design || !cause.check ? undefined : run(cause.check, targetOrg),
        Promise.all(
          (cause.rules ?? []).map(async (id) => {
            const rule = findById(id);
            return rule ? { rule, outcome: await run(rule.check, targetOrg) } : null;
          })
        ),
      ]);
      const failedRules = ruleOutcomes.filter(
        (r): r is { rule: ValidationRule; outcome: CheckOutcome } =>
          r !== null && !r.outcome.passed && !r.outcome.unavailable
      );
      let status = statusOf(outcome);
      // A failed linked rule is evidence of the cause even when the cause has no check of its own.
      if (failedRules.length > 0 && status !== "found") status = "found";
      return { match, status, outcome, failedRules };
    })
  );
  const findings = checked.map((f) => (possible.has(f.match) ? { ...f, possible: true } : f));

  // Matches first, then possible causes; within each, what the org shows first, then the best
  // match. A possible cause the org shows stays behind the matches: its check finds a problem
  // the org has whatever the user typed, so it is a lead, not the answer to this message.
  const rank = (f: CauseFinding) => (f.possible ? 1 : 0);
  findings.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (targetOrg ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status] : 0) ||
      b.match.score - a.match.score
  );
  return { symptom, targetOrg, findings };
}

// ============================================================================
// FORMATTING
// ============================================================================

/** Names of the records a failed check returned, for the report. */
export function recordNames(outcome: CheckOutcome | undefined): string[] {
  const details = outcome?.details as { records?: Array<Record<string, unknown>> } | undefined;
  if (!details?.records) return [];
  return details.records.map((r) => {
    const name =
      r.DeveloperName ??
      r.Name ??
      r.QualifiedApiName ??
      r.ValidationName ??
      r.EndpointUrl ??
      r.LifeSciConfigRecordId ??
      r.Id;
    const extra = r.InternalSharingModel ?? r.Context;
    const entity = (r.EntityDefinition as Record<string, unknown> | undefined)?.QualifiedApiName;
    return [entity ? `${entity}.${name}` : String(name), extra ? `(${extra})` : ""]
      .join(" ")
      .trim();
  });
}

/** YAML block text as one paragraph. */
function oneLine(text: string): string {
  return text.trim().replace(/\s*\n\s*/g, " ");
}

function statusLine(finding: CauseFinding, connected: boolean): string {
  const byDesign = finding.match.kind === "cause" && finding.match.item.by_design;
  if (byDesign) return "**This is how LSC works.**";
  switch (finding.status) {
    case "found":
      return "**Found in your org.**";
    case "not-found":
      return finding.notApplicable
        ? "Checked: doesn't apply here (the handler or feature it depends on isn't on in your org)."
        : "Checked: not present in your org.";
    case "unchecked":
      return connected
        ? `Couldn't check: ${finding.outcome?.message ?? "the check didn't run"}`
        : "Not checked (no org connected).";
    case "no-check":
      return "No automatic check. Look at the org with the steps below.";
  }
}

function formatFinding(finding: CauseFinding, connected: boolean): string {
  const { match } = finding;
  let out = "";
  if (match.kind === "cause") {
    const cause = match.item;
    out += `## ${cause.title}\n\n`;
    out += `${statusLine(finding, connected)}\n\n`;
    const names = recordNames(finding.outcome);
    if (finding.status === "found" && names.length > 0) {
      out += `Records to fix:\n${names
        .slice(0, 10)
        .map((n) => `- ${n}`)
        .join("\n")}\n\n`;
    }
    for (const { rule, outcome } of finding.failedRules) {
      out += `Failed check ${rule.id} (${rule.name}): ${outcome.message}\n\n`;
    }
    out += `**Why:** ${oneLine(cause.cause)}\n\n`;
    out += `**${cause.by_design ? "What to do" : "Fix"}:**\n`;
    cause.fix.forEach((step, i) => (out += `${i + 1}. ${step}\n`));
    if (cause.ui_path) out += `\n**Where:** ${cause.ui_path}\n`;
    if (cause.check_scope && finding.status === "not-found")
      out += `\n_The check doesn't cover everything: ${cause.check_scope}_\n`;
  } else {
    const rule = match.item;
    out += `## ${rule.name} (${rule.id})\n\n`;
    out += `${statusLine(finding, connected)}\n\n`;
    if (finding.status === "found" && finding.outcome) out += `${finding.outcome.message}\n\n`;
    out += `**Why:** ${oneLine(rule.description)}\n\n`;
    out += `**Fix:**\n`;
    rule.resolution.steps.forEach((step, i) => (out += `${i + 1}. ${step}\n`));
    if (rule.resolution.ui_path) out += `\n**Where:** ${rule.resolution.ui_path}\n`;
  }
  out += `\n_Matched on: "${match.matched}"_\n\n---\n\n`;
  return out;
}

export function formatDiagnosis(diagnosis: Diagnosis): string {
  const { symptom, targetOrg, findings } = diagnosis;
  const connected = Boolean(targetOrg);
  let out = `# Diagnosis: "${symptom.length > 200 ? `${symptom.slice(0, 200)}…` : symptom}"\n\n`;

  if (findings.length === 0) {
    out += "Nothing in the known causes or validation rules matches this.\n\n";
    out += "- Paste the exact error text, including object and field names.\n";
    out +=
      "- Run `audit_mobile_config({ group: 'full-mobile-audit' })` or `health_check` for a broad check.\n";
    out += "- Search the docs with `search_lsc_knowledge`.\n";
    return out;
  }

  const main = findings.filter((f) => !f.possible);
  const weaker = findings.filter((f) => f.possible);
  const found = main.filter((f) => f.status === "found").length;
  const weakerFound = weaker.filter((f) => f.status === "found").length;
  const causes = (n: number) => `${n} possible cause${n === 1 ? "" : "s"}`;
  const alsoFound =
    weakerFound > 0
      ? ` ${weakerFound} of the weaker matches below ${weakerFound === 1 ? "is" : "are"} in the org too: a problem the org has, but maybe not this one.`
      : "";
  if (main.length === 0) {
    out +=
      weakerFound > 0
        ? `Nothing matches this closely. ${causes(weaker.length)} ${weaker.length === 1 ? "shares" : "share"} some of its words, and ${weakerFound} ${weakerFound === 1 ? "is" : "are"} in ${targetOrg}. That is a problem the org has; check it fits what the user sees before calling it the cause.\n\n`
        : `Nothing matches this closely. ${causes(weaker.length)} ${weaker.length === 1 ? "shares" : "share"} some of its words${connected ? `; none were found in ${targetOrg}` : ""}. Treat ${weaker.length === 1 ? "it as a lead" : "them as leads"}, not ${weaker.length === 1 ? "an answer" : "answers"}.\n\n`;
  } else if (connected) {
    out +=
      (found > 0
        ? `Checked against ${targetOrg}: ${found} of ${causes(main.length)} found in the org.`
        : `Checked against ${targetOrg}: none of the checkable causes below are present. Work through the others by hand.`) +
      `${alsoFound}\n\n`;
  } else {
    out += `${causes(main.length)}. Connect an org to check which apply.\n\n`;
  }

  for (const finding of main) out += formatFinding(finding, connected);
  if (weaker.length > 0) {
    if (main.length > 0)
      out += `## Possible causes (weaker match)\n\nThese share some words with the message. Look at them if nothing above fits.\n\n---\n\n`;
    for (const finding of weaker) out += formatFinding(finding, connected);
  }
  return out;
}

// ============================================================================
// JSON (Studio)
// ============================================================================

/** One finding as plain data, for the chat diagnosis card and failed publishes. */
export interface DiagnosisItem {
  id: string;
  kind: "cause" | "rule";
  title: string;
  /** The cause's module, or the rule's category. */
  area: string;
  status: CheckStatus;
  byDesign: boolean;
  notApplicable: boolean;
  /** Why it happens (cause) or what the rule checks. */
  why: string;
  steps: string[];
  uiPath?: string;
  /** The check's message when it ran. */
  message?: string;
  /** Records the failed check returned, at most 10. */
  records: string[];
  failedRules: { id: string; name: string; message: string }[];
  /** What a passing check doesn't cover. */
  checkScope?: string;
  matched: string;
  score: number;
  /** A weaker match: show it as a possible cause, apart from the matches. */
  possible?: boolean;
}

export function diagnosisItems(diagnosis: Diagnosis): DiagnosisItem[] {
  return diagnosis.findings.map(
    ({ match, status, outcome, notApplicable, failedRules, possible }) => {
      const base = {
        ...(possible ? { possible: true } : {}),
        status,
        notApplicable: Boolean(notApplicable),
        message: outcome?.message,
        records: status === "found" ? recordNames(outcome).slice(0, 10) : [],
        failedRules: failedRules.map(({ rule, outcome: o }) => ({
          id: rule.id,
          name: rule.name,
          message: o.message,
        })),
        matched: match.matched,
        score: Math.round(match.score * 100) / 100,
      };
      if (match.kind === "cause") {
        const c = match.item;
        return {
          ...base,
          id: c.id,
          kind: "cause" as const,
          title: c.title,
          area: c.module,
          byDesign: Boolean(c.by_design),
          why: oneLine(c.cause),
          steps: c.fix,
          uiPath: c.ui_path,
          checkScope: c.check_scope ? oneLine(c.check_scope) : undefined,
        };
      }
      const r = match.item;
      return {
        ...base,
        id: r.id,
        kind: "rule" as const,
        title: r.name,
        area: String(r.category),
        byDesign: false,
        why: oneLine(r.description),
        steps: r.resolution.steps,
        uiPath: r.resolution.ui_path,
      };
    }
  );
}
