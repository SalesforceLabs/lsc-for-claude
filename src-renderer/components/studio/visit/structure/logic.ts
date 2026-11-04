import type { RecordFieldSpec } from "../../published-types";
import type { VisitStructure } from "./types";

/** Pure rules of the Visit Engagement shell (lifesciences-ios module/Visit/Visit). */

/** Fields the header never draws (Header/VisitHeaderViewModel hidden list). */
const ALWAYS_HIDDEN = new Set([
  "visitid",
  "nextprovidervisitobjective",
  "nextprvdvisitobjectivetype",
  "preprovidervisitnotes",
]);

/** The header fields to draw, in order: Account, Place, Planned start and end first, then the layout's. */
export function headerFields(
  fields: RecordFieldSpec[],
  opts: { organisation: boolean; isNew: boolean }
): RecordFieldSpec[] {
  const hidden = (n: string): boolean =>
    ALWAYS_HIDDEN.has(n.toLowerCase()) || (opts.organisation && n === "ParentOrganizationId");
  const first = ["AccountId", "PlaceId", "PlannedVisitStartTime", "PlannedVisitEndTime"];
  const rest = fields.filter(
    (f) => f.type === "blank" || (!first.includes(f.name) && !hidden(f.name))
  );
  const lead = first
    .map((n) => fields.find((f) => f.name === n))
    .filter((f): f is RecordFieldSpec => !!f)
    .map((f) =>
      f.name === "AccountId" || f.name === "PlaceId" || f.name.startsWith("Planned")
        ? { ...f, required: true }
        : f
    );
  // RecordTypeId is only offered when creating.
  return [...lead, ...rest.filter((f) => opts.isNew || f.name !== "RecordTypeId")];
}

/** Read-only header fields (Status, Territory) and the ones locked once the visit is signed. */
export function fieldLocked(name: string, signed: boolean): boolean {
  if (name === "Status" || name === "TerritoryId") return true;
  return signed && (name === "AccountId" || name === "PlaceId" || name === "RecordTypeId");
}

/** Visit record type names an account of `accountRecordType` may use; every one when the org has no mapping. */
export function recordTypeOptions(
  map: VisitStructure["recordTypeMap"] | undefined,
  accountRecordType: string | null | undefined,
  all: string[]
): string[] {
  if (!map?.length) return all;
  const names = map
    .filter((m) => !accountRecordType || m.accountRecordType === accountRecordType)
    .map((m) => m.visitRecordType)
    .filter((n) => all.includes(n));
  return names.length ? [...new Set(names)] : all;
}

/** End time = start + the default duration. */
export function endFromStart(start: Date, minutes: number): Date {
  return new Date(start.getTime() + minutes * 60_000);
}

/** SignatureRequirementLevel as the org spells it (None / Optional / Required) to 0..2; unset reads as not required. */
export function levelRank(level: string | undefined): number {
  const k = (level ?? "").replace(/[\s_-]/g, "").toLowerCase();
  return k === "required" || k === "mandatory" ? 2 : k === "optional" ? 1 : 0;
}

export const isCompleted = (status: string | undefined): boolean =>
  /^(completed|submitted)$/i.test((status ?? "").trim());

/** Which nav bar buttons show (VisitEditorView toolbar). */
export function navState(o: {
  isNew: boolean;
  status?: string;
  remote: boolean;
  child: boolean;
  showDocumentId: boolean;
  /** Strictest product SignatureRequirementLevel (strictestSignatureLevel). */
  level?: string;
  signed?: boolean;
}): {
  leftLabel: "Cancel" | "Close";
  title: string;
  getSignature: boolean;
  startRemote: boolean;
  documentId: boolean;
  signEnabled: boolean;
  submitEnabled: boolean;
} {
  const done = isCompleted(o.status);
  return {
    leftLabel: o.isNew ? "Cancel" : "Close",
    title: o.child ? "Attendee Visit Engagement" : "Visit Engagement",
    getSignature: !done && !o.child,
    startRemote: o.remote && !done,
    documentId: o.showDocumentId && !done,
    // VisitEditorToolbarView / VisitEngine+SignatureRequirement: no products means notRequired.
    signEnabled: !o.signed && levelRank(o.level) !== 0,
    submitEnabled: !!o.signed || levelRank(o.level) !== 2,
  };
}

/** Compliance statements still unticked that the visit requires. */
export function missingCompliance(
  defs: VisitStructure["compliance"] | undefined,
  ticks: Record<string, boolean>
): string[] {
  return (defs ?? []).filter((d) => d.required && !ticks[d.id]).map((d) => d.label);
}

/** Attendee details copied from the first attendee onto the rest ("Copy Details"): header values, never identity. */
const NOT_COPIED = new Set(["Id", "AccountId", "PlaceId", "Name", "ParentVisitId"]);
export function copyDetails(
  from: Record<string, string>,
  to: Record<string, string>
): Record<string, string> {
  const out = { ...to };
  for (const [k, v] of Object.entries(from)) if (!NOT_COPIED.has(k)) out[k] = v;
  return out;
}
