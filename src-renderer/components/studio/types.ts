// Structural copy of src/studio/types.ts — the renderer bundle cannot import from src/. Keep in sync.
import type { AssignCustomScriptFix, CreateCustomScriptFix, DeleteCustomScriptFix, SaveCustomScriptFix } from "./scripts/script-types";

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
  | CreateCustomScriptFix
  | SaveCustomScriptFix
  | DeleteCustomScriptFix
  | AssignCustomScriptFix
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
    }
  | EditMetadataFix
  | CopyForProfileFix;

/** A page layout field's behavior. */
export type FieldBehavior = "Edit" | "Required" | "Readonly";

/** A layout section by its label as written in the XML and which of the sections with that label it is. */
export interface SectionRef {
  label: string;
  nth: number;
}

/** A place in a layout column: before the field `before`, or at the end; `at` (a row index) is set by undo. */
export interface FieldSlot {
  section: SectionRef;
  /** Column index in the XML. */
  column: number;
  before: string | null;
  at?: number;
}

/** One edit to a page layout. Removes carry the removed XML when they're an undo. */
export type LayoutOp =
  | { op: "moveField"; field: string; to: FieldSlot }
  | { op: "removeField"; field: string }
  | { op: "addField"; field: string; behavior: FieldBehavior; to: FieldSlot; xml?: string }
  | { op: "setFieldBehavior"; field: string; from: FieldBehavior; to: FieldBehavior }
  | { op: "moveSection"; section: SectionRef; before: SectionRef | null }
  | { op: "removeSection"; section: SectionRef }
  | { op: "addSection"; xml: string; before: SectionRef | null }
  | { op: "setSectionHeading"; section: SectionRef; from: boolean; to: boolean }
  | { op: "moveRelatedList"; relatedList: string; before: string | null }
  | { op: "removeRelatedList"; relatedList: string }
  | { op: "addRelatedList"; relatedList: string; before: string | null; xml?: string; object?: string }
  // Mobile & Lightning Actions: the Draft model doesn't draw these, they pass through to the server untouched.
  | { op: "addAction"; action: string; before: string | null; actionType?: string }
  | { op: "removeAction"; action: string; dropList?: boolean };

/** One edit to a compact layout's fields (the record header). `before` is the field it goes in front of, or null for the end. */
export type CompactOp =
  | { op: "moveCompactField"; field: string; before: string | null }
  | { op: "removeCompactField"; field: string }
  | { op: "addCompactField"; field: string; before: string | null };

/** One filter row of a list view: the field, the operation word the Metadata API uses and the raw value. */
export interface ListViewFilter {
  field: string;
  operation: string;
  value: string;
}

/**
 * One edit to a list view's XML. Columns are found by the id the view stores
 * (an API name, or a legacy id like `ACCOUNT.NAME` on standard objects). `before` is the column
 * it goes in front of, or null for the end. The filter ops carry what they replace so a view
 * that changed in Setup since is noticed.
 */
export type ListViewOp =
  | { op: "moveListColumn"; column: string; before: string | null }
  | { op: "removeListColumn"; column: string }
  | { op: "addListColumn"; column: string; before: string | null }
  | { op: "setListFilterScope"; from: string | null; to: string }
  | { op: "setListFilters"; from: ListViewFilter[]; to: ListViewFilter[]; fromLogic: string | null; toLogic: string | null };

export interface MetadataDocRef {
  type: "Layout" | "CompactLayout" | "FlexiPage" | "ListView" | "CustomApplication";
  /** Metadata API name, e.g. "Account-Account Layout", "Account.LSC_Account_Compact" or a Lightning page's developer name. */
  fullName: string;
  label: string;
}

/** One item of a Lightning page region or facet: by `identifier` when it has one, else by index; `component` is checked. */
export interface FlexiItemRef {
  component: string;
  identifier: string | null;
  index: number;
}

/** A component (or record tab) on a Lightning page: the region or facet it's in, by XML name, and the item. */
export interface FlexiComponentRef {
  region: string;
  item: FlexiItemRef;
}

/** A Lightning page property Studio can set from the preview. */
export type FlexiPageProperty = string;

/** One edit to a Lightning page (src/studio/metadata/flexipage-ops.ts). */
export type FlexiPageOp =
  | { op: "moveComponent"; component: FlexiComponentRef; before: FlexiItemRef | null }
  | { op: "removeComponent"; component: FlexiComponentRef }
  | {
      op: "addComponent";
      region: string;
      before: FlexiItemRef | null;
      component: string;
      identifier: string | null;
      properties?: { name: string; value: string }[];
      xml?: string;
      facets?: { xml: string; at: number }[];
    }
  | { op: "setComponentProperty"; component: FlexiComponentRef; property: FlexiPageProperty; from: string | null; to: string | null };

/**
 * One edit to the tab bar of a Lightning app (a CustomApplication's `<tabs>`; for an app installed from a
 * package its `<subscriberTabs>`, the part the subscriber may change). Tabs are found by name
 * (`standard-Account`, `lsc4ce__Planner`, `Foo__c`). `before` is the tab it goes in front of, or null for the end.
 */
