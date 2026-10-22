/**
 * Studio's Metadata cache page: every profile's LSC Mobile metadata cache
 * (LifeSciMobileMetadataRecord) with what it's behind on, the generation jobs
 * that built them, and what's inside one cache's ZIP. Read-only — publishing
 * goes through `studio_publish_mobile`.
 */

import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { chunkIds } from "../tools/helpers.js";
import { ID_PATTERN, inList, query, queryResult, type Row } from "./helpers.js";
import { cachesByProfile } from "./overview-logic.js";
import { fetchLscProfiles, profilesBehind } from "./overview.js";
import { download, pruneCache } from "./published.js";
import { cacheErrorText } from "./publish.js";
import {
  buildJobs,
  isPlainZipName,
  parseZipListing,
  profileRows,
  sniffFile,
  type CacheFile,
  type CacheJob,
  type MetadataCacheOverview,
} from "./metadata-cache-logic.js";
import { privateTmp } from "../private-tmp.js";

const execFileAsync = promisify(execFile);

/** Generation jobs shown in History. */
const JOBS_SHOWN = 30;
const COLUMNS =
  "Id, Name, Status, IntegrationStatus, IntegrationErrorCode, IntegrationErrorMessage, CreatedDate, LastModifiedDate, CreatedBy.Name, ProfileId, Profile.Name, ParentMobileMetadataRecId, MetadataDocumentId, MetadataDocument.ContentSize";

