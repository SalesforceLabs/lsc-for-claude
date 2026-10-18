/**
 * Plain-language reasons a table makes a rep's sync heavy, with a concrete
 * change to propose where one is safe. Pure — Studio's Sync health →
 * Investigate feeds it a table's predicted volume and its DB Schema settings.
 */

import type { TableStatus } from "./sync-volume.js";

export type HintSeverity = "info" | "warning" | "error";

/** One DB Schema field change Studio can queue for the admin to review. */
export interface HintSuggestion {
  /** The DB Schema field to set (WhereSoql, AttachmentsSupport, DeltaDateField). */
  field: "WhereSoql" | "AttachmentsSupport" | "DeltaDateField";
  from: string | null;
  to: string;
  /** What the change does, as a button/tray label, e.g. "Turn off attachments for Task". */
  label: string;
}

export interface TableHint {
  /** Stable key for the rule, e.g. "no-filter". */
  id: string;
  severity: HintSeverity;
  title: string;
  detail: string;
  suggestion?: HintSuggestion;
}

/** The DB Schema settings that decide how a table syncs. */
export interface TableSchemaSettings {
  type?: string | null;
  whereSoql?: string | null;
  oneWaySync?: boolean | null;
  attachmentsSupport?: string | null;
  deltaDateField?: string | null;
  /**
   * Fields that have a value row on the record. A change can only be written
   * to a field with a row, so suggestions for the others become advice.
   * Absent means every field can be changed.
   */
  editable?: string[];
}

export interface ExplainInput {
  sobject: string;
  status: TableStatus;
  records: number;
  deviceRequests: number | null;
  note?: string;
  /** True when an org-wide count may exceed what the user downloads (see mayOvercount). */
  mayOvercount: boolean;
  /** The user's predicted records in this territory across all tables. */
  totalRecords: number;
  /** Absent when no DB Schema record could be matched to the table. */
  schema?: TableSchemaSettings | null;
}

/** A table with this many records and no filter is worth filtering. */
export const NO_FILTER_RECORDS = 10_000;
/** A table this big is heavy whatever its filter. */
export const HEAVY_RECORDS = 50_000;
/** Attachments and delta settings only matter once a table has some volume. */
export const MIN_RECORDS = 1_000;
/** Share of the user's total records at which one table stands out. */
export const DOMINANT_SHARE_PCT = 25;
/** Estimated device requests at which a table's request load is called out. */
export const MANY_REQUESTS = 50;

/**
 * Objects that grow with every interaction and are read for recent history, so
 * a rolling window is a reasonable default. Never proposed for other objects:
 * a date filter on reference data would hide records the rep needs.
 */
const ACTIVITY_LIKE = new Set(["task", "event", "emailmessage"]);
export const ACTIVITY_WINDOW_FILTER = "LastModifiedDate = LAST_N_DAYS:365";

const fmt = (n: number) => n.toLocaleString("en-US");
const present = (v: string | null | undefined) => (v ?? "").trim() !== "";

/** Whether an AttachmentsSupport value downloads files; empty is the app's "none". */
export function attachmentsOn(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  return v !== "" && !/^(none|false|no)$/i.test(v);
}

/** Keep a suggestion only when its field can be written; otherwise point the admin to Setup. */
function withSuggestion(
  schema: TableSchemaSettings | null,
  suggestion: HintSuggestion,
  detail: string
): { detail: string; suggestion?: HintSuggestion } {
  if (schema?.editable && !schema.editable.includes(suggestion.field)) {
    return { detail: `${detail} The record has no ${suggestion.field} value to change from here, so set it in Setup.` };
  }
  return { detail, suggestion };
}

export function sharePct(records: number, totalRecords: number): number {
  return totalRecords > 0 ? (records / totalRecords) * 100 : 0;
}

