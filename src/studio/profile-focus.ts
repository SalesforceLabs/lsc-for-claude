/**
 * Readiness for one profile. `withProfileFocus` runs a readiness or Overview load with a profile
 * picked; the helper that answers "which reps" (`ipadProfiles` in scope.ts)
 * then answers with that profile only, and data checks sample only its users' territories
 * (`focusTerritoryIds`).
 *
 * Each check records whether it asked for the focus (`trackFocusUse`, used by `runCheck`). One
 * that never did is the same for every profile, and the Readiness view says so. A memoised load
 * shared by several checks (`memoFocus`) passes its use on to every check that reads it.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { inList, query } from "./helpers.js";

interface Usage {
  used: boolean;
}

interface Focus {
  profile: string;
  /** Read once per load. */
  territories?: Promise<string[]>;
}

const focusStore = new AsyncLocalStorage<Focus>();
const usageStore = new AsyncLocalStorage<Usage>();

/** Run `fn` with `profile` (a profile name) picked; no profile runs it for every profile. */
export function withProfileFocus<T>(profile: string | undefined, fn: () => Promise<T>): Promise<T> {
  return profile ? focusStore.run({ profile }, fn) : fn();
}

/** The picked profile's name, recording that the running check depends on it. */
export function focusedProfile(): string | undefined {
  const focus = focusStore.getStore();
  if (focus) markUsed();
  return focus?.profile;
}

/** Whether a profile is picked, without recording a use. */
export function hasProfileFocus(): boolean {
  return focusStore.getStore() !== undefined;
}

function markUsed(): void {
  const usage = usageStore.getStore();
  if (usage) usage.used = true;
}

/** Run `fn` and say whether it asked for the picked profile. */
export async function trackFocusUse<T>(fn: () => Promise<T>): Promise<{ value: T; used: boolean }> {
  const usage: Usage = { used: false };
  const value = await usageStore.run(usage, fn);
  return { value, used: usage.used };
}

/**
 * Run `fn` once and share the promise. Whether the first run asked for the picked profile is
 * passed on to every caller, so a check that reads a shared sample is marked like the one that
 * loaded it.
 */
export function memoFocus<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  const usage: Usage = { used: false };
  return () => {
    p ??= usageStore.run(usage, fn);
    // `then` runs in the caller's context, so the mark lands on the caller's check.
    return p.then(
      (v) => {
        if (usage.used) markUsed();
        return v;
      },
      (err) => {
        if (usage.used) markUsed();
        throw err;
      }
    );
  };
}

/**
 * The Ids of the active-model territories the picked profile's active users are in, or undefined
 * when no profile is picked. An empty list means the profile's users have no territory.
 */
export async function focusTerritoryIds(org: string): Promise<string[] | undefined> {
  const focus = focusStore.getStore();
  if (!focus) return undefined;
  markUsed();
  focus.territories ??= query(
    `SELECT Territory2Id FROM UserTerritory2Association WHERE IsActive = true AND User.IsActive = true AND User.Profile.Name = ${inList([focus.profile])} ` +
      `AND Territory2.Territory2Model.State = 'Active' GROUP BY Territory2Id`,
    org
  ).then((rows) => rows.map((r) => String(r.Territory2Id)).filter(Boolean));
  return focus.territories;
}

/** At most `max` of `ids`, spread over the list rather than the first ones (an IN list has to fit in the URL). */
export function spread(ids: string[], max: number): string[] {
  const step = Math.max(1, Math.ceil(ids.length / max));
  return ids.filter((_, i) => i % step === 0);
}
