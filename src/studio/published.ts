/**
 * The iPad's published configuration — what LSC Mobile actually renders for a
 * profile, read from that profile's mobile metadata cache ZIP (the same file
 * the app downloads) instead of rebuilt from Admin Console records.
 *
 * Rendering rules mirror the iOS client (lifesciences-ios); file references in
 * comments point there. Read-only: the only org calls are a SOQL query and a
 * ContentVersion download.
 */

import { execFile, spawn } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import { ID_PATTERN, inList, query, type Row } from "./helpers.js";

const execFileAsync = promisify(execFile);

// ── Snapshot shape ────────────────────────────────────────────────────────────

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
  listViews: PublishedListView[];
  defaultListView: string | null;
  /** List views shared only with roles, groups, or territories the viewer isn't in. */
  hiddenListViews?: { label: string; reason: string }[];
}

export interface PublishedListView {
  name: string;
  label: string;
  columns: string[];
  /** The list view's `sharedTo` (non-empty entries); absent = visible to all users. */
  sharedTo?: Record<string, string[]>;
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
  viewer: PublishedViewer | null;
  /** Active users on the profile, for picking whose iPad to preview. */
  users: { id: string; name: string }[];
}

export interface PublishedViewer {
  userId: string;
  name: string;
  /** Assigned permission sets as the app receives them (`ns__Name`). */
  permissionSets: string[];
}

