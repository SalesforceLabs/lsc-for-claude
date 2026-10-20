/**
 * Predicts how much data the LSC mobile app will sync for a given user, by
 * replaying the app's DB Schema filter resolution against the org with
 * COUNT() queries.
 *
 * Mirrors two pieces of product logic:
 * - Which DB Schema records reach a user (lsc-metadata-svc
 *   includes/metadata/db.js): active, non-Configuration records whose profile
 *   assignments / `Profiles` field or `PermissionSets` field match the user;
 *   the first record per SObject by DeveloperName wins.
 * - How the iOS app expands WhereSoql tags (OCE MetadataDatabaseTable+LoadData
 *   and VisibilityCheckLoader): user/territory tags are substituted inline,
 *   ObjectTerritory2Association is loaded first to resolve {OT2A.OBJ.IDS},
 *   then Account to resolve {ACCOUNT.IDS}, and id-list tags are split into
 *   length-limited query chunks.
 */

import type { CliResult, SoqlQueryResult } from "../salesforce/cli.js";
import { MAX_GET_URL_CHARS } from "../salesforce/direct.js";
import { FV_VALUE_COLUMNS, extractFieldValue } from "../tools/helpers.js";

export interface QueryOptions {
  /** Most rows to read before the result is flagged `truncated` (the querier's own default when absent). */
  maxRows?: number;
}

export interface OrgQuerier {
  soql(query: string, options?: QueryOptions): Promise<CliResult<SoqlQueryResult>>;
  tooling(query: string): Promise<CliResult<SoqlQueryResult>>;
}

/**
 * A querier that asks the org once per distinct query for as long as it lives: concurrent and repeated
 * identical queries share one answer (the same COUNT() across territories, the id lists several tables
 * read, the DB Schema reads of two steps). Only successes are kept, so a failure is retried by the next
 * caller; an in-flight query is shared either way. Meant for one run, never for a long-lived server.
 */
export function memoizeQuerier(org: OrgQuerier): OrgQuerier {
  const make = (run: (q: string, options?: QueryOptions) => Promise<CliResult<SoqlQueryResult>>, kind: string) => {
    const cache = new Map<string, Promise<CliResult<SoqlQueryResult>>>();
    return (q: string, options?: QueryOptions) => {
      const key = `${kind}|${options?.maxRows ?? ""}|${q}`;
      let hit = cache.get(key);
      if (!hit) {
        hit = run(q, options);
        cache.set(key, hit);
        const forget = () => cache.delete(key);
        hit.then((r) => r.success || forget(), forget);
      }
      return hit;
    };
  };
  return { soql: make((q, o) => org.soql(q, o), "s"), tooling: make((q) => org.tooling(q), "t") };
}

// ---------------------------------------------------------------------------
// DB Schema records
// ---------------------------------------------------------------------------

export interface DbSchemaEntry {
  developerName: string;
  sobject: string;
  type: string;
  whereSoql: string | null;
  profileIds: Set<string>;
  profileNames: Set<string>;
  permissionSets: Set<string>;
}

const NON_DATA_SOBJECTS = new Set(["lifesciconfigrecord", "lifescimetadatarecord"]);

