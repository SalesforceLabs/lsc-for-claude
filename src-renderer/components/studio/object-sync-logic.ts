/**
 * Object sync page logic: the org's DB Schema records with the tray's queued changes laid
 * over them, filtering, and the changes the page's actions queue. No React, no IPC.
 */
import { activeChange, changeKey, effectiveActive, effectiveProfiles, profileChange, type PendingChange } from "./changes";
import type { CreateConfigFix, StudioFix } from "./types";
import type { CheckState, FilterCheckResult, ObjectSyncRow } from "./object-sync-types";

export const CATEGORY = "DbSchema";

export type TypeFilter = "all" | "DATA" | "CONFIGURATION";

export interface Filters {
  search: string;
  type: TypeFilter;
  /** A profile name, or null for every profile. */
  profile: string | null;
  problemsOnly: boolean;
}

export const NO_FILTERS: Filters = { search: "", type: "all", profile: null, problemsOnly: false };

/** A record as it will be once the tray is applied. */
export interface ViewRow {
  row: ObjectSyncRow;
  active: boolean;
  profiles: string[];
  whereSoql: string | null;
  /** Queued changes touching the record. */
  queued: number;
  /** A queued delete. */
  deleting: boolean;
  /** Set for a record that's only in the tray (a queued create). */
  created?: CreateConfigFix;
}

/** Whether a queued change is about this DB Schema record. */
export function touches(fix: StudioFix, developerName: string): boolean {
  switch (fix.kind) {
    case "setConfigField":
    case "setProfileAssignments":
    case "deleteConfigRecord":
    case "createConfigRecord":
      return fix.category === CATEGORY && fix.developerName === developerName;
    case "setActive":
      return fix.record.type === "config" && fix.record.category === CATEGORY && fix.record.developerName === developerName;
    default:
      return false;
  }
}

/** The value of one field once the tray is applied. */
export function fieldValue(row: ObjectSyncRow, name: string, pending: PendingChange[]): string | number | boolean | null {
  const queued = pending.find(
    (p) => p.fix.kind === "setConfigField" && p.fix.category === CATEGORY && p.fix.developerName === row.developerName && p.fix.field === name
  )?.fix;
  if (queued?.kind === "setConfigField") return queued.to;
  return row.fields.find((f) => f.name === name)?.value ?? null;
}

/** Whether the record has a value row for the field, which is what a field edit writes to. */
export const hasField = (row: ObjectSyncRow, name: string): boolean => row.fields.some((f) => f.name === name);

const fieldOf = (fix: CreateConfigFix, name: string) => fix.fields.find((f) => f.name === name)?.value ?? null;
const textOf = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** A queued create drawn as a row. */
export function createdRow(fix: CreateConfigFix): ObjectSyncRow {
  const sobject = textOf(fieldOf(fix, "SObject"));
  const type = textOf(fieldOf(fix, "Type"));
  return {
    developerName: fix.developerName,
    label: fix.recordLabel,
    title: sobject ?? fix.recordLabel,
    sobject,
    type,
    active: fix.active,
    orgLevel: false,
    status: null,
    errors: null,
    whereSoql: textOf(fieldOf(fix, "WhereSoql")),
    profiles: fix.profiles,
    permissionSets: fix.permissionSets ?? [],
    fields: fix.fields.map((f) => ({ name: f.name, type: f.dataType ?? null, value: f.value })),
    edit: undefined,
    soql: null,
    findings: [],
  };
}

/** Every record with the tray laid over it, queued creates last. */
export function viewRows(rows: ObjectSyncRow[], pending: PendingChange[]): ViewRow[] {
  const out: ViewRow[] = rows.map((row) => ({
    row,
    active: row.edit ? (effectiveActive(row.edit, pending) ?? row.active) : row.active,
    profiles: row.edit ? effectiveProfiles(row.edit, pending) : row.profiles,
    whereSoql: textOf(fieldValue(row, "WhereSoql", pending)),
    queued: pending.filter((p) => touches(p.fix, row.developerName)).length,
    deleting: pending.some((p) => p.fix.kind === "deleteConfigRecord" && p.fix.category === CATEGORY && p.fix.developerName === row.developerName),
  }));
  for (const p of pending) {
    if (p.fix.kind !== "createConfigRecord" || p.fix.category !== CATEGORY) continue;
    const row = createdRow(p.fix);
    out.push({ row, active: row.active, profiles: row.profiles, whereSoql: row.whereSoql, queued: 1, deleting: false, created: p.fix });
  }
  return out;
}