/** The parsed JSON files from one profile's `metadata/` folder. */
export interface MetadataFiles {
  nav: Record<string, Row>;
  ui: Row;
  permissions: Row;
  db: Record<string, unknown>;
  sobjects: Record<string, Row>;
  /** The user's `translations/<language>.json` (falling back to en_US); only `tabs` is read. */
  translations?: Row;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const NAMESPACE = "lsc4ce";
const ns = (name: string) => `${NAMESPACE}__${name}`;
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const ieq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** SFComponentsFactory.trimNamespace — drops a `ns:` prefix the app namespace contains. */
export function trimNamespace(name: string): string {
  const i = name.indexOf(":");
  if (i <= 0) return name;
  return NAMESPACE.includes(name.slice(0, i)) ? name.slice(i + 1) : name;
}

// ── Permissions ───────────────────────────────────────────────────────────────

/**
 * The profile with the user's permission sets merged in —
 * ProcessMetadataOperation.loadPermissions + MetadataPermissionsProfile.merge:
 * a tab becomes Visible/DefaultOn if any set says so, a record type visible if
 * any set makes it visible.
 */
export function effectiveProfile(permissions: Row, permissionSets: string[]): Row {
  const profile = obj(permissions.profile);
  const wanted = new Set(permissionSets);
  const sets = arr(permissions.permissionSets).filter((ps) => wanted.has(str(ps.fullName)));
  if (!sets.length) return profile;

  const tabs = new Map(arr(profile.tabVisibilities).map((t) => [str(t.tab), t]));
  const rts = new Map(arr(profile.recordTypeVisibilities).map((r) => [str(r.recordType), r]));
  for (const ps of sets) {
    for (const t of arr(ps.tabVisibilities)) {
      const v = str(t.visibility);
      const current = tabs.get(str(t.tab));
      if (!current) tabs.set(str(t.tab), t);
      else if (v === "DefaultOn" || v === "Visible") tabs.set(str(t.tab), { ...current, visibility: v });
    }
    for (const r of arr(ps.recordTypeVisibilities)) {
      const current = rts.get(str(r.recordType));
      const visible = r.visible === true || r.visible === "true";
      if (!current) rts.set(str(r.recordType), r);
      else if (visible) rts.set(str(r.recordType), { ...current, visible: true });
    }
  }
  return { ...profile, tabVisibilities: [...tabs.values()], recordTypeVisibilities: [...rts.values()] };
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

/**
 * Tab routing — CoordinatorFactory.createCoordinatorFor plus module tab
 * overrides (Planner, CLM, MyTeam). `null` = no coordinator, so the tab is
 * dropped (TabsItemFactory compactMaps it away).
 */
export function tabKind(
  tab: Row,
  hasTable: (sobject: string) => boolean,
  hasSobject: (sobject: string) => boolean = () => true
): TabKind | null {
  const fullName = str(tab.fullName);
  if (fullName === ns("Planner")) return "calendar";
  if (["Accounts", "Customers"].map(ns).includes(fullName) || fullName === "AccountFilter" || fullName === ns("AccountFilter"))
    return "accounts";
  if (fullName === ns("IntelligentContent") || fullName === "IntelligentContent") return "content";
  if (fullName === ns("MyTeamTab")) return "myTeam";
  if (str(tab.auraComponent) === ns("PlanCycleModalWrapper")) return "activityPlanReview";
  if (ieq(fullName, "standard-accountcompliance")) return "compliance";
  if ([ns("Reports"), "standard-report"].some((n) => ieq(n, fullName))) return "reports";
  if (ieq(fullName, ns("SalesData"))) return "salesData";
  if (fullName === "standard-Dashboard") return hasTable("Dashboard") ? "dashboards" : null;
  if (fullName === "Tableau" || fullName === "Tableau_Tab") return "tableau";
  if (fullName === "standard-MedicalInsight" || fullName === "standard-MedicalInsightFeed") return "insights";

  switch (str(tab.type).toLowerCase()) {
    case "sobject":
    case "customobject":
      // MetadataNavigation.init looks the object up in sobjects.json; no entry → FancyEmptyCoordinator.
      return tab.sobjectName && hasSobject(str(tab.sobjectName)) ? "object" : "empty";
    case "flexipage":
      return ieq(fullName, "standard-home") ? "home" : "flexiPage";
    default:
      return ieq(fullName, "standard-home") ? "home" : "empty";
  }
}

/** Names the app routes natively — a UI Settings tab must use one of these exactly. */
const NATIVE_TAB_NAMES: Record<string, string> = {
  accounts: ns("Accounts"),
  customers: ns("Customers"),
  accountfilter: "AccountFilter",
  planner: ns("Planner"),
  calendar: ns("Planner"),
  intelligentcontent: ns("IntelligentContent"),
  content: ns("IntelligentContent"),
  myteam: ns("MyTeamTab"),
  myteamtab: ns("MyTeamTab"),
  reports: ns("Reports"),
  salesdata: ns("SalesData"),
  tableau: "Tableau",
};

/** Explain a tab that routes to FancyEmptyViewController ("Coming soon"). */
function emptyReason(tab: Row, nav: Record<string, Row>, visible: Set<string>): string {
  const fullName = str(tab.fullName);
  const type = str(tab.type).toLowerCase();
  if (type === "sobject" || type === "customobject") {
    if (!tab.sobjectName) return "This object tab has no object the app can open.";
    return `${str(tab.sobjectName)} isn't in this profile's published objects, so the tab shows "Coming soon". Add it to the profile's DB Schema and publish again.`;
  }
  if (type === "mobile") {
    const key = fullName.replace(/^lsc4ce__/i, "").replace(/[\s_]/g, "").toLowerCase();
    const native = NATIVE_TAB_NAMES[key];
    const where = `the UI Settings navigation tab's Tab Name "${fullName}"`;
    if (native && native !== fullName) return `The app doesn't recognize ${where}. Use "${native}" to open the native screen.`;
    // A same-labelled object or Lightning page tab is what the admin probably meant.
    const twin = Object.values(nav).find(
      (t) => str(t.type).toLowerCase() !== "mobile" && ieq(str(t.label), fullName) && (t.sobjectName || t.flexiPage)
    );
    if (twin && visible.has(str(twin.fullName)))
      return `The app doesn't recognize ${where}, so this tab is empty. "${str(twin.label)}" already shows as its own tab (${str(twin.fullName)}).`;
    if (twin) return `The app doesn't recognize ${where}. UI Settings tabs only open the app's native screens — to show "${str(twin.label)}", make the ${str(twin.fullName)} tab visible instead.`;
    return `The app doesn't recognize ${where}. UI Settings tabs only open the app's native screens (Accounts, Planner, Intelligent Content, My Team, Reports, Sales Data, Tableau).`;
  }
  return `The app has no screen for ${type ? `"${type}" tabs` : "this tab"} (${fullName}).`;
}

const TAB_FILTER_REASONS = {
  notVisible: "Tab is hidden or default-off on the profile and the user's permission sets",
  noTable: "Its object isn't synced to the iPad",
  notAvailable: "Its object isn't in an active DB Schema record the user can read",
  samples: "Samples Management tabs never show on the iPad",
  noCoordinator: "The iPad can't open this tab",
} as const;

/**
 * Visible tabs in iPad order — ProcessMetadataOperation.parseNavigation
 * (visibility + table filter), sorted by tabOrder, then routed.
 *
 * `availableTables` is the user's `profile.availableFields` keys, which the
 * server sends per user at download (not in the ZIP): every active DB Schema
 * object in the org the user can read. Without it, fall back to the profile's
 * own synced tables.
 */
export function buildTabs(files: MetadataFiles, availableTables?: Set<string>): { tabs: PublishedTab[]; hidden: HiddenTab[] } {
  const profile = obj(files.permissions.profile);
  const visible = new Set(
    arr(profile.tabVisibilities)
      .filter((t) => t.visibility && t.visibility !== "Hidden" && t.visibility !== "DefaultOff")
      .map((t) => str(t.tab))
  );
  const hasTable = (s: string) => Object.keys(files.db).some((k) => ieq(k, s)) && Object.keys(files.sobjects).some((k) => ieq(k, s));
  const isAvailable = (s: string) => (availableTables ? availableTables.has(s) : hasTable(s));
  const translated = obj(files.translations?.tabs);

  const tabs: (PublishedTab & { order: number })[] = [];
  const hidden: HiddenTab[] = [];
  for (let t of Object.values(files.nav)) {
    const fullName = str(t.fullName);
    // MetadataNavigation.init: localize — a non-empty translated label wins.
    const label = str(obj(translated[fullName]).label) || str(t.label) || fullName;
    const hide = (reason: string) => hidden.push({ fullName, label, reason });
    if (t.sobjectName != null && !isAvailable(str(t.sobjectName))) {
      hide(availableTables ? TAB_FILTER_REASONS.notAvailable : TAB_FILTER_REASONS.noTable);
      continue;
    }
    if (!visible.has(fullName)) {
      hide(TAB_FILTER_REASONS.notVisible);
      continue;
    }
    if (fullName.toLowerCase().includes("samples_management")) {
      hide(TAB_FILTER_REASONS.samples);
      continue;
    }
    // MetadataNavigation.init: an orders dashboard tab is treated as the Order__c object tab.
    if (fullName.toLowerCase().includes("order") && fullName.toLowerCase().includes("dashboard")) {
      t = { ...t, sobjectName: "Order__c", type: "sobject" };
    }
    const kind = tabKind(t, hasTable, (s) => Object.prototype.hasOwnProperty.call(files.sobjects, s));
    if (!kind) {
      hide(TAB_FILTER_REASONS.noCoordinator);
      continue;
    }
    tabs.push({
      fullName,
      label: kind === "home" ? "Home" : label,
      kind,
      sobject: t.sobjectName ? str(t.sobjectName) : undefined,
      flexiPage: t.flexiPage ? str(t.flexiPage) : undefined,
      ...(kind === "empty" ? { emptyReason: emptyReason(t, files.nav, visible) } : {}),
      order: typeof t.tabOrder === "number" ? t.tabOrder : Number.MAX_SAFE_INTEGER,
    });
  }
  tabs.sort((a, b) => a.order - b.order);
  // TabsItemFactory always appends a pinned search / recent items tab.
  const result: PublishedTab[] = tabs.map(({ order: _order, ...t }) => t);
  result.push({ fullName: "RecentItems", label: "Recent Items", kind: "recent" });
  return { tabs: result, hidden };
}

// ── Components ────────────────────────────────────────────────────────────────

/** SFComponentsFactory exact names (after trimNamespace). */
const EXACT_COMPONENTS: Record<string, string> = {
  "flexipage:accordion": "Accordion",
  recordSignatureView: "Signature",
  lsAgentforceWelcome: "Agentforce welcome",
  "desktopDashboards:embeddedDashboard": "Dashboard",
  "flexipage:filterListCard": "List view",
  "flexipage:recentItems": "Recent items",
  "flexipage:reportChart": "Report chart",
  "flexipage:richText": "Rich text",
  "tableau:tableauViz": "Tableau",
  "analytics_embedding:metric": "CRM Analytics metric",
  "analytics_embedding:dashboard": "CRM Analytics dashboard",
  "analytics_embedding:visualization": "CRM Analytics visualization",
  "flexipage:tab": "Tab",
  "flexipage:tabset": "Tabs",
  "flexipage:fieldSection": "Field section",
  "force:detailPanel": "Record details",
  "force:highlightsPanel": "Highlights",
  "force:relatedListContainer": "Related lists",
  "force:relatedListSingleContainer": "Related list",
  "lst:dynamicRelatedList": "Related list",
  AccountComplianceCycleListView: "Compliance cycles",
  ActivityPlanByProduct: "Activity plan by product",
  recordViewWithSobjectJsonParser: "Record view",
  Call__c: "Log a call",
  "flowruntime:interview": "Flow",
};

/** SFComponentsFactory / SFiPadComponentsFactory / module suffix matches, in factory order. */
const SUFFIX_COMPONENTS: [string, string, boolean?][] = [
  ["multiEntityRecordView", "Record details"],
  ["salesTxnLineTable", "Sales transactions"],
  ["transactionSummary", "Transaction summary"],
  ["AccountCallPlan", "Account call plan (deprecated)"],
  ["ActivityPlan", "Activity plan"],
  ["utilizationTracker", "Utilization tracker"],
  ["AccountActivityGoal", "Account activity goals"],
  ["AccountTerritoryFields", "Territory fields"],
  ["ActivityHistory", "Activity history"],
  ["accountTeamPatiView", "Account team"],
  ["accountTeamView", "Account team"],
  ["BestTime", "Best time to visit"],
  ["DialogSubmit", "Submit dialog"],
  ["FieldCoachingEvaluationScreen", "Field coaching evaluation"],
  ["NbcLeaderBoard", "Next Best Customer leaderboard"],
  ["NbcScoreDetailStandalone", "Next Best Customer score"],
  ["NbcTopCards", "Next Best Customers", true],
  ["NbcTopResults", "Next Best Customer results"],
  ["nextBestActions", "Next best actions"],
  ["OrderComponent", "Orders"],
  ["Ratings", "Customer ratings"],
  ["SalesChart", "Sales chart"],
  ["accountWeChatQrCodeGenerator", "WeChat QR code"],
  ["TerritoryCallPlan", "Territory call plan"],
  ["UpcomingAgenda", "Upcoming agenda"],
  ["HomeOfficeMessage", "Home office messages"],
  ["UnsubmittedVisits", "Unsubmitted visits"],
  ["AccountFormularyProducts", "Formulary products"],
  ["timeline", "Timeline"],
  ["DynamicTreeViewContainer", "Hierarchy"],
  ["dynamicTreeView", "Hierarchy"],
  ["surveyListView", "Surveys"],
  ["ganttChart", "Gantt chart"],
  ["homeannouncements", "Announcements", true],
  ["listViewWithSobjectJsonParser", "List view"],
  ["profilingQuestions", "Profiling questions"],
  ["complianceStatements", "Compliance statements"],
  ["InsightUpvoteContainer", "Insight votes"],
  ["accountManagementDashboard", "Account dashboard"],
  // SFiPadComponentsFactory
  ["accountSummary", "Account summary"],
  ["providerSummary", "Account summary"],
  ["accountInteractionCard", "Latest interactions"],
  ["arcGraph", "Account relationship graph"],
  ["presentationcontent", "Presentation content", true],
  // Module overrides (Maps, Affiliations, Planner, KAM, CLM, Meetings)
  ["accountMapDisplay", "Map"],
  ["UpNextMapDisplay", "Up next map"],
  ["AccountAffiliations", "Affiliations"],
  ["CustomerInfoDashboard", "Customer info"],
  ["SBC", "Search before create"],
  ["ActionPlanTemplateViewer", "Action plan template"],
  ["AccountPlanRelatedTodoList", "Account plan to-dos"],
  ["TerritoryBusinessPlanRelatedObjectivesList", "Business plan objectives"],
  ["accountPlanAnalysis", "Account plan analysis"],
  ["BusinessObjectiveAccountScreen", "Business objective accounts"],
  ["clmContentViewer", "Content viewer"],
  ["LifeSciStagePathContainer", "Stage path"],
];

const MEETING_COMPONENTS = [
  "MeetingAttendees", "MeetingAttendeesNew", "meetingAttendeesLwc", "MeetingSpeakers", "MeetingSpeakersNew",
  "meetingSpeakersLwc", "MeetingColleagues", "MeetingColleaguesNew", "meetingColleaguesLwc",
  "MeetingNonProfiledAttendees", "MeetingNonProfiledAttendeesNew", "MeetingPath", "EventExpensesLwc",
  "MeetingHistory", "mngEventPresentationLayout",
];

/** Readable fallback for components the iPad can't render: `c:myCard` → "myCard". */
function rawLabel(name: string): string {
  return name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
}

/** Map a Lightning component name to what the iPad renders, or unsupported. */
export function componentInfo(name: string): { label: string; supported: boolean } {
  const trimmed = trimNamespace(name);
  if (EXACT_COMPONENTS[trimmed]) return { label: EXACT_COMPONENTS[trimmed], supported: true };
  if (EXACT_COMPONENTS[name]) return { label: EXACT_COMPONENTS[name], supported: true };
  if (trimmed === "runtime_industries_actionplan:listCard") return { label: "Action plans", supported: true };
  // LMRModule — inline LWCs render through the Lightning Mobile Runtime.
  if (trimmed.toLowerCase().startsWith("lscmobileinline_")) return { label: `LWC · ${trimmed.slice(16)}`, supported: true };
  if (name.toLowerCase() === "industries_ls_commercial:lscmobileinline_offlineassessmentselectionwrapper")
    return { label: "Offline assessment", supported: true };
  if (trimmed.toLowerCase().includes("lsstorecheckvisit")) return { label: "Store check", supported: true };
  if (MEETING_COMPONENTS.some((m) => trimmed === m || trimmed.endsWith(m))) return { label: "Meeting component", supported: true };
  for (const [suffix, label, ignoreCase] of SUFFIX_COMPONENTS) {
    if (ignoreCase ? trimmed.toLowerCase().endsWith(suffix.toLowerCase()) : trimmed.endsWith(suffix)) return { label, supported: true };
  }
  return { label: rawLabel(name), supported: false };
}

/** halfWidthMode overrides — these pair two per row on the iPad Home. */
function isHalfWidth(trimmed: string, props: Record<string, string>): boolean {
  if (trimmed.endsWith("UpcomingAgenda") || trimmed.endsWith("NbcLeaderBoard") || trimmed.endsWith("UnsubmittedVisits")) return true;
  if (trimmed === "ActivityPlanByProduct") return props.showEnhActivityPlanOnMobileHomepage !== "true";
  return trimmed.endsWith("ActivityPlan");
}

/**
 * VisibilityRuleValidator — `$Client` is always true, `$Permission` and
 * record/user rules depend on the user, anything else is false.
 */
export function visibilityOf(rule: unknown): Pick<PublishedComponent, "visibility" | "visibilityNote"> {
  if (!rule || typeof rule !== "object") return { visibility: "shown" };
  const r = rule as Row;
  const criteria = Array.isArray(r.criteria) ? (r.criteria as Row[]) : r.criteria ? [obj(r.criteria)] : [];
  const results = criteria.map((c): boolean | "conditional" => {
    const left = str(c.leftValue).replace(/[{}]/g, "");
    if (left.includes("!$Client")) return true;
    if (left.includes("!$Permission") || left.includes("!Record.") || left.includes("!$User.")) return "conditional";
    return false;
  });
  if (results.length === 0) return { visibility: "shown" };
  const decided = r.booleanFilter ? (results.every((x) => x === true) ? true : results.every((x) => x === false) ? false : "conditional") : results[0];
  if (decided === true) return { visibility: "shown" };
  if (decided === false) return { visibility: "hidden", visibilityNote: "Its visibility rule never passes on the iPad" };
  return { visibility: "conditional", visibilityNote: "Shown only when its visibility rule passes for the user or record" };
}

function propsOf(ci: Row): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of arr(ci.componentInstanceProperties)) if (p.name && p.value != null) out[str(p.name)] = str(p.value);
  return out;
}

