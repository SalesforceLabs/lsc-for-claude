/**
 * The properties of a Lightning page component, for the properties sheet of
 * the iPad preview's Edit mode. A custom LWC's come from the `targetConfigs`
 * of its bundle's `js-meta.xml` (`lightning__HomePage` / `lightning__RecordPage`);
 * the standard and LSC components the iPad draws come from a curated table
 * beside the component catalog. Each definition says whether the iPad reads
 * the property at all — lifesciences-ios is the source of truth, and
 * `published.ts` keeps the properties it passes to the preview (`PROP_KEEP`).
 * Read-only.
 */

import { XMLParser } from "fast-xml-parser";
import { query } from "./helpers.js";
import { componentInfo, PROP_KEEP } from "./published.js";

export type PropKind = "String" | "Integer" | "Boolean" | "Picklist";

export interface ComponentPropDef {
  name: string;
  label: string;
  type: PropKind;
  /** A String that wants a text area. */
  multiline?: boolean;
  description?: string;
  default?: string;
  min?: number;
  max?: number;
  required?: boolean;
  /** A picklist's values (a static datasource). */
  options?: string[];
  /**
   * Whether the iPad reads it: `unused` ones are greyed out. `unknown` is only
   * for a component Studio hasn't traced (`ComponentProps.unlisted`); the sheet
   * says so once for the component, not on each field.
   */
  ipad: "used" | "unused" | "unknown";
  ipadNote?: string;
}

/** How a page property that no definition lists is treated. */
export type Unlisted = "used" | "unused" | "unknown";

export interface ComponentProps {
  component: string;
  source: "bundle" | "curated" | "none";
  properties: ComponentPropDef[];
  /** Every non-empty property is read by the iPad whatever its name (the Agentforce welcome's prompt chips). */
  dynamic?: string;
  /** Whether the iPad draws the component at all (SFComponentsFactory and the module overrides); `no` means none of its properties is used. */
  renders: "yes" | "no";
  /** Said once for the whole component: not drawn, only an inline LWC's height passed, or not traced. */
  rendersNote?: string;
  /** How the page's properties that `properties` doesn't list are treated. */
  unlisted: Unlisted;
  /** What's partial about the definitions. */
  note?: string;
}

/** Properties the iPad preview reads from any component (`published.ts`). */
export const IPAD_READS: string[] = [...PROP_KEEP, "rowsToDisplay", "maxRecordsToDisplay", "active"].sort();

const trimNs = (name: string) => (name.includes(":") ? name.split(":")[1] : name);
const isInline = (component: string) => /^lscMobileInline_/.test(trimNs(component));

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const TARGETS = { HomePage: "lightning__HomePage", RecordPage: "lightning__RecordPage" } as const;

/**
 * The properties a `js-meta.xml` offers on a Home or record page (both when
 * `pageType` is omitted), first definition wins by name. Types: Integer and
 * Boolean as such, a static `datasource` makes a picklist, anything else is a string.
 */