export type AppOp =
  | { op: "moveAppTab"; tab: string; before: string | null }
  | { op: "removeAppTab"; tab: string }
  | { op: "addAppTab"; tab: string; before: string | null };

export type MetadataOp = LayoutOp | CompactOp | FlexiPageOp | ListViewOp | AppOp;

/** A Lightning page item as it is in the org now. */
export interface LiveFlexiItem {
  component: string;
  identifier: string | null;
  properties: Record<string, string>;
  /** Facet regions its properties name (a tabset's `tabs`, a tab's `body`). */
  facets: string[];
}

/** A Lightning page as it is in the org now, for lining the published preview up before editing. */
export interface LiveFlexiPage {
  type: "FlexiPage";
  fullName: string;
  label: string;
  pageType: string;
  template: string;
  sobjectType: string | null;
  regions: { name: string; facet: boolean; items: LiveFlexiItem[] }[];
  /** Profiles the page is assigned to in an app; null when that couldn't be read. */
  profiles: string[] | null;
  /** Apps whose default page this is; null when that couldn't be read. */
  appDefaults: string[] | null;
  /** Who gets the page is still being worked out (reading every app takes a while in big orgs); `studio_page_reach` waits for it. */
  reachPending?: boolean;
  /** Installed from a managed package — it can't be deployed. */
  managed: boolean;
  production: boolean;
}

/** One component "Insert component…" offers (src/studio/component-catalog.ts). */
export interface CatalogEntry {
  key: string;
  component: string;
  label: string;
  group: "Standard" | "Inline LWC" | "Related list";
  pages: ("HomePage" | "RecordPage")[];
  properties: { name: string; value: string }[];
  insertable: boolean;
  needs?: string;
  object?: string;
}

export interface ComponentCatalog {
  entries: CatalogEntry[];
  setupPath: string;
}

/** A page layout as it is in the org now, for lining the published preview up before editing. */
export interface LiveLayout {
  type: "Layout";
  fullName: string;
  sections: { label: string; nth: number; heading: boolean; columns: { field: string; behavior: FieldBehavior }[][] }[];
  relatedLists: string[];
  /** Profiles assigned the layout; null when that couldn't be read. */
  profiles: string[] | null;
  production: boolean;
  /** The object's fields the layout could show but doesn't (readable; no system fields or compound parts), by label; null when the object couldn't be described. */
  available: LayoutFieldOption[] | null;
  /** Related lists the layout could show but doesn't: the object's child relationships; null when the object couldn't be described. */
  availableRelated: RelatedListOption[] | null;
  /** The fields the layout does show, from the describe (label and type), so Draft can draw what was added in Setup since the last publish; null when the object couldn't be described. */
  placed?: LayoutFieldOption[] | null;
}

export interface LayoutFieldOption {
  field: string;
  label: string;
  /** The describe type, e.g. "string", "picklist", "reference". */
  type: string;
}

export interface RelatedListOption {
  /** The name the layout's XML uses: the relationship name, or Child.Field for custom children and lookups. */
  relatedList: string;
  /** The child object. */
  object: string;
}

/**
 * Edits to one metadata document, deployed together. Each op is checked against
 * the document as retrieved; undo is the reversed inverse ops.
 */
export type EditMetadataFix = LayoutEditFix | CompactLayoutEditFix | FlexiPageEditFix | ListViewEditFix | AppEditFix;

/**
 * "Make a copy just for this profile": clone a page layout or Lightning page under a new
 * name and point only `profile` at the copy (its layout assignments, or its
 * CustomApplication page overrides). `ops` are the edits made to the copy: the tray keeps them here
 * (not as an edit of the source) while the profile's draft is shown. Undo is the same fix with
 * `revert`: point the profile back at the source, then delete the copy.
 */
export interface CopyForProfileFix {
  kind: "copyForProfile";
  label: string;
  /** The shared document being copied. */
  doc: MetadataDocRef & { type: "Layout" | "FlexiPage" };
  copy: { fullName: string; label: string };
  /** The profile's name as Profile.Name has it ("LS Rep", "System Administrator"). */
  profile: string;
  ops?: (LayoutOp | FlexiPageOp)[];
  /** Set on an undo: the assignments to put back (what the apply moved). */
  revert?: { moves: CopyMove[] };
}

/** One assignment a copy moved the profile to: a layout's record type, or an app's page override. */
export interface CopyMove {
  /** Layout: the record type ("Account.HCP"), null for the object's default. */
  recordType?: string | null;
  /** Lightning page: the CustomApplication's name. */
  app?: string;
  /** Lightning page: the profile had no override of its own there, so one was added (undo removes it). */
  added?: boolean;
}

export interface LayoutEditFix {
  kind: "editMetadata";
  label: string;
  doc: MetadataDocRef & { type: "Layout" };
  ops: LayoutOp[];
}

export interface AppEditFix {
  kind: "editMetadata";
  label: string;
  doc: MetadataDocRef & { type: "CustomApplication" };
  ops: AppOp[];
}

/** A tab the app could take: from the org's tab describe. */
export interface AppTabOption {
  name: string;
  label: string;
  /** "object" (a standard or custom object's tab) or "page" (Lightning page, Visualforce, web, Aura), for the picker's detail line. */
  kind: "object" | "page";
}