const PROP_KEEP = new Set(["totalCards", "graphName", "label", "title", "richTextValue", "maxRecords", "entityNames", "relatedListApiName", "dashboardName", "showEnhActivityPlanOnMobileHomepage", "utterance1", "utterance2", "utterance3"]);

function toComponent(item: Row): PublishedComponent | null {
  const ci = obj(item.componentInstance);
  const name = str(ci.componentName);
  if (!name) return null;
  const all = propsOf(ci);
  const properties: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) if (PROP_KEEP.has(k)) properties[k] = k === "richTextValue" ? v.slice(0, 600) : v;
  const { label, supported } = componentInfo(name);
  const c: PublishedComponent = {
    name,
    label,
    supported,
    halfWidth: isHalfWidth(trimNamespace(name), all),
    ...visibilityOf(ci.visibilityRule),
    properties,
  };
  if (trimNamespace(name) === "flexipage:tabset") {
    c.tabs = arr(item.itemInstances).flatMap((child) => {
      const tab = obj(child.componentInstance);
      if (str(tab.componentName) !== "flexipage:tab") return [];
      if (visibilityOf(tab.visibilityRule).visibility === "hidden") return [];
      const tp = propsOf(tab);
      return [
        {
          title: tabTitle(tp.title ?? ""),
          active: tp.active === "true",
          components: arr(child.itemInstances).map(toComponent).filter((x): x is PublishedComponent => !!x),
        },
      ];
    });
  }
  return c;
}

