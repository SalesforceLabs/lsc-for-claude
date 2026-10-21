/** Result types for Studio's "What changed" page. A renderer copy lives in `drift-types.ts` beside DriftView. */

export interface SnapshotCounts {
  triggerHandlers: number;
  adminSettings: number;
  dbSchema: number;
  actions: number;
}

export interface SnapshotMeta {
  id: string;
  label: string;
  org: string;
  createdAt: string;
  counts: SnapshotCounts;
}

export type ChangeKind = "added" | "removed" | "changed";

export interface DriftFieldChange {
  name: string;
  before: unknown;
  after: unknown;
}

/** One configuration record that differs between a snapshot and the org now. */
export interface DriftChange {
  key: string;
  kind: ChangeKind;
  /** "DbSchema", "QuickAction", an Admin Console category, or "TriggerHandler". */
  category: string;
  developerName: string;
  label?: string;
  featureId: string | null;
  featureTitle: string | null;
  active?: { before?: boolean; after?: boolean };
  fields: DriftFieldChange[];
  assignmentsAdded: string[];
  assignmentsRemoved: string[];
  /** From the live record, when it still exists. */
  modifiedAt?: string;
  modifiedBy?: string;
}

export interface DriftDiff {
  snapshot: SnapshotMeta;
  generatedAt: string;
  changes: DriftChange[];
  counts: { added: number; removed: number; changed: number };
}

export type RecentKind =
  | "config"
  | "triggerHandler"
  | "validationRule"
  | "apexTrigger"
  | "flow"
  | "layout";

export interface RecentChange {
  kind: RecentKind;
  name: string;
  /** Category, object, or other context. */
  detail?: string;
  featureId: string | null;
  featureTitle: string | null;
  modifiedAt: string;
  modifiedBy?: string;
}

export interface RecentChanges {
  days: number;
  changes: RecentChange[];
  /** Sources that couldn't be read, e.g. "Flows: insufficient access". */
  errors: string[];
  /** Sources with more changes in the window than were read (also worded in `errors`). */
  limited?: string[];
}

export interface DriftList {
  org: string;
  snapshots: SnapshotMeta[];
  recent: RecentChanges;
}

export interface DriftSaved {
  snapshot: SnapshotMeta;
}

export interface DriftDeleted {
  deleted: string;
}