export const hasProblems = (v: ViewRow, check?: FilterCheckResult): boolean =>
  v.row.findings.some((f) => f.severity === "error" || f.severity === "warning") || check?.state === "fail" || check?.state === "warn";

export function filterRows(rows: ViewRow[], filters: Filters, checks: Map<string, FilterCheckResult>): ViewRow[] {
  const q = filters.search.trim().toLowerCase();
  const profile = filters.profile?.toLowerCase();
  return rows.filter((v) => {
    if (filters.type !== "all" && (v.row.type ?? "DATA").toUpperCase() !== filters.type) return false;
    if (profile && !v.row.orgLevel && !v.profiles.some((p) => p.toLowerCase() === profile)) return false;
    if (filters.problemsOnly && !hasProblems(v, checks.get(v.row.developerName))) return false;
    if (!q) return true;
    return [v.row.label, v.row.developerName, v.row.sobject ?? "", v.whereSoql ?? ""].some((s) => s.toLowerCase().includes(q));
  });
}

export function typeCounts(rows: ViewRow[]): Record<TypeFilter, number> {
  const counts: Record<TypeFilter, number> = { all: rows.length, DATA: 0, CONFIGURATION: 0 };
  for (const v of rows) counts[(v.row.type ?? "DATA").toUpperCase() === "CONFIGURATION" ? "CONFIGURATION" : "DATA"]++;
  return counts;
}