function splitList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function loadDbSchemaEntries(org: OrgQuerier): Promise<DbSchemaEntry[]> {
  const catResult = await org.tooling(
    `SELECT Id FROM LifeSciConfigCategory WHERE Category = 'DbSchema' LIMIT 1`
  );
  if (!catResult.success) throw new Error(`DbSchema category query failed: ${catResult.error}`);
  const categoryId = catResult.data?.records?.[0]?.Id as string | undefined;
  if (!categoryId) throw new Error("No DbSchema category found. Is LSC installed in this org?");

  const recResult = await org.tooling(
    `SELECT Id, DeveloperName FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId = '${categoryId}' AND IsActive = true ORDER BY DeveloperName`
  );
  if (!recResult.success) throw new Error(`DbSchema record query failed: ${recResult.error}`);
  const records = recResult.data?.records ?? [];
  if (records.length === 0) return [];

  const ids = records.map((r) => r.Id as string);
  const fieldsByRecord = new Map<string, Record<string, unknown>>();
  const profileIdsByRecord = new Map<string, Set<string>>();

  // The 50-id chunks are independent reads; run them together and merge in chunk order so a repeated
  // field name is overwritten exactly as the serial loop did.
  const idChunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) idChunks.push(ids.slice(i, i + 50));
  const chunkResults = await mapWithConcurrency(idChunks, DEFAULT_PROFILE_OPTIONS.concurrency, async (chunk) => {
    const idList = chunk.map((id) => `'${id}'`).join(",");
    const [fvResult, asgResult] = await Promise.all([
      org.tooling(
        `SELECT LifeSciConfigRecordId, FieldName, DataType, ${FV_VALUE_COLUMNS.join(", ")} FROM LifeSciConfigFieldValue WHERE LifeSciConfigRecordId IN (${idList})`
      ),
      org.tooling(`SELECT LifeSciConfigRecordId, AssignedToId, AssignmentLevel FROM LifeSciConfigAssignment WHERE LifeSciConfigRecordId IN (${idList})`),
    ]);
    return { fvResult, asgResult };
  });
  for (const { fvResult, asgResult } of chunkResults) {
    if (!fvResult.success) throw new Error(`DbSchema field value query failed: ${fvResult.error}`);
    for (const fv of fvResult.data?.records ?? []) {
      const parentId = fv.LifeSciConfigRecordId as string;
      const fields = fieldsByRecord.get(parentId) ?? {};
      fields[fv.FieldName as string] = extractFieldValue(fv);
      fieldsByRecord.set(parentId, fields);
    }
    if (!asgResult.success) throw new Error(`DbSchema assignment query failed: ${asgResult.error}`);
    for (const a of asgResult.data?.records ?? []) {
      if (String(a.AssignmentLevel ?? "Profile").toLowerCase() !== "profile") continue;
      const parentId = a.LifeSciConfigRecordId as string;
      const set = profileIdsByRecord.get(parentId) ?? new Set<string>();
      set.add(a.AssignedToId as string);
      profileIdsByRecord.set(parentId, set);
    }
  }

  const entries: DbSchemaEntry[] = [];
  for (const r of records) {
    const fields = fieldsByRecord.get(r.Id as string) ?? {};
    const sobject = (fields.SObject as string) || "";
    const type = (fields.Type as string) || "";
    if (!sobject || NON_DATA_SOBJECTS.has(sobject.toLowerCase())) continue;
    if (type.toLowerCase() === "configuration") continue;
    entries.push({
      developerName: r.DeveloperName as string,
      sobject,
      type,
      whereSoql: (fields.WhereSoql as string) || null,
      profileIds: profileIdsByRecord.get(r.Id as string) ?? new Set(),
      profileNames: new Set(splitList(fields.Profiles)),
      permissionSets: new Set(splitList(fields.PermissionSets)),
    });
  }
  return entries;
}

export interface UserContext {
  id: string;
  username: string;
  name: string;
  profileId: string;
  profileName: string;
  permissionSets: Set<string>;
  territories: Array<{ id: string; name: string }>;
}

export interface ApplicableTable {
  entry: DbSchemaEntry;
  matchedBy: "profile" | "permissionSet";
}

/**
 * Select the DB Schema records the user's device would sync, one per SObject.
 * Entries arrive sorted by DeveloperName; a profile match takes precedence over
 * a permission-set match for the same SObject.
 */
export function selectApplicableTables(
  entries: DbSchemaEntry[],
  user: Pick<UserContext, "profileId" | "profileName" | "permissionSets">
): ApplicableTable[] {
  const bySobject = new Map<string, ApplicableTable>();
  for (const entry of entries) {
    const key = entry.sobject.toLowerCase();
    const profileMatch =
      entry.profileIds.has(user.profileId) ||
      (entry.profileIds.size === 0 && entry.profileNames.has(user.profileName));
    const permMatch = [...entry.permissionSets].some((ps) => user.permissionSets.has(ps));
    if (!profileMatch && !permMatch) continue;

    const existing = bySobject.get(key);
    if (!existing) {
      bySobject.set(key, { entry, matchedBy: profileMatch ? "profile" : "permissionSet" });
    } else if (existing.matchedBy === "permissionSet" && profileMatch) {
      bySobject.set(key, { entry, matchedBy: "profile" });
    }
  }
  return [...bySobject.values()];
}

// ---------------------------------------------------------------------------
// WhereSoql tag resolution
// ---------------------------------------------------------------------------

export const TAG_ACCOUNT_IDS = "{ACCOUNT.IDS}";
export const TAG_OT2A_IDS = "{OT2A.OBJ.IDS}";
export const TAG_STI_IDS = "{STI.OBJ.IDS}";
const CONTENT_TAGS = ["{related.entities}", "{cont.docs}", "{attachments}"];
/** Tags that narrow a filter to one user — the count is then what that user downloads. */
const USER_SCOPE_TAGS = ["{USER.ID}", "{USER.TERRITORY}", "{USER.TERRITORYID}"];

