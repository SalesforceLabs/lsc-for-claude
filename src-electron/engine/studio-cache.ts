import { getDb } from "./history.js";

/**
 * Persistent cache for Studio tool results. Feature maps fan out to dozens of
 * sf CLI queries, so results are kept per org until the user hits Refresh.
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
  }
  return d;
}

export function getStudioCache(org: string, tool: string, args: string): unknown | undefined {
  const row = db()
    .prepare("SELECT data FROM studio_cache WHERE org = ? AND tool = ? AND args = ?")
    .get(org, key(tool), args) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}

export function setStudioCache(org: string, tool: string, args: string, data: unknown): void {
  db()
    .prepare(
      "INSERT OR REPLACE INTO studio_cache (org, tool, args, data, cached_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(org, key(tool), args, JSON.stringify(data), new Date().toISOString());
}

/** Drop cached results for an org, optionally only for one tool. */
export function clearStudioCache(org: string, tool?: string): void {
  if (tool) db().prepare("DELETE FROM studio_cache WHERE org = ? AND tool = ?").run(org, key(tool));
  else db().prepare("DELETE FROM studio_cache WHERE org = ?").run(org);
}