export function parseJsMeta(xml: string, pageType?: "HomePage" | "RecordPage"): ComponentPropDef[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseAttributeValue: false });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }
  type Node = Record<string, unknown>;
  const bundle = doc.LightningComponentBundle as Node | undefined;
  const configs = asArray((bundle?.targetConfigs as Node | undefined)?.targetConfig as Node | Node[] | undefined);
  const wanted: string[] = pageType ? [TARGETS[pageType]] : Object.values(TARGETS);
  const out = new Map<string, ComponentPropDef>();
  for (const config of configs) {
    const targets = String(config["@_targets"] ?? "")
      .split(",")
      .map((t) => t.trim());
    if (!targets.some((t) => wanted.includes(t))) continue;
    for (const p of asArray(config.property as Node | Node[] | undefined)) {
      const name = String(p["@_name"] ?? "");
      if (!/^\w+$/.test(name) || out.has(name)) continue;
      const type = String(p["@_type"] ?? "String");
      const datasource = String(p["@_datasource"] ?? "").trim();
      const options = datasource && !/^apex:\/\//i.test(datasource) ? datasource.split(",").map((o) => o.trim()).filter(Boolean) : [];
      const kind: PropKind = options.length ? "Picklist" : /^integer$/i.test(type) ? "Integer" : /^boolean$/i.test(type) ? "Boolean" : "String";
      const num = (a: string) => (p[a] !== undefined && String(p[a]).trim() !== "" && Number.isFinite(Number(p[a])) ? Number(p[a]) : undefined);
      out.set(name, {
        name,
        label: String(p["@_label"] ?? "") || name,
        type: kind,
        ipad: "unknown",
        ...(p["@_description"] ? { description: String(p["@_description"]) } : {}),
        ...(p["@_default"] !== undefined ? { default: String(p["@_default"]) } : {}),
        ...(kind === "Integer" && num("@_min") !== undefined ? { min: num("@_min") } : {}),
        ...(kind === "Integer" && num("@_max") !== undefined ? { max: num("@_max") } : {}),
        ...(String(p["@_required"]) === "true" ? { required: true } : {}),
        ...(options.length ? { options } : {}),
      });
    }
  }
  return [...out.values()];
}

type Curated = {
  label: string;
  properties: ComponentPropDef[];
  dynamic?: string;
  /** How a page property no definition lists is treated. Default `unused`: the table lists every property the iOS code reads. */
  unlisted?: Unlisted;
  /** Said once for the component. */
  note?: string;
};
type DefInput = Omit<ComponentPropDef, "ipad">;

const used = (d: DefInput, ipadNote?: string): ComponentPropDef => ({ ...d, ipad: "used", ...(ipadNote ? { ipadNote } : {}) });
const unused = (d: DefInput, ipadNote = "The iPad ignores this."): ComponentPropDef => ({ ...d, ipad: "unused", ipadNote });

const str = (name: string, label: string, description?: string): ComponentPropDef => used({ name, label, type: "String", ...(description ? { description } : {}) });
const bool = (name: string, label: string, def = "false", description?: string): ComponentPropDef =>
  used({ name, label, type: "Boolean", default: def, ...(description ? { description } : {}) });
const int = (name: string, label: string, min = 1, max = 9999, description?: string): ComponentPropDef =>
  used({ name, label, type: "Integer", min, max, ...(description ? { description } : {}) });

const MOBILE_HEIGHT = used({
  name: "mobileHeight",
  label: "Height on iPad (pt)",
  type: "Integer",
  min: 1,
  max: 9999,
  default: "400",
  description: "How tall the component's frame is on the iPad.",
});

/** Shown once for a component the iPad doesn't draw (SFComponentsFactory returns nil for it). */
export const NOT_RENDERED_NOTE = "The iPad doesn't draw this component, so none of its properties are used.";
/** Shown once for an inline LWC: LMRModule hands the web view only its height, the record id and the object name. */
export const INLINE_LWC_NOTE =
  "The iPad runs this inline LWC but passes it only its height, the record id and the object name. Its other properties aren't sent.";
/** Shown once for a component the iPad draws that reads none of its page properties. */
export const NO_PROPERTIES_NOTE = "The iPad draws this component but doesn't read any of its properties.";
/** The last resort: a component Studio hasn't traced. */
export const UNTRACED_NOTE = "Studio hasn't traced which properties the iPad reads for this component.";

const GRL_KEYS = [
  str("objectName", "Object"),
  str("fieldSetName", "Field set"),
  str("label", "Label"),
  str("whereClause", "Where clause"),
  str("relationshipFieldName", "Relationship field"),
  str("allowedRecordTypes", "Allowed record types"),
  str("newActionComponent", "New action component"),
  str("handlerForUpdateDelete", "Update and delete handler"),
  str("viewAllComponent", "View all component"),
  str("DisplayAsMobile", "Display as (mobile)"),
];

const range = (prefix: string, label: string, n: number) =>
  Array.from({ length: n }, (_, i) => bool(`${prefix}${i + 1}`, `${label} ${i + 1}`, "false"));

