/**
 * Object sync — Studio's page for the Admin Console's Mobile › Object Metadata
 * Cache Configuration: every DB Schema record (`LifeSciConfigRecord` in the
 * DbSchema category) as a table row, with what Studio finds wrong with it, and
 * a read-only check that test-runs each record's object, fields and filter.
 *
 * Writes go through the tray's existing fix kinds (setConfigField, setActive,
 * setProfileAssignments, createConfigRecord, deleteConfigRecord); nothing here
 * writes. The Admin Console's own Validate job (which sets `Status`) isn't
 * started from here: Studio's check reports, it doesn't change the record.
 *
 * NOTE: the renderer keeps a copy of these types in
 * `src-renderer/components/studio/object-sync-types.ts` — keep the two in sync.
 */

import { apiRequest, cachedDescribeSObject, dataPath } from "../salesforce/cli.js";
import type { ConfigRecord } from "../config/types.js";
import type { ItemEdit, StudioFinding } from "./types.js";
import { configEdit, query, splitList } from "./helpers.js";
import { fetchCategories, profilesOf } from "./collectors/shared.js";
import { dbSchemaLabel, findDuplicates, syncSoql } from "./collectors/mobile-sync.js";
import { resolveScalarTags } from "../perf/sync-volume.js";

export interface ObjectSyncField {
  name: string;
  /** Tooling DataType (TEXT, BOOLEAN, PICKLIST, LONGTEXT, OBJECT, FIELD, INTEGER). */
  type: string | null;
  value: string | number | boolean | null;
}

export interface ObjectSyncRow {
  developerName: string;
  label: string;
  /** What the record syncs: the object, or "Admin Console · Category" for CONFIGURATION records. */
  title: string;
  sobject: string | null;
  /** DATA or CONFIGURATION, as the record has it. */
  type: string | null;
  active: boolean;
  orgLevel: boolean;
  /** The Admin Console's validation status (VALID, INVALID, IN_PROGRESS, …), set by its Validate job. */
  status: string | null;
  errors: string | null;
  whereSoql: string | null;
  profiles: string[];
  permissionSets: string[];
  /** Every field value on the record, for the editor. */
  fields: ObjectSyncField[];
  /** What Studio can switch and re-target (the same shape the feature boards use). */
  edit: ItemEdit | undefined;
  /** The query LSC Mobile runs, when there's enough to show one. */
  soql: string | null;
  findings: StudioFinding[];
}

export interface ObjectSyncOverview {
  org: string;
  rows: ObjectSyncRow[];
  /** Queryable object API names, for the object field of a new record; empty when the org's object list couldn't be read. */
  objects: string[];
}

const value = (v: unknown): string | number | boolean | null =>
  v === undefined || v === null
    ? null
    : typeof v === "string" || typeof v === "number" || typeof v === "boolean"
      ? v
      : JSON.stringify(v);

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return s ? s : null;
};

/** Findings for one record. `duplicates` from `findDuplicates` over every record. */
export function rowFindings(r: ConfigRecord, duplicates: Map<string, string[]>): StudioFinding[] {
  const findings: StudioFinding[] = [];
  const status = text(r.fields.Status)?.toUpperCase() ?? null;
  if (text(r.fields.Errors))
    findings.push({
      severity: "error",
      title: "The Admin Console reports errors",
      detail: String(r.fields.Errors),
    });
  if (status === "INVALID")
    findings.push({
      severity: "error",
      title: "Marked invalid",
      detail:
        "The Admin Console's last validation failed for this record. Metadata cache generation can fail until it's fixed and validated again.",
    });
  if (r.fields.Type !== "CONFIGURATION" && !text(r.fields.SObject))
    findings.push({
      severity: "error",
      title: "No object",
      detail: "The record doesn't name an object, so there's nothing to sync.",
    });
  if (r.isActive && r.assignments.length === 0 && !r.isOrgLevel)
    findings.push({
      severity: "warning",
      title: "Not assigned to anyone",
      detail:
        "It's active but isn't org level or assigned to a profile or permission set, so nothing syncs from it.",
    });
  for (const profile of duplicates.get(r.developerName) ?? [])
    findings.push({
      severity: "warning",
      title: `Duplicate for ${profile}`,
      detail: `${profile} has more than one active record for ${dbSchemaLabel(r)}. Keep one so the sync filter is predictable.`,
    });
  return findings;
}

