/**
 * Pure helpers behind the Setup Overview's metadata-cache checks: what each
 * profile's iPad last downloaded, and which Admin Console changes came after.
 */

import type { Row } from "./helpers.js";
import { configItems, type ConfigEdit, type UnpublishedItem } from "./unpublished-logic.js";

export interface ProfileCache {
  profileId: string;
  /** Newest Active cache record's LastModifiedDate (ms), if any. */
  activeAt?: number;
  /** When that record's generation started (its CreatedDate, if earlier): changes after this may not be in it, as `studio_unpublished` counts. */
  activeStartedAt?: number;
  /** The newest record overall failed to generate and is newer than the newest Active one. */
  failed?: { at: number; message: string };
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** A record's generation error, if it reports one. */
export function cacheError(r: Row): string | null {
  const message = text(r.IntegrationErrorMessage) || text(r.IntegrationErrorCode);
  if (message) return message;
  if (/error|fail/i.test(text(r.IntegrationStatus)))
    return `Integration status: ${text(r.IntegrationStatus)}`;
  if (/fail|error/i.test(text(r.Status))) return `Status: ${text(r.Status)}`;
  return null;
}

/** Per profile: the newest Active cache time, and whether a newer record failed. Rows without a profile are ignored. */
export function cachesByProfile(rows: Row[]): Map<string, ProfileCache> {
  const out = new Map<string, ProfileCache>();
  for (const r of rows) {
    const profileId = text(r.ProfileId);
    if (!profileId) continue;
    const at = Date.parse(text(r.LastModifiedDate));
    if (Number.isNaN(at)) continue;
    const entry = out.get(profileId) ?? { profileId };
    out.set(profileId, entry);
    if (r.Status === "Active") {
      if (entry.activeAt === undefined || at > entry.activeAt) {
        entry.activeAt = at;
        const created = Date.parse(text(r.CreatedDate));
        entry.activeStartedAt = Number.isFinite(created) ? Math.min(created, at) : at;
      }
    } else {
      const message = cacheError(r);
      if (message && (!entry.failed || at > entry.failed.at)) entry.failed = { at, message };
    }
  }
  for (const entry of out.values()) {
    // A failure older than the live cache has been superseded.
    if (entry.failed && entry.activeAt !== undefined && entry.failed.at <= entry.activeAt)
      delete entry.failed;
  }
  return out;
}

export interface Unpublished {
  profileId: string;
  /** Admin Console changes that reach the profile's iPads only after a publish. */
  items: UnpublishedItem[];
}

/**
 * For each profile with a live cache, the Admin Console edits made after its generation started that
 * still need a publish — the same rules and boundary as `studio_unpublished` (`configItems`).
 */
export function unpublishedChanges(
  caches: Map<string, ProfileCache>,
  edits: ConfigEdit[]
): Unpublished[] {
  const out: Unpublished[] = [];
  for (const cache of caches.values()) {
    if (cache.activeAt === undefined) continue;
    const items = configItems(
      edits,
      cache.profileId,
      cache.activeStartedAt ?? cache.activeAt
    ).filter((i) => i.reach?.ipad === "publish");
    if (items.length) out.push({ profileId: cache.profileId, items });
  }
  return out;
}

export function daysSince(at: number, now = Date.now()): number {
  return Math.floor((now - at) / 86_400_000);
}
