import type { PublishedReportData } from "./report-types";
import type { PublishedScreens } from "./screens/types";

// Structural copy of the snapshot types in src/studio/published.ts — the renderer bundle cannot import from src/. Keep in sync.

/** What a nav tab opens on the iPad (CoordinatorFactory.createCoordinatorFor). */
export type TabKind =
  | "home"
  | "calendar"
  | "accounts"
  | "content"
  | "myTeam"
  | "activityPlanReview"
  | "compliance"
  | "reports"
  | "salesData"
  | "dashboards"
  | "tableau"
  | "insights"
  | "object"
  | "flexiPage"
  | "empty"
  | "recent";

export interface PublishedTab {
  fullName: string;
  label: string;
  kind: TabKind;
  sobject?: string;
  flexiPage?: string;
  /** Why an "empty" tab opens the app's "Coming soon" screen, and what would fix it. */
  emptyReason?: string;
}

export interface HiddenTab {
  fullName: string;
  label: string;
  reason: string;
}

export interface PublishedComponent {
  name: string;
  label: string;
  /** False when the iPad has no renderer for it — the app skips it silently. */
  supported: boolean;
  halfWidth: boolean;
  /** "hidden" / "conditional" from the component's visibility rule. */
  visibility: "shown" | "hidden" | "conditional";
  visibilityNote?: string;
  properties: Record<string, string>;
  /** force:highlightsPanel's dynamic actions (`actionNames`), in order. */
  actions?: string[];
  /** flexipage:tabset children. */
  tabs?: { title: string; active: boolean; components: PublishedComponent[] }[];
}

export interface PublishedPage {
  name: string;
  label: string;
  type: string;
  template: string;
  regions: { name: string; components: PublishedComponent[] }[];
  /** Regions the template has no slot for on iPad — never rendered. */
  droppedRegions: { name: string; components: string[] }[];
}

/** A layout item as the cache describes it (src/studio/screens/record-fields.ts). */
export interface RecordFieldSpec {
  name: string;
  label: string;
  type: string;
  ref?: string[];
  picklist?: Record<string, string>;
  /** The layout marks it Required / Readonly (create forms). */
  required?: boolean;
  readOnly?: boolean;
}

export interface PublishedLayout {
  name: string;
  sections: { label: string | null; columns: string[][]; fields?: RecordFieldSpec[][] }[];
  relatedLists: { name: string; label: string; columns?: RecordFieldSpec[] }[];
  actions: string[];
  actionItems?: { name: string; label: string; type: string; sortOrder: string }[];
}

export interface PublishedRecordType {
  name: string;
  label: string;
  layout: string | null;
  flexiPage: string | null;
  compactLayout: string | null;
  /** The picklist value each field starts with on a new record of this type. */
  picklistDefaults?: Record<string, string>;
  /** What `multiEntityRecordView` stacks for this record type: layouts in order, or the error it shows instead. */
  multiEntity?: { layouts: string[]; note?: string; error?: string };
}

export interface PublishedObject {
  name: string;
  label: string;
  labelPlural: string;
  recordTypes: PublishedRecordType[];
  /** Used when a record has no record type. */
  defaultCompactLayout: string | null;
  listViews: { name: string; label: string; columns: string[]; /** How to read its rows: a field type per column (null when the app drops it). */ query?: { fields: ({ path: string; type: string } | null)[] } }[];
  defaultListView: string | null;
  /** List views shared only with roles, groups, or territories the viewer isn't in. */
  hiddenListViews?: { label: string; reason: string }[];
  /** MetadataThemeInfo: the circle color and the SLDS glyph drawn on it. */
  theme?: { color: string; iconUrl: string };
}

export interface PublishedIpad {
  profile: string;
  cache: { recordId: string; name: string; contentVersionId: string; generatedAt: string; sizeBytes: number | null };
  tabs: PublishedTab[];
  hiddenTabs: HiddenTab[];
  home: PublishedPage | null;
  objects: Record<string, PublishedObject>;
  layouts: Record<string, PublishedLayout>;
  pages: Record<string, PublishedPage>;
  compactLayouts: Record<string, string[]>;
  compactFields?: Record<string, RecordFieldSpec[]>;
  notes: string[];
  /** The user whose permission sets were merged in; null when the profile has no active users. */
  viewer: { userId: string; name: string; permissionSets: string[] } | null;
  /** Active users on the profile, for picking whose iPad to preview. */
  users: { id: string; name: string }[];
  /** Active users on the profile; more than `users` lists when `usersTruncated`. */
  usersTotal?: number;
  /** `users` is only the most recently active few; others are found by name. */
  usersTruncated?: boolean;
  /** Dashboards the pages' `embeddedDashboard` components show, by developer name. */
  dashboards: Record<string, PublishedDashboard>;
  /** Custom settings from the cache's `config.json` (absent in snapshots saved before they were read). */
  settings?: { reports: { salesChart: boolean; salesforceReports: boolean } };
  /** The Reports tab's tree as the viewer sees it; absent without a Reports tab. */
  reports?: PublishedReportItem[];
  /** Object tabs' list view records as `Object.ListName` → data; absent when they couldn't be read. */
  lists?: Record<string, PublishedListData>;
  /** Why a list view has no data (`Object.ListName` → note). */
  listErrors?: Record<string, string>;
  /** `db.json`: the tables the app downloads, as object → DB Schema WhereSoql ("" = every record the user can read). */
  sync?: Record<string, string>;
  /** Native screens (Intelligent Content, Accounts, Planner, Tableau) as the viewer's iPad draws them, read live. */
  screens?: PublishedScreens;
  /** Records the list views open, read live (src/studio/screens/record.ts). */
  records?: PublishedRecords;
  /** What the live reads couldn't read in full (too many rows, too slow); absent when everything was read. */
  dataNotes?: string[];
}

