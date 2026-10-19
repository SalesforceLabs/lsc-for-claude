// Renderer copy of FixProgress in src/studio/fix-progress.ts (what studio_fix_progress returns).
export type StepState = "waiting" | "running" | "done" | "failed";

export interface FixStep {
  key: string;
  label: string;
  state: StepState;
  detail?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface ChangeProgress {
  index: number;
  total: number;
  label: string;
  phase: "preview" | "apply";
  startedAt: number;
  finishedAt?: number;
  steps: FixStep[];
}

export interface FixProgress {
  id: string;
  startedAt: number;
  finishedAt?: number;
  changes: ChangeProgress[];
}

/** One change of the batch as the dialog shows it. */
export interface ChangeView {
  index: number;
  label: string;
  state: StepState;
  steps: FixStep[];
  /** 0..1 */
  fraction: number;
  startedAt?: number;
  endedAt?: number;
}

/** "12 of 40" in a step's detail; the same reading as the iPad loading card's bar. */
function partOf(detail: string | undefined): number {
  const m = /([\d,]+) of ([\d,]+)/.exec(detail ?? "");
  if (!m) return 0;
  const total = Number(m[2].replace(/,/g, ""));
  // Never reaches a whole step until it finishes.
  return total > 0 ? Math.min(0.95, Number(m[1].replace(/,/g, "")) / total) : 0;
}

/** How far one change is: finished steps, plus the running step's "2 of 5" when it says so. */
export function stepsFraction(steps: FixStep[]): number {
  if (!steps.length) return 0;
  let sum = 0;
  for (const s of steps) {
    if (s.state === "done" || s.state === "failed") sum += 1;
    else if (s.state === "running") sum += partOf(s.detail);
  }
  return sum / steps.length;
}

/**
 * The batch as one view per change, in order. A change the server hasn't reported yet is waiting,
 * unless the caller already has its result (`finished`), as the apply loop does.
 */
export function changeViews(labels: string[], progress: FixProgress | null, finished: boolean[] = []): ChangeView[] {
  return labels.map((label, index) => {
    const c = progress?.changes.find((x) => x.index === index);
    if (!c) {
      return finished[index]
        ? { index, label, state: "done" as const, steps: [], fraction: 1 }
        : { index, label, state: "waiting" as const, steps: [], fraction: 0 };
    }
    const ended = !!c.finishedAt || !!finished[index];
    const failed = c.steps.some((s) => s.state === "failed");
    return {
      index,
      label,
      state: ended ? (failed ? ("failed" as const) : ("done" as const)) : ("running" as const),
      steps: c.steps,
      fraction: ended ? 1 : stepsFraction(c.steps),
      startedAt: c.startedAt,
      endedAt: c.finishedAt,
    };
  });
}

/** Overall progress for the bar: the mean of every change's fraction. */
export function overallFraction(views: ChangeView[]): number {
  if (!views.length) return 0;
  return views.reduce((sum, v) => sum + v.fraction, 0) / views.length;
}

/** The bar's width in percent; never empty, so it reads as started. */
export const barPercent = (fraction: number): number => Math.min(100, Math.max(4, fraction * 100));

/** Whether the server told us anything yet (otherwise the dialog keeps its plain text). */
export function hasSteps(views: ChangeView[]): boolean {
  return views.some((v) => v.steps.length > 0);
}

/** The step to put in the heading: the first one running, in change order. */
export function currentStep(views: ChangeView[]): { view: ChangeView; step: FixStep } | null {
  for (const view of views) {
    if (view.state !== "running") continue;
    const step = view.steps.find((s) => s.state === "running") ?? view.steps.find((s) => s.state === "waiting");
    if (step) return { view, step };
  }
  return null;
}

/** "Change 2 of 3 · Reading Contact Layout from the org", or the plain verb before any step has begun. */
export function headline(views: ChangeView[], phase: "preview" | "apply"): string {
  const cur = currentStep(views);
  const idle = phase === "apply" ? "Applying…" : "Checking the org…";
  if (!cur) return idle;
  const prefix = views.length > 1 ? `Change ${cur.view.index + 1} of ${views.length} · ` : "";
  return `${prefix}${cur.step.label}`;
}

/** "2 of 3 changes checked" for the line under the heading, or null for one change. */
export function batchSummary(views: ChangeView[], phase: "preview" | "apply"): string | null {
  if (views.length < 2) return null;
  const done = views.filter((v) => v.state === "done" || v.state === "failed").length;
  return `${done} of ${views.length} changes ${phase === "apply" ? "applied" : "checked"}`;
}

/** "340 ms", "2.4s", "14s" — a step's time. */
export function formatStepTime(ms: number): string {
  if (ms < 950) return `${Math.max(1, Math.round(ms / 10) * 10)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

/** A step's time so far (running) or in all (ended), or "" before it began. */
export function stepTime(s: Pick<FixStep, "startedAt" | "endedAt">, now: number): string {
  return s.startedAt ? formatStepTime(Math.max(0, (s.endedAt ?? now) - s.startedAt)) : "";
}

/** Poll results only count when they are for this batch and not older than what's shown. */
export function acceptProgress(current: FixProgress | null, next: FixProgress | null | undefined, id: string): FixProgress | null {
  if (!next || next.id !== id || !Array.isArray(next.changes)) return current;
  return next;
}
