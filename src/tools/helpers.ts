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
 * Query LifeSciConfigAssignment records for a set of parent record IDs and resolve
 * AssignedToId references to Profile/PermissionSet names.
 */
export async function queryAssignments(
  recordIds: string[],
  targetOrg: string
): Promise<Map<string, Array<{ id: string; name: string; level: string }>>> {
  const result = new Map<string, Array<{ id: string; name: string; level: string }>>();

  if (recordIds.length === 0) return result;

  const idFilter =
    recordIds.length === 1
      ? `LifeSciConfigRecordId = '${recordIds[0]}'`
      : `LifeSciConfigRecordId IN (${recordIds.map((id) => `'${id}'`).join(",")})`;

  const assignQuery = `SELECT Id, LifeSciConfigRecordId, AssignedToId, AssignmentLevel FROM LifeSciConfigAssignment WHERE ${idFilter}`;
  const assignResult = await runToolingQuery(assignQuery, targetOrg);

  if (!assignResult.success || !assignResult.data?.records?.length) {
    return result;
  }

  const assignedToIds = new Set<string>();
  const rawAssignments: Array<Record<string, unknown>> = [];

  for (const r of assignResult.data.records) {
    const a = r as Record<string, unknown>;
    rawAssignments.push(a);
    if (a.AssignedToId) assignedToIds.add(a.AssignedToId as string);
  }

  const nameMap = new Map<string, string>();
  if (assignedToIds.size > 0) {
    const idList = [...assignedToIds].map((id) => `'${id}'`).join(",");

    const profileQuery = `SELECT Id, Name FROM Profile WHERE Id IN (${idList})`;
    const profileResult = await cachedToolingQuery(profileQuery, targetOrg);
    if (profileResult.success && profileResult.data?.records) {
      for (const p of profileResult.data.records) {
        const pr = p as Record<string, unknown>;
        nameMap.set(pr.Id as string, pr.Name as string);
      }
    }

    const unresolvedIds = [...assignedToIds].filter((id) => !nameMap.has(id));
    if (unresolvedIds.length > 0) {
      const psIdList = unresolvedIds.map((id) => `'${id}'`).join(",");
      const psQuery = `SELECT Id, Name FROM PermissionSet WHERE Id IN (${psIdList})`;
      const psResult = await cachedToolingQuery(psQuery, targetOrg);
      if (psResult.success && psResult.data?.records) {
        for (const ps of psResult.data.records) {
          const psr = ps as Record<string, unknown>;
          nameMap.set(psr.Id as string, psr.Name as string);
        }
      }
    }
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
  return name.startsWith("DbSchema_") ? name : `DbSchema_${name}`;
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

  const chunkSize = 50;
  for (let i = 0; i < recordIds.length; i += chunkSize) {
    const chunk = recordIds.slice(i, i + chunkSize);

    let fvQuery: string;

    if (chunk.length === 1) {
      fvQuery = `SELECT Id, FieldName, DataType, ${columns.join(", ")}${parentIdCol} FROM LifeSciConfigFieldValue WHERE LifeSciConfigRecordId = '${chunk[0]}' ORDER BY FieldName`;
    } else {
      const idList = chunk.map((id) => `'${id}'`).join(",");
      fvQuery = `SELECT Id, FieldName, DataType, ${columns.join(", ")}, LifeSciConfigRecordId FROM LifeSciConfigFieldValue WHERE LifeSciConfigRecordId IN (${idList}) ORDER BY FieldName`;
    }

    const fvResult = await runToolingQuery(fvQuery, targetOrg);

    if (!fvResult.success) {
      return { fieldValuesByRecord, queryError: fvResult.error || "Unknown query error" };
    }

    if (fvResult.data?.records) {
      for (const fv of fvResult.data.records) {
        const f = fv as Record<string, unknown>;
        const parentId = (f.LifeSciConfigRecordId as string) || chunk[0];
        if (!fieldValuesByRecord.has(parentId)) {
          fieldValuesByRecord.set(parentId, []);
        }
        fieldValuesByRecord.get(parentId)!.push(f);
      }
    }
  }

  return { fieldValuesByRecord };
}