/** `Standard.Tab.detail` / `{!$Label.ns__Dashboard}` → a readable title. */
function tabTitle(raw: string): string {
  const std = /^Standard\.Tab\.(\w+)$/.exec(raw);
  if (std) return ({ detail: "Details", relatedLists: "Related", activity: "Activity", feed: "Chatter", news: "News" } as Record<string, string>)[std[1]] ?? std[1];
  const label = /^\{!\$Label\.(?:\w+__)?(\w+)\}$/.exec(raw);
  if (label) return label[1].replace(/_/g, " ");
  return raw;
}

/** Region slots per template — SFFlexiPageView.xib restoration identifiers. */
const TEMPLATE_REGIONS: Record<string, string[]> = {
  recordHomeSingleColTemplateDesktop: ["header", "main"],
  recordHomeTemplateDesktop: ["header", "main", "sidebar"],
  appHomeTemplateHeaderTwoColumnsLeftSidebar: ["header", "sidebar", "main"],
  defaultFlexiPage: ["main"],
  defaultAppHomeTemplate: ["header", "main"],
  desktopTemplate: ["top"],
};

/** A Lightning page as SFFlexiPageView builds it: only the template's region slots render. */
export function buildPage(name: string, page: Row): PublishedPage {
  const regions = arr(page.flexiPageRegions).filter((r) => str(r.type) !== "Facet");
  const templateName = str(obj(page.template).name);
  let template = templateName.includes(":") ? templateName.split(":")[1] : templateName;
  // shouldDisplayDefaultFlexiPage, plus the unknown-template fallback.
  const onlyMain = regions.length === 1 && str(regions[0].name) === "main";
  const emptyPair = str(page.type) === "RecordPage" && regions.length === 2 && regions.some((r) => arr(r.itemInstances).length === 0);
  if (onlyMain || emptyPair || !TEMPLATE_REGIONS[template]) template = "defaultFlexiPage";
  const slots = TEMPLATE_REGIONS[template];

  const result: PublishedPage = { name, label: str(page.masterLabel) || name, type: str(page.type), template, regions: [], droppedRegions: [] };
  for (const slot of slots) {
    const region = regions.find((r) => str(r.name) === slot);
    if (!region) continue;
    result.regions.push({ name: slot, components: arr(region.itemInstances).map(toComponent).filter((x): x is PublishedComponent => !!x) });
  }
  for (const r of regions) {
    if (slots.includes(str(r.name))) continue;
    const comps = arr(r.itemInstances).map((i) => str(obj(i.componentInstance).componentName)).filter(Boolean);
    if (comps.length) result.droppedRegions.push({ name: str(r.name), components: comps.map((c) => componentInfo(c).label) });
  }
  return result;
}

// ── Objects, layouts ──────────────────────────────────────────────────────────

function buildLayout(name: string, layout: Row): PublishedLayout {
  const sections = arr(layout.layoutSections).flatMap((s) => {
    const columns = arr(s.layoutColumns)
      .map((col) => arr(col.layoutItems).map((f) => str(f.label) || str(f.fullName)).filter(Boolean))
      .filter((c) => c.length);
    if (!columns.length) return [];
    // SFLayoutSection shows the heading only when detailHeading is on.
    const heading = str(s.detailHeading) === "true" && str(s.label) ? str(s.label) : null;
    return [{ label: heading, columns }];
  });
  const relatedLists = arr(layout.relatedLists).map((r) => {
    const rl = str(r.relatedList);
    return { name: rl, label: str(r.relatedListLabel) || str(r.label) || rl.replace(/^RelatedList$/, "").replace(/__r$|__c$/g, "") || rl };
  });
  const actions = arr(layout.platformActionList).flatMap((pal) =>
    arr(obj(pal).platformActionListItems ?? []).map((a) => str(a.label) || str(a.actionName) || str(a.fullName))
  );
  return { name, sections, relatedLists, actions: actions.filter(Boolean) };
}

