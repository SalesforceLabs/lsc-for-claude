/**
 * applyConfig() — the idempotent, create + update-only apply engine.
 *
 * Given a source snapshot, a computed diff, and a selection of record keys, this
 * writes the selected changes to the target org using the same Tooling primitives
 * the individual tools use (createToolingRecord / updateToolingRecord, the two-phase
 * activate pattern from create_db_schema, and profile resolution).
 *
 * Safe policy (never violated here):
 *   - NEW records are created; CHANGED records are updated.
 *   - TARGET_ONLY records are never touched; only-in-target fields/assignments are
 *     never removed. Nothing is ever deleted or deactivated unless the source says so.
 *   - Trigger handlers can only be toggled (IsActive), never created.
 */

import {
  createToolingRecord,
  updateToolingRecord,
  runToolingQuery,
  cachedToolingQuery,
} from "../salesforce/cli.js";
import { queryFieldValues, getValueColumn, resolveProfileId } from "../tools/helpers.js";
import { flattenSnapshot } from "./config-diff.js";
import type { ConfigDiff, RecordDiff } from "./config-diff.js";
import type { ConfigSnapshot, AssignmentRef } from "./types.js";

export interface ApplyProgressEvent {
  index: number;
  total: number;
  key: string;
  developerName: string;
  action: "create" | "update" | "toggle" | "skip";
  ok: boolean;
  message?: string;
}

export interface ApplyResultItem {
  key: string;
  developerName: string;
  action: "create" | "update" | "toggle" | "skip";
  ok: boolean;
  message?: string;
  warnings?: string[];
}

export interface ApplyResult {
  targetOrg: string;
  appliedAt: string;
  applied: number;
  failed: number;
  skipped: number;
  items: ApplyResultItem[];
}

export interface ApplyOptions {
  targetOrg: string;
  source: ConfigSnapshot;
  diff: ConfigDiff;
  selection: string[];
  onProgress?: (e: ApplyProgressEvent) => void;
}

/** DB Schema's fixed field types — used to infer DataType for v1.0 snapshots. */
const DB_SCHEMA_TYPES: Record<string, string> = {
  SObject: "OBJECT",
  Type: "PICKLIST",
  WhereSoql: "LONGTEXT",
  DeltaDateField: "FIELD",
  OneWaySync: "BOOLEAN",
  AttachmentsSupport: "PICKLIST",
  Status: "PICKLIST",
  MandatoryFields: "LONGTEXT",
  PermissionSets: "LONGTEXT",
};

export function inferDataType(name: string, value: unknown, category: string): string {
  if (category === "DbSchema" && DB_SCHEMA_TYPES[name]) return DB_SCHEMA_TYPES[name];
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") return Number.isInteger(value) ? "INTEGER" : "NUMBER";
  return "TEXT";
}

