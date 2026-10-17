/**
 * Shared types for LSC Studio — the visual, feature-centric view of an org's
 * LSC configuration rendered by the Electron app.
 *
 * A `FeatureMap` gathers every configuration surface that shapes one LSC
 * feature (custom scripts, validation rules, DB Schema, actions, …) into a
 * single JSON document. The renderer draws it as a board; it is produced by
 * `collectFeatureMap()` and served through the `studio_*` MCP tools.
 *
 * NOTE: the renderer keeps a structural copy of these types in
 * `src-renderer/components/studio/types.ts` — keep the two in sync.
 */

export type Severity = "error" | "warning" | "info";

export interface StudioFinding {
  severity: Severity;
  title: string;
  detail?: string;
  /** One-click changes that resolve the finding (applied only after a preview + confirm). */
  fixes?: StudioFix[];
}

/**
 * A change Studio can preview, apply, and undo. Each carries what the map saw
 * (`from`), so a fix is refused if the org changed since the map was loaded.
 */
export type StudioFix =
  | { kind: "assignPsl"; label: string; userId: string; userName: string; pslId: string; pslLabel: string }
  | {
      kind: "removePsl";
      label: string;
      assignmentId: string;
      userId: string;
      userName: string;
      pslId: string;
      pslLabel: string;
    }
  | {
      kind: "setConfigField";
      label: string;
      category: string;
      developerName: string;
      recordLabel: string;
      field: string;
      from: string | number | null;
      to: string | number | null;
    }
  | { kind: "setActive"; label: string; record: RecordRef; from: boolean; to: boolean }
  | {
      kind: "setProfileAssignments";
      label: string;
      category: string;
      developerName: string;
      recordLabel: string;
      /** Profile names; permission set assignments are left untouched. */
      from: string[];
      to: string[];
    }
  | CreateConfigFix
  | { kind: "deleteConfigRecord"; label: string; category: string; developerName: string; recordLabel: string }
  | { kind: "assignAccess"; label: string; userId: string; userName: string; access: AccessRef }
  | { kind: "removeAccess"; label: string; userId: string; userName: string; access: AccessRef; assignmentId: string }
  | {
      kind: "setCustomScriptCode";
      label: string;
      scriptId: string;
      scriptName: string;
      /** CodeText the map saw — the change is refused if the record's code is no longer this. */
      from: string;
      to: string;
    }
  | {
      kind: "setLayoutRelatedList";
      label: string;
      /** Metadata API name, e.g. "Visit-Visit Layout". */
      layoutName: string;
      layoutLabel: string;
      objectName: string;
      relationshipName: string;
      /** true inserts the related list into the layout; false removes it (the undo). */
      add: boolean;
    };

/** A field value on a new Admin Console record. `dataType` may be left out when it's known for the category or copied. */
export interface ConfigFieldInput {
  name: string;
  value: string | number | boolean | null;
  dataType?: string;
}

/**
 * A new Admin Console record (action, tab, DB Schema, …). Created inactive,
 * filled in, assigned, then activated — undo deletes it.
 */
export interface CreateConfigFix {
  kind: "createConfigRecord";
  label: string;
  category: string;
  developerName: string;
  recordLabel: string;
  /** Copy field values (and their data types) from this record in the same category; `fields` override them. */
  copyFrom?: string;
  fields: ConfigFieldInput[];
  /** Profile names to assign. */
  profiles: string[];
  /** Permission set API names to assign; when copying and left out, the source's are kept. */
  permissionSets?: string[];
  active: boolean;
}

/** Something a user can be given: a permission set, a permission set group, or a territory. */
export interface AccessRef {
  type: "permissionSet" | "permissionSetGroup" | "territory";
  id: string;
  label: string;
}

/** A user's current access, for the inspector's access panel and "Give same access as…". */
export interface UserAccess {
  userId: string;
  licenses: { assignmentId: string; pslId: string; label: string }[];
  access: (AccessRef & { assignmentId: string })[];
}

/** What can be given to a user, for the access panel's pickers. */
export interface AccessOptions {
  permissionSets: AccessRef[];
  permissionSetGroups: AccessRef[];
  /** Territories, labelled with their model; `planning` when the model isn't active. */
  territories: (AccessRef & { model: string; planning: boolean })[];
}

/** A record Studio can switch on or off. */
export type RecordRef =
  | { type: "config"; category: string; developerName: string; label: string }
  | { type: "triggerHandler"; developerName: string; label: string }
  | { type: "validationRule"; id: string; label: string };

/**
 * What the inspector lets an admin edit on an item. Profiles live either in the
 * record's `Profiles` field (actions) or in its Admin Console profile assignments.
 */
export interface ItemEdit {
  record: RecordRef;
  /** Present when the item can be switched on/off — the current value. */
  active?: boolean;
  profiles?: { source: "field"; raw: string } | { source: "assignments"; names: string[] };
}

/** Progress of a "Publish to iPad" mobile metadata cache generation. */
export interface PublishStatus {
  parentId: string;
  state: "running" | "done" | "failed";
  status: string;
  profiles: string[];
  error?: string;
}

export interface FixChange {
  target: string;
  field: string;
  before: string;
  after: string;
  /** Line diff for long text (code); lines are prefixed "+ ", "- ", or "  ", with "…" between hunks. */
  diff?: string[];
}

export interface FixPreview {
  org: string;
  title: string;
  changes: FixChange[];
  warnings: string[];
  /** Set when the fix can't be applied (already done, no capacity, org changed). */
  blocked?: string;
}