function buildObject(name: string, sobject: Row, ui: Row, profile: Row): PublishedObject {
  const visibleRts = new Map(
    arr(profile.recordTypeVisibilities).map((v) => [str(v.recordType), v.visible === true || v.visible === "true"])
  );
  const recordTypes = arr(sobject.recordTypes)
    .filter((rt) => rt.active !== false && visibleRts.get(`${name}.${str(rt.fullName)}`) !== false)
    // Master stands in for "no record type"; only offer it when it's the only one.
    .filter((rt, _i, all) => str(rt.fullName) !== "Master" || all.length === 1)
    .map((rt) => ({
      name: str(rt.fullName),
      label: str(rt.label) || str(rt.fullName),
      layout: rt.layout ? str(rt.layout) : null,
      flexiPage: rt.flexiPage ? str(rt.flexiPage) : null,
      compactLayout: rt.compactLayoutAssignment ? str(rt.compactLayoutAssignment) : sobject.compactLayoutAssignment ? str(sobject.compactLayoutAssignment) : null,
    }));
  const listViews: PublishedListView[] = Object.entries(obj(ui.listViews))
    .filter(([k]) => k.startsWith(`${name}.`))
    // AllSObjectsViewController.listViews drops recently viewed lists.
    .filter(([, v]) => str(obj(v).filterScope).toLowerCase() !== "mru")
    .map(([, v]) => {
      const lv = obj(v);
      const sharedTo = Object.fromEntries(
        Object.entries(obj(lv.sharedTo))
          .map(([k, names]) => [k, (Array.isArray(names) ? names : [names]).filter((n): n is string => typeof n === "string" && !!n)] as const)
          .filter(([, names]) => names.length > 0)
      );
      return {
        name: str(lv.fullName),
        label: str(lv.label) || str(lv.fullName),
        columns: arr(lv.columns).map((c) => str(c.label) || str(c.fullName)),
        ...(Object.keys(sharedTo).length ? { sharedTo } : {}),
      };
    })
    // SObjectsCoordinator.updateListViews: `$0.label < $1.label` (code-unit order).
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return {
    name,
    label: str(sobject.label) || name,
    labelPlural: str(sobject.labelPlural) || name,
    recordTypes,
    defaultCompactLayout: sobject.compactLayoutAssignment ? str(sobject.compactLayoutAssignment) : null,
    listViews,
    defaultListView: defaultListView(listViews),
  };
}

/** SObjectsCoordinator.didSelect(nil): a name containing ".All", then one ending "All", then the first. */
function defaultListView(views: { name: string }[]): string | null {
  const all = (n: string) => n.startsWith("All") || n.startsWith("lsc4ce__All");
  return (views.find((l) => all(l.name)) ?? views.find((l) => l.name.endsWith("All")) ?? views[0])?.name ?? null;
}

/** Objects the preview can open: tab objects plus Account and Visit. */
function previewObjects(tabs: PublishedTab[], files: MetadataFiles): string[] {
  const names = new Set<string>(["Account", "Visit"]);
  for (const t of tabs) if (t.sobject) names.add(t.sobject);
  return [...names].filter((n) => files.sobjects[n]);
}

export type SnapshotCore = Omit<PublishedIpad, "viewer" | "users">;

export function buildSnapshot(
  raw: MetadataFiles,
  meta: { profile: string; cache: PublishedIpad["cache"]; permissionSets?: string[]; availableTables?: Set<string> }
): SnapshotCore {
  const files: MetadataFiles = { ...raw, permissions: { ...raw.permissions, profile: effectiveProfile(raw.permissions, meta.permissionSets ?? []) } };
  const { tabs, hidden } = buildTabs(files, meta.availableTables);
  const flexiPages = obj(files.ui.flexiPages);
  const pageLayouts = obj(files.ui.pageLayouts);
  const compact = obj(files.ui.compactLayouts);
  const profile = obj(files.permissions.profile);
  const notes: string[] = [
    "Objects and fields synced only through permission-set DB Schema aren't reflected.",
    "Field-level security is applied per user when they download the cache, so hidden fields may still be listed.",
  ];

  const homeTab = tabs.find((t) => t.kind === "home");
  let home: PublishedPage | null = null;
  if (homeTab?.flexiPage && flexiPages[homeTab.flexiPage]) home = buildPage(homeTab.flexiPage, obj(flexiPages[homeTab.flexiPage]));
  else if (homeTab) home = { name: "", label: "Home", type: "HomePage", template: "desktopTemplate", regions: [{ name: "top", components: [] }], droppedRegions: [] };

  const objects: Record<string, PublishedObject> = {};
  const layouts: Record<string, PublishedLayout> = {};
  const pages: Record<string, PublishedPage> = {};
  const compactLayouts: Record<string, string[]> = {};
  for (const name of previewObjects(tabs, files)) {
    const o = buildObject(name, obj(files.sobjects[name]), files.ui, profile);
    objects[name] = o;
    const compactNames = new Set([o.defaultCompactLayout, ...o.recordTypes.map((r) => r.compactLayout)].filter((x): x is string => !!x));
    for (const c of compactNames) {
      const cl = obj(compact[`${name}.${c}`] ?? compact[c]);
      compactLayouts[`${name}.${c}`] = arr(cl.fields).map((f) => str(f.label) || str(f.fullName));
    }
    for (const rt of o.recordTypes) {
      if (rt.layout && !layouts[rt.layout] && pageLayouts[rt.layout]) layouts[rt.layout] = buildLayout(rt.layout, obj(pageLayouts[rt.layout]));
      if (rt.flexiPage && !pages[rt.flexiPage] && flexiPages[rt.flexiPage]) pages[rt.flexiPage] = buildPage(rt.flexiPage, obj(flexiPages[rt.flexiPage]));
    }
  }
  for (const t of tabs) {
    if (t.kind === "flexiPage" && t.flexiPage && flexiPages[t.flexiPage] && !pages[t.flexiPage]) pages[t.flexiPage] = buildPage(t.flexiPage, obj(flexiPages[t.flexiPage]));
  }

  return { profile: meta.profile, cache: meta.cache, tabs, hiddenTabs: hidden, home, objects, layouts, pages, compactLayouts, notes };
}

