/**
 * Shared helper functions used by multiple tool modules.
 * Extracted from the original monolithic index.ts during the Phase 2 refactor.
 */

import { runToolingQuery, cachedToolingQuery } from "../salesforce/cli.js";

// All 12 value columns on LifeSciConfigFieldValue (per the Life Sciences Developer Guide)
export const FV_VALUE_COLUMNS = [
  "TextValue",
  "IntegerValue",
  "PicklistValue",
  "HasBooleanValue",
  "LongTextValue",
  "ObjectValue",
  "FieldValue",
  "UrlValue",
  "NumberValue",
  "PhoneValue",
  "DateTimeValue",
  "DateValue",
];

/**
 * Ids per IN-list query. Each quoted id costs about 26 characters once the
 * request is URL-encoded, so ~400 ids stay under a ~12k-character budget (the
 * old fixed 50 spent ~1,300 and multiplied the round trips).
 */
export const ID_CHUNK_SIZE = 400;

/**
 * Parent ids per field-value query. Tooling pages hold 250 rows and each page is a round trip, so one
 * 400-id query for a few thousand values is a long chain of sequential pages; smaller chunks run side
 * by side (every record's values stay in one chunk, so results are looked up by id exactly as before).
 * A record has about a dozen values, so 20 parents is about one page: on 215 DB Schema records, 20 read
 * in ~0.6 s where 100 took ~1.0-1.9 s (the chunks are metered by the limiter, so more of them is cheap).
 */
export const FIELD_VALUE_CHUNK_SIZE = 20;

