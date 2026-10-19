/**
 * Types for the custom script test runner: a Node `vm` simulation of the LSC
 * custom script runtime (`record`, `user`, `db`, `env` and the condition
 * classes), run as the connected admin against a real org with read-only SOQL.
 */

export type ScriptType = "Validation" | "Checklist" | "VisitActionValidation";
export type Platform = "web" | "ipad";
export type Row = Record<string, unknown>;

export interface ScriptTestRequest {
  code: string;
  type: ScriptType;
  recordId?: string;
  objectName?: string | null;
  operationEventType?: string | null;
  platform: Platform;
  env?: { actionName?: string; fromStatus?: string; toStatus?: string; fieldName?: string };
  userId?: string;
}

export type ScriptOutcome = "pass" | "warn" | "block" | "none";

export interface ScriptLogLine {
  level: "log" | "warn" | "error";
  text: string;
  /** Milliseconds since the run started. */
  at: number;
}

export interface ScriptQueryLog {
  object: string;
  soql: string;
  rows: number;
  ms: number;
  error?: string;
}

/** A write the script asked for (`setValue`, `save`). Recorded, never sent to the org. */
export interface ScriptRecordedWrite {
  target: string;
  action: "setValue" | "save";
  field?: string;
  value?: unknown;
}

export interface ScriptTestResult {
  /** Ran to completion and returned the contract shape. */
  ok: boolean;
  results: { title: string; status: "success" | "warning" | "error" | string }[];
  /** How the app would treat it (block = an error result for Validation / VAV). */
  outcome: ScriptOutcome;
  logs: ScriptLogLine[];
  queries: ScriptQueryLog[];
  error?: { message: string; line?: number; column?: number; stack?: string };
  /** Problems with what came back: not an array, unresolved promise, Proxy-unsafe values, unknown status. */
  contract: string[];
  durationMs: number;
  /** What the simulation can't reproduce. */
  notes: string[];
  /** `setValue` / `save` calls the script made (not applied). */
  recorded?: ScriptRecordedWrite[];
}

export interface DescribeInfo {
  name: string;
  fields: { name: string; type: string }[];
}

/** What the runner needs from an org. All reads. */
export interface OrgReader {
  /** Rows for a SOQL query. Throws with the org's message when the query is invalid. */
  query(soql: string): Promise<Row[]>;
  /** Null when the object doesn't exist (or isn't visible). */
  describe(object: string): Promise<DescribeInfo | null>;
  /** The LSC managed-package namespace (e.g. "lsc4ce") when installed in the org. */
  namespace(): Promise<string | null>;
  /** The user the script's `user` global is built from (the connected admin when no id). */
  user(userId?: string): Promise<Row | null>;
}

/** A recent record the panel can run a script against. */
export interface ScriptTestRecord {
  id: string;
  objectName: string;
  name: string;
  accountName: string | null;
  /** ISO date-time the record is planned for, when it has one. */
  date: string | null;
  status: string | null;
  /** Child counts for visits (samples, details, ...). Empty for workflow records. */
  children: { object: string; label: string; count: number }[];
}

export interface ScriptTestRecordsRequest {
  type: ScriptType;
  objectName?: string | null;
  search?: string;
}

export interface ScriptTestRecordsResult {
  objectName: string;
  records: ScriptTestRecord[];
  notes: string[];
}

/** Limits, shared by code, notes and tests. */
export const RUN_LIMITS = {
  cpuMs: 5_000,
  totalMs: 20_000,
  rowsPerQuery: 500,
  maxQueries: 40,
  maxPasses: 12,
  maxFields: 200,
} as const;