/** Related-list properties of the dynamic list (DynamicRelatedListProperties.swift:15-26, 96-100). */
const DYNAMIC_LIST_PROPS = [
  str("relatedListApiName", "Related list"),
  str("parentFieldApiName", "Parent field"),
  str("relatedListLabel", "Label"),
  str("relatedListDisplayType", "Display type", "The iPad draws a grid whatever this says; it only picks the list component."),
  str("sortFieldAlias", "Sort column"),
  str("sortFieldOrder", "Sort order"),
  int("maxRecordsToDisplay", "Records to show", 1, 9999, "Same as Rows to show."),
  bool("showActionBar", "Show action bar", "true", "Only an explicit off hides the bar and its New button."),
];

/**
 * Standard and LSC components the iPad draws, by full name or the name without
 * its namespace. Every entry lists the properties the iOS code reads
 * (lifesciences-ios; the file:line is cited on each); any other property on
 * the page is "Not used on the iPad". Every component reads `title` as its
 * header (SFComponentViewController.swift:119, 395) — the sheet knows that
 * without listing it.
 */
const CURATED: Record<string, Curated> = {
  // DynamicUI/DynamicUI/SFComponentTab.swift:204 (title); SFComponentTabSetView.swift:125 (active, handled by Studio itself)
  "flexipage:tab": {
    label: "Tab",
    properties: [used({ name: "title", label: "Tab title", type: "String", required: true, description: "The iPad cuts titles over 25 characters short." })],
  },
  // SFComponentTabSetView.swift:87 reads only `tabs` (the tab items); nothing else, the iPad draws its own tab bar.
  "flexipage:tabset": {
    label: "Tabs",
    properties: [unused({ name: "variant", label: "Variant", type: "Picklist", options: ["default", "scoped", "vertical"] }, "The iPad draws its own tab bar.")],
  },
  // SFComponentAccordion/SFComponentAccordion.swift:94 (defaultSectionName)
  "flexipage:accordion": { label: "Accordion", properties: [str("defaultSectionName", "Section open at first")] },
  // DynamicForms/ViewModels/FieldSectionLayoutViewModel.swift:23 (label)
  "flexipage:fieldSection": { label: "Field section", properties: [str("label", "Label")] },
  // OCE/Classes/UI/RichText/RichTextCoordinator.swift:32-33 (richTextValue, decorate); :41 decorate matters off the Home page
  "flexipage:richText": {
    label: "Rich text",
    properties: [
      used({ name: "richTextValue", label: "Text", type: "String", multiline: true, description: "HTML shown in the component." }),
      bool("decorate", "Decorate", "false", "Draws the text in a card. On a Home page the card is always drawn."),
    ],
  },
  // OCEDemo/DynamicUI/SFComponentRecentItemsVC.swift: a fixed 200 pt tall list, no property read
  "flexipage:recentItems": { label: "Recent items", properties: [] },
  // SFComponentRelatedListsVC.swift:100 -> SFComponentRelatedListVC.swift:769-779 (setupEnhancedListWith)
  "force:relatedListContainer": {
    label: "Related lists",
    properties: [
      int("rowsToDisplay", "Rows to show", 1, 9999, "The iPad shows 5 rows unless the list is dynamic or an advanced grid."),
      str("relatedListComponentOverride", "Component override"),
    ],
  },
  // Core/DynamicRelatedLists/DynamicRelatedListProperties.swift:15-26, 96-100; SFComponentRelatedListVC.swift:769-779
  "force:relatedListSingleContainer": {
    label: "Related list",
    properties: [
      int("rowsToDisplay", "Rows to show", 1, 9999, "The iPad shows 5 rows unless the list is dynamic or an advanced grid."),
      str("relatedListComponentOverride", "Component override"),
      ...DYNAMIC_LIST_PROPS,
    ],
  },
  "lst:dynamicRelatedList": {
    label: "Related list",
    properties: [int("rowsToDisplay", "Rows to show", 1, 9999), str("relatedListComponentOverride", "Component override"), ...DYNAMIC_LIST_PROPS],
  },
  // OCEDemo/DynamicUI/SFComponentDashboardVC.swift:36 (dashboardName)
  "desktopDashboards:embeddedDashboard": {
    label: "Dashboard",
    properties: [used({ name: "dashboardName", label: "Dashboard", type: "String", required: true })],
  },
  // OCE/Classes/ReportChart/Helpers/ReportChartConfigParser.swift:15-70; SFComponentGenericSObjectJsonParserVC.swift:104-116
  "flexipage:reportChart": {
    label: "Report chart",
    properties: [
      used({ name: "reportName", label: "Report", type: "String", required: true }),
      str("label", "Label"),
      int("cacheAge", "Cache age", 0, 9999999),
      bool("showRefreshButton", "Show refresh button"),
      str("reportFilter", "Report filter column", "On a record page the report is filtered to the record on this column."),
    ],
  },
  // OCE/Classes/FilterListCard/FilterListCardViewModel.swift:29-34
  "flexipage:filterListCard": {
    label: "List view",
    properties: [
      str("entityName", "Object"),
      str("filterName", "List view"),
      int("pageSize", "Records per page", 1, 9999),
      bool("enableInlineEdit", "Inline edit"),
      bool("hideActionBar", "Hide action bar"),
      bool("hideSearchBar", "Hide search bar"),
    ],
  },
  // OCE/Classes/UI/Tableau/TableauViewCoordinator.swift:17-18, 32-33 (vizUrl, height; height defaults to 500)
  "tableau:tableauViz": { label: "Tableau", properties: [str("vizUrl", "Viz URL"), int("height", "Height", 1, 9999)] },
  // OCEDemo/DynamicUI/Tableau Components/SFComponentEmbeddedMetric.swift:22-27, 52-57
  "analytics_embedding:metric": {
    label: "CRM Analytics metric",
    properties: [
      str("metricId", "Metric"),
      str("semanticModelId", "Semantic model"),
      bool("showAppliedFilters", "Show applied filters"),
      bool("showChart", "Show chart"),
      bool("showInsightSummary", "Show insight summary"),
      bool("showPeriodOverPeriodChange", "Show period-over-period change"),
    ],
  },
  // SFComponentEmbeddedDashboard.swift:23-26, 50-57 (height defaults to 400)
  "analytics_embedding:dashboard": {
    label: "CRM Analytics dashboard",
    properties: [str("dashboardId", "Dashboard"), str("filterString", "Filters"), int("height", "Height", 1, 9999)],
  },
  // SFComponentEmbeddedVisualization.swift:23-28, 57-64 (height defaults to 400, plus a 36 pt toolbar)
  "analytics_embedding:visualization": {
    label: "CRM Analytics visualization",
    properties: [str("visualizationApiName", "Visualization"), str("filterString", "Filters"), int("height", "Height", 1, 9999)],
  },
  // OCEDemo/DynamicUI/SFComponentActivityPlanProductsVC.swift:52-62
  ActivityPlanByProduct: {
    label: "Activity plan by product",
    properties: [
      used({
        name: "planCycleType",
        label: "Plan cycle type",
        type: "Picklist",
        options: ["AccountGoal", "AccountGoalShared", "CallPlan", "ProductTerritoryAllocation", "WorkingDays", "OrderQuota"],
        default: "AccountGoal",
      }),
      used(
        { name: "showEnhActivityPlanOnMobileHomepage", label: "Enhanced plan on Home", type: "Boolean", default: "false" },
        "When on, the card takes the full width; otherwise it pairs with another half-width card."
      ),
    ],
  },
  // OCEDemo/DynamicUI/AgentforceWelcomeComponent/AgentforceWelcomeViewModel.swift:70-88: every property value is a prompt chip
  lsAgentforceWelcome: {
    label: "Agentforce welcome",
    properties: [],
    dynamic: "Every property with a value becomes a prompt chip on the iPad, whatever its name.",
  },
  // module/Flows/Flows/Module/Input/FlowInfo.swift:55-57
  "flowruntime:interview": {
    label: "Flow",
    properties: [str("flowName", "Flow", "Required: the iPad shows nothing without it."), str("flowLayout", "Layout"), str("flowArguments", "Arguments", "JSON list of arguments.")],
  },
  // DynamicUI/DynamicUI/Compliance Statements/ComplianceStatementsComponentVC.swift:99-100
  complianceStatements: { label: "Compliance statements", properties: [int("thresholdForAutoSave", "Auto-save threshold", 0, 9999)] },
  // OCEDemo/DynamicUI/SFComponentRelatedListVC.swift:1663-1664 (the rest of this parser's properties go to the generic list: see unlisted)
  profilingQuestions: { label: "Profiling questions", properties: [str("formTemplate", "Form template"), str("profilingMode", "Mode", "view or edit")], unlisted: "unknown", note: UNTRACED_NOTE },
  // SFComponentRelatedListVC.setupWith(componentProperties:) takes the whole list; Studio hasn't traced its reads
  listViewWithSobjectJsonParser: { label: "List view", properties: [], unlisted: "unknown", note: UNTRACED_NOTE },
  recordViewWithSobjectJsonParser: { label: "Record view", properties: [], unlisted: "unknown", note: UNTRACED_NOTE },
  // module/Planner/Planner/DynamicUI/SFComponentCustomerInfo.swift:145,151
  CustomerInfoDashboard: { label: "Customer info", properties: [str("accountFieldSet", "Account field set"), str("addressFieldSet", "Address field set")] },
  // module/KAM/KAM/BusinessObjective/AccountPlan/SFComponentSituationalAnalysis.swift:88
  accountPlanAnalysis: { label: "Account plan analysis", properties: [str("relatedListApiName", "Related list")] },
  // module/Meetings/module/MeetingsModule.swift:294; DynamicUI/GenericRelatedList/Models/GenericRelatedList.Configuration.swift:57-67 (objectName and fieldSetName are required)
  LSCVideoCallRecordingList: { label: "Video call recordings", properties: GRL_KEYS },
  LSCGenericRelatedList: { label: "Generic related list", properties: GRL_KEYS },
  // MeetingsModule.swift:321 builds the expense grid. The expense view controllers read label, objectName, whereClause, fieldSetName,
  // newActionComponent, handlerForUpdateDelete and viewAllComponent (ViewComponentProperties.swift:23-31), but which one this builds isn't traced.
  EventExpensesLwc: { label: "Event expenses", properties: [], unlisted: "unknown", note: UNTRACED_NOTE },
  // module/KAM/KAM/ActionPlanListCard/SFComponentActionPlanListCard.swift:21,74-75
  "runtime_industries_actionplan:listCard": { label: "Action plans", properties: [int("rowsToDisplay", "Rows to show", 1, 9999)] },
};

