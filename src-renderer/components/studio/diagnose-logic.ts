/**
 * "Paste an error": `studio_diagnose` items shown as check rows, the verdict, and what's
 * sent to Roz. Mirrors `DiagnosisItem` in src/validation/diagnose.ts.
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

/** One diagnosis item as a check row. A cause that's present is a "Fix", never "Blocking". */
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

/** What Roz gets: the error, what was checked, and the one item the user asked about (or all). */
export function diagnosisPrompt(text: string, result: DiagnosisResult, only?: DiagnosisItem): string {
  const items = only ? [only] : result.items;
  const lines = items.map((i) => {
    const records = i.records.length ? ` Records: ${i.records.map((r) => r.replace(/\.$/, "")).join("; ")}.` : "";
    return `- ${i.title} (${i.kind === "rule" ? "rule" : "known cause"} ${i.id}): ${detailOf(i, Boolean(result.checkedOrg))}.${records}`;
  });
  const quoted = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
  return [
    "An admin pasted this LSC error into Studio's Paste an error page:",
    "",
    "```",
    quoted,
    "```",
    "",
    result.checkedOrg ? `Studio checked these known causes against ${result.checkedOrg}:` : "Studio matched these known causes (no org checked):",
    ...lines,
    "",
    only
      ? "Help me fix this one. Confirm it in the org first, then walk me through the fix."
      : "Help me find which one it is and fix it. Use diagnose_lsc_issue if you need the full details.",
  ].join("\n");
}
