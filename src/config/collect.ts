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
import { queryFieldValues, queryAssignments, extractFieldValue } from "../tools/helpers.js";
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

async function loadCategoryRecords(org: string, catQuery: string, options: CollectOptions): Promise<ConfigRecord[]> {
  const fail = (what: string, error: unknown) => {
    if (options.strict) throw new Error(`Couldn't read Admin Console ${what}: ${String(error ?? "query failed")}`);
  };
  const catResult = await runToolingQuery(catQuery, org);
  if (!catResult.success) fail("categories", catResult.error);
  if (!catResult.success || !catResult.data?.records?.length) return [];

  // Categories are read side by side; the process-wide limiter caps concurrent calls.
  const perCategory = await Promise.all(
    (catResult.data.records as Array<Record<string, unknown>>).map(async (cat): Promise<ConfigRecord[]> => {
      const catId = cat.Id as string;
      // Category name — prefer the `Category` field, fall back to DeveloperName.
      const catName = (cat.Category as string) || (cat.DeveloperName as string);

      const recQuery = `SELECT Id, DeveloperName, MasterLabel, IsActive, IsOrgLevel FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId = '${catId}' ORDER BY DeveloperName`;
      const recResult = await runToolingQuery(recQuery, org);
      if (!recResult.success) fail(`${catName} records`, recResult.error);
      if (recResult.success && recResult.data?.truncated) fail(`${catName} records`, "too many records to read");
      if (!recResult.success || !recResult.data?.records?.length) return [];

      const records = recResult.data.records as Array<Record<string, unknown>>;
      const recordIds = records.map((r) => r.Id as string);
      const [{ fieldValuesByRecord, queryError }, assignmentMap] = await Promise.all([
        queryFieldValues(recordIds, org, true),
        queryAssignments(recordIds, org, options.strict),
      ]);
      if (queryError) fail(`${catName} field values`, queryError);

      return records.map((rec) => {
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
    })
  );
  return perCategory.flat();
}

