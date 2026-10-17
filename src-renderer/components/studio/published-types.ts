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
}

export type PublishedResult = PublishedIpad | { profile: string; missing: true };
