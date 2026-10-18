import { getDb } from "./history.js";
import { STUDIO_CACHE_MAX_ROWS, STUDIO_CACHE_TTL_MS, isFresh, ttlFor } from "./studio-cache-policy.js";

/**
 * Persistent cache for Studio tool results. Feature maps fan out to dozens of
 * sf CLI queries, so results are kept per org until the user hits Refresh or
 * they pass the TTL (`studio-cache-policy.ts`).
 */

let initialized = false;

/**
 * Bump when the shape of a cached result changes (e.g. a new FeatureMap field),
 * so maps saved by an older build are re-collected instead of shown half-empty.
 */
const CACHE_VERSION = 5;
const key = (tool: string) => `${tool}@${CACHE_VERSION}`;

function db() {
  const d = getDb();
  if (!initialized) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS studio_cache (
        org TEXT NOT NULL,
        tool TEXT NOT NULL,
        args TEXT NOT NULL,
        data TEXT NOT NULL,
        cached_at TEXT NOT NULL,
        PRIMARY KEY (org, tool, args)
      );
    `);
    initialized = true;
    prune(d);
  }
  return d;
}

/** Drop expired and older-version rows, then the oldest beyond the size cap. */
function prune(d: ReturnType<typeof getDb>): void {
  const cutoff = new Date(Date.now() - STUDIO_CACHE_TTL_MS).toISOString();
  d.prepare("DELETE FROM studio_cache WHERE cached_at < ? OR tool NOT LIKE ?").run(cutoff, `%@${CACHE_VERSION}`);
  d.prepare(
    `DELETE FROM studio_cache WHERE rowid IN (
       SELECT rowid FROM studio_cache ORDER BY cached_at DESC LIMIT -1 OFFSET ?)`
  ).run(STUDIO_CACHE_MAX_ROWS);
}

/** The stored JSON text and when it was saved (ISO), or undefined when missing or past the TTL. */
export function getStudioCacheRow(org: string, tool: string, args: string): { text: string; cachedAt: string } | undefined {
  const row = db()
    .prepare("SELECT data, cached_at FROM studio_cache WHERE org = ? AND tool = ? AND args = ?")
    .get(org, key(tool), args) as { data: string; cached_at: string } | undefined;
  if (!row) return undefined;
  if (!isFresh(row.cached_at, Date.now(), ttlFor(tool))) {
    db().prepare("DELETE FROM studio_cache WHERE org = ? AND tool = ? AND args = ?").run(org, key(tool), args);
    return undefined;
  }
  return { text: row.data, cachedAt: row.cached_at };
}

export function getStudioCacheText(org: string, tool: string, args: string): string | undefined {
  return getStudioCacheRow(org, tool, args)?.text;
}

export function getStudioCache(org: string, tool: string, args: string): unknown | undefined {
  const text = getStudioCacheText(org, tool, args);
  return text === undefined ? undefined : JSON.parse(text);
}

/** Store a result already serialized as JSON text, so a large map is stringified once. */
export function setStudioCacheText(org: string, tool: string, args: string, text: string): void {
  db()
    .prepare(
      "INSERT OR REPLACE INTO studio_cache (org, tool, args, data, cached_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(org, key(tool), args, text, new Date().toISOString());
}

export function setStudioCache(org: string, tool: string, args: string, data: unknown): void {
  setStudioCacheText(org, tool, args, JSON.stringify(data));
}

/** Drop cached results for an org, optionally only for one tool. */
export function clearStudioCache(org: string, tool?: string): void {
  if (tool) db().prepare("DELETE FROM studio_cache WHERE org = ? AND tool = ?").run(org, key(tool));
  else db().prepare("DELETE FROM studio_cache WHERE org = ?").run(org);
}
