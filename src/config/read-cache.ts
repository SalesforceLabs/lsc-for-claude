/**
 * A short-lived, shared cache for reads that many Studio surfaces repeat — the
 * Admin Console categories, the flow list. Concurrent callers share one
 * in-flight read; a finished read is reused for `ttlMs`. Failed reads are never
 * kept. Call `invalidateSharedReads(org)` after anything that writes to the org.
 */

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

export function sharedRead<T>(org: string, key: string, read: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const k = keyOf(org, key);
  const hit = entries.get(k);
  if (hit && (hit.expiresAt === undefined || hit.expiresAt > Date.now())) return hit.promise as Promise<T>;

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

/** Forget cached reads for one org (or all). */
export function invalidateSharedReads(org?: string): void {
  generation++;
  if (!org) return entries.clear();
  const prefix = `${org}\u0000`;
  for (const k of [...entries.keys()]) if (k.startsWith(prefix)) entries.delete(k);
}
