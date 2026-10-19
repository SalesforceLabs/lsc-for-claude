/**
 * collectConfig() — read LSC configuration from a live org into a ConfigSnapshot.
 *
 * This is the single source of truth for what "export" captures. It is reused by:
 *   - the export_config tool (writes the snapshot to disk),
 *   - import_config when the source is a live org (`sourceOrg`),
 *   - import_config's auto-backup of the target before applying.
 *
 * v1.1 additions over the original inline export logic:
 *   - every record carries its `category` (so actions know QuickAction vs CustomAction),
 *   - every record carries `fieldTypes` (FieldName → DataType) for faithful re-creation,
 *   - adminSettings now capture `assignments` too.
 */

import { runToolingQuery } from "../salesforce/cli.js";
import { sharedRead } from "./read-cache.js";
import { queryFieldValues, queryAssignments, extractFieldValue, chunkIds, FV_VALUE_COLUMNS } from "../tools/helpers.js";
import type {
  ConfigSnapshot,
  ConfigRecord,
  TriggerHandlerRecord,
  ExportCategory,
} from "./types.js";
import { SNAPSHOT_VERSION } from "./types.js";

/** Build a record's fields + fieldTypes maps from its field-value rows. */
function buildFields(fvs: Array<Record<string, unknown>>): {
  fields: Record<string, unknown>;
  fieldTypes: Record<string, string>;
} {
  const fields: Record<string, unknown> = {};
  const fieldTypes: Record<string, string> = {};
  for (const fv of fvs) {
    const name = fv.FieldName as string;
    fields[name] = extractFieldValue(fv);
    if (fv.DataType) fieldTypes[name] = fv.DataType as string;
  }
  return { fields, fieldTypes };
}

export async function collectConfig(
  org: string,
  categories?: ExportCategory[],
  options: CollectOptions = {}
): Promise<ConfigSnapshot> {
  const want = categories || ["trigger_handlers", "admin_settings", "db_schema", "actions"];
  const snapshot: ConfigSnapshot = {
    exportedAt: new Date().toISOString(),
    sourceOrg: org,
    version: SNAPSHOT_VERSION,
  };

  // 1. Trigger handlers (regular SObject).
  if (want.includes("trigger_handlers")) {
    const query = `SELECT Id, DeveloperName, MasterLabel, IsActive FROM LifeScienceTriggerHandler ORDER BY DeveloperName`;
    const result = await runToolingQuery(query, org);
    if (!result.success && options.strict) throw new Error(`Couldn't read trigger handlers: ${result.error}`);
    const handlers: TriggerHandlerRecord[] = [];
    if (result.success && result.data?.records) {
      for (const r of result.data.records as Array<Record<string, unknown>>) {
        handlers.push({
          developerName: r.DeveloperName as string,
          label: r.MasterLabel as string,
          isActive: r.IsActive as boolean,
        });
      }
    }
    snapshot.triggerHandlers = handlers;
  }

  // 2. Admin settings (every category except DbSchema / actions).
  if (want.includes("admin_settings")) {
    snapshot.adminSettings = await collectCategoryRecords(
      org,
      `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category NOT IN ('DbSchema', 'QuickAction', 'CustomAction') ORDER BY Category`,
      options
    );
  }

  // 3. DB Schema.
  if (want.includes("db_schema")) {
    snapshot.dbSchema = await collectCategoryRecords(
      org,
      `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category = 'DbSchema'`,
      options
    );
  }

  // 4. Actions (QuickAction + CustomAction).
  if (want.includes("actions")) {
    snapshot.actions = await collectCategoryRecords(
      org,
      `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category IN ('QuickAction', 'CustomAction') ORDER BY Category`,
      options
    );
  }

  return snapshot;
}

export interface CollectOptions {
  /**
   * Throw when any query fails instead of leaving the records out. Checks and
   * snapshots need this: a partial read looks like missing configuration.
   */
  strict?: boolean;
  /**
   * Share the read with other callers for a minute (and with reads in flight).
   * For Studio's many-surfaces-one-category reads; never for snapshots or
   * backups, which must see the org as it is now.
   */
  cache?: boolean;
}