/**
 * Components the factory matches by name suffix (`hasSuffix`), in
 * SFComponentsFactory order; the first match wins like the factory's switch.
 */
const SUFFIX_CURATED: [string, Curated][] = [
  // OCEDemo/Tabs/AccountActivityPlan/ActivityPlanViewModel.swift:22,44-50: only "showCumulative" shows the cumulative gauge
  [
    "ActivityPlan",
    {
      label: "Activity plan",
      properties: [
        used({ name: "activityFilter", label: "Cumulative gauge", type: "Picklist", options: ["showCumulative", "hideCumulative"], description: "Any value but showCumulative hides the cumulative gauge." }),
      ],
    },
  ],
  // OCEDemo/DynamicUI/SFAccountActivityPlanComponentVC.swift:36
  [
    "AccountActivityGoal",
    {
      label: "Account activity goals",
      properties: [
        used({ name: "activityFilter", label: "Cumulative gauge", type: "Picklist", options: ["showCumulative", "hideCumulative"], description: "Any value but showCumulative hides the cumulative gauge." }),
      ],
    },
  ],
  // OCE/Classes/AccountTeamComponent/SFComponentAccountTeam.swift:87 (case-insensitive)
  ["accountTeamView", { label: "Account team", properties: [str("fieldSetName", "Field set")] }],
  // OCEDemo/Tabs/NextBestCustomer/NextBestCustomersViewModel.swift:166-175
  [
    "NbcTopCards",
    { label: "Next Best Customers", properties: [int("totalCards", "Cards to show", 1, 9999), str("graphName", "Graph")] },
  ],
  // OCEDemo/DynamicUI/SFComponentCustomerRatingsVC.swift:72-78
  [
    "Ratings",
    {
      label: "Customer ratings",
      properties: [str("layoutName", "Layout", "Required: the iPad shows nothing without it."), bool("isAbleToCreateATP", "Can create ATP"), bool("showProductRatingsInGroups", "Show product ratings in groups")],
    },
  ],
  // OCEDemo/DynamicUI/SFComponentSalesChartVC.swift:48-53; Tabs/Charts/ChartsFlexiPageConfig.swift:21-26,87-; MeasureType.swift:36; ChartConstants.swift:52-60
  [
    "SalesChart",
    {
      label: "Sales chart",
      properties: [
        str("title", "Title"),
        str("salesDataType", "Sales data type"),
        str("rangeOfUnits", "Range of units"),
        str("dataSet", "Data set"),
        str("type", "Chart type"),
        ...range("measure", "Measure", 8),
        ...range("filter", "Filter", 8),
      ],
    },
  ],
  // OCEDemo/DynamicUI/SFComponentTimelineVC.swift:20-26, 70-72 (a value list, not editable here)
  ["timeline", { label: "Timeline", properties: [], note: "The iPad reads its configuration from the timelineConfigs or timelineMetadataRecordDeveloperName value list." }],
  // OCEDemo/Tabs/MilestonesGanttChart/MilestonesGanttChartViewModel.swift:141-150
  ["ganttChart", { label: "Gantt chart", properties: [str("ganttCustomMetadataRecordName", "Configuration record"), str("metadataConfigName", "Configuration name")] }],
  // OCEDemo/DynamicUI/SFComponentSurveysVC.swift:15-16, 29-30
  [
    "surveyListView",
    { label: "Surveys", properties: [bool("isRetakeAvailable", "Retake available"), bool("enableRetakeWithCopyingLastResponses", "Retake with copied responses")] },
  ],
  // module/Maps/Maps/DynamicUI/SFComponentHomeMapsVC.swift:61,64 (case-insensitive)
  ["UpNextMapDisplay", { label: "Up next map", properties: [int("minBeforeDndReminder", "Minutes before DND reminder", 0, 9999), int("minBeforeEventReminder", "Minutes before event reminder", 0, 9999)] }],
  ["UpcomingAgenda", { label: "Upcoming agenda", properties: [int("minBeforeDndReminder", "Minutes before DND reminder", 0, 9999), int("minBeforeEventReminder", "Minutes before event reminder", 0, 9999)] }],
  // module/Orders/Orders/ViewOrder/View/SFComponentTransactionSummary.swift:120; CreateOrder/Utils/OrderLineColumnBuilder.swift:159
  ["transactionSummary", { label: "Transaction summary", properties: [str("footerFields", "Footer fields")] }],
  ["salesTxnLineTable", { label: "Sales transactions", properties: [str("displayFields", "Display fields")] }],
];

