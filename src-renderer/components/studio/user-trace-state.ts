import type { ReadinessCheck } from "./types";

/** Renderer copy of `UserTrace` in src/studio/user-trace.ts. */
export interface UserTrace {
  org: string;
  collectedAt: string;
  userId: string;
  userName: string;
  profile: string | null;
  featureId: string | null;
  checks: ReadinessCheck[];
}

export type TraceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; trace: UserTrace };

/** The first link in the chain that is broken (failing, any severity but suggestions), in trace order. */
export function firstProblem(checks: ReadinessCheck[]): ReadinessCheck | undefined {
  return checks.find((c) => c.status === "fail" && c.severity !== "info");
}

export function traceHeadline(trace: UserTrace, featureTitle?: string): { ok: boolean; text: string } {
  const problem = firstProblem(trace.checks);
  if (problem) return { ok: false, text: `First problem: ${problem.title}` };
  const ran = trace.checks.filter((c) => c.status === "pass" || c.status === "fail").length;
  if (ran === 0) return { ok: false, text: "Couldn't check this user" };
  const unknown = trace.checks.filter((c) => c.status === "unknown" && c.severity !== "info").length;
  if (unknown) return { ok: false, text: `Not verified: ${unknown} check${unknown === 1 ? "" : "s"} couldn't run` };
  return { ok: true, text: featureTitle ? `Ready for ${featureTitle}` : "Ready for the iPad" };
}

/** Does fixing this check need a new iPad publish? */
export function needsPublish(check: ReadinessCheck): boolean {
  return check.status === "fail" && check.id.startsWith("user.mobile.");
}

/** A prompt for "Ask Claude" about the user's first problem. */
export function traceAskPrompt(trace: UserTrace, featureTitle?: string): string {
  const problem = firstProblem(trace.checks);
  const lines = [
    `In my LSC org, ${trace.userName}${trace.profile ? ` (${trace.profile})` : ""} can't ${featureTitle ? `use ${featureTitle}` : "use the iPad app"} as expected.`,
  ];
  if (problem) {
    lines.push(`Studio's user check found the first broken link: "${problem.title}" (${problem.id}).`);
    if (problem.detail) lines.push(`Detail: ${problem.detail}`);
    if (problem.why) lines.push(`Why it matters: ${problem.why}`);
  }
  lines.push("Explain what's wrong and walk me through fixing it.");
  return lines.join("\n");
}