/** A Lightning app's tab bar as it is in the org now, for lining the published tab bar up before editing. */
export interface LiveApp {
  type: "CustomApplication";
  fullName: string;
  label: string;
  /** Installed from a package: the package's own tabs are fixed and only `subscriberTabs` can change. */
  installed: boolean;
  /** The tabs that can be arranged, in order. */
  tabs: string[];
  /** The package's own tabs, which stay where they are (installed apps only). */
  fixedTabs: string[];
  /** Tabs that could be added, from the org's tab describe; empty when it couldn't be read. */
  available: AppTabOption[];
  /** Profiles that can open the app; null when that couldn't be read. */
  profiles: string[] | null;
  production: boolean;
}

export interface ListViewEditFix {
  kind: "editMetadata";
  label: string;
  doc: MetadataDocRef & { type: "ListView" };
  ops: ListViewOp[];
}

export interface CompactLayoutEditFix {
  kind: "editMetadata";
  label: string;
  doc: MetadataDocRef & { type: "CompactLayout" };
  ops: CompactOp[];
}

export interface FlexiPageEditFix {
  kind: "editMetadata";
  label: string;
  doc: MetadataDocRef & { type: "FlexiPage" };
  ops: FlexiPageOp[];
}

/**
 * A list view as it is in the org now, for lining the published columns up before editing.
 * The metadata has no sort element, so sort isn't here (and isn't editable).
 */
export interface LiveListView {
  type: "ListView";
  fullName: string;
  label: string;
  /** Column ids as the view stores them, in order. */
  columns: string[];
  /** Everything, Mine, Team, MyTerritory…; null when the view has none. */
  filterScope: string | null;
  filters: ListViewFilter[];
  /** "1 AND (2 OR 3)"; null when the view has no logic. */
  booleanFilter: string | null;
  /** Who it's shared with: all users when null, else the groups and roles. */
  sharedTo: { kind: string; name: string }[] | null;
  /** Fields that can be added as columns, from the object's describe; empty when it couldn't be read. */
  available: { name: string; label: string; type: string; filterable: boolean }[];
  /** Installed from a managed package, so it can't be changed. */
  managed: boolean;
  production: boolean;
}

/** A compact layout as it is in the org now, for lining the published record header up before editing. */
export interface LiveCompactLayout {
  type: "CompactLayout";
  fullName: string;
  label: string;
  /** API names, in order. */
  fields: string[];
  /** Fields that can go on a compact layout, from the object's describe; empty when it couldn't be read. */
  available: { name: string; label: string; type: string }[];
  /** Record types assigned it ("Master" when it's the object's default); null when that couldn't be read. */
  recordTypes: string[] | null;
  production: boolean;
}

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
  /** Lists cut at the server's cap, with how many exist — find the rest by name. */
  truncated?: Partial<Record<"permissionSets" | "permissionSetGroups" | "territories", { listed: number; total: number }>>;
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
  /** The org is a production org (metadata deploys ask for an extra confirmation). */
  production?: boolean;
  /** A Lightning page whose reach wasn't worked out (every app has to be read); the review dialog offers `studio_page_reach` on request. */
  reachPage?: string;
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

/**
 * Readiness stages, in the order an admin works through them: is the feature
 * switched on, can the right people use it, is its data in place, are its
 * settings and rules right, and does it reach the iPad.
 */
export type ReadinessStage = "enabled" | "access" | "data" | "config" | "mobile";

/**
 * pass / fail — the check ran. unknown — it couldn't run (query failed, object
 * missing). skipped — not applicable, or a check it depends on failed.
 */
export type ReadinessStatus = "pass" | "fail" | "unknown" | "skipped";

/** One readiness check: a rule from knowledge/validation-rules or a Studio check. */
export interface ReadinessCheck {
  /** Rule id (e.g. "sample-001") or a Studio check id (e.g. "visit.data.current-period"). */
  id: string;
  stage: ReadinessStage;
  title: string;
  status: ReadinessStatus;
  /** How bad a failure is — error blocks the feature, warning should be fixed, info is best practice. */
  severity: Severity;
  /** What Studio found, e.g. "0 active sample products". */
  detail?: string;
  /** Why it matters, in a sentence or two. */
  why?: string;
  /** How to fix it by hand. */
  steps?: string[];
  /** Where to go in Salesforce, e.g. "Admin Console > Mobile > DB Schema". */
  uiPath?: string;
  /** Board surface that shows the records this check is about. */
  surface?: SurfaceId;
  /** One-click changes that resolve it (queued, previewed, then applied). */
  fixes?: StudioFix[];
  /** A few of the records that failed, labelled for people. */
  examples?: string[];
  /** "rule" = knowledge/validation-rules YAML, "studio" = a TypeScript check. */
  source: "rule" | "studio";
}

/** Every readiness check for one feature, from `studio_readiness`. */
export interface FeatureReadiness {
  featureId: string;
  title: string;
  org: string;
  collectedAt: string;
  checks: ReadinessCheck[];
}
