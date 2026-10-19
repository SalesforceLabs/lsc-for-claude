/**
 * Pure helpers behind Studio's Metadata cache page (`studio_metadata_cache`):
 * cache records as the page shows them, generation jobs (a parent record plus
 * one child per profile), each profile's current cache, and the ZIP listing.
 */

import type { Row } from "./helpers.js";
import { cacheErrorText, jobOutcome } from "./publish.js";
import { cacheError } from "./overview-logic.js";

export interface CacheRecordInfo {
  id: string;
  name: string;
  status: string;
  profile: string | null;
  profileId: string | null;
  createdAt: string;
  modifiedAt: string;
  createdBy: string | null;
  /** The ZIP's size, when the record has one. */
  sizeBytes: number | null;
  hasDocument: boolean;
  /** IntegrationErrorMessage / code, or a failed status. */
  error: string | null;
  /** The ErrorLog's message, shortened; `studio_metadata_cache_log` has it all. */
  log: string | null;
}

export type JobState = "running" | "done" | "failed";

export interface CacheJob {
  id: string;
  name: string;
  startedAt: string;
  /** The newest change on the job's records. */
  updatedAt: string;
  startedBy: string | null;
  state: JobState;
  status: string;
  error: string | null;
  /** One per profile. */
  records: CacheRecordInfo[];
}

export type ProfileCacheState = "current" | "behind" | "failed" | "running" | "never";

export interface ProfileCacheRow {
  profile: string;
  profileId: string;
  /** Active users holding an LSC license; 0 for a profile that only has caches. */
  users: number;
  /** What its iPads download: the newest Active record with a document. */
  live: CacheRecordInfo | null;
  /** The newest record of any status, when it's newer than `live` (a failed or running attempt). */
  attempt: CacheRecordInfo | null;
  attemptState: JobState | null;
  /** Why the attempt failed (its job's error, else its own). */
  attemptError: string | null;
  /** Admin Console changes not in `live` yet; null when they couldn't be counted. */
  unpublished: number | null;
  state: ProfileCacheState;
}

export interface MetadataCacheOverview {
  org: string;
  collectedAt: string;
  profiles: ProfileCacheRow[];
  jobs: CacheJob[];
  /** All generation jobs in the org; `jobs` holds the newest. */
  jobsTotal: number;
  notes: string[];
}

/** A job that hasn't moved in this long has stopped, whatever its status says. */
export const STALLED_MS = 2 * 3_600_000;
const LOG_PREVIEW = 300;

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const nameOf = (v: unknown): string | null => text((v as { Name?: unknown } | null)?.Name) || null;

export function recordInfo(r: Row, profileNames?: Map<string, string>): CacheRecordInfo {
  const doc = r.MetadataDocument as { ContentSize?: unknown } | null | undefined;
  const log = cacheErrorText(r.ErrorLog);
  const profileId = text(r.ProfileId) || null;
  return {
    id: text(r.Id),
    name: text(r.Name),
    status: text(r.Status) || "Unknown",
    profile: nameOf(r.Profile) ?? (profileId ? (profileNames?.get(profileId) ?? profileId) : null),
    profileId,
    createdAt: text(r.CreatedDate),
    modifiedAt: text(r.LastModifiedDate),
    createdBy: nameOf(r.CreatedBy),
    sizeBytes: typeof doc?.ContentSize === "number" ? doc.ContentSize : null,
    hasDocument: !!r.MetadataDocumentId,
    error: cacheError(r),
    log: log ? (log.length > LOG_PREVIEW ? `${log.slice(0, LOG_PREVIEW)}…` : log) : null,
  };
}

/** Jobs from parent records (no ParentMobileMetadataRecId) and their children, in the parents' order. */
export function buildJobs(parents: Row[], children: Row[], now = Date.now()): CacheJob[] {
  const byParent = new Map<string, Row[]>();
  for (const c of children) {
    const p = text(c.ParentMobileMetadataRecId);
    byParent.set(p, [...(byParent.get(p) ?? []), c]);
  }
  return parents.map((p) => {
    const kids = byParent.get(text(p.Id)) ?? [];
    const outcome = jobOutcome(p, kids);
    const updatedAt =
      [p, ...kids]
        .map((r) => text(r.LastModifiedDate))
        .sort()
        .at(-1) ?? text(p.LastModifiedDate);
    const stalled = outcome.state === "running" && now - Date.parse(updatedAt) > STALLED_MS;
    return {
      id: text(p.Id),
      name: text(p.Name),
      startedAt: text(p.CreatedDate),
      updatedAt,
      startedBy: nameOf(p.CreatedBy),
      state: stalled ? "failed" : outcome.state,
      status: text(p.Status) || "Unknown",
      error: stalled
        ? "Stopped without finishing: Salesforce stopped updating this job."
        : (outcome.error ?? null),
      records: kids
        .map((k) => recordInfo(k))
        .sort((a, b) => (a.profile ?? "").localeCompare(b.profile ?? "")),
    };
  });
}

