// Renderer copy of MapProgress in src/studio/map-progress.ts (what studio_feature_map_progress returns).
import type { LoadStep } from "./published-loading-logic";

export interface MapProgress {
  featureId: string;
  title: string;
  startedAt: number;
  finishedAt?: number;
  steps: (LoadStep & { count?: number })[];
}

/** A running step this long is called out, in seconds. */
export const SLOW_STEP_SECONDS = 8;
export const SLOW_LOAD_SECONDS = 20;

/** The note under the checklist: the slowest running step, or a general one when the whole load drags. */
export function slowNote(steps: MapProgress["steps"], now: number, startedAt: number): string | null {
  const slow = steps
    .filter((s) => s.state === "running" && s.startedAt && now - s.startedAt > SLOW_STEP_SECONDS * 1000)
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))[0];
  if (slow) {
    const detail = slow.detail ? ` — ${slow.detail}` : "";
    return `${slow.label} ${/s$/.test(slow.label) ? "are" : "is"} taking a while${detail}. Big orgs take longer; the rest keeps loading meanwhile.`;
  }
  if (now - startedAt > SLOW_LOAD_SECONDS * 1000) return "This is taking longer than usual. Large orgs can take a minute on the first open; later opens reuse what was read.";
  return null;
}
