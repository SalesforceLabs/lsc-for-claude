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

/** The verdict line, red only when something blocking fails (warnings alone are amber). */
export function traceHeadline(trace: UserTrace, featureTitle?: string): { ok: boolean; tone: "pass" | "error" | "warning" | "unknown"; text: string } {
  const problem = firstProblem(trace.checks);
  if (problem) {
    const blocking = trace.checks.some((c) => c.status === "fail" && c.severity === "error");
    return { ok: false, tone: blocking ? "error" : "warning", text: `First problem: ${problem.title}` };
  }
  const ran = trace.checks.filter((c) => c.status === "pass" || c.status === "fail").length;
  if (ran === 0) return { ok: false, tone: "unknown", text: "Couldn't check this user" };
  const unknown = trace.checks.filter((c) => c.status === "unknown" && c.severity !== "info").length;
  if (unknown) return { ok: false, tone: "unknown", text: `Not verified: ${unknown} check${unknown === 1 ? "" : "s"} couldn't run` };
  return { ok: true, tone: "pass", text: featureTitle ? `Ready for ${featureTitle}` : "Ready for the iPad" };
}

/** Does fixing this check need a new iPad publish? */
export function needsPublish(check: ReadinessCheck): boolean {
  return check.status === "fail" && check.id.startsWith("user.mobile.");
}
