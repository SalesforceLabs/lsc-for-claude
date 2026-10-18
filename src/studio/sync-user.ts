/**
 * Studio "Sync health → Investigate": one user's predicted sync volume per
 * table, their own sync history, and why each heavy table is heavy. Read-only.
 *
 * Volume is resolved the way a performance assessment does (compiled schema
 * with DB Schema fallback, COUNT() per territory); each table is then tied back
 * to its DB Schema record so the GUI can open or change it.
 */

import { z } from "zod";
import { cachedDescribeSObject, runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import { loadTelemetry } from "../perf/assessment.js";
import { createCompiledSchemaSource, type SchemaSource } from "../perf/compiled-schema.js";
import { createDeviceSession } from "../perf/device/session.js";
import { DEFAULT_TELEMETRY_DAYS } from "../perf/nfr.js";
import { explainTable, sharePct, type TableHint } from "../perf/table-hints.js";
import type { SyncSample, TelemetrySummary } from "../perf/telemetry.js";
import {
  DEFAULT_PROFILE_OPTIONS,
  annotateSharing,
  loadDbSchemaEntries,
  loadUserContext,
  incompleteTables,
  mayOvercount,
  pickLargestTerritories,
  profileTerritory,
  selectApplicableTables,
  upperBoundRecords,
  type ApplicableTable,
  type CountScope,
  type TableStatus,
  type TerritoryVolume,
} from "../perf/sync-volume.js";
import type { PerfDeps } from "./perf.js";
import { fetchCategories, profilesOf } from "./collectors/shared.js";
import { splitList } from "./helpers.js";

export const syncUserInput = {
  userId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/),
  days: z.number().int().min(1).max(365).optional(),
  /** Territories to profile, in name order; the user's own count is returned either way. */
  maxTerritories: z.number().int().min(1).max(50).optional(),
};

export interface SyncUserInput {
  userId: string;
  days?: number;
  maxTerritories?: number;
}

/** Territories profiled when the caller doesn't cap them. */
export const DEFAULT_MAX_TERRITORIES = 10;
/** Recent syncs returned for the user's history. */
const RECENT_SYNCS = 10;

/** The DB Schema record behind a table, with the fields that decide how it syncs. */
export interface SchemaRecordRef {
  category: "DbSchema";
  developerName: string;
  /** LifeSciConfigRecord id; null when the record couldn't be looked up. */
  recordId: string | null;
  /** The Mobile Sync board's item id (`onOpenSetup("mobile-sync", "syncedObjects", itemId)`). */
  itemId: string;
  active: boolean;
  fields: {
    SObject: string;
    Type: string | null;
    WhereSoql: string | null;
    OneWaySync: boolean;
    AttachmentsSupport: string | null;
    DeltaDateField: string | null;
  };
  /** Profile names the record is assigned to (assignments plus its Profiles field). */
  profiles: string[];
  /** Permission sets named in its PermissionSets field. */
  permissionSets: string[];
  /** Editable fields (WhereSoql, AttachmentsSupport, DeltaDateField) that have a value row; others can't be changed from Studio. */
  fieldRows: string[];
}

export interface SyncTable {
  sobject: string;
  developerName: string;
  matchedBy: "profile" | "permissionSet";
  status: TableStatus;
  records: number;
  /** Share of the territory's predicted records, 0–100. */
  sharePct: number;
  deviceRequests: number | null;
  idTag?: string;
  note?: string;
  scope?: CountScope;
  sharingModel?: string;
  /** The org-wide count may exceed what the user downloads (restricted sharing). */
  mayOvercount: boolean;
  /** The count is a minimum (its id list was cut short). */
  lowerBound?: boolean;
  /** The table it is filtered by failed, so this one couldn't be counted. */
  sourceFailed?: boolean;
  /** Null when no DB Schema record matched (e.g. a table only in the compiled archive). */
  schema: SchemaRecordRef | null;
  hints: TableHint[];
}

export interface SyncTerritory {
  territory: { id: string; name: string } | null;
  totalRecords: number;
  totalDeviceRequests: number;
  /** Records from counts that may exceed the user's own visibility. */
  upperBoundRecords: number;
  /** Tables that failed, timed out or are minimums: the totals are at least this much. */
  incompleteCount: number;
  tables: SyncTable[];
}

export interface SyncUserTelemetry {
  summary: TelemetrySummary;
  /** The user's newest syncs, newest first. */
  recent: SyncSample[];
}