/**
 * Who a user is for list view sharing: role and public group developer
 * names, and territories as `Model.Territory` — each "AndAbove" set holds the
 * user's own plus every ancestor (matching an "…AndSubordinates" share).
 */
export interface ViewerSharing {
  role: string | null;
  roleAndAbove: Set<string>;
  groups: Set<string>;
  territories: Set<string>;
  territoryAndAbove: Set<string>;
}

const SHARE_MATCH: Record<string, (v: ViewerSharing, n: string) => boolean> = {
  role: (v, n) => v.role === n,
  roles: (v, n) => v.role === n,
  roleAndSubordinates: (v, n) => v.roleAndAbove.has(n),
  roleAndSubordinatesInternal: (v, n) => v.roleAndAbove.has(n),
  rolesAndSubordinates: (v, n) => v.roleAndAbove.has(n),
  group: (v, n) => v.groups.has(n),
  groups: (v, n) => v.groups.has(n),
  territory: (v, n) => v.territories.has(n),
  territories: (v, n) => v.territories.has(n),
  territoryAndSubordinates: (v, n) => v.territoryAndAbove.has(n),
  territoriesAndSubordinates: (v, n) => v.territoryAndAbove.has(n),
};

const SHARE_NOUN: Record<string, string> = {
  role: "role", roles: "role", roleAndSubordinates: "role and subordinates", roleAndSubordinatesInternal: "role and subordinates",
  rolesAndSubordinates: "role and subordinates", group: "group", groups: "group", territory: "territory", territories: "territory",
  territoryAndSubordinates: "territory and subordinates", territoriesAndSubordinates: "territory and subordinates",
};

/**
 * Keep the list views the viewer can see. The app lists them live from
 * `/sobjects/<object>/listviews` as the user (the cache's own list views are
 * ignored — MetadataCore decodes them as []), so a view shared only with
 * roles, groups, or territories the user isn't in never shows.
 */
export function applyListViewSharing(core: SnapshotCore, viewer: ViewerSharing | null): SnapshotCore {
  if (!viewer) return core;
  const objects: Record<string, PublishedObject> = {};
  for (const [name, o] of Object.entries(core.objects)) {
    const hiddenListViews: { label: string; reason: string }[] = [];
    const listViews = o.listViews.filter((l) => {
      if (!l.sharedTo) return true;
      const entries = Object.entries(l.sharedTo);
      if (entries.some(([k, names]) => names.some((n) => SHARE_MATCH[k]?.(viewer, n)))) return true;
      const to = entries.map(([k, names]) => `${SHARE_NOUN[k] ?? k} ${names.join(", ")}`).join("; ");
      hiddenListViews.push({ label: l.label, reason: `Shared only with ${to}` });
      return false;
    });
    objects[name] = { ...o, listViews, defaultListView: defaultListView(listViews), ...(hiddenListViews.length ? { hiddenListViews } : {}) };
  }
  return { ...core, objects };
}

// ── Org access ────────────────────────────────────────────────────────────────

const FILES = ["nav", "ui", "permissions", "db", "sobjects"] as const;
const CACHE_ROOT = path.join(os.tmpdir(), "lsc-studio-published");
const SNAPSHOT_VERSION = 7;
/** UserService.defaultLanguage — the translation file used when the user's is missing. */
const DEFAULT_LANGUAGE = "en_US";
/** Distinct permission-set combinations pre-built per download. */
const MAX_COMBOS = 25;

interface CacheRecord {
  recordId: string;
  name: string;
  contentVersionId: string;
  generatedAt: string;
  sizeBytes: number | null;
}

/**
 * The profile's current cache: the newest Active per-profile child record
 * with a document (the server's own pick isn't exposed, so newest wins).
 */
async function latestCache(profile: string, org: string): Promise<CacheRecord | null> {
  const rows = await query(
    `SELECT Id, Name, Status, Profile.Name, LastModifiedDate, MetadataDocument.LatestPublishedVersionId, MetadataDocument.ContentSize
     FROM LifeSciMobileMetadataRecord
     WHERE ParentMobileMetadataRecId != null AND MetadataDocumentId != null
     ORDER BY LastModifiedDate DESC LIMIT 2000`,
    org
  );
  const mine = rows.filter((r) => ieq(str(obj(r.Profile).Name), profile));
  const pick = mine.find((r) => r.Status === "Active") ?? mine[0];
  if (!pick) return null;
  const doc = obj(pick.MetadataDocument);
  return {
    recordId: str(pick.Id),
    name: str(pick.Name),
    contentVersionId: str(doc.LatestPublishedVersionId),
    generatedAt: str(pick.LastModifiedDate),
    sizeBytes: typeof doc.ContentSize === "number" ? doc.ContentSize : null,
  };
}

function download(contentVersionId: string, dest: string, org: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "sf",
      ["api", "request", "rest", `/services/data/v62.0/sobjects/ContentVersion/${contentVersionId}/VersionData`, "--stream-to-file", dest, "--target-org", org],
      { stdio: "pipe", timeout: 300000 }
    );
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `Download failed (exit ${code})`))));
  });
}

/**
 * Extract the metadata JSON files plus the given languages' translation files
 * (all translations together are most of the ZIP). Returns the files and each
 * found language's `tabs` translations.
 */
async function extract(zip: string, dir: string, languages: string[]): Promise<{ files: MetadataFiles; tabTranslations: Map<string, Row> }> {
  const patterns = [...FILES.map((f) => `*/metadata/${f}.json`), ...languages.map((l) => `*/translations/${l}.json`)];
  try {
    await execFileAsync("unzip", ["-o", "-q", "-j", zip, ...patterns, "-d", dir], { maxBuffer: 1 << 20 });
  } catch (err) {
    // Exit 11 = some patterns had no match; anything else is a real failure.
    const code = (err as { code?: number }).code;
    if (code !== 11) throw new Error(`Couldn't unpack the metadata cache (${err instanceof Error ? err.message : String(err)}). Studio needs the unzip command.`);
  }
  const read = (f: string): Row => {
    const p = path.join(dir, `${f}.json`);
    return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Row) : {};
  };
  const tabTranslations = new Map<string, Row>();
  for (const l of languages) {
    if (fs.existsSync(path.join(dir, `${l}.json`))) tabTranslations.set(l, { tabs: obj(read(l).tabs) });
  }
  return {
    files: {
      nav: read("nav") as Record<string, Row>,
      ui: read("ui"),
      permissions: read("permissions"),
      db: read("db"),
      sobjects: read("sobjects") as Record<string, Row>,
    },
    tabTranslations,
  };
}

