/**
 * A short-lived, shared cache for reads that many Studio surfaces repeat — the
 * Admin Console categories, the flow list. Concurrent callers share one
 * in-flight read; a finished read is reused for `ttlMs`. Failed reads are never
 * kept. Call `invalidateSharedReads(org)` after anything that writes to the org.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface Entry {
  promise: Promise<unknown>;
  /** Set once the read settles successfully; in-flight reads have no expiry yet. */
  expiresAt?: number;
}

const DEFAULT_TTL_MS = 60_000;
const entries = new Map<string, Entry>();
/** Bumped by invalidation so a read that started before it never repopulates the cache. */
let generation = 0;

const keyOf = (org: string, key: string) => `${org}\u0000${key}`;

export function sharedRead<T>(
  org: string,
  key: string,
  read: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS
): Promise<T> {
  const k = keyOf(org, key);
  const hit = entries.get(k);
  if (hit && (hit.expiresAt === undefined || hit.expiresAt > Date.now()))
    return hit.promise as Promise<T>;

  prune();
  const started = generation;
  const entry: Entry = { promise: read() };
  entries.set(k, entry);
  entry.promise.then(
    () => {
      if (started === generation && entries.get(k) === entry) entry.expiresAt = Date.now() + ttlMs;
      else if (entries.get(k) === entry) entries.delete(k);
    },
    () => {
      if (entries.get(k) === entry) entries.delete(k);
    }
  );
  return entry.promise as Promise<T>;
}

/**
 * Studio's read-only surfaces (feature maps, readiness, overview, user trace, recent changes) run inside
 * this scope: while active, identical SOQL queries from anywhere in the call tree (and from concurrent
 * calls) share one read (`runSoqlQuery` checks `sharedReadsActive`). Fixes, snapshots and anything that
 * must see the org as it is right now never enter it. Any write drops every shared read for the org.
 */
const readScope = new AsyncLocalStorage<true>();

export function withSharedReads<T>(fn: () => T): T {
  return readScope.run(true, fn);
}

export function sharedReadsActive(): boolean {
  return readScope.getStore() === true;
}

/** Drop expired entries now and then so distinct query texts don't pile up. */
function prune(): void {
  if (entries.size < 500) return;
  const now = Date.now();
  for (const [k, e] of entries)
    if (e.expiresAt !== undefined && e.expiresAt <= now) entries.delete(k);
}

const lastRefresh = new Map<string, number>();

/**
 * A user's Refresh: forget shared reads for the org so the answer is read from it again. Several surfaces
 * refresh together ("Refresh all"), so a second call within a few seconds doesn't throw away what the
 * first one's reads have just fetched.
 */
export function refreshSharedReads(org: string, windowMs = 5_000): void {
  const now = Date.now();
  if (now - (lastRefresh.get(org) ?? 0) < windowMs) return;
  lastRefresh.set(org, now);
  invalidateSharedReads(org);
}

/** Forget cached reads for one org (or all). */
export function invalidateSharedReads(org?: string): void {
  generation++;
  if (!org) return entries.clear();
  const prefix = `${org}\u0000`;
  for (const k of [...entries.keys()]) if (k.startsWith(prefix)) entries.delete(k);
}
