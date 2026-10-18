import type { PublishedLayout, RecordFieldSpec } from "./published-types";

/**
 * The New Visit editor's field list and starting values (module/Visit VisitHeaderViewModel, BaseLayoutViewModel,
 * and MetadataCore.makeMergedRecordType, which merges the Visit and Provider Visit layouts of a compound record type).
 */

/** Always drawn first, in this order (they get their own controls), whatever the layout says. */
const HARDCODED = ["AccountId", "PlaceId", "PlannedVisitStartTime", "PlannedVisitEndTime"];

/** Never shown on the editor. */
const HIDDEN = new Set(["VisitId", "NextProviderVisitObjective", "NextPrvdVisitObjectiveType", "PreProviderVisitNotes", "ParentOrganizationId"]);

const BLANK: RecordFieldSpec = { name: "", label: "", type: "blank" };

/** Fields the editor forces regardless of the layout's behavior. */
const FORCED_READONLY = new Set(["TerritoryId", "Status"]);
const FORCED_REQUIRED = new Set(["PlannedVisitStartTime", "PlannedVisitEndTime", "RecordTypeId"]);

/**
 * Layout items in the order the editor draws them. BaseLayoutViewModel puts the hardcoded four first, then flattens each
 * layout's sections row by row (one cell per column in turn), drops hidden fields and formulas, keeps the first of a name
 * that repeats across layouts, and deals the list into two columns by index (TwoColumnsTopToBottom). The dynamic layout
 * leaves rollup summaries out of a new record (no value yet), so the cells after one move up within their column (observed:
 * Owner Name beside the sample count, Name beside Record Type); an existing record keeps them (Num_Details on the Home
 * visit editor). `blank` fills the right cell when the columns end uneven.
 */
export function visitFields(layouts: PublishedLayout[], opts: { edit?: boolean } = {}): RecordFieldSpec[] {
  const seen = new Set<string>();
  const found = new Map<string, RecordFieldSpec>();
  const rest: RecordFieldSpec[] = [];
  for (const layout of layouts) {
    for (const section of layout.sections) {
      const cols = section.fields ?? [];
      const rows = Math.max(0, ...cols.map((c) => c.length));
      for (let r = 0; r < rows; r++) {
        for (const spec of cols.map((c) => c[r])) {
          if (!spec) continue;
          if (HARDCODED.includes(spec.name) && !found.has(spec.name)) found.set(spec.name, spec);
          if (seen.has(spec.name)) continue;
          seen.add(spec.name);
          if (HARDCODED.includes(spec.name) || HIDDEN.has(spec.name)) continue;
          if (spec.type === "calculated") continue;
          rest.push(spec);
        }
      }
    }
  }
  const first = HARDCODED.map(
    (name) =>
      found.get(name) ?? {
        name,
        label: name,
        type: name === "AccountId" || name === "PlaceId" ? "lookup" : "datetime",
      }
  );
  const all = [...first, ...rest];
  const keep = (s: RecordFieldSpec) => opts.edit || s.type !== "summary";
  const left = all.filter((_, i) => i % 2 === 0).filter(keep);
  const right = all.filter((_, i) => i % 2 === 1).filter(keep);
  const dealt: RecordFieldSpec[] = [];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    dealt.push(left[i] ?? BLANK);
    if (i < right.length || i < left.length - 1) dealt.push(right[i] ?? BLANK);
  }
  return dealt.map((s) => ({
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

/**
 * The Name a new record shows until it syncs (OCE AutoNumberProvider.generateAutoNumber): the field's display
 * format (`{000000000}` when the metadata has none) with its digits replaced by zeros for the first half and, after
 * that, the last digit of the character codes of the new record's local id read from its end; a trailing `*` marks it temporary.
 * The id is made on the device, so every open of the editor shows a different number.
 */
export function autoNumber(seed: string, format?: string | null): string {
  const template = format || "{000000000}";
  const open = template.indexOf("{");
  const close = template.indexOf("}", open);
  if (open < 0 || close < 0) return `${template}*`;
  const capacity = close - open - 1;
  const zeros = capacity <= 3 ? 0 : Math.floor(capacity / 2);
  const chars = [...seed];
  let digits = "";
  for (let i = 0; i < capacity; i++) {
    if (i > zeros) {
      const c = chars[chars.length - 1 - i];
      digits += c === undefined ? "0" : String(c.codePointAt(0)).slice(-1);
    } else digits += "0";
  }
  return `${template.slice(0, open)}${digits}${template.slice(close + 1)}*`;
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
