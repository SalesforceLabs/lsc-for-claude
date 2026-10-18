/**
 * What Studio keeps in its persistent cache, and for how long. Pure, so it can be tested
 * without a database.
 */

/** Cached results older than this are dropped; the user can always Refresh sooner. */
export const STUDIO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Most rows kept in the table; the oldest go first when pruning at startup. */
export const STUDIO_CACHE_MAX_ROWS = 400;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** True when the value carries any generic "this is partial" marker. */
function marked(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (typeof v.error === "string" && v.error) return true;
  if (Array.isArray(v.errors) && v.errors.length > 0) return true;
  return v.truncated === true || v.timedOut === true;
}

/**
 * Failures that may go away on the next try — timeouts, row caps, network and limit errors.
 * Anything else (an object this org doesn't have, a missing permission) is the org's answer
 * and is as cacheable as a pass.
 */
const TRANSIENT =
  /timed out|didn't answer within|too many for one query|too many records to read|QUERY_TIMEOUT|REQUEST_LIMIT_EXCEEDED|SERVER_UNAVAILABLE|UNABLE_TO_LOCK_ROW|lost the connection|socket hang up|ECONN|ETIMEDOUT|ENOTFOUND|HTTP 5\d\d|Engine not started/i;

function transient(v: unknown, field: "error" | "detail"): boolean {
  return isObj(v) && typeof v[field] === "string" && TRANSIENT.test(v[field] as string);
}

/**
 * Whether a tool result is complete enough to keep. Results cut short by something transient (a
 * surface or check that timed out, a truncated query) would otherwise stick until the TTL, so
 * the next open retries instead.
 */
export function isCacheable(toolName: string, data: unknown): boolean {
  if (!isObj(data) || marked(data)) return false;
  // A layout whose XML couldn't be retrieved.
  if (isObj(data.sidebar) && data.sidebar.relatedLists === null) return false;
  const rows = (key: string): unknown[] => (Array.isArray(data[key]) ? (data[key] as unknown[]) : []);
  switch (toolName) {
    case "studio_feature_map":
      return !rows("surfaces").some((s) => transient(s, "error") || (isObj(s) && (s.truncated === true || s.timedOut === true)));
    case "studio_readiness":
    case "studio_setup_overview":
      return !rows("checks").some((c) => transient(c, "error") || (isObj(c) && c.status === "unknown" && transient(c, "detail")));
    default:
      return true;
  }
}

/** True when a row cached at `cachedAt` (ISO) is still fresh at `now`. */
export function isFresh(cachedAt: string, now = Date.now(), ttl = STUDIO_CACHE_TTL_MS): boolean {
  const t = Date.parse(cachedAt);
  return Number.isFinite(t) && now - t < ttl;
}
