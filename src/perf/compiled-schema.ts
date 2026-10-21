/**
 * Sync-volume table list from the COMPILED mobile metadata schema: the
 * db.json / db_ps.json inside the profile's metadata archive, which is what the
 * iOS app actually receives (ProcessMetadataOperation.parseDatabase), rather
 * than the raw DB Schema config records.
 *
 * The archive is found through LifeSciMobileMetadataRecord (child rows carry
 * ProfileId and a MetadataDocumentId -> ContentDocument -> latest ContentVersion)
 * and downloaded once per profile per source. Admin credentials cannot call the
 * device download action (no userSpecificPermissions), so the user-specific
 * table list is approximated by intersecting the archive's tables with the
 * objects the user can read through ObjectPermissions.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import type { DbSchemaEntry, ApplicableTable, OrgQuerier, UserContext } from "./sync-volume.js";
import { downloadArchive, readMetadataFiles, type MetadataDownloadInfo, type MetadataFiles } from "./device/metadata.js";
import type { DeviceSession } from "./device/session.js";
import { privateTmp } from "../private-tmp.js";

/** "user-download": the user's own metadata download through a mobile login (exact, including field-level filtering). */
export type SchemaSource = "compiled" | "db-schema" | "user-download";

export interface CompiledSchemaTables {
  tables: ApplicableTable[];
  notes: string[];
  /** Defaults to "compiled" when absent. */
  source?: Exclude<SchemaSource, "db-schema">;
}

export interface CompiledSchemaSource {
  /** Tables the user's device would sync per the profile's archive, or null (with a reason) to fall back. */
  tablesFor(
    user: Pick<UserContext, "id" | "profileId" | "profileName" | "permissionSets"> & { username?: string }
  ): Promise<{ result: CompiledSchemaTables } | { fallbackReason: string }>;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function splitList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return typeof v === "string" ? v.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : [];
}

function soqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Pure: archive files -> applicable tables
// ---------------------------------------------------------------------------

/**
 * Turn db.json (profile) and db_ps.json (permission sets) into the same
 * ApplicableTable shape the DB Schema path produces. config.json tables are
 * excluded as on the device; the lowest DeveloperName wins per table, with the
 * profile entry preferred over a permission-set entry.
 */
export function tablesFromArchive(
  files: Pick<MetadataFiles, "db" | "dbPs" | "config">,
  user: { permissionSets: Set<string> },
  access?: ObjectAccess
): ApplicableTable[] {
  const excluded = new Set(Object.keys(files.config).map((k) => k.toLowerCase()));
  const assigned = new Set([...user.permissionSets].map((n) => n.toLowerCase()));
  const winners = new Map<string, ApplicableTable>();

  const consider = (key: string, raw: unknown, matchedBy: "profile" | "permissionSet") => {
    const e = obj(raw);
    const sobject = str(e.SObject) ?? (matchedBy === "profile" ? key : key.replace(/__c$/, ""));
    const lower = sobject.toLowerCase();
    if (excluded.has(lower) || e.IsActive === false) return;
    // Objects outside ObjectPermissions (User, Event, RecordType, ...) are never filtered out.
    if (access && access.governed.has(lower) && !access.readable.has(lower)) return;
    if (matchedBy === "permissionSet") {
      const sets = splitList(e.PermissionSets);
      if (!sets.some((n) => assigned.has(n.toLowerCase()))) return;
    }
    const entry: DbSchemaEntry = {
      developerName: str(e.DeveloperName) ?? key,
      sobject,
      type: str(e.Type) ?? "",
      whereSoql: str(e.WhereSoql) ?? null,
      profileIds: new Set(),
      profileNames: new Set(),
      permissionSets: new Set(),
    };
    const existing = winners.get(lower);
    if (!existing) {
      winners.set(lower, { entry, matchedBy });
    } else if (existing.matchedBy === matchedBy && entry.developerName.localeCompare(existing.entry.developerName) < 0) {
      winners.set(lower, { entry, matchedBy });
    } else if (existing.matchedBy === "permissionSet" && matchedBy === "profile") {
      winners.set(lower, { entry, matchedBy });
    }
  };

  for (const [key, raw] of Object.entries(files.db)) consider(key, raw, "profile");
  for (const [key, raw] of Object.entries(files.dbPs)) consider(key, raw, "permissionSet");
  return [...winners.values()].sort((a, b) => a.entry.sobject.localeCompare(b.entry.sobject));
}

/**
 * Tables whose WhereSoql differs between the compiled schema and the DB Schema
 * path (compared after collapsing whitespace), plus tables present on only one side.
 */