export async function collectMetadataCache(org: string): Promise<MetadataCacheOverview> {
  const notes: string[] = [];
  const [lsc, cachedProfiles, parents] = await Promise.all([
    fetchLscProfiles(org),
    // Profiles that have caches but no LSC users still show, so nothing published is hidden.
    query(
      `SELECT ProfileId, Profile.Name pn FROM LifeSciMobileMetadataRecord WHERE ProfileId != null GROUP BY ProfileId, Profile.Name`,
      org
    ),
    queryResult(
      `SELECT ${COLUMNS}, ErrorLog FROM LifeSciMobileMetadataRecord WHERE ParentMobileMetadataRecId = null ORDER BY CreatedDate DESC LIMIT ${JOBS_SHOWN}`,
      org
    ),
  ]);
  const profiles = [...lsc];
  for (const r of cachedProfiles) {
    const id = String(r.ProfileId);
    if (!profiles.some((p) => p.id === id))
      profiles.push({ id, name: String(r.pn ?? id), users: 0 });
  }

  const parentIds = parents.records.map((r) => String((r as Row).Id));
  const [records, jobChildren, jobsTotal] = await Promise.all([
    // Every profile's records, so its live cache is found however old it is (no ErrorLog: it can be long).
    Promise.all(
      chunkIds(profiles.map((p) => p.id)).map((chunk) =>
        query(
          `SELECT ${COLUMNS} FROM LifeSciMobileMetadataRecord WHERE ProfileId IN (${inList(chunk)}) ORDER BY CreatedDate DESC`,
          org
        )
      )
    ).then((g) => g.flat()),
    parentIds.length
      ? query(
          `SELECT ${COLUMNS}, ErrorLog FROM LifeSciMobileMetadataRecord WHERE ParentMobileMetadataRecId IN (${inList(parentIds)})`,
          org
        )
      : Promise.resolve([]),
    query(
      `SELECT COUNT(Id) n FROM LifeSciMobileMetadataRecord WHERE ParentMobileMetadataRecId = null`,
      org
    ).then((r) => Number(r[0]?.n ?? r[0]?.expr0 ?? 0)),
  ]);

  const jobs = buildJobs(parents.records as Row[], jobChildren);
  const states = new Map<string, Pick<CacheJob, "state" | "error">>(jobs.map((j) => [j.id, j]));
  // An attempt from a job older than the ones shown: read its parent so its state is judged the same way.
  const older = [
    ...new Set(
      records
        .map((r) => String(r.ParentMobileMetadataRecId ?? ""))
        .filter((id) => id && !states.has(id))
    ),
  ].slice(0, 200);
  if (older.length) {
    const [ps, cs] = await Promise.all([
      query(
        `SELECT ${COLUMNS}, ErrorLog FROM LifeSciMobileMetadataRecord WHERE Id IN (${inList(older)})`,
        org
      ),
      query(
        `SELECT ${COLUMNS}, ErrorLog FROM LifeSciMobileMetadataRecord WHERE ParentMobileMetadataRecId IN (${inList(older)})`,
        org
      ),
    ]);
    for (const j of buildJobs(ps, cs)) states.set(j.id, j);
  }

  let unpublished: Map<string, number> | null = null;
  try {
    const behind = await profilesBehind(
      org,
      cachesByProfile(records),
      new Map(profiles.map((p) => [p.id, p.name]))
    );
    unpublished = new Map(behind.map((u) => [u.profileId, u.items.length]));
    if (behind.cappedAtDays)
      notes.push(
        `Changes are counted for the last ${behind.cappedAtDays} days; a profile published longer ago may be missing older ones.`
      );
  } catch (err) {
    notes.push(
      `Couldn't count the changes not on iPads yet: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return {
    org,
    collectedAt: new Date().toISOString(),
    profiles: profileRows(profiles, records, states, unpublished),
    jobs,
    jobsTotal,
    notes,
  };
}

/** The full ErrorLog of a record and, for a job's parent, of each profile's record. */
export async function cacheLog(
  recordId: string,
  org: string
): Promise<{ logs: { id: string; profile: string | null; log: string }[] }> {
  if (!ID_PATTERN.test(recordId)) throw new Error(`Invalid record Id: ${recordId}`);
  const rows = await query(
    `SELECT Id, Profile.Name, ErrorLog FROM LifeSciMobileMetadataRecord WHERE Id = '${recordId}' OR ParentMobileMetadataRecId = '${recordId}'`,
    org
  );
  return {
    logs: rows
      .map((r) => ({
        id: String(r.Id),
        profile: ((r.Profile as { Name?: string } | null)?.Name ?? null) || null,
        log: cacheErrorText(r.ErrorLog),
      }))
      .filter((l) => l.log)
      .sort((a, b) => Number(b.id === recordId) - Number(a.id === recordId)),
  };
}

// ── Contents ────────────────────────────────────────────────────────────────

/** Downloaded caches: they hold the org's full metadata, so only the last few are kept. */
const zipRoot = () => privateTmp("lsc-studio-cache-zips");
const ZIPS_KEPT = 3;
const ZIP_MAX_BYTES = 2 << 30;
/** Bigger files come back cut short, as text. */
export const FILE_MAX_BYTES = 24 << 20;
const FILE_PREVIEW_BYTES = 1 << 20;

export interface CacheContents {
  recordId: string;
  name: string;
  profile: string | null;
  generatedAt: string;
  sizeBytes: number | null;
  files: CacheFile[];
  /** Where the ZIP was downloaded (for the app's Download ZIP). */
  zipPath: string;
}

const downloads = new Map<string, Promise<void>>();

async function ensureZip(recordId: string, org: string): Promise<Omit<CacheContents, "files">> {
  if (!ID_PATTERN.test(recordId)) throw new Error(`Invalid record Id: ${recordId}`);
  const rows = await query(
    `SELECT Id, Name, Profile.Name, LastModifiedDate, MetadataDocument.LatestPublishedVersionId, MetadataDocument.ContentSize FROM LifeSciMobileMetadataRecord WHERE Id = '${recordId}'`,
    org
  );
  const r = rows[0];
  if (!r) throw new Error("This cache record no longer exists.");
  const doc = (r.MetadataDocument ?? null) as {
    LatestPublishedVersionId?: string;
    ContentSize?: number;
  } | null;
  if (!doc?.LatestPublishedVersionId)
    throw new Error(
      "This record has no cache file. Only records that finished generating have one."
    );
  const version = doc.LatestPublishedVersionId;
  if (!ID_PATTERN.test(version)) throw new Error(`Invalid file Id: ${version}`);
  const dir = path.join(zipRoot(), version);
  const zipPath = path.join(dir, "cache.zip");
  const sizeBytes = typeof doc.ContentSize === "number" ? doc.ContentSize : null;
  if (!fs.existsSync(zipPath)) {
    let pending = downloads.get(version);
    if (!pending) {
      pending = (async () => {
        fs.mkdirSync(dir, { recursive: true });
        try {
          pruneCache(zipRoot(), { keep: ZIPS_KEPT, maxBytes: ZIP_MAX_BYTES, protect: [dir] });
        } catch {
          // Housekeeping only.
        }
        const partial = `${zipPath}.part`;
        await download(version, partial, org, sizeBytes);
        fs.renameSync(partial, zipPath);
      })().finally(() => downloads.delete(version));
      downloads.set(version, pending);
    }
    await pending;
  } else {
    const now = new Date();
    fs.utimesSync(dir, now, now);
  }
  return {
    recordId,
    name: String(r.Name ?? ""),
    profile: ((r.Profile as { Name?: string } | null)?.Name ?? null) || null,
    generatedAt: String(r.LastModifiedDate ?? ""),
    sizeBytes,
    zipPath,
  };
}

async function listZip(zipPath: string): Promise<CacheFile[]> {
  try {
    const { stdout } = await execFileAsync("unzip", ["-v", zipPath], { maxBuffer: 32 << 20 });
    return parseZipListing(stdout);
  } catch (err) {
    throw new Error(
      `Couldn't read the metadata cache (${err instanceof Error ? err.message : String(err)}). Studio needs the unzip command.`
    );
  }
}

