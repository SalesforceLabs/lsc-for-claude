/**
 * Pure helpers for Studio's sync-impact estimate: apply pending DB Schema
 * changes to the loaded entries, decide which tables must be recounted, and
 * diff the before/after volumes.
 */

import type { ApplicableTable, DbSchemaEntry, TableVolume } from "./sync-volume.js";

/** The slice of a Studio fix that can change DB Schema entries. Other kinds are ignored. */
export type WhatIfFix =
  | {
      kind: "setConfigField";
      label?: string;
      category: string;
      developerName: string;
      field: string;
      to: string | number | null;
    }
  | {
      kind: "setActive";
      label?: string;
      record: { type: string; category?: string; developerName: string };
      to: boolean;
    }
  | {
      kind: "setProfileAssignments";
      label?: string;
      category: string;
      developerName: string;
      to: string[];
    }
  | {
      kind: "createConfigRecord";
      label?: string;
      category: string;
      developerName: string;
      copyFrom?: string;
      fields: Array<{ name: string; value: string | number | boolean | null }>;
      profiles: string[];
      permissionSets?: string[];
      active: boolean;
    }
  | { kind: "deleteConfigRecord"; label?: string; category: string; developerName: string };

export interface Unmodeled {
  label: string;
  reason: string;
}

export interface AppliedChanges {
  entries: DbSchemaEntry[];
  /** DeveloperNames of DB Schema records the changes touched. */
  touched: string[];
  unmodeled: Unmodeled[];
}

