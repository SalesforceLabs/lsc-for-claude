/**
 * Pure helpers behind the Setup Overview's metadata-cache checks: what each
 * profile's iPad last downloaded, and which Admin Console changes came after.
 */

import type { Row } from "./helpers.js";

export interface ProfileCache {
  profileId: string;
  /** Newest Active cache record's LastModifiedDate (ms), if any. */
  activeAt?: number;
  /** The newest record overall failed to generate and is newer than the newest Active one. */
  failed?: { at: number; message: string };
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** A record's generation error, if it reports one. */
export function cacheError(r: Row): string | null {
  const message = text(r.IntegrationErrorMessage) || text(r.IntegrationErrorCode);
  if (message) return message;
  if (/error|fail/i.test(text(r.IntegrationStatus))) return `Integration status: ${text(r.IntegrationStatus)}`;
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
      if (entry.activeAt === undefined || at > entry.activeAt) entry.activeAt = at;
    } else {
      const message = cacheError(r);
      if (message && (!entry.failed || at > entry.failed.at)) entry.failed = { at, message };
    }
  }
  for (const entry of out.values()) {
    // A failure older than the live cache has been superseded.
    if (entry.failed && entry.activeAt !== undefined && entry.failed.at <= entry.activeAt) delete entry.failed;
  }
  return out;
}

/** An Admin Console record edited (or whose assignments were edited) at `at`. */
export interface ConfigChange {
  label: string;
  at: number;
  /** Profile ids it's assigned to. */
  profileIds: string[];
  /** Applies to every profile: org-level, or assigned through something other than a profile. */
  allProfiles: boolean;
}

export interface Unpublished {
  profileId: string;
  changes: ConfigChange[];
}

/** For each profile with a live cache, the changes made after it was generated. */
export function unpublishedChanges(caches: Map<string, ProfileCache>, changes: ConfigChange[]): Unpublished[] {
  const out: Unpublished[] = [];
  for (const cache of caches.values()) {
    if (cache.activeAt === undefined) continue;
    const mine = changes.filter((c) => c.at > cache.activeAt! && (c.allProfiles || c.profileIds.includes(cache.profileId)));
    if (mine.length) out.push({ profileId: cache.profileId, changes: mine });
  }
  return out;
}

export function daysSince(at: number, now = Date.now()): number {
  return Math.floor((now - at) / 86_400_000);
}
