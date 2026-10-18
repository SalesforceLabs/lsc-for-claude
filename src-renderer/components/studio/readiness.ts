import type { FeatureReadiness, ReadinessCheck, ReadinessStage } from "./types";
import type { StatusTone } from "../ui/StatusIcon";
import type { Revalidating } from "./fix-effects";

/**
 * Readiness verdicts — pure helpers behind the Readiness view, the Setup
 * Overview, and the user check. A check that couldn't run or was skipped never
 * counts for or against a feature.
 */

export type ReadinessState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | ({ status: "ready"; readiness: FeatureReadiness } & Revalidating);

/** Stage titles, in order. Copy of `STAGES` in src/studio/readiness/index.ts. */
export const STAGES: { id: ReadinessStage; title: string }[] = [
  { id: "enabled", title: "Switched on" },
  { id: "access", title: "Access" },
  { id: "data", title: "Data" },
  { id: "config", title: "Settings & rules" },
  { id: "mobile", title: "iPad" },
];

/**
 * ready — nothing blocking or to fix. issues — warnings only. blocked — an error-severity check fails.
 * unknown — nothing fails, but too little ran to say: no check ran, an error-severity check couldn't run,
 * or more couldn't run than did.
 */
export type Verdict = "ready" | "issues" | "blocked" | "unknown";

export interface ReadinessSummary {
  verdict: Verdict;
  /** Checks that ran (pass + fail). */
  ran: number;
  passed: number;
  blocking: ReadinessCheck[];
  toFix: ReadinessCheck[];
  /** Failing info-severity checks — best practice, not counted against the verdict. */
  suggestions: ReadinessCheck[];
  unknown: number;
  skipped: number;
}

export function summarize(checks: ReadinessCheck[]): ReadinessSummary {
  const failing = checks.filter((c) => c.status === "fail");
  const blocking = failing.filter((c) => c.severity === "error");
  const toFix = failing.filter((c) => c.severity === "warning");
  const suggestions = failing.filter((c) => c.severity === "info");
  const ran = checks.filter((c) => c.status === "pass" || c.status === "fail").length;
  const unknown = checks.filter((c) => c.status === "unknown");
  const unverified = ran === 0 || unknown.length > ran || unknown.some((c) => c.severity === "error");
  const verdict: Verdict = blocking.length ? "blocked" : toFix.length ? "issues" : unverified ? "unknown" : "ready";
  return {
    verdict,
    ran,
    passed: checks.filter((c) => c.status === "pass").length,
    blocking,
    toFix,
    suggestions,
    unknown: unknown.length,
    skipped: checks.filter((c) => c.status === "skipped").length,
  };
}

/** The tone a verdict is shown in: ready passes, works-with-issues warns, blocked fails, unverified is neutral. */
export function verdictTone(v: Verdict): StatusTone {
  return { ready: "pass", issues: "warning", blocked: "error", unknown: "unknown" }[v] as StatusTone;
}

export function verdictText(s: ReadinessSummary): string {
  switch (s.verdict) {
    case "blocked":
      return `Not ready: ${plural(s.blocking.length, "blocking issue")}${s.toFix.length ? `, ${s.toFix.length} more to fix` : ""}`;
    case "issues":
      return `Works, with ${plural(s.toFix.length, "issue")} to fix`;
    case "ready":
      return `Ready: all ${s.ran} checks pass`;
    case "unknown":
      return s.ran ? `Not verified: ${plural(s.unknown, "check")} couldn't run` : "Couldn't check this feature";
  }
}

/** Checks grouped by stage, in stage order; empty stages are left out. */
export function byStage(checks: ReadinessCheck[]): { stage: (typeof STAGES)[number]; checks: ReadinessCheck[] }[] {
  return STAGES.map((stage) => ({ stage, checks: checks.filter((c) => c.stage === stage.id) })).filter((g) => g.checks.length);
}

/** Failing checks first (blocking, then to fix, then suggestions), then unknown, skipped, passing. */
export function sortForAttention(checks: ReadinessCheck[]): ReadinessCheck[] {
  const rank = (c: ReadinessCheck) =>
    c.status === "fail" ? { error: 0, warning: 1, info: 2 }[c.severity] : c.status === "unknown" ? 3 : c.status === "skipped" ? 4 : 5;
  return checks.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(({ c }) => c);
}

/** A prompt for "Ask Claude" about one failing check. */
export function askPrompt(featureTitle: string, check: ReadinessCheck): string {
  const lines = [
    `In my LSC org, the ${featureTitle} readiness check "${check.title}" (${check.id}) is ${check.status === "unknown" ? "unable to run" : "failing"}.`,
  ];
  if (check.detail) lines.push(`Studio found: ${check.detail}`);
  if (check.examples?.length) lines.push(`Examples: ${check.examples.join(", ")}`);
  if (check.why) lines.push(`Why it matters: ${check.why}`);
  lines.push("Explain what's wrong and walk me through fixing it.");
  return lines.join("\n");
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