/**
 * Collect every LifeSciConfigRecord under the categories returned by `catQuery`,
 * tagging each with its category name and capturing fields, fieldTypes, and assignments.
 */
export async function collectCategoryRecords(org: string, catQuery: string, options: CollectOptions = {}): Promise<ConfigRecord[]> {
  if (!options.cache) return loadCategoryRecords(org, catQuery, options);
  try {
    return await sharedRead(org, `config:${catQuery}`, () => loadCategoryRecords(org, catQuery, { strict: true }));
  } catch (err) {
    // A cached read is strict so a failure is never kept; lenient callers fall back to a partial read.
    if (options.strict) throw err;
    return loadCategoryRecords(org, catQuery, options);
  }
}

/** A category's record before its values and assignments are read. */
interface CategoryRow {
  catName: string;
  rec: Record<string, unknown>;
}

const failer = (options: CollectOptions) => (what: string, error: unknown) => {
  if (options.strict) throw new Error(`Couldn't read Admin Console ${what}: ${String(error ?? "query failed")}`);
};

const categoryName = (cat: Record<string, unknown>) => (cat.Category as string) || (cat.DeveloperName as string);

/**
 * The categories `catQuery` selects and their records, without values. Several categories share one
 * record query (it used to be one per category); if that can't answer exactly (it failed or was cut
 * short) each category is read on its own, as before.
 */
async function loadCategoryRows(org: string, catQuery: string, options: CollectOptions): Promise<CategoryRow[]> {
  const fail = failer(options);
  const catResult = await runToolingQuery(catQuery, org);
  if (!catResult.success) fail("categories", catResult.error);
  if (!catResult.success || !catResult.data?.records?.length) return [];
  const cats = catResult.data.records as Array<Record<string, unknown>>;

  if (cats.length > 1) {
    const together = await readRecordsTogether(org, cats);
    if (together) return together;
  }

  // Categories are read side by side; the process-wide limiter caps concurrent calls.
  const perCategory = await Promise.all(
    cats.map(async (cat): Promise<CategoryRow[]> => {
      const catName = categoryName(cat);
      const recQuery = `SELECT Id, DeveloperName, MasterLabel, IsActive, IsOrgLevel FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId = '${cat.Id as string}' ORDER BY DeveloperName`;
      const recResult = await runToolingQuery(recQuery, org);
      if (!recResult.success) fail(`${catName} records`, recResult.error);
      if (recResult.success && recResult.data?.truncated) fail(`${catName} records`, "too many records to read");
      if (!recResult.success || !recResult.data?.records?.length) return [];
      return (recResult.data.records as Array<Record<string, unknown>>).map((rec) => ({ catName, rec }));
    })
  );
  return perCategory.flat();
}

/** Every category's records in one IN-list query per chunk; null when it can't answer exactly. */
async function readRecordsTogether(org: string, cats: Array<Record<string, unknown>>): Promise<CategoryRow[] | null> {
  const results = await Promise.all(
    chunkIds(cats.map((c) => c.Id as string)).map((chunk) =>
      runToolingQuery(
        `SELECT Id, DeveloperName, MasterLabel, IsActive, IsOrgLevel, LifeSciConfigCategoryId FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId IN (${chunk.map((id) => `'${id}'`).join(",")}) ORDER BY DeveloperName`,
        org
      )
    )
  );
  if (results.some((r) => !r.success || r.data?.truncated)) return null;
  const byCategory = new Map<string, Array<Record<string, unknown>>>();
  for (const r of results) {
    for (const rec of (r.data?.records ?? []) as Array<Record<string, unknown>>) {
      const id = rec.LifeSciConfigCategoryId as string;
      if (!byCategory.has(id)) byCategory.set(id, []);
      byCategory.get(id)!.push(rec);
    }
  }
  // Category order first, then DeveloperName within each, as the per-category reads gave.
  return cats.flatMap((cat) => (byCategory.get(cat.Id as string) ?? []).map((rec) => ({ catName: categoryName(cat), rec })));
}