function cloneEntry(e: DbSchemaEntry): DbSchemaEntry {
  return {
    ...e,
    profileIds: new Set(e.profileIds),
    profileNames: new Set(e.profileNames),
    permissionSets: new Set(e.permissionSets),
  };
}

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function splitList(v: unknown): string[] {
  return text(v)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const labelOf = (f: { label?: string; kind: string; developerName?: string }) =>
  f.label || `${f.kind} ${f.developerName ?? ""}`.trim();

/** Apply the DbSchema-relevant fixes, in order, to a copy of the entries. */
export function applyChanges(
  entries: DbSchemaEntry[],
  fixes: Array<Record<string, unknown>>
): AppliedChanges {
  const byName = new Map(entries.map((e) => [e.developerName, cloneEntry(e)]));
  const touched = new Set<string>();
  const unmodeled: Unmodeled[] = [];

  for (const raw of fixes) {
    const fix = raw as unknown as WhatIfFix;
    switch (fix.kind) {
      case "setConfigField": {
        if (fix.category !== "DbSchema") break;
        const entry = byName.get(fix.developerName);
        if (!entry) {
          unmodeled.push({
            label: labelOf(fix),
            reason: `${fix.developerName} is not an active DB Schema record that syncs data`,
          });
          break;
        }
        const key = fix.field.toLowerCase();
        const value = text(fix.to);
        if (key === "profiles") {
          // A field-sourced list: names are matched when the record has no assignments.
          entry.profileIds = new Set();
          entry.profileNames = new Set(splitList(value));
        } else if (key === "permissionsets") {
          entry.permissionSets = new Set(splitList(value));
        } else if (key === "wheresoql") {
          entry.whereSoql = value || null;
        } else if (key === "sobject") {
          entry.sobject = value;
        } else if (key === "type") {
          entry.type = value;
          // Configuration records aren't synced as tables.
          if (value.toLowerCase() === "configuration") byName.delete(entry.developerName);
        } else {
          unmodeled.push({
            label: labelOf(fix),
            reason: `${fix.field} doesn't change how many records are downloaded`,
          });
          break;
        }
        touched.add(fix.developerName);
        break;
      }
      case "setActive": {
        if (fix.record?.type !== "config" || fix.record.category !== "DbSchema") break;
        const name = fix.record.developerName;
        if (!fix.to) {
          if (byName.delete(name)) touched.add(name);
          else
            unmodeled.push({
              label: labelOf({ ...fix, developerName: name }),
              reason: `${name} is not an active DB Schema record that syncs data`,
            });
        } else if (!byName.has(name)) {
          unmodeled.push({
            label: labelOf({ ...fix, developerName: name }),
            reason: `${name} is inactive, so its filter and profiles aren't loaded`,
          });
        }
        break;
      }
      case "setProfileAssignments": {
        if (fix.category !== "DbSchema") break;
        const entry = byName.get(fix.developerName);
        if (!entry) {
          unmodeled.push({
            label: labelOf(fix),
            reason: `${fix.developerName} is not an active DB Schema record that syncs data`,
          });
          break;
        }
        // Assigned profiles are matched by name from here on; with none left, the Profiles field names apply.
        entry.profileIds = new Set();
        if (fix.to.length > 0) entry.profileNames = new Set(fix.to);
        touched.add(entry.developerName);
        break;
      }
      case "createConfigRecord": {
        if (fix.category !== "DbSchema") break;
        if (!fix.active) {
          unmodeled.push({
            label: labelOf(fix),
            reason: "Created inactive, so it doesn't sync yet",
          });
          break;
        }
        const source = fix.copyFrom ? byName.get(fix.copyFrom) : undefined;
        if (fix.copyFrom && !source) {
          unmodeled.push({
            label: labelOf(fix),
            reason: `Copied from ${fix.copyFrom}, which isn't an active DB Schema record that syncs data`,
          });
          break;
        }
        const entry: DbSchemaEntry = source
          ? cloneEntry(source)
          : {
              developerName: "",
              sobject: "",
              type: "",
              whereSoql: null,
              profileIds: new Set(),
              profileNames: new Set(),
              permissionSets: new Set(),
            };
        entry.developerName = fix.developerName;
        for (const f of fix.fields) {
          if (f.name === "SObject") entry.sobject = text(f.value);
          else if (f.name === "Type") entry.type = text(f.value);
          else if (f.name === "WhereSoql") entry.whereSoql = text(f.value) || null;
          else if (f.name === "PermissionSets" && !fix.permissionSets)
            entry.permissionSets = new Set(splitList(f.value));
        }
        entry.profileIds = new Set();
        entry.profileNames = new Set(fix.profiles);
        if (fix.permissionSets) entry.permissionSets = new Set(fix.permissionSets);
        if (!entry.sobject || entry.type.toLowerCase() === "configuration") {
          unmodeled.push({ label: labelOf(fix), reason: "No SObject to sync" });
          break;
        }
        byName.set(entry.developerName, entry);
        touched.add(entry.developerName);
        break;
      }
      case "deleteConfigRecord": {
        if (fix.category !== "DbSchema") break;
        if (byName.delete(fix.developerName)) touched.add(fix.developerName);
        else
          unmodeled.push({
            label: labelOf(fix),
            reason: `${fix.developerName} is not an active DB Schema record that syncs data`,
          });
        break;
      }
      default:
        break;
    }
  }

  return {
    entries: [...byName.values()].sort((a, b) => a.developerName.localeCompare(b.developerName)),
    touched: [...touched],
    unmodeled,
  };
}

/** True when the fix is one this module models for DB Schema (even if a given instance isn't). */
export function touchesDbSchema(fix: Record<string, unknown>): boolean {
  if (fix.kind === "setActive") {
    const r = fix.record as { type?: string; category?: string } | undefined;
    return r?.type === "config" && r.category === "DbSchema";
  }
  return (
    [
      "setConfigField",
      "setProfileAssignments",
      "createConfigRecord",
      "deleteConfigRecord",
    ].includes(String(fix.kind)) && fix.category === "DbSchema"
  );
}

/**
 * Profiles whose tables the changes can alter: names assigned to a touched
 * record before or after, plus ids to be resolved to names by the caller.
 */
export function affectedProfiles(
  before: DbSchemaEntry[],
  after: DbSchemaEntry[],
  touched: string[]
): { names: Set<string>; ids: Set<string> } {
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const list of [before, after]) {
    for (const e of list) {
      if (!touched.includes(e.developerName)) continue;
      e.profileNames.forEach((n) => names.add(n));
      e.profileIds.forEach((i) => ids.add(i));
    }
  }
  return { names, ids };
}

// ---------------------------------------------------------------------------
// Table diff
// ---------------------------------------------------------------------------

const key = (t: ApplicableTable) => t.entry.sobject.toLowerCase();

/** Tables whose rules differ between the two sides (added, removed, or re-filtered), by lowercase SObject. */
export function changedSobjects(before: ApplicableTable[], after: ApplicableTable[]): Set<string> {
  const b = new Map(before.map((t) => [key(t), t]));
  const a = new Map(after.map((t) => [key(t), t]));
  const out = new Set<string>();
  for (const k of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(k);
    const y = a.get(k);
    if (
      !x ||
      !y ||
      x.entry.whereSoql !== y.entry.whereSoql ||
      x.entry.developerName !== y.entry.developerName
    )
      out.add(k);
  }
  return out;
}