/** The curated entry for a page `componentName`: the full name, the name without its namespace, then the factory's suffix matches. */
export function curatedFor(component: string): Curated | undefined {
  const trimmed = trimNs(component);
  const exact = CURATED[component] ?? CURATED[trimmed];
  if (exact) return exact;
  if (trimmed.toLowerCase().includes("lscgenericrelatedlist")) return CURATED.LSCGenericRelatedList;
  return SUFFIX_CURATED.find(([suffix]) => trimmed.endsWith(suffix))?.[1];
}

/** An LWC's own properties: `mobileHeight` on an inline LWC is read; nothing else is passed to it (LMRModule.swift:110). It's offered only when the bundle declares it — the org rejects a property its js-meta.xml doesn't. */
function markBundleProps(component: string, defs: ComponentPropDef[]): ComponentPropDef[] {
  const inline = isInline(component);
  const mapped = defs.map((d): ComponentPropDef => {
    if (inline && d.name === "mobileHeight") return { ...d, min: d.min ?? 1, ipad: "used", ipadNote: MOBILE_HEIGHT.ipadNote };
    return { ...d, ipad: "unused", ipadNote: "The iPad ignores this." };
  });
  return mapped;
}

/** The bundle's `js-meta.xml`, or null when it can't be read (managed bundles hide their source). */
async function jsMetaOf(component: string, org: string): Promise<string | null> {
  const [ns, name] = component.includes(":") ? component.split(":") : ["c", component];
  const nsClause = ns === "c" ? "LightningComponentBundle.NamespacePrefix = null" : `LightningComponentBundle.NamespacePrefix = '${ns}'`;
  const rows = await query(
    `SELECT Source FROM LightningComponentResource WHERE FilePath LIKE '%.js-meta.xml' AND LightningComponentBundle.DeveloperName = '${name}' AND ${nsClause} LIMIT 1`,
    org,
    true
  );
  const source = rows[0]?.Source;
  return typeof source === "string" && source.trim() ? source : null;
}