export interface SyncUserDetail {
  generatedAt: string;
  days: number;
  user: {
    id: string;
    username: string;
    name: string;
    profileId: string;
    profileName: string;
    permissionSetCount: number;
    /** Every active-model territory the user is in. */
    territories: Array<{ id: string; name: string }>;
  };
  schemaSource: SchemaSource;
  schemaNotes: string[];
  tableCount: number;
  /** Territories profiled (capped); fewer than user.territories when `maxTerritories` applied. */
  territories: SyncTerritory[];
  telemetry?: SyncUserTelemetry;
  /** Why telemetry is missing (no table in the org, or the query failed). */
  telemetryError?: string;
}

export interface SyncUserDeps extends PerfDeps {
  /** DB Schema records with ids; defaults to the Admin Console collector plus an id lookup. */
  dbSchemaRecords?: (org: string, querier: ReturnType<PerfDeps["querier"]>) => Promise<SchemaRecordRef[]>;
}

const defaultDeps: SyncUserDeps = {
  querier: (org) => ({
    soql: (q, options) => runSoqlQuery(q, org, options),
    tooling: (q) => runToolingQuery(q, org),
  }),
  telemetryFields: (org) => async () => {
    const result = await cachedDescribeSObject("DeviceSyncSummary", org);
    return new Set(result.success ? (result.data?.fields ?? []).map((f) => f.name) : []);
  },
  compiledSchema: (org, querier) => createCompiledSchemaSource({ org: querier, getSession: () => createDeviceSession(org) }),
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** Every DB Schema record (active or not) as a ref, so a table can be tied back to its record. */
async function loadSchemaRecords(org: string, querier: ReturnType<PerfDeps["querier"]>): Promise<SchemaRecordRef[]> {
  const records = await fetchCategories(org, ["DbSchema"]);
  const ids = new Map<string, string>();
  const cat = await querier.tooling(`SELECT Id FROM LifeSciConfigCategory WHERE Category = 'DbSchema' LIMIT 1`);
  const categoryId = cat.success ? (cat.data?.records?.[0]?.Id as string | undefined) : undefined;
  if (categoryId) {
    const rows = await querier.tooling(`SELECT Id, DeveloperName FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId = '${categoryId}'`);
    for (const r of rows.success ? (rows.data?.records ?? []) : []) ids.set(String(r.DeveloperName), String(r.Id));
  }
  return records.map((r) => ({
    category: "DbSchema",
    developerName: r.developerName,
    recordId: ids.get(r.developerName) ?? null,
    itemId: `DbSchema:${r.developerName}`,
    active: !!r.isActive,
    fields: {
      SObject: String(r.fields.SObject ?? ""),
      Type: text(r.fields.Type),
      WhereSoql: text(r.fields.WhereSoql),
      OneWaySync: r.fields.OneWaySync === true,
      AttachmentsSupport: text(r.fields.AttachmentsSupport),
      DeltaDateField: text(r.fields.DeltaDateField),
    },
    profiles: [...new Set([...profilesOf(r), ...splitList(r.fields.Profiles)])],
    permissionSets: splitList(r.fields.PermissionSets),
    fieldRows: ["WhereSoql", "AttachmentsSupport", "DeltaDateField"].filter((f) => f in r.fields),
  }));
}

/** Whether a DB Schema record reaches the user, as selectApplicableTables decides. */
function reaches(r: SchemaRecordRef, user: { profileName: string; permissionSets: Set<string> }): boolean {
  return (
    r.profiles.some((p) => p.toLowerCase() === user.profileName.toLowerCase()) ||
    r.permissionSets.some((ps) => user.permissionSets.has(ps))
  );
}

/**
 * The record behind a table: the one named by the table, otherwise an active
 * record for the same object. Only a record that reaches the user counts —
 * editing another profile's record would change the wrong sync — so null when
 * none does.
 */
export function matchSchemaRecord(
  table: { developerName: string; sobject: string },
  records: SchemaRecordRef[],
  user: { profileName: string; permissionSets: Set<string> }
): SchemaRecordRef | null {
  const mine = records.filter((r) => reaches(r, user));
  return (
    mine.find((r) => r.developerName === table.developerName) ??
    mine.find((r) => r.active && r.fields.SObject.toLowerCase() === table.sobject.toLowerCase()) ??
    null
  );
}

function toSyncTerritory(vol: TerritoryVolume, records: SchemaRecordRef[], user: { profileName: string; permissionSets: Set<string> }): SyncTerritory {
  const tables = vol.tables.map((t): SyncTable => {
    const schema = matchSchemaRecord(t, records, user);
    const over = mayOvercount(t);
    return {
      sobject: t.sobject,
      developerName: t.developerName,
      matchedBy: t.matchedBy,
      status: t.status,
      records: t.records,
      sharePct: sharePct(t.records, vol.totalRecords),
      deviceRequests: t.deviceRequests,
      ...(t.idTag ? { idTag: t.idTag } : {}),
      ...(t.note ? { note: t.note } : {}),
      ...(t.scope ? { scope: t.scope } : {}),
      ...(t.sharingModel ? { sharingModel: t.sharingModel } : {}),
      mayOvercount: over,
      ...(t.lowerBound ? { lowerBound: true } : {}),
      ...(t.sourceFailed ? { sourceFailed: true } : {}),
      schema,
      hints: explainTable({
        sobject: t.sobject,
        status: t.status,
        records: t.records,
        deviceRequests: t.deviceRequests,
        note: t.note,
        lowerBound: t.lowerBound,
        mayOvercount: over,
        totalRecords: vol.totalRecords,
        schema: schema && {
          type: schema.fields.Type,
          whereSoql: schema.fields.WhereSoql,
          oneWaySync: schema.fields.OneWaySync,
          attachmentsSupport: schema.fields.AttachmentsSupport,
          deltaDateField: schema.fields.DeltaDateField,
          editable: schema.fieldRows,
        },
      }),
    };
  });
  return {
    territory: vol.territory,
    totalRecords: vol.totalRecords,
    totalDeviceRequests: vol.totalDeviceRequests,
    upperBoundRecords: upperBoundRecords(vol),
    incompleteCount: incompleteTables(vol).length,
    tables,
  };
}

export async function syncUserDetail(org: string, input: SyncUserInput, deps: SyncUserDeps = defaultDeps): Promise<SyncUserDetail> {
  const days = input.days ?? DEFAULT_TELEMETRY_DAYS;
  const querier = deps.querier(org);

  const user = await loadUserContext(querier, input.userId);
  const entries = await loadDbSchemaEntries(querier);
  const dbSchemaTables = selectApplicableTables(entries, user);

  let tables: ApplicableTable[] = dbSchemaTables;
  let schemaSource: SchemaSource = "db-schema";
  const schemaNotes: string[] = [];
  const compiled = deps.compiledSchema?.(org, querier);
  if (compiled) {
    const found = await compiled.tablesFor(user);
    if ("result" in found) {
      tables = found.result.tables;
      schemaSource = found.result.source ?? "compiled";
      schemaNotes.push(...found.result.notes);
    } else {
      schemaNotes.push(`Used DB Schema records: compiled schema unavailable (${found.fallbackReason}).`);
    }
  }

  const records = await (deps.dbSchemaRecords ?? loadSchemaRecords)(org, querier);

  const cap = input.maxTerritories ?? DEFAULT_MAX_TERRITORIES;
  const picked = await pickLargestTerritories(querier, user.territories, cap);
  if (picked.note) schemaNotes.push(picked.note);
  const targets: Array<{ id: string; name: string } | null> = picked.picked.length ? picked.picked : [null];
  const volumes: TerritoryVolume[] = [];
  // One id cache for the user: the OT2A and Account id lists are read once, not per table.
  const options = { ...DEFAULT_PROFILE_OPTIONS, idCache: new Map() };
  for (const territory of targets) {
    volumes.push(await profileTerritory(querier, user, territory, tables, options));
  }
  await annotateSharing(querier, volumes);

  let telemetry: SyncUserTelemetry | undefined;
  let telemetryError: string | undefined;
  try {
    const { samples, summary } = await loadTelemetry(querier, deps.telemetryFields(org), { days, userIds: [user.id] });
    telemetry = { summary, recent: samples.slice(0, RECENT_SYNCS) };
  } catch (e) {
    telemetryError = e instanceof Error ? e.message : String(e);
  }

  return {
    generatedAt: new Date().toISOString(),
    days,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      profileId: user.profileId,
      profileName: user.profileName,
      permissionSetCount: user.permissionSets.size,
      territories: user.territories,
    },
    schemaSource,
    schemaNotes,
    tableCount: tables.length,
    territories: volumes.map((v) => toSyncTerritory(v, records, user)),
    ...(telemetry ? { telemetry } : {}),
    ...(telemetryError ? { telemetryError } : {}),
  };
}
