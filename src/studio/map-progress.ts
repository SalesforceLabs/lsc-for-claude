/**
 * Progress of a running `collectFeatureMap` (or `collectReadiness`), so Studio can show which
 * surface a slow load is on (studio_feature_map_progress). One entry per load key; a new load
 * of the same key replaces it. Collectors don't pass a tracker around: `buildSurface` finds the
 * running one through an AsyncLocalStorage scope, so every collector, including the org-wide
 * ones, reports without changes.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type MapStepState = "waiting" | "running" | "done" | "failed";

export interface MapStep {
  key: string;
  label: string;
  state: MapStepState;
  /** The result ("12 layouts"), partial progress ("3 of 8 objects described") or why it failed. */
  detail?: string;
  /** Items found, once the step is done. */
  count?: number;
  startedAt?: number;
  endedAt?: number;
}

export interface MapProgress {
  featureId: string;
  title: string;
  startedAt: number;
  finishedAt?: number;
  steps: MapStep[];
}

/** How long a finished load stays readable, so the last poll can see it end. */
const KEEP_FINISHED_MS = 2 * 60_000;
const KEEP_STALE_MS = 30 * 60_000;
const MAX_ENTRIES = 60;

const runs = new Map<string, MapProgress>();

function prune(now = Date.now()): void {
  for (const [k, p] of runs) {
    const stale = p.finishedAt ? now - p.finishedAt > KEEP_FINISHED_MS : now - p.startedAt > KEEP_STALE_MS;
    if (stale) runs.delete(k);
  }
  while (runs.size > MAX_ENTRIES) runs.delete(runs.keys().next().value as string);
}

export class MapTracker {
  constructor(readonly progress: MapProgress) {}

  /** Steps that will run, so the checklist shows them before they start. */
  plan(steps: { key: string; label: string }[]): void {
    for (const s of steps) if (!this.find(s.key)) this.progress.steps.push({ key: s.key, label: s.label, state: "waiting" });
  }

  /** A step began (planned or not). */
  start(key: string, label: string): void {
    this.plan([{ key, label }]);
    const step = this.find(key) as MapStep;
    if (step.state === "waiting") {
      step.state = "running";
      step.startedAt = Date.now();
    }
  }

  /** A step ended: `count` items found, or `error`. */
  end(key: string, outcome: { count?: number; noun?: string; error?: string; detail?: string }): void {
    const step = this.find(key);
    if (!step) return;
    step.endedAt = Date.now();
    if (outcome.error) {
      step.state = "failed";
      step.detail = outcome.error;
      return;
    }
    step.state = "done";
    if (outcome.count !== undefined) {
      step.count = outcome.count;
      step.detail = outcome.detail ?? countText(outcome.count, outcome.noun ?? "item");
    } else if (outcome.detail) step.detail = outcome.detail;
  }

  /** Say how far a step is ("3 of 8 objects described"). */
  detail(key: string, text: string | undefined): void {
    const step = this.find(key);
    if (step && step.state === "running") step.detail = text;
  }

  /** The load returned: steps that never ran drop out. */
  finish(): void {
    this.progress.steps = this.progress.steps.filter((s) => s.state !== "waiting");
    this.progress.finishedAt = Date.now();
  }

  private find(key: string): MapStep | undefined {
    return this.progress.steps.find((s) => s.key === key);
  }
}

export function countText(n: number, noun: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? noun : pluralNoun(noun)}`;
}

function pluralNoun(noun: string): string {
  return /(?:s|x|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`;
}

const scope = new AsyncLocalStorage<MapTracker>();

/** The tracker of the load this code runs inside, if any. */
export function currentMapTracker(): MapTracker | undefined {
  return scope.getStore();
}

/** Run `fn` as the load `key`, reporting its surfaces to `studio_feature_map_progress`. */
export async function trackMap<T>(key: string, featureId: string, title: string, fn: (tracker: MapTracker) => Promise<T>): Promise<T> {
  prune();
  const tracker = new MapTracker({ featureId, title, startedAt: Date.now(), steps: [] });
  runs.set(key, tracker.progress);
  try {
    return await scope.run(tracker, () => fn(tracker));
  } finally {
    tracker.finish();
  }
}

export function mapProgress(key: string): MapProgress | null {
  return runs.get(key) ?? null;
}

/** Progress keys: the map and the readiness load of a feature are tracked apart. */
export const mapKey = (featureId: string) => featureId;
export const readinessKey = (featureId: string) => `readiness:${featureId}`;
