/**
 * `diagnose_lsc_issue` items (chat's diagnosis card) shown as check rows, and the verdict.
 * Mirrors `DiagnosisItem` in src/validation/diagnose.ts.
 */

import type { ReadinessCheck } from "./types";

export type DiagnosisStatus = "found" | "not-found" | "unchecked" | "no-check";

export interface DiagnosisItem {
  id: string;
  kind: "cause" | "rule";
  title: string;
  area: string;
  status: DiagnosisStatus;
  byDesign: boolean;
  notApplicable: boolean;
  why: string;
  steps: string[];
  uiPath?: string;
  message?: string;
  records: string[];
  failedRules: { id: string; name: string; message: string }[];
  checkScope?: string;
  matched: string;
  score: number;
}

export interface DiagnosisResult {
  items: DiagnosisItem[];
  checkedOrg: string | null;
  orgNote?: string;
}

function detailOf(item: DiagnosisItem, connected: boolean): string {
  if (item.byDesign) return "This is how LSC works, not a setup mistake.";
  switch (item.status) {
    case "found":
      if (item.records.length > 0) return `Found in your org: ${item.records.length === 1 ? "1 record" : `${item.records.length} records`} to fix`;
      if (item.failedRules.length > 0) return `Found in your org: ${item.failedRules[0].message}`;
      return item.message ? `Found in your org: ${item.message}` : "Found in your org";
    case "not-found":
      if (item.notApplicable) return "Doesn't apply here: the feature it depends on isn't on";
      return item.checkScope ? `Not in your org. The check doesn't cover everything: ${item.checkScope}` : "Not in your org";
    case "unchecked":
      return connected ? `Couldn't check: ${item.message ?? "the check didn't run"}` : "Not checked: no org connected";
    case "no-check":
      return "No automatic check. Open it for the steps to look by hand.";
  }
}

/** One diagnosis item as a check row. A cause that's present is "Worth fixing", never "Fix now". */
export function toCheck(item: DiagnosisItem, connected: boolean): ReadinessCheck {
  const status: ReadinessCheck["status"] = item.byDesign
    ? "skipped"
    : item.status === "found"
      ? "fail"
      : item.status === "not-found"
        ? "pass"
        : "unknown";
  const ruleLines = item.failedRules.map((r) => `${r.name} failed: ${r.message}`);
  return {
    id: item.id,
    stage: "config",
    title: item.title,
    status,
    severity: "warning",
    detail: detailOf(item, connected),
    why: [item.why, ...ruleLines].join(" "),
    steps: item.steps,
    uiPath: item.uiPath,
    examples: item.records.length > 0 ? item.records : undefined,
    source: item.kind === "rule" ? "rule" : "cause",
  };
}

export interface DiagnosisVerdict {
  tone: "pass" | "warning" | "info" | "unknown";
  title: string;
}

export function diagnosisVerdict(result: DiagnosisResult): DiagnosisVerdict {
  const { items, checkedOrg } = result;
  const found = items.filter((i) => i.status === "found" && !i.byDesign).length;
  const byDesign = items.filter((i) => i.byDesign).length;
  const n = items.length;
  const causes = `${n} possible cause${n === 1 ? "" : "s"}`;
  if (!checkedOrg) return { tone: "info", title: `${causes}. Connect an org to check which apply.` };
  if (found > 0) return { tone: "warning", title: `${found} of ${causes} found in ${checkedOrg}` };
  if (byDesign > 0 && byDesign === n) return { tone: "info", title: "This is how LSC works, not a setup mistake" };
  const open = items.filter((i) => i.status === "unchecked" || i.status === "no-check").length;
  return open > 0
    ? { tone: "unknown", title: `None of the checked causes are in ${checkedOrg}. ${open} ${open === 1 ? "needs" : "need"} a look by hand.` }
    : { tone: "pass", title: `None of the ${causes} are in ${checkedOrg}` };
}