/** Read the field values and assignments of `rows` and build their records. */
async function hydrateRows(org: string, rows: CategoryRow[], options: CollectOptions): Promise<ConfigRecord[]> {
  if (rows.length === 0) return [];
  const recordIds = rows.map((r) => r.rec.Id as string);
  const [{ fieldValuesByRecord, queryError }, assignmentMap] = await Promise.all([
    queryFieldValues(recordIds, org, true),
    queryAssignments(recordIds, org, options.strict),
  ]);
  if (queryError) failer(options)([...new Set(rows.map((r) => r.catName))].join(", ") + " field values", queryError);

  return rows.map(({ catName, rec }) => {
    const recId = rec.Id as string;
    const { fields, fieldTypes } = buildFields(fieldValuesByRecord.get(recId) || []);
    const assignments = (assignmentMap.get(recId) || []).map((a) => ({
      name: a.name,
      level: a.level,
    }));
    return {
      category: catName,
      developerName: rec.DeveloperName as string,
      label: rec.MasterLabel as string,
      isActive: rec.IsActive as boolean,
      isOrgLevel: rec.IsOrgLevel as boolean,
      fields,
      fieldTypes,
      assignments,
    };
  });
}

async function loadCategoryRecords(org: string, catQuery: string, options: CollectOptions): Promise<ConfigRecord[]> {
  return hydrateRows(org, await loadCategoryRows(org, catQuery, options), options);
}

export interface RecordsWhere {
  /** Every record's DeveloperName in the category, whether it matched or not. */
  developerNames: string[];
  /** The records whose `field` value `keep` accepted, with all their values and assignments, in category order. */
  records: ConfigRecord[];
}

/**
 * Like `collectCategoryRecords` (strict, shared for a minute), for a caller that needs only the records
 * whose one field has a given value — a feature's DB Schema records out of hundreds. It reads that one
 * field for every record (a single light query), then the values and assignments of the matches only.
 * Throws when any read fails or is cut short; the caller then reads the whole category.
 */
export async function collectCategoryRecordsWhere(
  org: string,
  catQuery: string,
  probe: { field: string; keep: (value: unknown) => boolean }
): Promise<RecordsWhere> {
  const rows = await sharedRead(org, `config:rows:${catQuery}`, () => loadCategoryRows(org, catQuery, { strict: true }));
  const values = await sharedRead(org, `config:probe:${catQuery}:${probe.field}`, () => readFieldOf(org, probe.field, rows));
  const matching = rows.filter((r) => probe.keep(values.get(r.rec.Id as string)));
  return {
    developerNames: rows.map((r) => r.rec.DeveloperName as string),
    records: await hydrateRows(org, matching, { strict: true }),
  };
}

/** One field's value for every record id, read in IN-list chunks. */
async function readFieldOf(org: string, field: string, rows: CategoryRow[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  const results = await Promise.all(
    chunkIds(rows.map((r) => r.rec.Id as string)).map((chunk) =>
      runToolingQuery(
        `SELECT Id, FieldName, DataType, ${FV_VALUE_COLUMNS.join(", ")}, LifeSciConfigRecordId FROM LifeSciConfigFieldValue WHERE FieldName = '${field.replace(/'/g, "\\'")}' AND LifeSciConfigRecordId IN (${chunk.map((id) => `'${id}'`).join(",")}) ORDER BY FieldName`,
        org
      )
    )
  );
  for (const r of results) {
    if (!r.success) throw new Error(`Couldn't read Admin Console ${field} values: ${r.error ?? "query failed"}`);
    if (r.data?.truncated) throw new Error(`Couldn't read Admin Console ${field} values: too many to read`);
    for (const fv of (r.data?.records ?? []) as Array<Record<string, unknown>>) {
      out.set(fv.LifeSciConfigRecordId as string, extractFieldValue(fv));
    }
  }
  return out;
}