function sqlEscape(v: string): string {
  return v.replace(/'/g, "\\'");
}

export async function applyConfig(opts: ApplyOptions): Promise<ApplyResult> {
  const { targetOrg, source, diff, selection, onProgress } = opts;

  const diffByKey = new Map<string, RecordDiff>();
  for (const r of diff.records) diffByKey.set(r.key, r);
  const srcByKey = flattenSnapshot(source);

  const categoryIdCache = new Map<string, string | null>();
  const resolveCategoryId = async (name: string): Promise<string | null> => {
    if (categoryIdCache.has(name)) return categoryIdCache.get(name)!;
    const q = `SELECT Id FROM LifeSciConfigCategory WHERE Category = '${sqlEscape(name)}' OR DeveloperName = '${sqlEscape(name)}' LIMIT 1`;
    const res = await cachedToolingQuery(q, targetOrg);
    const id =
      res.success && res.data?.records?.length
        ? ((res.data.records[0] as Record<string, unknown>).Id as string)
        : null;
    categoryIdCache.set(name, id);
    return id;
  };

  const resolveAssigneeId = async (a: AssignmentRef): Promise<string | null> => {
    if ((a.level || "Profile") === "PermissionSet") {
      const q = `SELECT Id FROM PermissionSet WHERE Name = '${sqlEscape(a.name)}' LIMIT 1`;
      const res = await cachedToolingQuery(q, targetOrg);
      if (res.success && res.data?.records?.length) {
        return (res.data.records[0] as Record<string, unknown>).Id as string;
      }
      return null;
    }
    return resolveProfileId(a.name, targetOrg);
  };

  const items: ApplyResultItem[] = [];
  const selectionSet = [...new Set(selection)];
  const total = selectionSet.length;
  let applied = 0;
  let failed = 0;
  let skipped = 0;

  const emit = (item: ApplyResultItem, index: number) => {
    items.push(item);
    if (item.action === "skip") skipped++;
    else if (item.ok) applied++;
    else failed++;
    onProgress?.({
      index,
      total,
      key: item.key,
      developerName: item.developerName,
      action: item.action,
      ok: item.ok,
      message: item.message,
    });
  };

  for (let index = 0; index < selectionSet.length; index++) {
    const key = selectionSet[index];
    const rd = diffByKey.get(key);

    if (!rd || !rd.applicable) {
      emit(
        {
          key,
          developerName: rd?.developerName || key,
          action: "skip",
          ok: true,
          message: rd?.note || "Not applicable under the safe policy — skipped.",
        },
        index
      );
      continue;
    }

    try {
      if (rd.kind === "triggerHandler") {
        emit(await applyTriggerHandler(targetOrg, rd), index);
      } else if (rd.status === "NEW") {
        emit(
          await createRecord(targetOrg, rd, srcByKey, resolveCategoryId, resolveAssigneeId),
          index
        );
      } else {
        emit(await updateExistingRecord(targetOrg, rd, srcByKey, resolveAssigneeId), index);
      }
    } catch (err) {
      emit(
        {
          key,
          developerName: rd.developerName,
          action: rd.status === "NEW" ? "create" : "update",
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        },
        index
      );
    }
  }

  return {
    targetOrg,
    appliedAt: new Date().toISOString(),
    applied,
    failed,
    skipped,
    items,
  };
}

async function applyTriggerHandler(targetOrg: string, rd: RecordDiff): Promise<ApplyResultItem> {
  const desired = rd.activeChange?.to;
  const q = `SELECT Id, IsActive FROM LifeScienceTriggerHandler WHERE DeveloperName = '${sqlEscape(rd.developerName)}' LIMIT 1`;
  const res = await runToolingQuery(q, targetOrg);
  if (!res.success || !res.data?.records?.length) {
    return {
      key: rd.key,
      developerName: rd.developerName,
      action: "toggle",
      ok: false,
      message: "Handler not found in target org.",
    };
  }
  const id = (res.data.records[0] as Record<string, unknown>).Id as string;
  const upd = await updateToolingRecord(
    "LifeScienceTriggerHandler",
    id,
    { IsActive: desired },
    targetOrg
  );
  return {
    key: rd.key,
    developerName: rd.developerName,
    action: "toggle",
    ok: upd.success,
    message: upd.success ? `IsActive → ${desired}` : upd.error,
  };
}

async function createRecord(
  targetOrg: string,
  rd: RecordDiff,
  srcByKey: ReturnType<typeof flattenSnapshot>,
  resolveCategoryId: (name: string) => Promise<string | null>,
  resolveAssigneeId: (a: AssignmentRef) => Promise<string | null>
): Promise<ApplyResultItem> {
  const src = srcByKey.get(rd.key);
  if (!src) {
    return {
      key: rd.key,
      developerName: rd.developerName,
      action: "create",
      ok: false,
      message: "Source record not found in snapshot.",
    };
  }

  // Guard: never create a record whose name already exists (globally unique DeveloperName).
  const existQ = `SELECT Id FROM LifeSciConfigRecord WHERE DeveloperName = '${sqlEscape(src.developerName)}' LIMIT 1`;
  const existRes = await runToolingQuery(existQ, targetOrg);
  if (existRes.success && existRes.data?.records?.length) {
    return {
      key: rd.key,
      developerName: rd.developerName,
      action: "skip",
      ok: true,
      message: "Already exists in target — skipped to avoid duplicate.",
    };
  }

  const categoryId = await resolveCategoryId(src.category);
  if (!categoryId) {
    return {
      key: rd.key,
      developerName: rd.developerName,
      action: "create",
      ok: false,
      message: `Category '${src.category}' not found in target org.`,
    };
  }

  const warnings: string[] = [];

  // Phase 1: create parent INACTIVE (Tooling validates required fields only on activation).
  const parent = await createToolingRecord(
    "LifeSciConfigRecord",
    {
      DeveloperName: src.developerName,
      MasterLabel: src.label || src.developerName,
      LifeSciConfigCategoryId: categoryId,
      IsActive: false,
      IsOrgLevel: src.isOrgLevel ?? false,
    },
    targetOrg
  );
  if (!parent.success) {
    return {
      key: rd.key,
      developerName: rd.developerName,
      action: "create",
      ok: false,
      message: `Parent create failed: ${parent.error}`,
    };
  }
  const recordId = parent.data!.id;

  // Phase 2: field values. Skip empty values — an absent value carries nothing
  // to create, and `false`/`0` are preserved (they are real values).
  let fieldErrors = 0;
  let fieldsCreated = 0;
  for (const [name, value] of Object.entries(src.fields)) {
    if (value === null || value === undefined || value === "") continue;
    const dataType = src.fieldTypes[name] || inferDataType(name, value, src.category);
    if (!src.fieldTypes[name]) warnings.push(`Inferred DataType ${dataType} for field ${name}`);
    const createData: Record<string, unknown> = {
      FieldName: name,
      LifeSciConfigRecordId: recordId,
      DataType: dataType,
    };
    createData[getValueColumn(dataType)] = value;
    const fr = await createToolingRecord("LifeSciConfigFieldValue", createData, targetOrg);
    if (!fr.success) {
      fieldErrors++;
      warnings.push(`Field ${name}: ${fr.error}`);
    } else {
      fieldsCreated++;
    }
  }

  // Phase 2b: assignments.
  for (const a of src.assignments) {
    const assigneeId = await resolveAssigneeId(a);
    if (!assigneeId) {
      warnings.push(`Assignment ${a.name} (${a.level}): assignee not found`);
      continue;
    }
    const ar = await createToolingRecord(
      "LifeSciConfigAssignment",
      {
        LifeSciConfigRecordId: recordId,
        AssignedToId: assigneeId,
        AssignmentLevel: a.level || "Profile",
      },
      targetOrg
    );
    if (!ar.success) warnings.push(`Assignment ${a.name}: ${ar.error}`);
  }

  // Phase 3: activate if the source record is active and all fields landed.
  if (src.isActive && fieldErrors === 0) {
    const act = await updateToolingRecord(
      "LifeSciConfigRecord",
      recordId,
      { IsActive: true },
      targetOrg
    );
    if (!act.success) warnings.push(`Activation: ${act.error}`);
  } else if (src.isActive && fieldErrors > 0) {
    warnings.push("Activation skipped — fix field errors, then re-apply.");
  }

  return {
    key: rd.key,
    developerName: rd.developerName,
    action: "create",
    ok: fieldErrors === 0,
    message:
      fieldErrors === 0
        ? `Created (${fieldsCreated} fields)`
        : `Created with ${fieldErrors} field error(s)`,
    warnings: warnings.length ? warnings : undefined,
  };
}

async function updateExistingRecord(
  targetOrg: string,
  rd: RecordDiff,
  srcByKey: ReturnType<typeof flattenSnapshot>,
  resolveAssigneeId: (a: AssignmentRef) => Promise<string | null>
): Promise<ApplyResultItem> {
  const src = srcByKey.get(rd.key);
  if (!src) {
    return {
      key: rd.key,
      developerName: rd.developerName,
      action: "update",
      ok: false,
      message: "Source record not found in snapshot.",
    };
  }

  // Locate the target record + its existing field values.
  const recQ = `SELECT Id FROM LifeSciConfigRecord WHERE DeveloperName = '${sqlEscape(src.developerName)}' LIMIT 1`;
  const recRes = await runToolingQuery(recQ, targetOrg);
  if (!recRes.success || !recRes.data?.records?.length) {
    return {
      key: rd.key,
      developerName: rd.developerName,
      action: "update",
      ok: false,
      message: "Record not found in target org.",
    };
  }
  const recordId = (recRes.data.records[0] as Record<string, unknown>).Id as string;

  const { fieldValuesByRecord } = await queryFieldValues([recordId], targetOrg, false);
  const existingFvByName = new Map<string, Record<string, unknown>>();
  for (const fv of fieldValuesByRecord.get(recordId) || []) {
    existingFvByName.set(fv.FieldName as string, fv);
  }

  const warnings: string[] = [];
  let errors = 0;

  // Field changes: only those the diff flagged as source-driven (willApply).
  for (const fd of rd.fieldDiffs.filter((f) => f.willApply)) {
    const dataType = fd.dataType || inferDataType(fd.name, fd.to, src.category);
    const valueCol = getValueColumn(dataType);
    const existing = existingFvByName.get(fd.name);
    if (existing) {
      const upd = await updateToolingRecord(
        "LifeSciConfigFieldValue",
        existing.Id as string,
        { [valueCol]: fd.to },
        targetOrg
      );
      if (!upd.success) {
        errors++;
        warnings.push(`Field ${fd.name}: ${upd.error}`);
      }
    } else {
      const created = await createToolingRecord(
        "LifeSciConfigFieldValue",
        {
          FieldName: fd.name,
          LifeSciConfigRecordId: recordId,
          DataType: dataType,
          [valueCol]: fd.to,
        },
        targetOrg
      );
      if (!created.success) {
        errors++;
        warnings.push(`Field ${fd.name} (new): ${created.error}`);
      }
    }
  }

  // Additive assignments.
  for (const a of rd.assignmentDiff.added) {
    const assigneeId = await resolveAssigneeId(a);
    if (!assigneeId) {
      warnings.push(`Assignment ${a.name} (${a.level}): assignee not found`);
      continue;
    }
    const ar = await createToolingRecord(
      "LifeSciConfigAssignment",
      {
        LifeSciConfigRecordId: recordId,
        AssignedToId: assigneeId,
        AssignmentLevel: a.level || "Profile",
      },
      targetOrg
    );
    if (!ar.success) warnings.push(`Assignment ${a.name}: ${ar.error}`);
  }

  // IsActive last, so required fields exist before activation.
  if (rd.activeChange && errors === 0) {
    const act = await updateToolingRecord(
      "LifeSciConfigRecord",
      recordId,
      { IsActive: rd.activeChange.to },
      targetOrg
    );
    if (!act.success) {
      errors++;
      warnings.push(`IsActive: ${act.error}`);
    }
  }

  return {
    key: rd.key,
    developerName: rd.developerName,
    action: "update",
    ok: errors === 0,
    message: errors === 0 ? "Updated" : `Updated with ${errors} error(s)`,
    warnings: warnings.length ? warnings : undefined,
  };
}