export function chunkIds<T>(ids: T[], size = ID_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/**
 * Query LifeSciConfigAssignment records for a set of parent record IDs and resolve
 * AssignedToId references to Profile/PermissionSet names.
 */
export async function queryAssignments(
  recordIds: string[],
  targetOrg: string,
  strict = false
): Promise<Map<string, Array<{ id: string; name: string; level: string }>>> {
  const result = new Map<string, Array<{ id: string; name: string; level: string }>>();

  if (recordIds.length === 0) return result;

  const assignedToIds = new Set<string>();
  const rawAssignments: Array<Record<string, unknown>> = [];

  // Chunked so a long id list doesn't overflow the request URL; chunks run side
  // by side and the process-wide limiter caps how many reach the org at once.
  const chunkResults = await Promise.all(
    chunkIds(recordIds).map((chunk) => {
      const idFilter =
        chunk.length === 1
          ? `LifeSciConfigRecordId = '${chunk[0]}'`
          : `LifeSciConfigRecordId IN (${chunk.map((id) => `'${id}'`).join(",")})`;
      const assignQuery = `SELECT Id, LifeSciConfigRecordId, AssignedToId, AssignmentLevel FROM LifeSciConfigAssignment WHERE ${idFilter}`;
      return runToolingQuery(assignQuery, targetOrg);
    })
  );

  for (const assignResult of chunkResults) {
    if (!assignResult.success || assignResult.data?.truncated) {
      if (strict) {
        throw new Error(`Couldn't read Admin Console assignments: ${assignResult.error ?? "too many assignments to read"}`);
      }
      continue;
    }

    for (const r of assignResult.data?.records ?? []) {
      const a = r as Record<string, unknown>;
      rawAssignments.push(a);
      if (a.AssignedToId) assignedToIds.add(a.AssignedToId as string);
    }
  }

  if (rawAssignments.length === 0) return result;

  const nameMap = new Map<string, string>();
  if (assignedToIds.size > 0) {
    const resolveNames = async (object: string, ids: string[]) => {
      const results = await Promise.all(
        chunkIds(ids).map((chunk) =>
          cachedToolingQuery(`SELECT Id, Name FROM ${object} WHERE Id IN (${chunk.map((id) => `'${id}'`).join(",")})`, targetOrg)
        )
      );
      for (const r of results) {
        for (const row of r.success ? (r.data?.records ?? []) : []) {
          const rr = row as Record<string, unknown>;
          nameMap.set(rr.Id as string, rr.Name as string);
        }
      }
    };

    // Profile ids start with 00e; anything else can only be a permission set (or group), which used to
    // be asked for after the profile query found nothing. Asking both at once gives the same names.
    const all = [...assignedToIds];
    const profileIds = all.filter((id) => id.startsWith("00e"));
    const otherIds = all.filter((id) => !id.startsWith("00e"));
    await Promise.all([
      profileIds.length > 0 ? resolveNames("Profile", profileIds) : undefined,
      otherIds.length > 0 ? resolveNames("PermissionSet", otherIds) : undefined,
    ]);
    // A profile id the Profile query couldn't name (deleted) was tried as a permission set too.
    const unresolvedProfiles = profileIds.filter((id) => !nameMap.has(id));
    if (unresolvedProfiles.length > 0) await resolveNames("PermissionSet", unresolvedProfiles);
  }

  for (const a of rawAssignments) {
    const parentId = a.LifeSciConfigRecordId as string;
    const assignedToId = a.AssignedToId as string;
    const level = (a.AssignmentLevel as string) || "Profile";
    const name = nameMap.get(assignedToId) || assignedToId;

    if (!result.has(parentId)) {
      result.set(parentId, []);
    }
    result.get(parentId)!.push({ id: assignedToId, name, level });
  }

  return result;
}

/**
 * Look up a Profile ID by name via the Tooling API.
 */
export async function resolveProfileId(
  profileName: string,
  targetOrg: string
): Promise<string | null> {
  const query = `SELECT Id FROM Profile WHERE Name = '${profileName.replace(/'/g, "\\'")}' LIMIT 1`;
  const result = await cachedToolingQuery(query, targetOrg);
  if (result.success && result.data?.records?.length) {
    return (result.data.records[0] as Record<string, unknown>).Id as string;
  }
  return null;
}

/**
 * Map DataType to the Tooling API value column name.
 */
export function getValueColumn(dataType: string): string {
  switch (dataType) {
    case "TEXT":
      return "TextValue";
    case "INTEGER":
      return "IntegerValue";
    case "PICKLIST":
      return "PicklistValue";
    case "BOOLEAN":
      return "HasBooleanValue";
    case "LONGTEXT":
      return "LongTextValue";
    case "OBJECT":
      return "ObjectValue";
    case "FIELD":
      return "FieldValue";
    case "URL":
      return "UrlValue";
    case "NUMBER":
      return "NumberValue";
    case "PHONE":
      return "PhoneValue";
    case "MULTIPICKLIST":
      return "LongTextValue";
    case "RECORDREFERENCE":
      return "TextValue";
    default:
      return "TextValue";
  }
}

/**
 * Extract value from a field value record.
 *
 * The row's `DataType` tells us which of the 12 typed value columns actually
 * holds the value, so we read that column directly. This matters because the
 * Tooling API returns `HasBooleanValue` as `false` (not null) even for
 * non-boolean fields — a blind coalesce would then report every empty TEXT /
 * LONGTEXT field as `false` (e.g. `WhereSoql: false`, `Category: false`).
 *
 * When the row carries no `DataType` (legacy callers), fall back to coalescing
 * across the columns, but never let the phantom `HasBooleanValue=false` win.
 */
export function extractFieldValue(f: Record<string, unknown>): unknown {
  const dataType = f.DataType as string | undefined;
  if (dataType) {
    const v = f[getValueColumn(dataType)];
    return v === undefined ? null : v;
  }
  return (
    f.TextValue ??
    f.PicklistValue ??
    f.IntegerValue ??
    f.LongTextValue ??
    f.ObjectValue ??
    f.FieldValue ??
    f.UrlValue ??
    f.NumberValue ??
    f.PhoneValue ??
    f.DateTimeValue ??
    f.DateValue ??
    null
  );
}

/**
 * Normalize DbSchema name — accepts "Visit" or "DbSchema_Visit".
 */
export function normalizeDbSchemaName(name: string): string {
  return /^dbschema_/i.test(name) ? name : `DbSchema_${name}`;
}

/**
 * Query LifeSciConfigFieldValue records for a set of parent record IDs.
 * Returns a map of parentId → field values.
 */
export async function queryFieldValues(
  recordIds: string[],
  targetOrg: string,
  includeParentId: boolean = false
): Promise<{
  fieldValuesByRecord: Map<string, Array<Record<string, unknown>>>;
  queryError?: string;
}> {
  const columns = FV_VALUE_COLUMNS;
  const fieldValuesByRecord = new Map<string, Array<Record<string, unknown>>>();

  const parentIdCol = includeParentId ? ", LifeSciConfigRecordId" : "";

  // Chunks run side by side; the process-wide limiter caps how many reach the org at once.
  const chunkResults = await Promise.all(
    chunkIds(recordIds, FIELD_VALUE_CHUNK_SIZE).map(async (chunk) => {
      let fvQuery: string;
      if (chunk.length === 1) {
        fvQuery = `SELECT Id, FieldName, DataType, ${columns.join(", ")}${parentIdCol} FROM LifeSciConfigFieldValue WHERE LifeSciConfigRecordId = '${chunk[0]}' ORDER BY FieldName`;
      } else {
        const idList = chunk.map((id) => `'${id}'`).join(",");
        fvQuery = `SELECT Id, FieldName, DataType, ${columns.join(", ")}, LifeSciConfigRecordId FROM LifeSciConfigFieldValue WHERE LifeSciConfigRecordId IN (${idList}) ORDER BY FieldName`;
      }
      return { chunk, fvResult: await runToolingQuery(fvQuery, targetOrg) };
    })
  );

  let queryError: string | undefined;
  for (const { chunk, fvResult } of chunkResults) {
    if (!fvResult.success) {
      queryError ??= fvResult.error || "Unknown query error";
      continue;
    }
    if (fvResult.data?.truncated) {
      queryError ??= "Too many field values to read in one query";
      continue;
    }
    for (const fv of fvResult.data?.records ?? []) {
      const f = fv as Record<string, unknown>;
      const parentId = (f.LifeSciConfigRecordId as string) || chunk[0];
      if (!fieldValuesByRecord.has(parentId)) {
        fieldValuesByRecord.set(parentId, []);
      }
      fieldValuesByRecord.get(parentId)!.push(f);
    }
  }

  return queryError ? { fieldValuesByRecord, queryError } : { fieldValuesByRecord };
}