export async function cacheContents(recordId: string, org: string): Promise<CacheContents> {
  const info = await ensureZip(recordId, org);
  const files = (await listZip(info.zipPath)).sort((a, b) => a.path.localeCompare(b.path));
  return { ...info, files };
}

export interface CacheFileText {
  path: string;
  size: number;
  kind: "text" | "image" | "binary";
  /** The file's text; empty for binary files. */
  text: string;
  /** An image's data URL. */
  image?: string;
  /** Only the first part of a file over `FILE_MAX_BYTES`. */
  truncated: boolean;
}

export async function cacheFile(
  recordId: string,
  file: string,
  org: string
): Promise<CacheFileText> {
  const info = await ensureZip(recordId, org);
  const entry = (await listZip(info.zipPath)).find((f) => f.path === file);
  if (!entry) throw new Error(`${file} isn't in this cache.`);
  if (!isPlainZipName(file))
    throw new Error(`Studio can't open ${file}; download the ZIP to see it.`);
  const truncated = entry.size > FILE_MAX_BYTES;
  const buf = await readEntry(info.zipPath, file, truncated ? FILE_PREVIEW_BYTES : FILE_MAX_BYTES);
  const kind = sniffFile(buf);
  if (kind.kind === "image")
    return {
      path: file,
      size: entry.size,
      kind: "image",
      text: "",
      image: `data:${kind.mime};base64,${buf.toString("base64")}`,
      truncated: false,
    };
  if (kind.kind === "binary")
    return { path: file, size: entry.size, kind: "binary", text: "", truncated: false };
  return { path: file, size: entry.size, kind: "text", text: buf.toString("utf8"), truncated };
}

/** Up to `limit` bytes of one file in the ZIP, stopping unzip once it has them. */
function readEntry(zipPath: string, file: string, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", zipPath, file]);
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).subarray(0, limit));
    };
    child.stdout.on("data", (c: Buffer) => {
      chunks.push(c);
      size += c.length;
      if (size >= limit) {
        finish();
        child.kill();
      }
    });
    child.on(
      "error",
      (err) => !done && ((done = true), reject(new Error(`Couldn't read ${file}: ${err.message}`)))
    );
    child.on("close", (code) => {
      if (done) return;
      if (code === 0) finish();
      else ((done = true), reject(new Error(`Couldn't read ${file} (unzip exited with ${code}).`)));
    });
  });
}