export interface PublishedRelated {
  key: string;
  /** The flexipage `relatedListApiName` (child relationship name) that shows it. */
  api: string;
  label: string;
  object: string;
  count: number;
  columns: { label: string; type: string }[];
  rows: { id: string; cells: string[] }[];
  canCreate?: boolean;
}

export interface PublishedFieldMeta {
  label: string;
  hidden?: boolean;
  help?: boolean;
}

export interface PublishedInlineCard {
  title: string;
  object: string;
  cells: { label: string; field: string; half: boolean }[];
}

/** Offline check of an inline LWC against the iPad's network shunt (src/studio/screens/inline-lwc.ts). */
export interface InlineLwcCheck {
  issues: { severity: "online" | "gated"; kind: "apex" | "adapter" | "graphql" | "network" | "component"; detail: string; bundle?: string }[];
  bundles: string[];
}

export interface PublishedRecordData {
  id: string;
  object: string;
  recordType: string | null;
  title: string;
  values: Record<string, Record<string, string>>;
  linked?: { object: string; id: string };
  editable: boolean;
  related: Record<string, PublishedRelated>;
  expenses?: { count: number; total: string };
  dashboard?: PublishedDashboard;
  /** Inquiry stage path: the Status picklist's active labels in order, and the current one. */
  stagePath?: { steps: string[]; current: string };
  /** Account Ratings tab cards; `cards` is null when the org doesn't expose the rating layout entities. */
  ratings?: PublishedRatings;
}

export interface PublishedRatings {
  layout: string;
  cards: { tab: "General" | "Product" | "Territory"; title: string; value: string; editable: boolean; updated: string; live: boolean }[] | null;
}

export interface PublishedDashboard {
  summary: { generated: string; sections: { title: string; items: string[] }[] } | null;
  overview: { target: boolean; specialties: { label: string; primary: boolean }[] };
  nba: { week: string; items: { id: string; title: string; type: string; due: string; status: string }[] };
  map: { address: string; license: "validated" | "notValidated" | "disabled"; geo?: [number, number] };
}

export interface PublishedRecords {
  byId: Record<string, PublishedRecordData>;
  themes: Record<string, { color: string; iconUrl: string }>;
  inline: Record<string, PublishedInlineCard>;
  inlineChecks?: Record<string, InlineLwcCheck>;
  fields: Record<string, Record<string, PublishedFieldMeta>>;
}

/** A list view's records as the viewer's iPad lists them: its count chip and first page. */
export interface PublishedListData {
  count: number;
  rows: { id: string; cells: string[] }[];
}

/** MultiReportItem: a top-level section, a subfolder, or a report. */
export interface PublishedReportItem {
  kind: "section" | "folder" | "report";
  title: string;
  description?: string;
  /** Summary and tabular reports open natively, the rest on the web. */
  native?: boolean;
  /** Report Id, format, and its result when run read-only for the "View Report" sheet. */
  id?: string;
  format?: string;
  data?: PublishedReportData;
  ran?: boolean;
  children: PublishedReportItem[];
}

/** A Lightning dashboard as `embeddedDashboard` lays it out: its describe's grid and component titles. */
export interface PublishedDashboard {
  id: string;
  title: string;
  /** Runs as one specified user, so its results are the same for every viewer. */
  sharedResults: boolean;
  numColumns: number;
  rowHeight: number;
  components: PublishedDashboardComponent[];
  /** When the results were last refreshed (only with `data`). */
  refreshedAt?: string;
  /** Why a shared-results dashboard has no data. */
  dataNote?: string;
}

export interface PublishedDashboardComponent {
  id: string;
  /** The header (DashboardComponentViewModel.title). */
  title: string;
  /** The component's own title, drawn under the header. */
  subtitle: string;
  chart: string;
  /** groupByType for bars: grouped, stacked, or stacked100. */
  groupBy: string;
  column: number;
  row: number;
  colspan: number;
  rowspan: number;
  /** visualizationProperties.legendPosition: Right, Bottom, or None. */
  legend: string;
  showValues: boolean;
  showTotal: boolean;
  /** Fold items under 3% of the total into "Other". */
  combineSmall: boolean;
  /** The component's results, read live — only for dashboards with shared results. */
  data?: DashboardData;
}

/** One component's report results, as chart series. */
export interface DashboardData {
  /** Aggregate labels, e.g. "Sum of No of Engagements". */
  measures: string[];
  /** The first grouping's labels: slices, or x-axis categories. */
  categories: string[];
  /** Series come from a second grouping (else one per measure). */
  grouped: boolean;
  /** One series per second-grouping value, else one per measure. */
  series: { label: string; values: (number | null)[]; labels: string[] }[];
  /** The grand total of the first measure, formatted. */
  total?: string;
}

export type PublishedResult = PublishedIpad | { profile: string; missing: true };
