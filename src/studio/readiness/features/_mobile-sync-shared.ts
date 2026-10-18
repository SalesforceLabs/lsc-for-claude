/**
 * Building blocks shared by the org-wide and Next Best / Events / Medical
 * Inquiries readiness modules: "is the iPad's published copy out of date", which
 * profiles have field users, and per-profile DB Schema coverage with fixes.
 */

import type { ConfigRecord } from "../../../config/types.js";
import { fetchCache, isLiveCache, type CacheRecord } from "../../collectors/mobile-sync.js";
import { actionAudience, addProfileFix, newDbSchema, profilesOf } from "../../collectors/shared.js";
import { audienceOf, inList, plural, query } from "../../helpers.js";
import type { StudioFix } from "../../types.js";
import type { StudioCheckResult } from "../index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Newest live (Active / Published) metadata cache per profile name. Rows with no
 * profile are a publish's parent record, not a cache any iPad downloads.
 */
export function liveCacheDates(caches: CacheRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of caches.filter(isLiveCache)) {
    if (c.profile === null) continue;
    const at = Date.parse(String(c.row.LastModifiedDate));
    if (Number.isFinite(at) && at > (out.get(c.profile) ?? 0)) out.set(c.profile, at);
  }
  return out;
}

/** Admin Console records of `categories` changed after `since`: developer name → newest change (record, field value or assignment). */
export async function changedConfig(org: string, categories: string[], since: number): Promise<Map<string, number>> {
  const after = new Date(since).toISOString();
  const cats = inList(categories);
  const [records, values, assignments] = await Promise.all([
    query(
      `SELECT DeveloperName, LastModifiedDate FROM LifeSciConfigRecord WHERE LifeSciConfigCategory.Category IN (${cats}) AND LastModifiedDate > ${after} ORDER BY LastModifiedDate DESC LIMIT 500`,
      org,
      true
    ),
    query(
      `SELECT LifeSciConfigRecord.DeveloperName, LastModifiedDate FROM LifeSciConfigFieldValue WHERE LifeSciConfigRecord.LifeSciConfigCategory.Category IN (${cats}) AND LastModifiedDate > ${after} ORDER BY LastModifiedDate DESC LIMIT 500`,
      org,
      true
    ),
    // Assignment changes are a nicety; an org that won't answer shouldn't hide the rest.
    query(
      `SELECT LifeSciConfigRecord.DeveloperName, LastModifiedDate FROM LifeSciConfigAssignment WHERE LifeSciConfigRecord.LifeSciConfigCategory.Category IN (${cats}) AND LastModifiedDate > ${after} ORDER BY LastModifiedDate DESC LIMIT 500`,
      org,
      true
    ).catch(() => []),
  ]);
  const out = new Map<string, number>();
  const note = (name: unknown, date: unknown) => {
    const at = Date.parse(String(date));
    if (typeof name === "string" && Number.isFinite(at) && at > (out.get(name) ?? 0)) out.set(name, at);
  };
  for (const r of records) note(r.DeveloperName, r.LastModifiedDate);
  for (const r of [...values, ...assignments]) {
    note((r.LifeSciConfigRecord as { DeveloperName?: string } | null)?.DeveloperName, r.LastModifiedDate);
  }
  return out;
}

/**
 * Pass when nothing in `categories` changed since the iPad's metadata cache for
 * the profiles in `forProfiles` (or everyone, when empty) was last generated.
 * `records` are the category's records, used to tell which profile a change reaches.
 * With `onlyRecords`, only changes to those records count (not the whole category).
 * There is no fix: publishing is its own step.
 */
