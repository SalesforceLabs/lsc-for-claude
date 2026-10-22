/**
 * In-memory TTL cache for frequently queried Salesforce metadata.
 *
 * Caches are scoped by target org so switching orgs never returns stale data.
 * Entries expire after a configurable TTL (default 120 seconds).
 */

export interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
}

/** Default TTL in milliseconds (2 minutes) */
const DEFAULT_TTL_MS = 120_000;

/** Most entries kept; past this the oldest go first, so a long session can't grow without bound. */
const MAX_ENTRIES = 500;

/** Global cache store — keyed by `${orgAlias}:${cacheKey}` */
const store = new Map<string, CacheEntry>();

/**
 * Build a composite key scoped to the current org.
 */
function compositeKey(org: string, key: string): string {
  return `${org}:${key}`;
}

/**
 * Get a cached value. Returns `undefined` on miss or expiry.
 */
export function cacheGet<T>(org: string, key: string): T | undefined {
  const ck = compositeKey(org, key);
  const entry = store.get(ck);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(ck);
    return undefined;
  }
  return entry.value as T;
}

/**
 * Store a value in the cache.
 */
export function cacheSet<T>(
  org: string,
  key: string,
  value: T,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  const ck = compositeKey(org, key);
  // Delete first so a re-set moves to the end of the insertion order (newest).
  store.delete(ck);
  store.set(ck, { value, expiresAt: Date.now() + ttlMs });
  if (store.size > MAX_ENTRIES) {
    cachePrune();
    while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
  }
}

/**
 * Drop every expired entry (reads only drop the one they hit).
 */
export function cachePrune(now: number = Date.now()): void {
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}

// Sweep in the background too, so idle entries don't sit in memory until the next write.
setInterval(() => cachePrune(), 60_000).unref();

/**
 * Invalidate all entries for a specific org.
 * Call this when the user switches target orgs.
 */
export function cacheInvalidateOrg(org: string): void {
  const prefix = `${org}:`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

/**
 * Clear the entire cache (useful for testing or hard resets).
 */
export function cacheClear(): void {
  store.clear();
}

/**
 * Return current cache size (for diagnostics).
 */
export function cacheSize(): number {
  return store.size;
}

/**
 * Build a cache key from a SOQL/Tooling query string.
 * Normalises whitespace so cosmetic differences don't cause misses.
 */
export function queryCacheKey(query: string, tooling: boolean = false): string {
  const normalised = query.replace(/\s+/g, " ").trim();
  return `${tooling ? "tooling" : "soql"}:${normalised}`;
}

/**
 * Build a cache key for an sObject describe call.
 */
export function describeCacheKey(objectName: string): string {
  return `describe:${objectName}`;
}