export function diffTables(compiled: ApplicableTable[], dbSchema: ApplicableTable[]): { differing: string[]; onlyCompiled: string[]; onlyDbSchema: string[] } {
  const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
  const left = new Map(compiled.map((t) => [t.entry.sobject.toLowerCase(), t]));
  const right = new Map(dbSchema.map((t) => [t.entry.sobject.toLowerCase(), t]));
  const differing: string[] = [];
  const onlyCompiled: string[] = [];
  const onlyDbSchema: string[] = [];
  for (const [k, t] of left) {
    const other = right.get(k);
    if (!other) onlyCompiled.push(t.entry.sobject);
    else if (norm(t.entry.whereSoql) !== norm(other.entry.whereSoql)) differing.push(t.entry.sobject);
  }
  for (const [k, t] of right) if (!left.has(k)) onlyDbSchema.push(t.entry.sobject);
  return { differing, onlyCompiled, onlyDbSchema };
}

// ---------------------------------------------------------------------------
// Org lookups
// ---------------------------------------------------------------------------

interface ArchiveRef {
  recordId: string;
  contentVersionId: string;
  checksum: string;
  contentSize: number;
}

/** The newest Active LifeSciMobileMetadataRecord for the profile that has a document. */
export async function findProfileArchive(org: OrgQuerier, profileId: string): Promise<ArchiveRef | null> {
  const rec = await org.soql(
    `SELECT Id, MetadataDocumentId FROM LifeSciMobileMetadataRecord WHERE Status = 'Active' AND ProfileId = '${soqlString(profileId)}' AND MetadataDocumentId != null ORDER BY LastModifiedDate DESC LIMIT 1`
  );
  if (!rec.success) throw new Error(`LifeSciMobileMetadataRecord query failed: ${rec.error}`);
  const row = rec.data?.records?.[0];
  const docId = str(row?.MetadataDocumentId);
  if (!row || !docId) return null;

  const ver = await org.soql(
    `SELECT Id, Checksum, ContentSize FROM ContentVersion WHERE ContentDocumentId = '${soqlString(docId)}' AND IsLatest = true LIMIT 1`
  );
  if (!ver.success) throw new Error(`ContentVersion query failed: ${ver.error}`);
  const v = ver.data?.records?.[0];
  const checksum = str(v?.Checksum);
  if (!v || !checksum) return null;
  return {
    recordId: row.Id as string,
    contentVersionId: v.Id as string,
    checksum: checksum.toLowerCase(),
    contentSize: Number(v.ContentSize) || 0,
  };
}

/**
 * `governed`: objects that appear in ObjectPermissions anywhere in the org
 * (access is permission-controlled). `readable`: those the user's profile and
 * assigned permission sets grant read on.
 */
export interface ObjectAccess {
  governed: Set<string>;
  readable: Set<string>;
}

function sobjectTypes(records: Array<Record<string, unknown>> | undefined): Set<string> {
  return new Set((records ?? []).flatMap((r) => (typeof r.SobjectType === "string" ? [r.SobjectType.toLowerCase()] : [])));
}

/** Null when either lookup fails or returns nothing, so callers skip the filter rather than drop every table. */
export async function loadObjectAccess(org: OrgQuerier, userId: string, sobjects: string[]): Promise<ObjectAccess | null> {
  if (sobjects.length === 0) return null;
  const names = sobjects.map((n) => `'${soqlString(n)}'`).join(",");
  // Aggregate queries can't page, so the lookup is scoped to the archive's tables.
  const [governed, readable] = await Promise.all([
    org.soql(`SELECT SobjectType FROM ObjectPermissions WHERE SobjectType IN (${names}) GROUP BY SobjectType`),
    org.soql(
      `SELECT SobjectType FROM ObjectPermissions WHERE PermissionsRead = true AND SobjectType IN (${names}) AND ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${soqlString(userId)}') GROUP BY SobjectType`
    ),
  ]);
  if (!governed.success || !readable.success) return null;
  const access = { governed: sobjectTypes(governed.data?.records), readable: sobjectTypes(readable.data?.records) };
  return access.governed.size > 0 && access.readable.size > 0 ? access : null;
}

/**
 * Archives are immutable per ContentVersion (its MD5 is part of the key), so the parsed files are kept
 * for the life of the process and the zip on disk across processes: a profile's archive is downloaded
 * once, not on every run. A cached zip is re-hashed against the org's checksum before it is trusted.
 */
const MAX_CACHED_ARCHIVES = 2;
const memoryCache = new Map<string, MetadataFiles>();

function diskCacheDir(): string {
  return privateTmp("lsc-perf-md-cache");
}

