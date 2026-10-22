// Renderer copy of LoadProgress in src/studio/published-progress.ts.
export interface LoadStep {
  key: string;
  label: string;
  state: "waiting" | "running" | "done" | "failed";
  detail?: string;
  startedAt?: number;
  endedAt?: number;
}
export interface LoadProgress {
  profile: string;
  startedAt: number;
  finishedAt?: number;
  steps: LoadStep[];
}

/** How far along a load is: finished steps, plus the running step's "12 of 40" when it says so. */
export function loadFraction(steps: LoadStep[]): number {
  if (!steps.length) return 0;
  let sum = 0;
  for (const s of steps) {
    if (s.state === "done" || s.state === "failed") sum += 1;
    else if (s.state === "running") {
      const m = /([\d,]+) of ([\d,]+)/.exec(s.detail ?? "");
      const total = m ? Number(m[2].replace(/,/g, "")) : 0;
      // Never reaches a whole step until it finishes.
      if (total > 0) sum += Math.min(0.95, Number(m![1].replace(/,/g, "")) / total);
    }
  }
  return sum / steps.length;
}