export interface ScalarTagValues {
  userId: string;
  territoryName: string;
  territoryId: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTag(text: string, tag: string): boolean {
  return text.toLowerCase().includes(tag.toLowerCase());
}

function countTag(text: string, tag: string): number {
  return text.toLowerCase().split(tag.toLowerCase()).length - 1;
}

/** Same substitutions as the app's parseConditional(). */
export function resolveScalarTags(conditional: string, values: ScalarTagValues): string {
  let result = conditional.split(/\r?\n/).join(" ");
  const map: Record<string, string> = {
    "{USER.TERRITORY}": values.territoryName,
    "{USER.ID}": values.userId,
    // Legacy OCE Team__mdt membership; LSC orgs resolve this to an empty list.
    "{USER.TEAMS}": "''",
    "{USER.ACCESS.ENTITIES}": "'*'",
    "{USER.TERRITORYID}": values.territoryId,
  };
  for (const [tag, value] of Object.entries(map)) {
    result = result.replace(new RegExp(escapeRegExp(tag), "gi"), () => value);
  }
  return result;
}

/**
 * Substitute an id-list tag with a quoted id list. Accepts both `IN ({TAG})`
 * and `IN ('{TAG}')` forms found in customer filters.
 */
export function substituteIdTag(conditional: string, tag: string, ids: string[]): string {
  const list = ids.map((id) => `'${id}'`).join(",");
  const quoted = new RegExp(`'${escapeRegExp(tag)}'`, "gi");
  const bare = new RegExp(escapeRegExp(tag), "gi");
  return conditional.replace(quoted, () => list).replace(bare, () => list);
}

function splitChunks<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// Limits from the app's MetadataDatabaseTableLoader.
const MAX_WHERE_LENGTH = 4000;
const MAX_QUERY_LENGTH = 14000;
const REST_REQUEST_CHARACTERS = 200;
const ID_LENGTH_WITH_QUOTES = 21;

/**
 * Number of queries the app splits one table's filter into when it carries an
 * id-list tag (formQuery in the app): the id list is chunked to keep the WHERE
 * clause and the query under the app's length limits. Returns null when the
 * filter is too long for the app to fit any ids.
 */
export function estimateDeviceRequests(
  table: string,
  resolvedConditional: string,
  tag: string,
  idCount: number
): number | null {
  const template = `SELECT id FROM ${table} WHERE ${resolvedConditional}`;
  let limit = MAX_QUERY_LENGTH - (template.length + REST_REQUEST_CHARACTERS) - REST_REQUEST_CHARACTERS;
  limit = Math.min(limit, MAX_WHERE_LENGTH - resolvedConditional.length - REST_REQUEST_CHARACTERS);
  let chunkSize = Math.floor(limit / (ID_LENGTH_WITH_QUOTES + 1));
  const tagCount = countTag(resolvedConditional, tag);
  if (tagCount > 0) chunkSize = Math.floor(chunkSize / tagCount);
  if (chunkSize <= 0) return null;
  return Math.ceil(idCount / chunkSize);
}

/** Records per REST query page (the app sends no Sforce-Query-Options batch size). */
const QUERY_PAGE_SIZE = 2000;
/** Follow-on pages the app fetches per /composite/batch request. */
const PAGES_PER_BATCH = 15;

/**
 * Requests the app's legacy (REST query) download makes for one table on an
 * initial sync: one query per id-list chunk for its first page, then the
 * remaining 2,000-record pages in /composite/batch requests of up to 15. An
 * initial sync has no visibility pass. The enhanced (Connect) flow pages
 * differently, so treat this as an estimate of request load, not a count.
 */
export function initialSyncRequests(queries: number | null, records: number): number | null {
  if (queries === null) return null;
  if (queries <= 0) return 0;
  const pages = Math.max(queries, Math.ceil(records / QUERY_PAGE_SIZE));
  return queries + Math.ceil((pages - queries) / PAGES_PER_BATCH);
}

// ---------------------------------------------------------------------------
// Profiling
// ---------------------------------------------------------------------------

/** "timed-out": the COUNT() ran out of time, which says the table is too large to count, not that its filter is wrong. */
export type TableStatus = "counted" | "not-estimated" | "error" | "timed-out";

/**
 * How a counted table was narrowed to the user. "user": the filter (or the id
 * list it uses) depends on the user or their territory. "org-wide": the COUNT()
 * saw every record the connected user can, so for an admin it is only exact
 * when the object's sharing lets every user read every record.
 */
export type CountScope = "user" | "org-wide";

export interface TableVolume {
  sobject: string;
  developerName: string;
  matchedBy: "profile" | "permissionSet";
  status: TableStatus;
  records: number;
  deviceRequests: number | null;
  idTag?: string;
  note?: string;
  /** Set on counted tables. */
  scope?: CountScope;
  /** The object's internal org-wide default (EntityDefinition.InternalSharingModel), set on org-wide counts. */
  sharingModel?: string;
  /** The count is a minimum: an id list it was counted from was cut off at the row cap. */
  lowerBound?: boolean;
  /** Not estimated because the table its ids come from couldn't be counted. */
  sourceFailed?: boolean;
}

/** A table whose number is missing or only a minimum, so totals that include it understate the sync. */
export function isIncomplete(t: TableVolume): boolean {
  return t.status === "error" || t.status === "timed-out" || t.lowerBound === true || t.sourceFailed === true;
}

export function incompleteTables(terr: TerritoryVolume): TableVolume[] {
  return terr.tables.filter(isIncomplete);
}

/** Org-wide defaults under which every internal user reads every record. */
const OPEN_SHARING = new Set(["read", "readwrite", "readwritetransfer", "fullaccess"]);

/**
 * True when an org-wide count may exceed what the user downloads: the filter
 * isn't scoped to the user and the object's sharing is restricted or unknown.
 */
export function mayOvercount(t: TableVolume): boolean {
  return (
    t.status === "counted" &&
    t.scope === "org-wide" &&
    t.records > 0 &&
    !OPEN_SHARING.has((t.sharingModel ?? "").toLowerCase())
  );
}

/** Records in a territory that come from counts that may exceed the user's own visibility. */
export function upperBoundRecords(terr: TerritoryVolume): number {
  return terr.tables.filter(mayOvercount).reduce((n, t) => n + t.records, 0);
}

export interface TerritoryVolume {
  territory: { id: string; name: string } | null;
  tables: TableVolume[];
  totalRecords: number;
  largestTable: TableVolume | null;
  totalDeviceRequests: number;
}

/** Ids read for an id-list tag. */
interface IdFetch {
  ids: string[];
  /** Rows the id query returned (an id can repeat). */
  rows: number;
  /** More rows matched than were read, so `ids` is a prefix of the real list. */
  truncated: boolean;
}

export interface ProfileOptions {
  /** Most ids inlined per COUNT() query; the URL length budget may lower it per query. */
  idsPerQuery: number;
  concurrency: number;
  /** Id lists already read, by query, so tables and users sharing a territory read them once. */
  idCache?: Map<string, Promise<IdFetch>>;
}

export const DEFAULT_PROFILE_OPTIONS: ProfileOptions = { idsPerQuery: 500, concurrency: 6 };

/** Ids kept for one id-list tag; a longer list is cut and everything counted from it is a lower bound. */
export const MAX_TAG_IDS = 500_000;

/** Request path, API version and `q=` that share the GET URL with the query. */
const URL_OVERHEAD = 400;
/** An id as it appears URL-encoded in an IN list: %27 + 18 chars + %27 + %2C. */
const ENCODED_ID_CHARS = 27;

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** A query that failed; `timedOut` tells a too-large table from a bad filter. */
class QueryFailure extends Error {
  constructor(
    message: string,
    readonly timedOut: boolean
  ) {
    super(message);
  }
}

async function countQuery(org: OrgQuerier, sobject: string, where: string | null): Promise<number> {
  const q = where ? `SELECT COUNT() FROM ${sobject} WHERE ${where}` : `SELECT COUNT() FROM ${sobject}`;
  const result = await org.soql(q);
  if (!result.success) throw new QueryFailure(result.error || "COUNT() query failed", result.timedOut === true);
  return result.data?.totalSize ?? 0;
}

async function fetchIdsUncached(org: OrgQuerier, sobject: string, idField: string, where: string | null): Promise<IdFetch> {
  const q = where
    ? `SELECT ${idField} FROM ${sobject} WHERE ${where}`
    : `SELECT ${idField} FROM ${sobject}`;
  const result = await org.soql(q, { maxRows: MAX_TAG_IDS });
  if (!result.success) throw new QueryFailure(result.error || `${sobject} id query failed`, result.timedOut === true);
  const records = result.data?.records ?? [];
  const ids = new Set<string>();
  for (const r of records) {
    const v = r[idField];
    if (typeof v === "string") ids.add(v);
  }
  return { ids: [...ids], rows: records.length, truncated: result.data?.truncated === true };
}

/** Run `fn` once per key; a failure isn't kept, so a retry asks the org again. */
function memo(cache: Map<string, Promise<IdFetch>> | undefined, key: string, fn: () => Promise<IdFetch>): Promise<IdFetch> {
  if (!cache) return fn();
  let hit = cache.get(key);
  if (!hit) {
    hit = fn();
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
  }
  return hit;
}

/**
 * Ids per query so the query fits a REST GET URL: what's left of the budget
 * after the query without its ids, over the encoded size of one id (times the
 * number of places the tag appears), capped at `max`.
 */
export function idChunkSize(templateWithoutIds: string, tagCount: number, max: number): number {
  const room = MAX_GET_URL_CHARS - URL_OVERHEAD - encodeURIComponent(templateWithoutIds).length;
  return Math.max(1, Math.min(max, Math.floor(room / (ENCODED_ID_CHARS * Math.max(1, tagCount)))));
}

function idChunks(
  selectClause: string,
  sobject: string,
  conditional: string,
  tag: string,
  ids: string[],
  max: number
): string[][] {
  const template = `${selectClause} FROM ${sobject} WHERE ${substituteIdTag(conditional, tag, [])}`;
  return splitChunks(ids, idChunkSize(template, countTag(conditional, tag), max));
}

/**
 * Run a filter that may carry one id-list tag: chunk the ids, sum the per-chunk
 * results. Zero ids means the app issues no queries for the table.
 */
async function countWithIdTag(
  org: OrgQuerier,
  sobject: string,
  conditional: string,
  tag: string,
  ids: string[],
  options: ProfileOptions
): Promise<number> {
  if (ids.length === 0) return 0;
  const chunks = idChunks("SELECT COUNT()", sobject, conditional, tag, ids, options.idsPerQuery);
  const counts = await mapWithConcurrency(chunks, options.concurrency, (chunk) =>
    countQuery(org, sobject, substituteIdTag(conditional, tag, chunk))
  );
  return counts.reduce((a, b) => a + b, 0);
}

async function fetchIdsWithIdTag(
  org: OrgQuerier,
  sobject: string,
  idField: string,
  conditional: string,
  tag: string,
  ids: string[],
  options: ProfileOptions
): Promise<IdFetch> {
  if (ids.length === 0) return { ids: [], rows: 0, truncated: false };
  const chunks = idChunks(`SELECT ${idField}`, sobject, conditional, tag, ids, options.idsPerQuery);
  const parts = await mapWithConcurrency(chunks, options.concurrency, (chunk) =>
    fetchIdsUncached(org, sobject, idField, substituteIdTag(conditional, tag, chunk))
  );
  const all = [...new Set(parts.flatMap((p) => p.ids))];
  return {
    ids: all.slice(0, MAX_TAG_IDS),
    rows: parts.reduce((n, p) => n + p.rows, 0),
    truncated: parts.some((p) => p.truncated) || all.length > MAX_TAG_IDS,
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const TIMED_OUT_NOTE = "The count timed out — this table is too large to count in time, so its size is not in the totals.";

/** A failed table: "timed-out" when the org ran out of time, otherwise "error" with the message. */
function failedVolume(e: unknown): Pick<TableVolume, "status" | "records" | "deviceRequests" | "note"> {
  const timedOut = e instanceof QueryFailure && e.timedOut;
  return { status: timedOut ? "timed-out" : "error", records: 0, deviceRequests: null, note: timedOut ? `${TIMED_OUT_NOTE} (${errorMessage(e)})` : errorMessage(e) };
}

/**
 * Predict per-table sync volume for one user in one territory (or with no
 * territory when the user has none).
 */
export async function profileTerritory(
  org: OrgQuerier,
  user: UserContext,
  territory: { id: string; name: string } | null,
  tables: ApplicableTable[],
  options: ProfileOptions = DEFAULT_PROFILE_OPTIONS,
  onTable?: (done: number, total: number) => void
): Promise<TerritoryVolume> {
  let done = 0;
  const tick = () => onTable?.(++done, tables.length);
  const scalar: ScalarTagValues = {
    userId: user.id,
    territoryName: territory?.name ?? "",
    territoryId: territory?.id ?? "",
  };
  const resolved = (t: ApplicableTable) =>
    t.entry.whereSoql ? resolveScalarTags(t.entry.whereSoql, scalar) : null;
  const ownScope = (t: ApplicableTable | undefined): CountScope => {
    const where = t?.entry.whereSoql;
    return where && USER_SCOPE_TAGS.some((tag) => containsTag(where, tag)) ? "user" : "org-wide";
  };
  // A table filtered by an id list is as narrow as the table the ids came from.
  const viaIds = (t: ApplicableTable, source: CountScope): CountScope =>
    ownScope(t) === "user" || source === "user" ? "user" : "org-wide";

  const findTable = (name: string) =>
    tables.find((t) => t.entry.sobject.toLowerCase() === name.toLowerCase());
  const anyUses = (tag: string) =>
    tables.some((t) => t.entry.whereSoql && containsTag(t.entry.whereSoql, tag));

  const volumes: TableVolume[] = [];
  const base = (t: ApplicableTable) => ({
    sobject: t.entry.sobject,
    developerName: t.entry.developerName,
    matchedBy: t.matchedBy,
  });

  // The app loads ObjectTerritory2Association first, then Account, when other
  // filters reference their ids. The id lists are read once per query across
  // tables, territories and users (`idCache`).
  const cache = options.idCache ?? new Map<string, Promise<IdFetch>>();
  let ot2aIds: string[] = [];
  let ot2aFailed = false;
  let ot2aLower = false;
  let ot2aKey = "";
  const ot2aTable = findTable("ObjectTerritory2Association");
  if (ot2aTable && anyUses(TAG_OT2A_IDS)) {
    ot2aKey = `OT2A|${resolved(ot2aTable)}`;
    const where = resolved(ot2aTable);
    try {
      const fetched = await memo(cache, ot2aKey, () => fetchIdsUncached(org, ot2aTable.entry.sobject, "ObjectId", where));
      ot2aIds = fetched.ids;
      let total = fetched.rows;
      let totalLower = false;
      if (fetched.truncated) {
        // The id list is cut short; the table's own size still counts exactly.
        ot2aLower = true;
        try {
          total = await countQuery(org, ot2aTable.entry.sobject, where);
        } catch {
          totalLower = true;
        }
      }
      volumes.push({
        ...base(ot2aTable),
        status: "counted",
        records: total,
        deviceRequests: initialSyncRequests(1, total),
        scope: ownScope(ot2aTable),
        ...(totalLower ? { lowerBound: true } : {}),
        ...(fetched.truncated ? { note: `Only the first ${fetched.rows.toLocaleString("en-US")} ids could be read, so tables filtered by {OT2A.OBJ.IDS} are counted as minimums` } : {}),
      });
    } catch (e) {
      ot2aFailed = true;
      volumes.push({ ...base(ot2aTable), ...failedVolume(e) });
    }
    tick();
  }

  let accountIds: string[] = [];
  let accountFailed = false;
  /** Tables filtered by {ACCOUNT.IDS} count only the accounts whose ids were read. */
  let accountLower = false;
  const accountTable = findTable("Account");
  const ot2aScope = ownScope(ot2aTable);
  const accountScope =
    accountTable?.entry.whereSoql && containsTag(accountTable.entry.whereSoql, TAG_OT2A_IDS)
      ? viaIds(accountTable, ot2aScope)
      : ownScope(accountTable);
  if (accountTable && anyUses(TAG_ACCOUNT_IDS)) {
    const cond = resolved(accountTable);
    try {
      if (cond && containsTag(cond, TAG_OT2A_IDS) && ot2aFailed) {
        accountFailed = true;
        volumes.push({ ...base(accountTable), status: "not-estimated", records: 0, deviceRequests: null, idTag: TAG_OT2A_IDS, sourceFailed: true, note: `${TAG_OT2A_IDS} could not be resolved because its source table query failed` });
      } else if (cond && containsTag(cond, TAG_OT2A_IDS)) {
        const fetched = await memo(cache, `Account|${cond}|${ot2aKey}`, () =>
          fetchIdsWithIdTag(org, "Account", "Id", cond, TAG_OT2A_IDS, ot2aIds, options)
        );
        accountIds = fetched.ids;
        const sourceLower = ot2aLower;
        let records = accountIds.length;
        if (fetched.truncated) records = await countWithIdTag(org, "Account", cond, TAG_OT2A_IDS, ot2aIds, options);
        accountLower = sourceLower || fetched.truncated;
        volumes.push({
          ...base(accountTable),
          status: "counted",
          records,
          deviceRequests: initialSyncRequests(estimateDeviceRequests("Account", cond, TAG_OT2A_IDS, ot2aIds.length), records),
          idTag: TAG_OT2A_IDS,
          scope: accountScope,
          ...(sourceLower ? { lowerBound: true } : {}),
        });
      } else {
        const fetched = await memo(cache, `Account|${cond}`, () => fetchIdsUncached(org, "Account", "Id", cond));
        accountIds = fetched.ids;
        const records = fetched.truncated ? await countQuery(org, "Account", cond) : accountIds.length;
        accountLower = fetched.truncated;
        volumes.push({
          ...base(accountTable),
          status: "counted",
          records,
          deviceRequests: initialSyncRequests(1, records),
          scope: accountScope,
          ...(fetched.truncated ? { note: `Only the first ${fetched.rows.toLocaleString("en-US")} ids could be read, so tables filtered by {ACCOUNT.IDS} are counted as minimums` } : {}),
        });
      }
    } catch (e) {
      accountFailed = true;
      volumes.push({ ...base(accountTable), ...failedVolume(e) });
    }
    tick();
  }

  const handled = new Set(volumes.map((v) => v.sobject.toLowerCase()));
  const remaining = tables.filter((t) => !handled.has(t.entry.sobject.toLowerCase()));

  const rest = await mapWithConcurrency(remaining, options.concurrency, async (t): Promise<TableVolume> => {
    const cond = resolved(t);
    try {
      if (!cond) {
        const records = await countQuery(org, t.entry.sobject, null);
        return { ...base(t), status: "counted", records, deviceRequests: initialSyncRequests(1, records), scope: "org-wide" };
      }
      if (CONTENT_TAGS.some((tag) => containsTag(cond, tag))) {
        return { ...base(t), status: "not-estimated", records: 0, deviceRequests: null, note: "Content/attachment filter is resolved from other tables at sync time" };
      }
      if (containsTag(cond, TAG_STI_IDS)) {
        return { ...base(t), status: "not-estimated", records: 0, deviceRequests: null, note: "{STI.OBJ.IDS} depends on the device's pending sync transactions" };
      }
      const hasAccount = containsTag(cond, TAG_ACCOUNT_IDS);
      const hasOt2a = containsTag(cond, TAG_OT2A_IDS);
      if (hasAccount && hasOt2a) {
        return { ...base(t), status: "not-estimated", records: 0, deviceRequests: null, note: "Filter combines {ACCOUNT.IDS} and {OT2A.OBJ.IDS}" };
      }
      if (hasAccount || hasOt2a) {
        const tag = hasAccount ? TAG_ACCOUNT_IDS : TAG_OT2A_IDS;
        const ids = hasAccount ? accountIds : ot2aIds;
        const source = hasAccount ? accountTable : ot2aTable;
        if ((hasAccount && accountFailed) || (hasOt2a && ot2aFailed)) {
          return { ...base(t), status: "not-estimated", records: 0, deviceRequests: null, idTag: tag, sourceFailed: true, note: `${tag} could not be resolved because its source table query failed` };
        }
        if (!source) {
          return { ...base(t), status: "counted", records: 0, deviceRequests: 0, idTag: tag, scope: "user", note: `${tag} is used but its source table is not in this user's DB Schema, so the app has no ids to substitute` };
        }
        const records = await countWithIdTag(org, t.entry.sobject, cond, tag, ids, options);
        const lower = hasAccount ? accountLower : ot2aLower;
        return {
          ...base(t),
          status: "counted",
          records,
          deviceRequests: initialSyncRequests(estimateDeviceRequests(t.entry.sobject, cond, tag, ids.length), records),
          idTag: tag,
          scope: viaIds(t, hasAccount ? accountScope : ot2aScope),
          ...(lower ? { lowerBound: true, note: `Counted from the first ${ids.length.toLocaleString("en-US")} ${tag} ids only — a minimum` } : {}),
        };
      }
      const records = await countQuery(org, t.entry.sobject, cond);
      return { ...base(t), status: "counted", records, deviceRequests: initialSyncRequests(1, records), scope: ownScope(t) };
    } catch (e) {
      return { ...base(t), ...failedVolume(e) };
    } finally {
      tick();
    }
  });

  const all = [...volumes, ...rest].sort((a, b) => b.records - a.records);
  const counted = all.filter((v) => v.status === "counted");
  return {
    territory,
    tables: all,
    totalRecords: counted.reduce((sum, v) => sum + v.records, 0),
    largestTable: counted[0] ?? null,
    totalDeviceRequests: counted.reduce((sum, v) => sum + (v.deviceRequests ?? 0), 0),
  };
}

/**
 * Record each org-wide count's object sharing model, so callers can tell exact
 * counts from upper bounds. A failed lookup leaves the model unknown, which
 * mayOvercount() treats as restricted.
 */
export async function annotateSharing(org: OrgQuerier, territories: TerritoryVolume[]): Promise<void> {
  const tables = territories.flatMap((t) => t.tables).filter((t) => t.status === "counted" && t.scope === "org-wide");
  const names = [...new Set(tables.map((t) => t.sobject))];
  if (names.length === 0) return;
  const result = await org.soql(
    `SELECT QualifiedApiName, InternalSharingModel FROM EntityDefinition WHERE QualifiedApiName IN (${names.map((n) => `'${soqlString(n)}'`).join(",")})`
  );
  if (!result.success) return;
  const models = new Map<string, string>();
  for (const r of result.data?.records ?? []) {
    if (typeof r.QualifiedApiName === "string" && typeof r.InternalSharingModel === "string") {
      models.set(r.QualifiedApiName.toLowerCase(), r.InternalSharingModel);
    }
  }
  for (const t of tables) {
    const model = models.get(t.sobject.toLowerCase());
    if (model) t.sharingModel = model;
  }
}

function soqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Resolve a username or 15/18-char User Id into the context profiling needs. */
export async function loadUserContext(org: OrgQuerier, userRef: string): Promise<UserContext> {
  const ref = soqlString(userRef.trim());
  const isId = /^005[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/.test(userRef.trim());
  const where = isId ? `Id = '${ref}'` : `Username = '${ref}'`;
  const userResult = await org.soql(
    `SELECT Id, Username, Name, ProfileId, Profile.Name FROM User WHERE ${where} LIMIT 1`
  );
  if (!userResult.success) throw new Error(`User lookup failed: ${userResult.error}`);
  const u = userResult.data?.records?.[0];
  if (!u) throw new Error(`User not found: ${userRef}`);

  const userId = u.Id as string;
  const profile = (u.Profile as Record<string, unknown> | null) ?? null;

  const [psResult, terrResult] = await Promise.all([
    org.soql(`SELECT PermissionSet.Name FROM PermissionSetAssignment WHERE AssigneeId = '${userId}'`),
    org.soql(
      `SELECT Territory2Id, Territory2.Name FROM UserTerritory2Association WHERE UserId = '${userId}' AND Territory2.Territory2Model.State = 'Active' ORDER BY Territory2.Name`
    ),
  ]);
  const permissionSets = new Set<string>();
  for (const r of psResult.data?.records ?? []) {
    const ps = r.PermissionSet as Record<string, unknown> | null;
    if (ps?.Name) permissionSets.add(ps.Name as string);
  }

  const territories: Array<{ id: string; name: string }> = [];
  for (const r of terrResult.data?.records ?? []) {
    const t = r.Territory2 as Record<string, unknown> | null;
    territories.push({ id: r.Territory2Id as string, name: (t?.Name as string) ?? "" });
  }

  return {
    id: userId,
    username: u.Username as string,
    name: u.Name as string,
    profileId: u.ProfileId as string,
    profileName: (profile?.Name as string) ?? "",
    permissionSets,
    territories,
  };
}

/** Territories per aggregate query when ranking them by aligned accounts. */
const TERRITORY_RANK_CHUNK = 150;

/** Aligned Account rows per territory (keyed by 15-character id), in chunked GROUP BY queries. Throws when one fails. */
export async function territoryAccountCounts(org: OrgQuerier, territories: Array<{ id: string }>): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  const chunks = splitChunks(territories, TERRITORY_RANK_CHUNK);
  await mapWithConcurrency(chunks, DEFAULT_PROFILE_OPTIONS.concurrency, async (chunk) => {
    const list = chunk.map((t) => `'${soqlString(t.id)}'`).join(",");
    const result = await org.soql(
      `SELECT Territory2Id, COUNT(Id) cnt FROM ObjectTerritory2Association WHERE SobjectType = 'Account' AND Territory2Id IN (${list}) GROUP BY Territory2Id`
    );
    if (!result.success) throw new Error(result.error || "territory size query failed");
    for (const r of result.data?.records ?? []) sizes.set(String(r.Territory2Id).slice(0, 15), Number(r.cnt ?? r.expr0 ?? 0));
  });
  return sizes;
}

/**
 * Choose which of a user's territories to profile. Over the cap, the ones with
 * the most aligned accounts win — they carry the heaviest sync — and `note` says
 * how many were left out. Falls back to name order (with a note saying so) when
 * the sizes can't be read.
 */
export async function pickLargestTerritories(
  org: OrgQuerier,
  territories: Array<{ id: string; name: string }>,
  cap: number
): Promise<{ picked: Array<{ id: string; name: string }>; note?: string }> {
  if (territories.length <= cap) return { picked: territories };
  try {
    const sizes = await territoryAccountCounts(org, territories);
    const sizeOf = (t: { id: string }) => sizes.get(t.id.slice(0, 15)) ?? 0;
    const picked = [...territories].sort((a, b) => sizeOf(b) - sizeOf(a) || a.name.localeCompare(b.name)).slice(0, cap);
    return { picked, note: `Checked the ${cap} largest of ${territories.length} territories (by aligned accounts); the other ${territories.length - cap} are smaller.` };
  } catch (e) {
    return {
      picked: territories.slice(0, cap),
      note: `Checked the first ${cap} of ${territories.length} territories in name order — couldn't rank them by size (${errorMessage(e)}), so a larger one may be missing.`,
    };
  }
}