export function toRow(r: ConfigRecord, duplicates: Map<string, string[]>): ObjectSyncRow {
  const names = new Set([...Object.keys(r.fields), ...Object.keys(r.fieldTypes)]);
  return {
    developerName: r.developerName,
    label: r.label || r.developerName,
    title: dbSchemaLabel(r),
    sobject: text(r.fields.SObject),
    type: text(r.fields.Type),
    active: !!r.isActive,
    orgLevel: !!r.isOrgLevel,
    status: text(r.fields.Status),
    errors: text(r.fields.Errors),
    whereSoql: text(r.fields.WhereSoql),
    profiles: profilesOf(r),
    permissionSets: [
      ...new Set([
        ...r.assignments.filter((a) => a.level === "PermissionSet").map((a) => a.name),
        ...splitList(r.fields.PermissionSets),
      ]),
    ],
    fields: [...names]
      .sort()
      .map((name) => ({ name, type: r.fieldTypes[name] ?? null, value: value(r.fields[name]) })),
    edit: configEdit(r),
    soql: syncSoql(r),
    findings: rowFindings(r, duplicates),
  };
}

/** Queryable objects in the org, by API name. */
async function queryableObjects(org: string): Promise<string[]> {
  const res = await apiRequest<{ sobjects?: { name: string; queryable?: boolean }[] }>(
    await dataPath(org, "/sobjects"),
    "GET",
    undefined,
    org
  );
  if (!res.success) return [];
  return (res.data?.sobjects ?? [])
    .filter((o) => o.queryable !== false)
    .map((o) => o.name)
    .sort();
}

export async function collectObjectSync(org: string): Promise<ObjectSyncOverview> {
  const [records, objects] = await Promise.all([
    fetchCategories(org, ["DbSchema"], true),
    queryableObjects(org).catch(() => []),
  ]);
  const duplicates = findDuplicates(records);
  const rows = records
    .map((r) => toRow(r, duplicates))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { org, rows, objects };
}

// --- Check filters ---------------------------------------------------------------

export type CheckState = "pass" | "fail" | "warn" | "skipped";

export interface FilterCheckPart {
  name: string;
  state: CheckState;
  detail: string;
}

export interface FilterCheckResult {
  developerName: string;
  state: CheckState;
  parts: FilterCheckPart[];
  checkedAt: string;
}

/** The app's longest WHERE clause (MetadataDatabaseTableLoader). */
export const MAX_WHERE_LENGTH = 4000;
/** A sample record Id, put where a filter expects ids it only knows on the device. */
const SAMPLE_ID = "'000000000000000AAA'";
const SAMPLE_USER_ID = "005000000000000AAA";
const SAMPLE_TERRITORY_ID = "0MI000000000000AAA";

/**
 * A filter LSC Mobile would send, with its tags filled with sample values so the
 * org can parse it: the user and territory tags as the app substitutes them, and
 * id-list tags ({ACCOUNT.IDS}, {OT2A.OBJ.IDS}, content tags, …) as one sample Id.
 * Returns the filter and the tags it filled.
 */
export function sampleFilter(where: string): { soql: string; tags: string[] } {
  const tags = [...new Set((where.match(/\{[A-Za-z0-9_.]+\}/g) ?? []).map((t) => t.toUpperCase()))];
  where = where.split(/\r?\n/).join(" ");
  // The user and territory tags go in raw, as the app puts them, so a filter missing its quotes fails here too.
  let soql = resolveScalarTags(where, {
    userId: SAMPLE_USER_ID,
    territoryName: "Sample",
    territoryId: SAMPLE_TERRITORY_ID,
  });
  // Whatever is left is an id list: IN ('{TAG}') or IN ({TAG}).
  soql = soql.replace(/'\{[A-Za-z0-9_.]+\}'/g, SAMPLE_ID).replace(/\{[A-Za-z0-9_.]+\}/g, SAMPLE_ID);
  return { soql, tags };
}

const worst = (parts: FilterCheckPart[]): CheckState =>
  parts.some((p) => p.state === "fail")
    ? "fail"
    : parts.some((p) => p.state === "warn")
      ? "warn"
      : parts.every((p) => p.state === "skipped")
        ? "skipped"
        : "pass";

/** Shorter Salesforce errors: the first line, without the echoed query. */
function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const line =
    message.split(/\r?\n/).find((l) => l.trim() && !/^\s*(SELECT|FROM|WHERE|\^)/i.test(l)) ??
    message;
  return line
    .replace(/^ERROR at Row:\d+:Column:\d+\s*/i, "")
    .trim()
    .slice(0, 400);
}

/**
 * Check one record the way metadata cache generation would trip over it: the
 * object exists and can be queried, its delta date field and listed fields are
 * on the object, and its filter runs (as a one-row query, with tags filled with
 * sample values). Read-only.
 */