/** Tables other filters read ids from; if one of these changes, dependents change with it. */
const ID_SOURCES = new Set(["account", "objectterritory2association"]);

export interface RecountPlan {
  /** Recount every table on the "after" side (a source table changed). */
  full: boolean;
  /** After-side tables to count when not full: the changed ones, plus the id sources they may depend on. */
  after: ApplicableTable[];
}

export function planRecount(after: ApplicableTable[], changed: Set<string>): RecountPlan {
  if ([...changed].some((k) => ID_SOURCES.has(k))) return { full: true, after };
  const subset = after.filter((t) => changed.has(key(t)));
  // Changed tables with id tags need the source tables present to resolve them.
  const needsSources = subset.some((t) =>
    /\{(ACCOUNT\.IDS|OT2A\.OBJ\.IDS)\}/i.test(t.entry.whereSoql ?? "")
  );
  return {
    full: false,
    after: needsSources
      ? after.filter((t) => changed.has(key(t)) || ID_SOURCES.has(key(t)))
      : subset,
  };
}

export interface TableDiff {
  sobject: string;
  before: number | null;
  after: number | null;
  delta: number;
  note?: string;
}

export interface FailingFilter {
  sobject: string;
  developerName: string;
  message: string;
}

export interface VolumeDiff {
  totalBefore: number;
  totalAfter: number;
  delta: number;
  /** Percent change of the total; null when the total before is 0. */
  pct: number | null;
  tables: TableDiff[];
  failing: FailingFilter[];
}

const counted = (t: TableVolume | undefined) => (t && t.status === "counted" ? t.records : null);

/**
 * Diff the before/after volumes. `beforeAll` is the full count on the before
 * side; `afterTables` is either the full after-side count (`full`) or only
 * the recounted tables, in which case the unchanged ones are carried over.
 */
export function diffVolumes(
  beforeAll: TableVolume[],
  afterTables: TableVolume[],
  changed: Set<string>,
  full: boolean
): VolumeDiff {
  const lc = (v: TableVolume) => v.sobject.toLowerCase();
  const b = new Map(beforeAll.map((t) => [lc(t), t]));
  const a = new Map(afterTables.map((t) => [lc(t), t]));
  const totalBefore = beforeAll.reduce((n, t) => n + (counted(t) ?? 0), 0);

  let totalAfter: number;
  if (full) {
    totalAfter = afterTables.reduce((n, t) => n + (counted(t) ?? 0), 0);
  } else {
    // Unchanged tables are identical on both sides.
    const changedBefore = [...changed].reduce((n, k) => n + (counted(b.get(k)) ?? 0), 0);
    const changedAfter = [...changed].reduce((n, k) => n + (counted(a.get(k)) ?? 0), 0);
    totalAfter = totalBefore - changedBefore + changedAfter;
  }

  const keys = full
    ? new Set(
        [...b.keys(), ...a.keys()].filter(
          (k) => changed.has(k) || counted(b.get(k)) !== counted(a.get(k))
        )
      )
    : changed;
  const tables: TableDiff[] = [];
  const failing: FailingFilter[] = [];
  for (const k of keys) {
    const x = b.get(k);
    const y = a.get(k);
    const bv = counted(x);
    const av = counted(y);
    const diff: TableDiff = {
      sobject: (y ?? x)!.sobject,
      before: bv,
      after: av,
      delta: (av ?? 0) - (bv ?? 0),
    };
    const note = y && y.status !== "counted" ? y.note : undefined;
    if (note) diff.note = note;
    tables.push(diff);
    if (y?.status === "error" && x?.status !== "error") {
      failing.push({
        sobject: y.sobject,
        developerName: y.developerName,
        message: y.note ?? "Count query failed",
      });
    }
  }
  tables.sort(
    (p, q) => Math.abs(q.delta) - Math.abs(p.delta) || p.sobject.localeCompare(q.sobject)
  );
  const delta = totalAfter - totalBefore;
  return {
    totalBefore,
    totalAfter,
    delta,
    pct: totalBefore > 0 ? (delta / totalBefore) * 100 : null,
    tables,
    failing,
  };
}