const soqlString = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

interface ProfileUser {
  id: string;
  name: string;
  lastLogin: string;
  /** Salesforce language (`LanguageLocaleKey`) — picks the translation file. */
  language: string;
  permissionSets: string[];
}

/**
 * Active users on the profile with their directly assigned permission sets —
 * the list the app gets at sync (UserDao.getUserAssignedPermissionSets: not
 * profile-owned, `ns__Name`).
 */
async function profileUsers(profile: string, org: string): Promise<ProfileUser[]> {
  const name = soqlString(profile);
  const [users, assignments] = await Promise.all([
    query(`SELECT Id, Name, LastLoginDate, LanguageLocaleKey FROM User WHERE IsActive = true AND Profile.Name = ${name} ORDER BY Name LIMIT 500`, org),
    query(
      `SELECT AssigneeId, PermissionSet.Name, PermissionSet.NamespacePrefix FROM PermissionSetAssignment
       WHERE PermissionSet.IsOwnedByProfile = false AND Assignee.IsActive = true AND Assignee.Profile.Name = ${name} LIMIT 20000`,
      org
    ),
  ]);
  const sets = new Map<string, string[]>();
  for (const a of assignments) {
    const ps = obj(a.PermissionSet);
    const ns = str(ps.NamespacePrefix);
    const list = sets.get(str(a.AssigneeId)) ?? [];
    list.push(ns ? `${ns}__${str(ps.Name)}` : str(ps.Name));
    sets.set(str(a.AssigneeId), list);
  }
  return users.map((u) => ({
    id: str(u.Id),
    name: str(u.Name),
    lastLogin: str(u.LastLoginDate),
    // Only used to build a file name inside the ZIP.
    language: /^[A-Za-z]{2,3}(_[A-Za-z0-9]{2,4})*$/.test(str(u.LanguageLocaleKey)) ? str(u.LanguageLocaleKey) : DEFAULT_LANGUAGE,
    permissionSets: (sets.get(str(u.Id)) ?? []).sort(),
  }));
}

const comboKey = (sets: string[]) => createHash("sha1").update(sets.join("\n")).digest("hex").slice(0, 12);

/** The default viewer: a user with the profile's most common permission-set combination, most recent login first. */
function defaultUser(users: ProfileUser[]): ProfileUser | undefined {
  const counts = new Map<string, number>();
  for (const u of users) counts.set(comboKey(u.permissionSets), (counts.get(comboKey(u.permissionSets)) ?? 0) + 1);
  return [...users].sort(
    (a, b) =>
      (counts.get(comboKey(b.permissionSets)) ?? 0) - (counts.get(comboKey(a.permissionSets)) ?? 0) ||
      b.lastLogin.localeCompare(a.lastLogin)
  )[0];
}

/**
 * The tab objects in each user's `availableFields` — the server sends these
 * per user at download: every active DB Schema object in the org (whichever
 * profile it's assigned to) the user can read. Objects with no object
 * permissions (Event, ContentDocument, …) count as readable. Returns a lookup
 * by permission-set combination, or null if the org won't say.
 */
async function availableTablesFor(
  profile: string,
  sobjects: string[],
  org: string
): Promise<((permissionSets: string[]) => Set<string>) | null> {
  try {
    const synced = await query(
      `SELECT ObjectValue, TextValue FROM LifeSciConfigFieldValue
       WHERE FieldName = 'SObject' AND LifeSciConfigRecord.IsActive = true AND LifeSciConfigRecord.LifeSciConfigCategory.Category = 'DbSchema'`,
      org,
      true
    );
    const active = new Set(synced.map((r) => str(r.ObjectValue) || str(r.TextValue)));
    const candidates = sobjects.filter((s) => active.has(s));
    if (!candidates.length) return () => new Set();
    const list = inList(candidates);
    const [reads, permissionable] = await Promise.all([
      query(
        `SELECT SobjectType, Parent.Name, Parent.NamespacePrefix, Parent.IsOwnedByProfile FROM ObjectPermissions
         WHERE PermissionsRead = true AND SobjectType IN (${list})
         AND ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND Assignee.Profile.Name = ${soqlString(profile)})`,
        org
      ),
      // An admin profile has a row for every object that has object permissions at all.
      query(
        `SELECT SobjectType FROM ObjectPermissions
         WHERE SobjectType IN (${list}) AND Parent.IsOwnedByProfile = true AND Parent.PermissionsModifyAllData = true`,
        org
      ),
    ]);
    const hasPermissions = new Set(permissionable.map((r) => str(r.SobjectType)));
    const fromProfile = new Set<string>();
    const fromSet = new Map<string, Set<string>>();
    for (const r of reads) {
      const ps = obj(r.Parent);
      if (ps.IsOwnedByProfile === true) fromProfile.add(str(r.SobjectType));
      else {
        const name = str(ps.NamespacePrefix) ? `${str(ps.NamespacePrefix)}__${str(ps.Name)}` : str(ps.Name);
        fromSet.set(name, (fromSet.get(name) ?? new Set()).add(str(r.SobjectType)));
      }
    }
    return (permissionSets) => {
      const readable = new Set([...fromProfile, ...permissionSets.flatMap((ps) => [...(fromSet.get(ps) ?? [])])]);
      return new Set(candidates.filter((s) => readable.has(s) || !hasPermissions.has(s)));
    };
  } catch {
    return null;
  }
}

/** Walk a parent field up from `ids`, returning every row reached (the starting rows included). */
async function ancestors(sobject: string, parentField: string, fields: string, ids: string[], org: string): Promise<Row[]> {
  const seen = new Map<string, Row>();
  let frontier = ids.filter((id) => ID_PATTERN.test(id));
  for (let depth = 0; frontier.length && depth < 20; depth++) {
    const rows = await query(`SELECT Id, ${parentField}, ${fields} FROM ${sobject} WHERE Id IN (${inList(frontier)})`, org);
    for (const r of rows) seen.set(str(r.Id), r);
    frontier = [...new Set(rows.map((r) => str(r[parentField])).filter((id) => id && !seen.has(id)))];
  }
  return [...seen.values()];
}

