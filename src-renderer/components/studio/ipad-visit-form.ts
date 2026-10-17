import type { PublishedLayout, RecordFieldSpec } from "./published-types";

/**
 * The New Visit editor's field list and starting values (module/Visit VisitHeaderViewModel, BaseLayoutViewModel,
 * and MetadataCore.makeMergedRecordType, which merges the Visit and Provider Visit layouts of a compound record type).
 */

/** Always drawn first, in this order (they get their own controls), whatever the layout says. */
const HARDCODED = ["AccountId", "PlaceId", "PlannedVisitStartTime", "PlannedVisitEndTime"];

/** Never shown on the editor. */
const HIDDEN = new Set(["VisitId", "NextProviderVisitObjective", "NextPrvdVisitObjectiveType", "PreProviderVisitNotes", "ParentOrganizationId"]);

/** Fields the editor forces regardless of the layout's behavior. */
const FORCED_READONLY = new Set(["TerritoryId", "Status"]);
const FORCED_REQUIRED = new Set(["PlannedVisitStartTime", "PlannedVisitEndTime", "RecordTypeId"]);

/**
 * Layout items in the order the editor draws them (two columns, filled row by row): the hardcoded four, then each
 * layout's sections row by row (one cell per column in turn), skipping hidden fields, summaries and formulas and keeping the
 * first of a name that repeats across layouts. On the device's System Information section the right column comes
 * first in each row (observed: Owner Name, Name, Record Type, External ID).
 */
export function visitFields(layouts: PublishedLayout[]): RecordFieldSpec[] {
  const seen = new Set<string>();
  const found = new Map<string, RecordFieldSpec>();
  const rest: RecordFieldSpec[] = [];
  for (const layout of layouts) {
    for (const section of layout.sections) {
      const cols = section.fields ?? [];
      const rows = Math.max(0, ...cols.map((c) => c.length));
      const swap = section.label === "System Information" && cols.length === 2;
      for (let r = 0; r < rows; r++) {
        const row = cols.map((c) => c[r]);
        for (const spec of swap ? [...row].reverse() : row) {
          if (!spec) continue;
          if (HARDCODED.includes(spec.name) && !found.has(spec.name)) found.set(spec.name, spec);
          if (seen.has(spec.name)) continue;
          seen.add(spec.name);
          if (HARDCODED.includes(spec.name) || HIDDEN.has(spec.name)) continue;
          if (/^(summary|calculated)$/.test(spec.type)) continue;
          rest.push(spec);
        }
      }
    }
  }
  const first = HARDCODED.map((name) => found.get(name) ?? { name, label: name, type: name === "AccountId" || name === "PlaceId" ? "lookup" : "datetime" });
  return [...first, ...rest].map((s) => ({
    ...s,
    ...(FORCED_REQUIRED.has(s.name) || s.name === "AccountId" || s.name === "PlaceId" ? { required: true } : {}),
    ...(FORCED_READONLY.has(s.name) ? { readOnly: true } : {}),
  }));
}

/**
 * Planned Start is now to the minute (no rounding) and End is start plus the default duration, unless the org's
 * SetBlankDateTimeInPlannedStartTime leaves both empty.
 */
export function visitTimes(now: Date, durationMinutes: number, blankStart: boolean): { start: Date | null; end: Date | null } {
  if (blankStart) return { start: null, end: null };
  const start = new Date(now);
  start.setSeconds(0, 0);
  return { start, end: new Date(start.getTime() + durationMinutes * 60000) };
}

/** "Oct 17, 2026 at 12:41 PM" */
export function fmtDateTime(d: Date): string {
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/** The label of a picklist's starting value on the record type (its `isDefault` value), if any. */
export function picklistStart(spec: RecordFieldSpec, defaults: Record<string, string> | undefined): string | undefined {
  const v = defaults?.[spec.name];
  return v ? (spec.picklist?.[v] ?? v) : undefined;
}
