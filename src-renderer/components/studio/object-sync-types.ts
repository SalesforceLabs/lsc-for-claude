/**
 * Renderer copy of the Object sync page's data (src/studio/object-sync.ts — keep the two in sync).
 */
import type { ItemEdit, StudioFinding } from "./types";

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
  fields: ObjectSyncField[];
  edit: ItemEdit | undefined;
  soql: string | null;
  findings: StudioFinding[];
}

export interface ObjectSyncOverview {
  org: string;
  rows: ObjectSyncRow[];
  objects: string[];
}

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

export interface FilterCheckResponse {
  org: string;
  results: FilterCheckResult[];
  missing: string[];
}
