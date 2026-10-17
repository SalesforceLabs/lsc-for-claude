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

export interface PublishedLayout {
  name: string;
  sections: { label: string | null; columns: string[][] }[];
  relatedLists: { name: string; label: string }[];
  actions: string[];
}

export interface PublishedRecordType {
  name: string;
  label: string;
  layout: string | null;
  flexiPage: string | null;
  compactLayout: string | null;
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
  listViews: { name: string; label: string; columns: string[] }[];
  defaultListView: string | null;
  /** List views shared only with roles, groups, or territories the viewer isn't in. */
  hiddenListViews?: { label: string; reason: string }[];
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
  notes: string[];
  /** The user whose permission sets were merged in; null when the profile has no active users. */
  viewer: { userId: string; name: string; permissionSets: string[] } | null;
  /** Active users on the profile, for picking whose iPad to preview. */
  users: { id: string; name: string }[];
  /** Dashboards the pages' `embeddedDashboard` components show, by developer name. */
  dashboards: Record<string, PublishedDashboard>;
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