export interface FixResult {
  ok: boolean;
  message: string;
  /** The fix that reverses this one. */
  undo?: StudioFix;
}

/**
 * Who an item is assigned to, for Studio's "View as" lens. Items without an
 * audience apply to everyone; empty lists mean the item applies to no one.
 */
export interface Audience {
  profiles: string[];
  permissionSets: string[];
}

/** Item kinds that support a lazy `studio_item_detail` lookup. */
export type DetailKind = "customScript" | "validationRule" | "apexTrigger" | "layout" | "flow";

export interface StudioItem {
  id: string;
  label: string;
  sublabel?: string;
  /** undefined = the surface has no notion of active/inactive. */
  active?: boolean;
  /** Small key/value facts shown in the inspector. */
  properties: Record<string, string | number | boolean | null>;
  /** Source code shown inline (custom scripts). */
  code?: { language: string; text: string };
  /** Set when more detail (formula, trigger body) can be fetched on demand. */
  detailKind?: DetailKind;
  /** Set by surfaces whose items are assigned per profile / permission set. */
  audience?: Audience;
  /** Set when Studio can edit the item (active toggle, profile picker). */
  edit?: ItemEdit;
  /** Set on rows that stand for a profile (or a user's profile), so Studio can offer to check its setup. */
  checkProfile?: string;
  /** Set on users whose permission sets and territories Studio can change. */
  user?: { id: string; name: string };
  findings: StudioFinding[];
}

/**
 * Surface ids are open strings: object-centric features share the standard set
 * (objects, customScripts, dbSchema, …) while org-wide features define their own.
 */
export type SurfaceId = string;

/** Canvas column id a surface is drawn in; titles come from `FeatureMap.lanes`. */
export type Lane = string;

export interface LaneDef {
  id: Lane;
  title: string;
}

export interface StudioSurface {
  id: SurfaceId;
  title: string;
  lane: Lane;
  description: string;
  items: StudioItem[];
  /** Surface-level findings (e.g. "Visit is not synced to mobile"). */
  findings: StudioFinding[];
  /** Set when the surface couldn't be loaded; the rest of the map still renders. */
  error?: string;
  /** Records the admin can add here ("+ New home page action"), prefilled and opened in a form. */
  creates?: CreateConfigFix[];
}

export interface FeatureMap {
  featureId: string;
  title: string;
  org: string;
  collectedAt: string;
  objects: string[];
  /** One-line summary shown under the feature title, e.g. "7 objects". */
  summary: string;
  /** Board columns, left to right. */
  lanes: LaneDef[];
  surfaces: StudioSurface[];
  /** Steps for the profile check; when left out, every surface is a step, in lane order. */
  checklist?: ChecklistStep[];
  /** What the profile check is called, e.g. "iPad readiness". */
  checkTitle?: string;
}

/** One row of the profile check — what the profile gets from a surface. */
export interface ChecklistStep {
  surface: SurfaceId;
  label: string;
  /** Shown when the profile gets none of the surface's items; `{total}` is replaced by the item count. */
  missing?: string;
  /** Offer "Publish to iPad" for the profile when the step is missing. */
  publish?: boolean;
}

export interface FeatureSummary {
  id: string;
  title: string;
  description: string;
  available: boolean;
}

/** A profile the "View as" lens can pick, with its active user count. */
export interface ProfileOption {
  name: string;
  users: number;
}

/** A child object that can be added to the Visit engagement sidebar. */
export interface SidebarCandidate {
  objectName: string;
  relationshipName: string;
}

/** What a Visit page layout shows in the engagement sidebar, and what could be added. */
export interface LayoutSidebar {
  /** Metadata API name, e.g. "Visit-Visit Layout". */
  layoutName: string;
  /** Relationship names already on the layout; null when the layout couldn't be retrieved. */
  relatedLists: string[] | null;
  /** The sidebar holds at most this many related lists. */
  max: number;
  candidates: SidebarCandidate[];
}

export interface ItemDetail {
  kind: DetailKind;
  id: string;
  properties: Record<string, string | number | boolean | null>;
  code?: { language: string; text: string };
  /** Present for Visit page layouts. */
  sidebar?: LayoutSidebar;
  /** Present for flows whose metadata could be read. */
  flow?: FlowOutline;
  /** Health checks that need the heavyweight detail (e.g. a flow's steps). */
  findings?: StudioFinding[];
}

/** One line of a flow's path; `depth` indents decision outcomes, loop bodies, and fault paths. */
export interface FlowStep {
  depth: number;
  kind: "decision" | "outcome" | "loop" | "lookup" | "assign" | "change" | "action" | "error" | "goto" | "path";
  text: string;
}

/** A record-triggered flow, read from its metadata: when it runs, its path, and what it changes. */
export interface FlowOutline {
  object: string | null;
  /** e.g. "After a Visit is saved — when it's created or updated". */
  trigger: string;
  /** Entry conditions; empty when it runs on every save. */
  conditions: string[];
  /** "and", "or", custom logic ("1 AND (2 OR 3)"), or "formula"; null for zero or one condition. */
  conditionLogic: string | null;
  /** Runs only when a record is updated to meet the conditions, not on every save that meets them. */
  onlyWhenChanged: boolean;
  steps: FlowStep[];
  /** Records changed, actions run, and errors raised, in path order. */
  effects: string[];
}