export async function cacheFreshResult(org: string, caches: CacheRecord[], categories: string[], records: ConfigRecord[], forProfiles: string[] = [], onlyRecords = false): Promise<StudioCheckResult> {
  const dates = liveCacheDates(caches);
  if (!dates.size) return { pass: true, skip: true, detail: "No mobile metadata cache has been generated yet." };
  const oldest = Math.min(...dates.values());
  const changed = await changedConfig(org, categories, oldest);
  if (!changed.size) return { pass: true, detail: "Nothing has changed since the last publish." };

  const byName = new Map(records.map((r) => [r.developerName, r]));
  const profiles = forProfiles.length ? forProfiles : [...dates.keys()];
  // Profile names in assignments and on the cache needn't agree on case.
  const dateOf = new Map([...dates].map(([p, at]) => [p.toLowerCase(), at]));
  const stale: string[] = [];
  for (const profile of profiles) {
    const published = dateOf.get(profile.toLowerCase());
    if (published === undefined) continue;
    const hit = [...changed].filter(([name, at]) => {
      if (at <= published) return false;
      const rec = byName.get(name);
      if (!rec && onlyRecords) return false;
      // A record we can't see is treated as reaching everyone.
      return !rec || reaches(rec, profile);
    });
    if (hit.length) stale.push(`${profile} (${plural(hit.length, "change")} since ${new Date(published).toISOString().slice(0, 10)})`);
  }
  return stale.length
    ? { pass: false, detail: `Unpublished changes for ${plural(stale.length, "profile")}: ${stale.slice(0, 3).join("; ")}${stale.length > 3 ? "…" : ""}.`, examples: stale }
    : { pass: true, detail: "Nothing has changed since each profile's last publish." };
}

/**
 * Could a change to `rec` show up on `profile`'s iPads? Actions list their
 * profiles in a field and show to everyone when none are listed; other records
 * reach only their assignments (none = nobody). Permission set assignments
 * could reach anyone, so they count.
 */
function reaches(rec: ConfigRecord, profile: string): boolean {
  const audience = rec.category === "QuickAction" || rec.category === "CustomAction" ? actionAudience(rec) : audienceOf(rec);
  return !audience || audience.profiles.some((p) => p.toLowerCase() === profile.toLowerCase()) || audience.permissionSets.length > 0;
}

export { fetchCache };

/** Whole days since `date`, or null for no date. */
export function daysSince(date: unknown, now = Date.now()): number | null {
  const at = Date.parse(String(date ?? ""));
  return Number.isFinite(at) ? Math.floor((now - at) / DAY_MS) : null;
}

/**
 * Per-profile DB Schema coverage: for each of `objects` that exists, the profiles in
 * `profiles` should sync it through an active record. Gives a "copy" fix per gap —
 * switch a record on, add the profile to a record, or create one for the profiles.
 */
/** Whether `rec` is assigned to `profile`, ignoring case. */
const hasProfile = (rec: ConfigRecord, profile: string) => profilesOf(rec).some((p) => p.toLowerCase() === profile.toLowerCase());

export function profileSyncResult(schema: ConfigRecord[], objects: string[], profiles: string[]): StudioCheckResult {
  if (!profiles.length) return { pass: true, skip: true, detail: "No profile has active users for this feature yet." };
  const sobject = (r: ConfigRecord) => String(r.fields.SObject ?? "").toLowerCase();
  const gaps: string[] = [];
  const fixes: StudioFix[] = [];
  for (const obj of objects) {
    const mine = schema.filter((r) => sobject(r) === obj.toLowerCase());
    const active = mine.filter((r) => r.isActive);
    const missing = profiles.filter((p) => !active.some((r) => r.isOrgLevel || hasProfile(r, p)));
    if (!missing.length) continue;
    gaps.push(`${obj}: ${missing.join(", ")}`);
    const offs = mine.filter((r) => !r.isActive);
    // Only an unambiguous record gets a fix; with several, which one to change is the admin's call.
    if (active.length) {
      if (active.length === 1) {
        for (const p of missing) {
          const fix = addProfileFix(active[0], p, `Sync ${obj} to ${p}`);
          if (fix) fixes.push(fix);
        }
      }
    } else if (offs.length === 1) {
      const off = offs[0];
      fixes.push({
        kind: "setActive",
        label: `Switch on ${obj} sync`,
        record: { type: "config", category: "DbSchema", developerName: off.developerName, label: off.label || off.developerName },
        from: false,
        to: true,
      });
      // Switching it on only helps the profiles it's given to; add the rest.
      if (!off.isOrgLevel) {
        for (const p of missing.filter((p) => !hasProfile(off, p))) {
          const fix = addProfileFix(off, p, `Sync ${obj} to ${p}`);
          if (fix) fixes.push(fix);
        }
      }
    } else if (!offs.length) {
      fixes.push(newDbSchema(obj, schema, missing));
    }
  }
  return gaps.length
    ? { pass: false, detail: `Not synced to some profiles — ${gaps.join("; ")}.`, examples: gaps, fixes }
    : { pass: true, detail: `${plural(objects.length, "object")} synced to ${plural(profiles.length, "profile")}.` };
}