function md5OfFile(file: string): string {
  return createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

function remember(key: string, files: MetadataFiles): void {
  memoryCache.delete(key);
  memoryCache.set(key, files);
  while (memoryCache.size > MAX_CACHED_ARCHIVES) memoryCache.delete(memoryCache.keys().next().value as string);
}

/** The archive's files from memory or disk, or null when it has to be downloaded. */
function cachedFiles(ref: ArchiveRef): MetadataFiles | null {
  const key = `${ref.contentVersionId}|${ref.checksum}`;
  const hit = memoryCache.get(key);
  if (hit) {
    remember(key, hit);
    return hit;
  }
  const file = path.join(diskCacheDir(), `${ref.checksum.replace(/[^a-f0-9]/g, "")}.zip`);
  try {
    if (!fs.existsSync(file)) return null;
    if (md5OfFile(file) !== ref.checksum) {
      fs.rmSync(file, { force: true });
      return null;
    }
    const files = readMetadataFiles(file);
    remember(key, files);
    return files;
  } catch {
    return null;
  }
}

function storeArchive(ref: ArchiveRef, zip: string, files: MetadataFiles): void {
  remember(`${ref.contentVersionId}|${ref.checksum}`, files);
  try {
    const dir = diskCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${ref.checksum.replace(/[^a-f0-9]/g, "")}.zip`);
    const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    fs.copyFileSync(zip, tmp);
    fs.renameSync(tmp, dest);
  } catch {
    // The cache is an optimization only.
  }
}

async function downloadProfileFiles(session: DeviceSession, ref: ArchiveRef): Promise<{ files: MetadataFiles; bytes: number }> {
  const info: MetadataDownloadInfo = {
    contentVersionId: ref.contentVersionId,
    checksum: ref.checksum,
    contentSize: ref.contentSize,
    versionDataURL: `/services/data/${session.apiVersion}/sobjects/ContentVersion/${ref.contentVersionId}/VersionData`,
    userSpecificPermissions: {},
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsc-perf-md-"));
  try {
    const dl = await downloadArchive(session, info, dir);
    const files = readMetadataFiles(dl.file);
    storeArchive(ref, dl.file, files);
    return { files, bytes: dl.bytes };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

export interface CompiledSchemaSourceDeps {
  /** Config-org querier used to find the archive and the user's readable objects. */
  org: OrgQuerier;
  /** Lazily creates the authenticated session used to download archives. */
  getSession: () => Promise<DeviceSession>;
}

/** Archive downloads are cached by profile id for the lifetime of the returned source (one run). */
export function createCompiledSchemaSource(deps: CompiledSchemaSourceDeps): CompiledSchemaSource {
  const cache = new Map<string, Promise<{ files: MetadataFiles; bytes: number; recordId: string } | { reason: string }>>();

  const loadFiles = (profileId: string) => {
    let pending = cache.get(profileId);
    if (!pending) {
      pending = (async () => {
        const ref = await findProfileArchive(deps.org, profileId);
        if (!ref) return { reason: "no active metadata archive for the profile" };
        const cachedHit = cachedFiles(ref);
        const { files, bytes } = cachedHit
          ? { files: cachedHit, bytes: ref.contentSize }
          : await downloadProfileFiles(await deps.getSession(), ref);
        if (Object.keys(files.db).length === 0) return { reason: `archive ${ref.recordId} has no db.json tables` };
        return { files, bytes, recordId: ref.recordId };
      })().catch((e): { reason: string } => ({ reason: errorMessage(e) }));
      cache.set(profileId, pending);
    }
    return pending;
  };

  return {
    async tablesFor(user) {
      if (!user.profileId) return { fallbackReason: "user has no profile id" };
      const loaded = await loadFiles(user.profileId);
      if ("reason" in loaded) return { fallbackReason: loaded.reason };

      const candidates = tablesFromArchive(loaded.files, user).map((t) => t.entry.sobject);
      const access = await loadObjectAccess(deps.org, user.id, candidates);
      const notes: string[] = [];
      const tables = tablesFromArchive(loaded.files, user, access ?? undefined);
      notes.push(
        access
          ? `Table list approximated from archive ${loaded.recordId} db.json/db_ps.json for ${user.profileName} minus permission-controlled objects the user cannot read (ObjectPermissions); the device uses its own userSpecificPermissions, so field-level filtering is not applied.`
          : `Table list taken from archive ${loaded.recordId} db.json/db_ps.json for ${user.profileName} without a readable-object filter (ObjectPermissions lookup returned nothing); tables the user cannot read may be included.`
      );
      if (Object.keys(loaded.files.dbPs).length === 0) notes.push("The archive has no db_ps.json, so permission-set tables are not included.");
      return { result: { tables, notes } };
    },
  };
}

/** Forget cached archives (tests). */
export function clearArchiveCache(opts: { disk?: boolean } = {}): void {
  memoryCache.clear();
  if (opts.disk) fs.rmSync(diskCacheDir(), { recursive: true, force: true });
}