export async function checkRecord(r: ConfigRecord, org: string): Promise<FilterCheckResult> {
  const parts: FilterCheckPart[] = [];
  const done = (): FilterCheckResult => ({
    developerName: r.developerName,
    state: worst(parts),
    parts,
    checkedAt: new Date().toISOString(),
  });
  if (r.fields.Type === "CONFIGURATION") {
    parts.push({
      name: "Admin Console records",
      state: "skipped",
      detail: "It syncs Admin Console records, so there's no object filter to check.",
    });
    return done();
  }
  const sobject = text(r.fields.SObject);
  if (!sobject || !/^\w+$/.test(sobject)) {
    parts.push({
      name: "Object",
      state: "fail",
      detail: sobject ? `"${sobject}" isn't an object API name.` : "No object is set.",
    });
    return done();
  }
  const described = await cachedDescribeSObject(sobject, org);
  if (!described.success || !described.data) {
    parts.push({
      name: "Object",
      state: "fail",
      detail:
        `${sobject} isn't an object this login can read in the org. ${described.error ? errorText(described.error) : ""}`.trim(),
    });
    return done();
  }
  parts.push({ name: "Object", state: "pass", detail: `${described.data.label} (${sobject})` });
  const fields = new Map(described.data.fields.map((f) => [f.name.toLowerCase(), f]));

  const delta = text(r.fields.DeltaDateField);
  if (delta) {
    const f = fields.get(delta.toLowerCase());
    parts.push(
      !f
        ? { name: "Delta date field", state: "fail", detail: `${sobject} has no field ${delta}.` }
        : !/date/i.test(f.type)
          ? {
              name: "Delta date field",
              state: "warn",
              detail: `${delta} is a ${f.type} field, not a date or date/time.`,
            }
          : { name: "Delta date field", state: "pass", detail: delta }
    );
  } else {
    parts.push({
      name: "Delta date field",
      state: "warn",
      detail: "None set — every sync downloads the whole table again.",
    });
  }

  const listed = splitList(r.fields.MandatoryFields);
  if (listed.length) {
    // Relationship paths (Account.Name) are only checked up to the first dot.
    const missing = listed.filter((name) => !name.includes(".") && !fields.has(name.toLowerCase()));
    parts.push(
      missing.length
        ? // Fields can be missing because of an org setting (person-name fields) or this login's field access, so it's a warning.
          {
            name: "Synced fields",
            state: "warn",
            detail: `${sobject} has no ${missing.join(", ")} for this login, so they can't sync.`,
          }
        : {
            name: "Synced fields",
            state: "pass",
            detail: `${listed.length} listed, all on ${sobject}.`,
          }
    );
  }

  const where = text(r.fields.WhereSoql);
  if (!where) {
    parts.push({
      name: "Filter",
      state: "pass",
      detail: "No filter — every record the user can see is downloaded.",
    });
    return done();
  }
  const { soql, tags } = sampleFilter(where);
  if (soql.length > MAX_WHERE_LENGTH)
    parts.push({
      name: "Filter length",
      state: "warn",
      detail: `${soql.length.toLocaleString()} characters; the app splits or drops filters over ${MAX_WHERE_LENGTH.toLocaleString()}.`,
    });
  try {
    await query(`SELECT Id FROM ${sobject} WHERE ${soql} LIMIT 1`, org, false, {
      maxRows: 1,
      allowTruncated: true,
    });
    parts.push({
      name: "Filter",
      state: "pass",
      detail: tags.length ? `Runs, with ${tags.join(", ")} filled with sample values.` : "Runs.",
    });
  } catch (err) {
    parts.push({ name: "Filter", state: "fail", detail: errorText(err) });
  }
  return done();
}

/** Check the named records, a few at a time (every call still goes through the shared limiter). */
export async function checkObjectSync(
  developerNames: string[],
  org: string
): Promise<{ org: string; results: FilterCheckResult[]; missing: string[] }> {
  const records = await fetchCategories(org, ["DbSchema"], true);
  const byName = new Map(records.map((r) => [r.developerName.toLowerCase(), r]));
  const wanted = [...new Set(developerNames)];
  const missing = wanted.filter((n) => !byName.has(n.toLowerCase()));
  const targets = wanted
    .map((n) => byName.get(n.toLowerCase()))
    .filter((r): r is ConfigRecord => !!r);
  const results: FilterCheckResult[] = [];
  for (let i = 0; i < targets.length; i += 6) {
    results.push(...(await Promise.all(targets.slice(i, i + 6).map((r) => checkRecord(r, org)))));
  }
  return { org, results, missing };
}