const STANDARD_NAMESPACES = new Set(["flexipage", "force", "forceChatter", "lightning", "desktopDashboards", "analytics_embedding", "tableau", "flowruntime", "runtime_sales_activities", "forceContent", "wave", "lst"]);

/**
 * Definitions for one component, and whether the iPad draws it at all. The
 * iPad draws exactly what SFComponentsFactory and the module overrides build
 * (`componentInfo`, which the preview uses too); anything else is not drawn and
 * none of its properties are used. A drawn component's properties come from
 * the curated table (everything it doesn't list is ignored), an inline LWC's
 * from its js-meta.xml (only the height is passed on), and a drawn component
 * with no table entry reads none.
 */
export async function collectComponentProps(component: string, pageType: "HomePage" | "RecordPage" | undefined, org: string): Promise<ComponentProps> {
  if (!/^\w+(:\w+)?$/.test(component)) throw new Error(`Invalid component name: ${component}`);
  const drawn = componentInfo(component).supported;
  const ns = component.includes(":") ? component.split(":")[0] : "c";

  const fromBundle = async (): Promise<ComponentPropDef[] | null> => {
    let xml: string | null = null;
    try {
      xml = await jsMetaOf(component, org);
    } catch {
      xml = null;
    }
    return xml ? markBundleProps(component, parseJsMeta(xml, pageType)) : null;
  };

  if (!drawn) {
    // Typed fields for a custom LWC are still useful to edit; each is ignored and the sheet says so once.
    const bundle = STANDARD_NAMESPACES.has(ns) ? null : await fromBundle();
    const properties = (bundle ?? []).map((d): ComponentPropDef => ({ ...d, ipad: "unused", ipadNote: "The iPad ignores this." }));
    return { component, source: bundle ? "bundle" : "none", properties, renders: "no", rendersNote: NOT_RENDERED_NOTE, unlisted: "unused" };
  }

  if (isInline(component)) {
    const bundle = await fromBundle();
    if (bundle) return { component, source: "bundle", properties: bundle, renders: "yes", rendersNote: INLINE_LWC_NOTE, unlisted: "unused" };
    return {
      component,
      source: "curated",
      properties: [MOBILE_HEIGHT],
      renders: "yes",
      rendersNote: INLINE_LWC_NOTE,
      unlisted: "unused",
      note: "Studio couldn't read this component's js-meta.xml (a managed package hides it). Its own properties are listed untyped.",
    };
  }

  const curated = curatedFor(component);
  if (curated) {
    const unlisted: Unlisted = curated.dynamic ? "used" : (curated.unlisted ?? "unused");
    return {
      component,
      source: "curated",
      properties: curated.properties,
      renders: "yes",
      unlisted,
      ...(curated.dynamic ? { dynamic: curated.dynamic } : {}),
      ...(curated.note ? { rendersNote: curated.note } : {}),
    };
  }
  return { component, source: "curated", properties: [], renders: "yes", rendersNote: NO_PROPERTIES_NOTE, unlisted: "unused" };
}
