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
import { FV_VALUE_COLUMNS, extractFieldValue } from "../tools/helpers.js";

export interface OrgQuerier {
  soql(query: string): Promise<CliResult<SoqlQueryResult>>;
  tooling(query: string): Promise<CliResult<SoqlQueryResult>>;
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

  for (let i = 0; i < ids.length; i += 50) {
    const idList = ids
      .slice(i, i + 50)
      .map((id) => `'${id}'`)
      .join(",");

    const fvResult = await org.tooling(
      `SELECT LifeSciConfigRecordId, FieldName, DataType, ${FV_VALUE_COLUMNS.join(", ")} FROM LifeSciConfigFieldValue WHERE LifeSciConfigRecordId IN (${idList})`
    );
    if (!fvResult.success) throw new Error(`DbSchema field value query failed: ${fvResult.error}`);
    for (const fv of fvResult.data?.records ?? []) {
      const parentId = fv.LifeSciConfigRecordId as string;
      const fields = fieldsByRecord.get(parentId) ?? {};
      fields[fv.FieldName as string] = extractFieldValue(fv);
      fieldsByRecord.set(parentId, fields);
    }

    const asgResult = await org.tooling(
      `SELECT LifeSciConfigRecordId, AssignedToId, AssignmentLevel FROM LifeSciConfigAssignment WHERE LifeSciConfigRecordId IN (${idList})`
    );
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
 * Number of SOQL requests the app issues for one table's visibility pass when
 * the filter carries an id-list tag (formQuery in the app). Returns null when
 * the filter is too long for the app to fit any ids.
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

// ---------------------------------------------------------------------------
// Profiling
// ---------------------------------------------------------------------------

export type TableStatus = "counted" | "not-estimated" | "error";

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

export interface ProfileOptions {
  /** Ids inlined per COUNT() query issued by the harness. */
  idsPerQuery: number;
  concurrency: number;
}

export const DEFAULT_PROFILE_OPTIONS: ProfileOptions = { idsPerQuery: 200, concurrency: 4 };

async function mapWithConcurrency<T, R>(
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

async function countQuery(org: OrgQuerier, sobject: string, where: string | null): Promise<number> {
  const q = where ? `SELECT COUNT() FROM ${sobject} WHERE ${where}` : `SELECT COUNT() FROM ${sobject}`;
  const result = await org.soql(q);
  if (!result.success) throw new Error(result.error || "COUNT() query failed");
  return result.data?.totalSize ?? 0;
}

async function fetchIds(
  org: OrgQuerier,
  sobject: string,
  idField: string,
  where: string | null
): Promise<string[]> {
  const q = where
    ? `SELECT ${idField} FROM ${sobject} WHERE ${where}`
    : `SELECT ${idField} FROM ${sobject}`;
  const result = await org.soql(q);
  if (!result.success) throw new Error(result.error || `${sobject} id query failed`);
  const ids = new Set<string>();
  for (const r of result.data?.records ?? []) {
    const v = r[idField];
    if (typeof v === "string") ids.add(v);
  }
  return [...ids];
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
  const chunks = splitChunks(ids, options.idsPerQuery);
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
): Promise<string[]> {
  if (ids.length === 0) return [];
  const chunks = splitChunks(ids, options.idsPerQuery);
  const lists = await mapWithConcurrency(chunks, options.concurrency, (chunk) =>
    fetchIds(org, sobject, idField, substituteIdTag(conditional, tag, chunk))
  );
  return [...new Set(lists.flat())];
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
  options: ProfileOptions = DEFAULT_PROFILE_OPTIONS
): Promise<TerritoryVolume> {
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
  // filters reference their ids.
  let ot2aIds: string[] = [];
  let ot2aFailed = false;
  const ot2aTable = findTable("ObjectTerritory2Association");
  if (ot2aTable && anyUses(TAG_OT2A_IDS)) {
    try {
      ot2aIds = await fetchIds(org, ot2aTable.entry.sobject, "ObjectId", resolved(ot2aTable));
      const total = await countQuery(org, ot2aTable.entry.sobject, resolved(ot2aTable));
      volumes.push({ ...base(ot2aTable), status: "counted", records: total, deviceRequests: 1, scope: ownScope(ot2aTable) });
    } catch (e) {
      ot2aFailed = true;
      volumes.push({ ...base(ot2aTable), status: "error", records: 0, deviceRequests: null, note: errorMessage(e) });
    }
  }

  let accountIds: string[] = [];
  let accountFailed = false;
  const accountTable = findTable("Account");
  const ot2aScope = ownScope(ot2aTable);
  const accountScope =
    accountTable?.entry.whereSoql && containsTag(accountTable.entry.whereSoql, TAG_OT2A_IDS)
      ? viaIds(accountTable, ot2aScope)
      : ownScope(accountTable);
  if (accountTable && anyUses(TAG_ACCOUNT_IDS)) {
    const cond = resolved(accountTable);
    try {
      if (cond && containsTag(cond, TAG_OT2A_IDS)) {
        accountIds = await fetchIdsWithIdTag(org, "Account", "Id", cond, TAG_OT2A_IDS, ot2aIds, options);
        volumes.push({
          ...base(accountTable),
          status: "counted",
          records: accountIds.length,
          deviceRequests: estimateDeviceRequests("Account", cond, TAG_OT2A_IDS, ot2aIds.length),
          idTag: TAG_OT2A_IDS,
          scope: accountScope,
        });
      } else {
        accountIds = await fetchIds(org, "Account", "Id", cond);
        volumes.push({ ...base(accountTable), status: "counted", records: accountIds.length, deviceRequests: 1, scope: accountScope });
      }
    } catch (e) {
      accountFailed = true;
      volumes.push({ ...base(accountTable), status: "error", records: 0, deviceRequests: null, note: errorMessage(e) });
    }
  }

  const handled = new Set(volumes.map((v) => v.sobject.toLowerCase()));
  const remaining = tables.filter((t) => !handled.has(t.entry.sobject.toLowerCase()));

  const rest = await mapWithConcurrency(remaining, options.concurrency, async (t): Promise<TableVolume> => {
    const cond = resolved(t);
    try {
      if (!cond) {
        return { ...base(t), status: "counted", records: await countQuery(org, t.entry.sobject, null), deviceRequests: 1, scope: "org-wide" };
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
          return { ...base(t), status: "not-estimated", records: 0, deviceRequests: null, idTag: tag, note: `${tag} could not be resolved because its source table query failed` };
        }
        if (!source) {
          return { ...base(t), status: "counted", records: 0, deviceRequests: 0, idTag: tag, scope: "user", note: `${tag} is used but its source table is not in this user's DB Schema, so the app has no ids to substitute` };
        }
        return {
          ...base(t),
          status: "counted",
          records: await countWithIdTag(org, t.entry.sobject, cond, tag, ids, options),
          deviceRequests: estimateDeviceRequests(t.entry.sobject, cond, tag, ids.length),
          idTag: tag,
          scope: viaIds(t, hasAccount ? accountScope : ot2aScope),
        };
      }
      return { ...base(t), status: "counted", records: await countQuery(org, t.entry.sobject, cond), deviceRequests: 1, scope: ownScope(t) };
    } catch (e) {
      return { ...base(t), status: "error", records: 0, deviceRequests: null, note: errorMessage(e) };
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

  const psResult = await org.soql(
    `SELECT PermissionSet.Name FROM PermissionSetAssignment WHERE AssigneeId = '${userId}'`
  );
  const permissionSets = new Set<string>();
  for (const r of psResult.data?.records ?? []) {
    const ps = r.PermissionSet as Record<string, unknown> | null;
    if (ps?.Name) permissionSets.add(ps.Name as string);
  }

  const terrResult = await org.soql(
    `SELECT Territory2Id, Territory2.Name FROM UserTerritory2Association WHERE UserId = '${userId}' AND Territory2.Territory2Model.State = 'Active' ORDER BY Territory2.Name`
  );
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