/** Profiles named on any record, for the profile filter. */
export function profileNames(rows: ViewRow[]): string[] {
  const seen = new Map<string, string>();
  for (const v of rows) for (const p of v.profiles) if (!seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// --- Changes the page queues ------------------------------------------------------

const affects = (...lists: string[][]) => [...new Set(lists.flat())];

/** A field edit, as a tray change; null when it's no change or the record has no value row for it. */
export function fieldChange(row: ObjectSyncRow, name: string, to: string | number | boolean | null): PendingChange | null {
  const field = row.fields.find((f) => f.name === name);
  if (!field) return null;
  return {
    fix: {
      kind: "setConfigField",
      label: `Change ${FIELD_LABELS[name] ?? name} on ${row.label}`,
      category: CATEGORY,
      developerName: row.developerName,
      recordLabel: row.label,
      field: name,
      from: field.value,
      to,
    },
    affects: row.profiles,
  };
}

/** Switch the records on or off (records already that way are left out). */
export function activeChanges(rows: ViewRow[], to: boolean): PendingChange[] {
  return rows.flatMap((v) => {
    if (v.created || v.deleting || !v.row.edit || v.active === to) return [];
    const fix = activeChange(v.row.edit, to);
    return fix ? [{ fix, affects: v.profiles }] : [];
  });
}

/**
 * Add or remove profiles on each record. Org-level records reach everyone already, and records
 * the change wouldn't alter are left out; `skipped` counts the org-level ones.
 */
export function profileChanges(rows: ViewRow[], mode: "add" | "remove", names: string[]): { changes: PendingChange[]; skipped: number } {
  const lower = new Set(names.map((n) => n.toLowerCase()));
  let skipped = 0;
  const changes = rows.flatMap((v) => {
    if (v.created || v.deleting || !v.row.edit) return [];
    if (v.row.orgLevel) {
      skipped++;
      return [];
    }
    const has = new Set(v.profiles.map((p) => p.toLowerCase()));
    const to = mode === "add" ? [...v.profiles, ...names.filter((n) => !has.has(n.toLowerCase()))] : v.profiles.filter((p) => !lower.has(p.toLowerCase()));
    if (to.length === v.profiles.length) return [];
    const fix = profileChange(v.row.edit, to);
    return fix ? [{ fix, affects: affects(v.profiles, to) }] : [];
  });
  return { changes, skipped };
}

/** Delete the records. Queued creates aren't deleted — they're taken out of the tray (`dropCreates`). */
export function deleteChanges(rows: ViewRow[]): PendingChange[] {
  return rows.flatMap((v) =>
    v.created || v.deleting
      ? []
      : [
          {
            fix: { kind: "deleteConfigRecord", label: `Delete ${v.row.label}`, category: CATEGORY, developerName: v.row.developerName, recordLabel: v.row.label },
            affects: v.profiles,
          } satisfies PendingChange,
        ]
  );
}

/** The tray without the queued creates among `rows`. */
export function dropCreates(pending: PendingChange[], rows: ViewRow[]): PendingChange[] {
  const keys = new Set(rows.flatMap((v) => (v.created ? [changeKey(v.created)] : [])));
  return pending.filter((p) => !keys.has(changeKey(p.fix)));
}

/** The tray without the record's queued delete. */
export function dropDelete(pending: PendingChange[], developerName: string): PendingChange[] {
  return pending.filter((p) => !(p.fix.kind === "deleteConfigRecord" && p.fix.category === CATEGORY && p.fix.developerName === developerName));
}

/** A blank DB Schema record for "New…". */
export function newDraft(): CreateConfigFix {
  return {
    kind: "createConfigRecord",
    label: "New DB Schema record",
    category: CATEGORY,
    developerName: "",
    recordLabel: "",
    fields: [{ name: "Type", value: "DATA" }],
    profiles: [],
    active: true,
  };
}

/** A "Duplicate…" draft: every value copied, then overridden by the form. */
export function duplicateDraft(row: ObjectSyncRow): CreateConfigFix {
  const base = row.developerName.startsWith("DbSchema_") ? row.developerName : `DbSchema_${row.developerName}`;
  return {
    kind: "createConfigRecord",
    label: `Duplicate ${row.label}`,
    category: CATEGORY,
    developerName: `${base.slice(0, 75).replace(/_+$/, "")}_Copy`,
    recordLabel: `${row.label} (copy)`.slice(0, 80),
    copyFrom: row.developerName,
    fields: [],
    profiles: row.profiles,
    active: row.active,
  };
}

// --- Display ---------------------------------------------------------------------

/** Labels for the DB Schema fields the page shows by name. */
export const FIELD_LABELS: Record<string, string> = {
  SObject: "Object",
  Type: "Type",
  Category: "Category",
  WhereSoql: "Filter",
  DeltaDateField: "Delta date field",
  OneWaySync: "Download only",
  AttachmentsSupport: "Attachments",
  MandatoryFields: "Synced fields",
  PermissionSets: "Permission sets",
  Status: "Status",
  Errors: "Errors",
};

/** The fields the detail panel edits by name; the rest are listed read-only. */
export const EDITED_FIELDS = new Set(["WhereSoql", "DeltaDateField", "OneWaySync", "AttachmentsSupport", "MandatoryFields"]);

export const ATTACHMENT_OPTIONS = [
  { value: "", label: "Off" },
  { value: "CACHE", label: "Download with the sync" },
  { value: "BACKGROUND", label: "Download in the background" },
];

/** The org's Status as a pill tone and words. */
export function statusPill(status: string | null): { tone: "pass" | "error" | "warning" | ""; text: string } {
  const s = (status ?? "").toUpperCase();
  if (!s) return { tone: "", text: "Not validated" };
  if (s === "VALID") return { tone: "pass", text: "Valid" };
  if (s === "INVALID") return { tone: "error", text: "Invalid" };
  if (s === "IN_PROGRESS" || s === "INPROGRESS") return { tone: "warning", text: "Validating" };
  return { tone: "", text: s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") };
}

export const CHECK_TEXT: Record<CheckState, string> = {
  pass: "Filter runs",
  warn: "Check passed with warnings",
  fail: "Check failed",
  skipped: "Not checked",
};

export const typeText = (type: string | null) => ((type ?? "").toUpperCase() === "CONFIGURATION" ? "Configuration" : "Data");