/** The user's role, public groups (nested included), and territories, for list view sharing; null if the org won't say. */
async function viewerSharing(userId: string, org: string): Promise<ViewerSharing | null> {
  if (!ID_PATTERN.test(userId)) return null;
  try {
    const [users, assignments] = await Promise.all([
      query(`SELECT UserRoleId, UserRole.DeveloperName FROM User WHERE Id = '${userId}'`, org),
      query(`SELECT Territory2Id FROM UserTerritory2Association WHERE UserId = '${userId}' AND IsActive = true`, org),
    ]);
    const roleId = str(users[0]?.UserRoleId);
    const roles = roleId ? await ancestors("UserRole", "ParentRoleId", "DeveloperName", [roleId], org) : [];
    const ownTerritories = assignments.map((a) => str(a.Territory2Id));
    const territories = await ancestors("Territory2", "ParentTerritory2Id", "DeveloperName, Territory2Model.DeveloperName", ownTerritories, org);
    const territoryName = (t: Row) => `${str(obj(t.Territory2Model).DeveloperName)}.${str(t.DeveloperName)}`;

    // Start from the user and the role/territory groups they belong to, then follow group nesting.
    const roleIds = roles.map((r) => str(r.Id));
    const territoryIds = territories.map((t) => str(t.Id));
    const clauses = [
      roleId && `(Type = 'Role' AND RelatedId = '${roleId}')`,
      roleIds.length && `(Type IN ('RoleAndSubordinates','RoleAndSubordinatesInternal') AND RelatedId IN (${inList(roleIds)}))`,
      ownTerritories.length && `(Type = 'Territory' AND RelatedId IN (${inList(ownTerritories)}))`,
      territoryIds.length && `(Type = 'TerritoryAndSubordinates' AND RelatedId IN (${inList(territoryIds)}))`,
    ].filter(Boolean);
    const implicit = clauses.length ? await query(`SELECT Id FROM Group WHERE ${clauses.join(" OR ")}`, org) : [];
    const groups = new Set<string>();
    const seen = new Set<string>([userId, ...implicit.map((g) => str(g.Id))]);
    let frontier = [...seen];
    for (let depth = 0; frontier.length && depth < 10; depth++) {
      const rows = await query(`SELECT GroupId, Group.DeveloperName, Group.Type FROM GroupMember WHERE UserOrGroupId IN (${inList(frontier)})`, org);
      frontier = [];
      for (const m of rows) {
        const g = obj(m.Group);
        if (g.Type === "Regular" && str(g.DeveloperName)) groups.add(str(g.DeveloperName));
        if (!seen.has(str(m.GroupId))) {
          seen.add(str(m.GroupId));
          frontier.push(str(m.GroupId));
        }
      }
    }
    return {
      role: str(obj(users[0]?.UserRole).DeveloperName) || null,
      roleAndAbove: new Set(roles.map((r) => str(r.DeveloperName))),
      groups,
      territories: new Set(territories.filter((t) => ownTerritories.includes(str(t.Id))).map(territoryName)),
      territoryAndAbove: new Set(territories.map(territoryName)),
    };
  } catch {
    return null;
  }
}

/**
 * Load the iPad as one user of a profile sees it (the profile's most typical
 * user unless `userId` is given). Cache files never change once published, so
 * snapshots are kept on disk by ContentVersion Id and permission-set combination.
 */
export async function loadPublishedIpad(
  profile: string,
  org: string,
  userId?: string
): Promise<PublishedIpad | { profile: string; missing: true }> {
  const [cache, users] = await Promise.all([latestCache(profile, org), profileUsers(profile, org)]);
  if (!cache) return { profile, missing: true };
  if (!ID_PATTERN.test(cache.contentVersionId)) throw new Error("The metadata cache record has no downloadable file.");

  const user = (userId && users.find((u) => u.id === userId)) || defaultUser(users);
  const permissionSets = user?.permissionSets ?? [];
  const viewer: PublishedViewer | null = user ? { userId: user.id, name: user.name, permissionSets } : null;
  const userList = users.map((u) => ({ id: u.id, name: u.name }));

  const language = user?.language ?? DEFAULT_LANGUAGE;

  const sharing = user ? viewerSharing(user.id, org) : Promise.resolve(null);
  const dir = path.join(CACHE_ROOT, cache.contentVersionId);
  const snapshotPath = (sets: string[], lang: string) => path.join(dir, `snapshot-v${SNAPSHOT_VERSION}-${lang}-${comboKey(sets)}.json`);
  if (fs.existsSync(snapshotPath(permissionSets, language))) {
    const saved = JSON.parse(fs.readFileSync(snapshotPath(permissionSets, language), "utf8")) as SnapshotCore;
    return { ...applyListViewSharing(saved, await sharing), profile, cache, viewer, users: userList };
  }

  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, "cache.zip");
  let languages: string[] = [];
  try {
    await download(cache.contentVersionId, zip, org);
    // Build every combination on the profile now, so switching users doesn't re-download.
    const combos = new Map<string, { sets: string[]; language: string }>([[`${language} ${comboKey(permissionSets)}`, { sets: permissionSets, language }]]);
    for (const u of users) {
      if (combos.size < MAX_COMBOS) combos.set(`${u.language} ${comboKey(u.permissionSets)}`, { sets: u.permissionSets, language: u.language });
    }
    languages = [...new Set([...[...combos.values()].map((c) => c.language), DEFAULT_LANGUAGE])];
    const { files, tabTranslations } = await extract(zip, dir, languages);
    const tabObjects = [...new Set(Object.values(files.nav).map((t) => str(t.sobjectName)).filter(Boolean))];
    const available = await availableTablesFor(profile, tabObjects, org);
    let result: SnapshotCore | null = null;
    for (const c of combos.values()) {
      // OfflineUserService.getCurrentLocalizationFile: the user's language, else en_US.
      const translations = tabTranslations.get(c.language) ?? tabTranslations.get(DEFAULT_LANGUAGE);
      const snapshot = buildSnapshot({ ...files, translations }, { profile, cache, permissionSets: c.sets, availableTables: available?.(c.sets) });
      fs.writeFileSync(snapshotPath(c.sets, c.language), JSON.stringify(snapshot));
      if (c.sets === permissionSets && c.language === language) result = snapshot;
    }
    return { ...applyListViewSharing(result as SnapshotCore, await sharing), viewer, users: userList };
  } finally {
    // Keep only the snapshots — the raw files hold the org's full metadata.
    for (const f of ["cache.zip", ...FILES.map((x) => `${x}.json`), ...languages.map((l) => `${l}.json`)]) fs.rmSync(path.join(dir, f), { force: true });
  }
}