/** Why this table is heavy (or why it couldn't be sized), most important first. */
export function explainTable(t: ExplainInput): TableHint[] {
  const hints: TableHint[] = [];
  const schema = t.schema ?? null;

  if (t.status === "error") {
    hints.push({
      id: "filter-failed",
      severity: "error",
      title: "The filter fails for this user",
      detail: `${t.note ? `${t.note} ` : ""}The same filter will fail on the iPad, so ${t.sobject} may not sync at all. Open the DB Schema record and fix the WhereSoql.`,
    });
    return hints;
  }
  if (t.status === "not-estimated") {
    hints.push({
      id: "not-estimated",
      severity: "info",
      title: "Size can't be predicted",
      detail: `${t.note ? `${t.note}. ` : ""}Studio can't count this table ahead of time, so it isn't in the totals. A first-sync replay measures it for real.`,
    });
    return hints;
  }

  const share = sharePct(t.records, t.totalRecords);
  const filtered = present(schema?.whereSoql);
  const activity = ACTIVITY_LIKE.has(t.sobject.toLowerCase());

  if (schema && !filtered && t.records >= NO_FILTER_RECORDS) {
    const detail = `${t.sobject} has no filter, so all ${fmt(t.records)} records go to the iPad.${
      activity
        ? " Activity history older than a year rarely matters in the field; a rolling window keeps recent records and drops the rest from the iPad."
        : " Add a WhereSoql filter that keeps only what the rep needs, for example records for their accounts or territory."
    }`;
    hints.push({
      id: "no-filter",
      severity: "warning",
      title: "Syncs every record the rep can see",
      ...(activity
        ? withSuggestion(
            schema,
            { field: "WhereSoql", from: null, to: ACTIVITY_WINDOW_FILTER, label: `Only sync the last year of ${t.sobject} records` },
            detail
          )
        : { detail }),
    });
  }

  if (t.records >= HEAVY_RECORDS) {
    hints.push({
      id: "large-table",
      severity: "warning",
      title: `${fmt(t.records)} records`,
      detail: `Tables this large dominate first-sync time and device storage.${filtered ? " Consider a tighter filter." : ""}`,
    });
  }

  if (t.totalRecords >= MIN_RECORDS && share >= DOMINANT_SHARE_PCT) {
    hints.push({
      id: "dominant-share",
      severity: "info",
      title: `${Math.round(share)}% of this rep's sync`,
      detail: `${t.sobject} is ${fmt(t.records)} of the rep's ${fmt(t.totalRecords)} predicted records. Trimming it helps more than anything else in the list.`,
    });
  }

  if (schema && attachmentsOn(schema.attachmentsSupport) && t.records >= MIN_RECORDS) {
    hints.push({
      id: "attachments-on",
      severity: "warning",
      title: "Files and attachments download too",
      // The picklist's off value is empty, as the app and the DB Schema tools treat it.
      ...withSuggestion(
        schema,
        { field: "AttachmentsSupport", from: schema.attachmentsSupport ?? null, to: "", label: `Turn off attachments for ${t.sobject}` },
        `Attachments are on for ${t.sobject}, so each of its ${fmt(t.records)} records can bring files with it. Turning it off stops the files downloading; reps can no longer open them offline.`
      ),
    });
  }

  if (schema && !present(schema.deltaDateField) && t.records >= MIN_RECORDS && (schema.type ?? "").toUpperCase() !== "CONFIGURATION") {
    hints.push({
      id: "no-delta-field",
      severity: "info",
      title: "No date field for delta sync",
      ...withSuggestion(
        schema,
        { field: "DeltaDateField", from: schema.deltaDateField ?? null, to: "LastModifiedDate", label: `Delta sync ${t.sobject} by LastModifiedDate` },
        `Without a delta date field, later syncs can't ask for only what changed, so ${t.sobject} may be re-checked in full each time.`
      ),
    });
  }

  if (t.mayOvercount) {
    hints.push({
      id: "may-overcount",
      severity: "info",
      title: "Count may be higher than the rep's",
      detail: `The filter doesn't narrow ${t.sobject} to this user and the object's sharing is restricted, so the count shows what an admin can see. The rep downloads this many or fewer.`,
    });
  }

  if (t.deviceRequests !== null && t.deviceRequests >= MANY_REQUESTS) {
    hints.push({
      id: "many-requests",
      severity: "info",
      title: `About ${fmt(t.deviceRequests)} requests`,
      detail: "Large id lists are split into many small queries, which is slow on weak networks.",
    });
  }

  return hints;
}