/**
 * Each profile's current cache and newest attempt from its child records (newest first or not),
 * with the states of the jobs those attempts belong to.
 */
export function profileRows(
  profiles: { id: string; name: string; users: number }[],
  records: Row[],
  attempts: Map<string, Pick<CacheJob, "state" | "error">>,
  unpublished: Map<string, number> | null
): ProfileCacheRow[] {
  const byProfile = new Map<string, Row[]>();
  for (const r of records) {
    const id = text(r.ProfileId);
    if (id) byProfile.set(id, [...(byProfile.get(id) ?? []), r]);
  }
  const names = new Map(profiles.map((p) => [p.id, p.name]));
  return profiles
    .map((p) => {
      const mine = (byProfile.get(p.id) ?? []).sort((a, b) =>
        text(b.CreatedDate).localeCompare(text(a.CreatedDate))
      );
      const liveRow = mine.find((r) => r.Status === "Active" && r.MetadataDocumentId);
      const newest = mine[0];
      const attemptRow =
        newest &&
        newest !== liveRow &&
        (!liveRow || text(newest.CreatedDate) > text(liveRow.CreatedDate))
          ? newest
          : undefined;
      const job = attemptRow ? attempts.get(text(attemptRow.ParentMobileMetadataRecId)) : undefined;
      const ownError = attemptRow ? cacheError(attemptRow) : null;
      const attemptState = job?.state ?? (ownError ? "failed" : null);
      const behind = liveRow ? (unpublished?.get(p.id) ?? 0) : 0;
      const state: ProfileCacheState =
        attemptState === "running"
          ? "running"
          : attemptState === "failed"
            ? "failed"
            : !liveRow
              ? "never"
              : behind > 0
                ? "behind"
                : "current";
      return {
        profile: p.name,
        profileId: p.id,
        users: p.users,
        live: liveRow ? recordInfo(liveRow, names) : null,
        attempt: attemptRow ? recordInfo(attemptRow, names) : null,
        attemptState,
        attemptError: attemptState === "failed" ? (job?.error ?? ownError) : null,
        unpublished: liveRow ? (unpublished ? (unpublished.get(p.id) ?? 0) : null) : null,
        state,
      };
    })
    .sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        b.users - a.users ||
        a.profile.localeCompare(b.profile)
    );
}

/** Rows needing attention first. */
const STATE_ORDER: Record<ProfileCacheState, number> = {
  failed: 0,
  running: 1,
  behind: 2,
  never: 3,
  current: 4,
};

export interface CacheFile {
  path: string;
  size: number;
  compressed: number;
}

/** Files (not folders) in `unzip -v` output. */
export function parseZipListing(out: string): CacheFile[] {
  const files: CacheFile[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+\S+\s+(\d+)\s+-?\d+%\s+\S+\s+\S+\s+[0-9a-f]{8}\s+(.+)$/.exec(line);
    if (!m || m[3].endsWith("/")) continue;
    files.push({ path: m[3], size: Number(m[1]), compressed: Number(m[2]) });
  }
  return files;
}

/** A name `unzip` would read as a pattern or an option can't be asked for exactly; such files aren't opened. */
export function isPlainZipName(name: string): boolean {
  return !/[*?[\]\\]/.test(name) && !name.startsWith("-");
}

const IMAGE_MAGIC: [string, number[]][] = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
];

/** What a file's first bytes say it is: an image Studio can show, other binary, or text. */
export function sniffFile(
  head: Uint8Array
): { kind: "image"; mime: string } | { kind: "binary" } | { kind: "text" } {
  for (const [mime, magic] of IMAGE_MAGIC)
    if (magic.every((b, i) => head[i] === b)) return { kind: "image", mime };
  return head.subarray(0, 8000).includes(0) ? { kind: "binary" } : { kind: "text" };
}
