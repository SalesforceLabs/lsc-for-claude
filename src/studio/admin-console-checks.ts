/**
 * Pure checks over Admin Console records and cloned permission sets, for the Setup Overview.
 * Each one is a misconfiguration admins have hit in the field: a profile record quietly overriding
 * the org-level setting they changed, two records competing for one profile, a record saved with
 * no values, and a copy of a standard LSC permission set that missed permissions added later.
 */

import type { ConfigRecord } from "../config/types.js";

/** Fields every record has that say nothing about the setting itself. */
const IGNORED_FIELDS = new Set(["Profiles", "PermissionSets", "DeveloperName", "MasterLabel", "Status", "Errors"]);
/** Categories that hold one settings record per target (org, profile or user), not a list of entries. */
const ONE_PER_TARGET = /(Settings|Administration|Configuration)$/;
/** Categories whose records are useless without values, even when they are the only one. */
const NEEDS_VALUES = new Set(["PlannerAdministration", "CallDiscussionRecordType"]);
/** Differing fields named per overriding record. */
const MAX_FIELDS = 3;

const target = (a: { name: string; level: string }) => `${a.level} ${a.name}`;
const value = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const shown = (v: unknown) => (value(v) === "" ? "(empty)" : value(v));
const settingFields = (r: ConfigRecord) => Object.keys(r.fields).filter((f) => !IGNORED_FIELDS.has(f));

function byCategory(records: ConfigRecord[]): Map<string, ConfigRecord[]> {
  const out = new Map<string, ConfigRecord[]>();
  for (const r of records) out.set(r.category, [...(out.get(r.category) ?? []), r]);
  return out;
}

export interface Override {
  category: string;
  record: string;
  /** Who the record is assigned to, e.g. "Profile Field Sales". */
  targets: string[];
  /** "Field: org value → this record's value". */
  differences: string[];
}

/**
 * Profile- or user-assigned records that differ from their category's single org-level record.
 * The app reads the most specific record, so a change made on the org-level one doesn't reach these users.
 * Only active records, and only fields both records have a value for.
 */
export function settingOverrides(records: ConfigRecord[]): Override[] {
  const out: Override[] = [];
  for (const [category, rs] of byCategory(records.filter((r) => r.isActive !== false))) {
    const orgLevel = rs.filter((r) => r.isOrgLevel);
    if (orgLevel.length !== 1) continue;
    const base = orgLevel[0];
    for (const r of rs) {
      if (r.isOrgLevel || r.assignments.length === 0) continue;
      const differences = settingFields(r)
        .filter((f) => f in base.fields && value(base.fields[f]) !== value(r.fields[f]))
        .map((f) => `${f}: ${shown(base.fields[f])} → ${shown(r.fields[f])}`);
      if (differences.length) out.push({ category, record: r.label ?? r.developerName, targets: r.assignments.map(target), differences });
    }
  }
  return out;
}

export const overrideLine = (o: Override) => {
  const more = o.differences.length > MAX_FIELDS ? ` and ${o.differences.length - MAX_FIELDS} more` : "";
  return `${o.category} › ${o.record} (${o.targets.join(", ")}): ${o.differences.slice(0, MAX_FIELDS).join("; ")}${more}`;
};

export interface Duplicate {
  category: string;
  /** "org level", or who both records are assigned to. */
  target: string;
  records: string[];
}

/**
 * Two or more active records in a one-per-target category for the same target (the org level, one
 * profile or one user), plus a record assigned to the same target twice. Which one the app reads is
 * then down to order.
 */
export function duplicateSettings(records: ConfigRecord[]): Duplicate[] {
  const out: Duplicate[] = [];
  for (const [category, rs] of byCategory(records.filter((r) => r.isActive !== false))) {
    if (!ONE_PER_TARGET.test(category)) continue;
    const holders = new Map<string, string[]>();
    for (const r of rs) {
      const name = r.label ?? r.developerName;
      const keys = r.isOrgLevel ? ["org level"] : r.assignments.map(target);
      for (const k of new Set(keys)) holders.set(k, [...(holders.get(k) ?? []), name]);
      const seen = new Set<string>();
      for (const k of r.assignments.map(target)) {
        if (seen.has(k)) out.push({ category, target: k, records: [name, name] });
        seen.add(k);
      }
    }
    for (const [k, names] of holders) if (names.length > 1) out.push({ category, target: k, records: names });
  }
  return out;
}

export const duplicateLine = (d: Duplicate) =>
  d.records[0] === d.records[1] && d.records.length === 2
    ? `${d.category} › ${d.records[0]} is assigned to ${d.target} twice`
    : `${d.category}: ${d.records.join(", ")} all apply to ${d.target}`;

/**
 * Active records with no setting values, where the category needs them: another record in it has
 * values, or the category is known to be unusable without them.
 */
export function emptySettings(records: ConfigRecord[]): ConfigRecord[] {
  const out: ConfigRecord[] = [];
  for (const [category, rs] of byCategory(records)) {
    const filled = rs.some((r) => settingFields(r).length > 0);
    if (!filled && !NEEDS_VALUES.has(category)) continue;
    out.push(...rs.filter((r) => r.isActive !== false && settingFields(r).length === 0));
  }
  return out;
}

// ─── Cloned permission sets ─────────────────────────────────────────────────

export interface PermSet {
  id: string;
  name: string;
  label: string;
  /** The LSC system permissions (PermissionSet `Permissions*` fields) it has switched on. */
  perms: Set<string>;
}

export interface CloneGap {
  clone: PermSet;
  source: PermSet;
  /** LSC permissions the source has and the clone lacks. */
  missing: string[];
}

/** The PermissionSet fields that are LSC system permissions, from a describe's field names. */
export const isLscPermission = (field: string) => /^Permissions/.test(field) && /LifeSci|LSC4CE|IndustriesVisit/i.test(field);

/**
 * Each custom set compared with the standard LSC set it most resembles (most LSC permissions in
 * common; ties go to the smaller standard set, the likelier source). Only clones missing something
 * the source has are returned — a clone that adds permissions is fine.
 */
export function cloneGaps(standard: PermSet[], clones: PermSet[]): CloneGap[] {
  const out: CloneGap[] = [];
  for (const clone of clones) {
    if (clone.perms.size === 0) continue;
    let best: PermSet | undefined;
    let bestShared = 0;
    for (const s of standard) {
      const shared = [...s.perms].filter((p) => clone.perms.has(p)).length;
      if (shared > bestShared || (shared === bestShared && best && s.perms.size < best.perms.size)) {
        best = s;
        bestShared = shared;
      }
    }
    if (!best || bestShared === 0) continue;
    const missing = [...best.perms].filter((p) => !clone.perms.has(p)).sort();
    if (missing.length) out.push({ clone, source: best, missing });
  }
  return out;
}

/** "PermissionsUseLifeSciSampleLimits" → "UseLifeSciSampleLimits". */
export const permLabel = (field: string) => field.replace(/^Permissions/, "");
