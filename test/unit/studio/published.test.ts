import { describe, it, expect } from "vitest";
import {
  applyListViewSharing,
  buildPage,
  buildReportTree,
  buildSnapshot,
  buildTabs,
  componentInfo,
  dashboardData,
  dashboardFromDescribe,
  effectiveProfile,
  fieldLabel,
  separatedWithSpaces,
  tabKind,
  trimNamespace,
  visibilityOf,
  type MetadataFiles,
  type ViewerSharing,
} from "../../../src/studio/published.js";

type Row = Record<string, unknown>;

const comp = (componentName: string, extra: Row = {}): Row => ({
  componentInstance: { componentName, componentInstanceProperties: [], ...extra },
});

function files(overrides: Partial<MetadataFiles> = {}): MetadataFiles {
  return {
    nav: {
      home: { fullName: "standard-home", label: "Start", type: "flexipage", flexiPage: "Rep_Home", tabOrder: 1 },
      accounts: { fullName: "lsc4ce__Accounts", label: "Accounts", tabOrder: 2 },
      visits: { fullName: "standard-Visit", label: "Visits", type: "sobject", sobjectName: "Visit", tabOrder: 3 },
      orders: { fullName: "standard-Order", label: "Orders", type: "sobject", sobjectName: "Order", tabOrder: 4 },
      admin: { fullName: "lsc4ce__AdminConsole", label: "Admin Console", type: "flexipage", tabOrder: 5 },
      planner: { fullName: "lsc4ce__Planner", label: "Calendar" },
    },
    ui: {
      flexiPages: {
        Rep_Home: {
          masterLabel: "Rep Home",
          type: "HomePage",
          template: { name: "home:desktopTemplate" },
          flexiPageRegions: [
            { name: "top", type: "Region", itemInstances: [comp("c:UpcomingAgenda"), comp("c:UnsubmittedVisits"), comp("c:Q_Demo_Tracker")] },
            { name: "sidebar", type: "Region", itemInstances: [comp("flexipage:recentItems")] },
          ],
        },
      },
      pageLayouts: {
        "Visit-Visit Layout": {
          layoutSections: [
            {
              label: "Information",
              detailHeading: "true",
              layoutColumns: [{ layoutItems: [{ fullName: "Name" }, { fullName: "Status" }] }, { layoutItems: [] }],
            },
          ],
          relatedLists: [{ relatedList: "ProviderVisits", relatedListLabel: "Provider Visits" }],
        },
      },
      compactLayouts: { "Visit.VisitCompact": { fields: [{ fullName: "Name" }, { label: "Status" }] } },
      listViews: {
        "Visit.My": { fullName: "My", label: "My Visits", columns: [{ fullName: "NAME" }] },
        "Visit.All": { fullName: "All", label: "All Visits", columns: [] },
      },
    },
    permissions: {
      profile: {
        tabVisibilities: [
          { tab: "standard-home", visibility: "DefaultOn" },
          { tab: "lsc4ce__Accounts", visibility: "DefaultOn" },
          { tab: "standard-Visit", visibility: "DefaultOn" },
          { tab: "standard-Order", visibility: "DefaultOn" },
          { tab: "lsc4ce__AdminConsole", visibility: "Hidden" },
          { tab: "lsc4ce__Planner", visibility: "DefaultOn" },
        ],
        recordTypeVisibilities: [{ recordType: "Visit.Hidden", visible: false }],
      },
    },
    db: { Visit: {}, Account: {} },
    sobjects: {
      Account: { label: "Account", labelPlural: "Accounts", recordTypes: [] },
      Visit: {
        label: "Visit",
        labelPlural: "Visits",
        compactLayoutAssignment: "VisitCompact",
        recordTypes: [
          { fullName: "Master", label: "Master" },
          { fullName: "Field", label: "Field Visit", layout: "Visit-Visit Layout" },
          { fullName: "Hidden", label: "Hidden" },
          { fullName: "Old", label: "Old", active: false },
        ],
      },
    },
    ...overrides,
  };
}

const meta = { profile: "Rep", cache: { recordId: "1", name: "Cache", contentVersionId: "068", generatedAt: "", sizeBytes: null } };

describe("trimNamespace", () => {
  it("strips prefixes the app namespace contains only", () => {
    expect(trimNamespace("c:myCard")).toBe("myCard");
    expect(trimNamespace("lsc4ce:UpcomingAgenda")).toBe("UpcomingAgenda");
    expect(trimNamespace("industries_ls_commercial:foo")).toBe("industries_ls_commercial:foo");
    expect(trimNamespace("plain")).toBe("plain");
  });
});

describe("tabKind", () => {
  const no = () => false;
  it("routes special tabs, objects, and pages", () => {
    expect(tabKind({ fullName: "lsc4ce__Planner" }, no)).toBe("calendar");
    expect(tabKind({ fullName: "AccountFilter" }, no)).toBe("accounts");
    expect(tabKind({ fullName: "x", auraComponent: "lsc4ce__PlanCycleModalWrapper" }, no)).toBe("activityPlanReview");
    expect(tabKind({ fullName: "standard-report" }, no)).toBe("reports");
    expect(tabKind({ fullName: "standard-Visit", type: "sobject", sobjectName: "Visit" }, no)).toBe("object");
    expect(tabKind({ fullName: "Custom", type: "flexipage" }, no)).toBe("flexiPage");
    expect(tabKind({ fullName: "standard-home", type: "flexipage" }, no)).toBe("home");
    expect(tabKind({ fullName: "Web", type: "url" }, no)).toBe("empty");
  });
  it("drops Dashboards without a Dashboard table", () => {
    expect(tabKind({ fullName: "standard-Dashboard" }, no)).toBeNull();
    expect(tabKind({ fullName: "standard-Dashboard" }, () => true)).toBe("dashboards");
  });
});

describe("buildTabs", () => {
  it("filters, sorts by tabOrder (missing last), relabels Home, and pins Recent Items", () => {
    const { tabs, hidden } = buildTabs(files());
    expect(tabs.map((t) => t.label)).toEqual(["Home", "Accounts", "Visits", "Calendar", "Recent Items"]);
    expect(tabs.at(-1)?.kind).toBe("recent");
    expect(hidden.map((h) => h.label).sort()).toEqual(["Admin Console", "Orders"]);
    expect(hidden.find((h) => h.label === "Orders")?.reason).toMatch(/synced/);
  });
  it("filters object tabs by the user's available tables (exact name) when known", () => {
    const { tabs, hidden } = buildTabs(files(), new Set(["Order", "Account"]));
    expect(tabs.map((t) => t.label)).toEqual(["Home", "Accounts", "Orders", "Calendar", "Recent Items"]);
    expect(hidden.find((h) => h.label === "Visits")?.reason).toMatch(/active DB Schema record the user can read/);
    expect(buildTabs(files(), new Set(["visit"])).tabs.map((t) => t.label)).not.toContain("Visits");
  });
  it("shows an available object tab without published object metadata as Coming soon", () => {
    const orders = buildTabs(files(), new Set(["Order", "Visit"])).tabs.find((t) => t.fullName === "standard-Order");
    expect(orders).toMatchObject({ kind: "empty" });
    expect(orders?.emptyReason).toMatch(/Order isn't in this profile's published objects/);
  });
  it("uses the translated tab label when it's non-empty", () => {
    const translations = { tabs: { "standard-Visit": { label: "Visit" }, "lsc4ce__Planner": { label: "" } } };
    const labels = buildTabs(files({ translations })).tabs.map((t) => t.label);
    expect(labels).toEqual(["Home", "Accounts", "Visit", "Calendar", "Recent Items"]);
  });
  it("explains UI Settings tabs the app can't route", () => {
    const f = files();
    f.nav.mAccounts = { fullName: "Accounts", label: "Accounts", type: "mobile", tabOrder: 6 };
    f.nav.mVisits = { fullName: "Visits", label: "Provider Visits", type: "mobile", tabOrder: 7 };
    f.nav.mPat = { fullName: "Pat Sim", label: "Pat Sim", type: "mobile", tabOrder: 8 };
    for (const tab of ["Accounts", "Visits", "Pat Sim"])
      (f.permissions.profile as { tabVisibilities: Row[] }).tabVisibilities.push({ tab, visibility: "DefaultOn" });
    const byName = Object.fromEntries(buildTabs(f).tabs.map((t) => [t.fullName, t]));
    expect(byName.Accounts.kind).toBe("empty");
    expect(byName.Accounts.emptyReason).toContain('Use "lsc4ce__Accounts"');
    expect(byName.Visits.emptyReason).toContain("already shows as its own tab (standard-Visit)");
    expect(byName["Pat Sim"].emptyReason).toMatch(/only open the app's native screens \(/);
    expect(byName["lsc4ce__Accounts"].emptyReason).toBeUndefined();
  });
  it("treats an orders dashboard tab as the Order__c object tab", () => {
    const f = files();
    f.nav.od = { fullName: "OrdersDashboard", label: "Orders", type: "flexipage" };
    (f.permissions.profile as { tabVisibilities: Row[] }).tabVisibilities.push({ tab: "OrdersDashboard", visibility: "DefaultOn" });
    f.sobjects.Order__c = { label: "Order" };
    expect(buildTabs(f).tabs.find((t) => t.fullName === "OrdersDashboard")).toMatchObject({ kind: "object", sobject: "Order__c" });
  });
  it("never shows Samples Management tabs", () => {
    const f = files();
    f.nav.s = { fullName: "lsc4ce__samples_management", label: "Samples", type: "flexipage" };
    (f.permissions.profile as { tabVisibilities: Row[] }).tabVisibilities.push({ tab: "lsc4ce__samples_management", visibility: "DefaultOn" });
    expect(buildTabs(f).tabs.map((t) => t.label)).not.toContain("Samples");
  });
});

describe("componentInfo", () => {
  it("matches exact, suffix, and LMR components", () => {
    expect(componentInfo("flexipage:richText")).toEqual({ label: "Rich text", supported: true });
    expect(componentInfo("c:myNbcTopCards").supported).toBe(true);
    expect(componentInfo("c:lscMobileInline_visitSummary").label).toBe("LWC · visitSummary");
  });
  it("marks unknown components unsupported", () => {
    expect(componentInfo("c:Q_Demo_Tracker")).toEqual({ label: "Q_Demo_Tracker", supported: false });
  });
});

describe("visibilityOf", () => {
  const rule = (...lefts: string[]) => ({ criteria: lefts.map((leftValue) => ({ leftValue })) });
  it("treats $Client as true, user-dependent rules as conditional, anything else as false", () => {
    expect(visibilityOf(undefined).visibility).toBe("shown");
    expect(visibilityOf(rule("{!$Client.formFactor}")).visibility).toBe("shown");
    expect(visibilityOf(rule("{!$Permission.CustomPermission.X}")).visibility).toBe("conditional");
    expect(visibilityOf(rule("{!$Browser.formFactor}")).visibility).toBe("hidden");
  });
  it("lets the first criterion decide without a booleanFilter", () => {
    expect(visibilityOf(rule("{!$Client.formFactor}", "{!$Browser.x}")).visibility).toBe("shown");
    expect(visibilityOf({ ...rule("{!$Client.formFactor}", "{!$Browser.x}"), booleanFilter: "1 OR 2" }).visibility).toBe("conditional");
  });
});

describe("buildPage", () => {
  it("renders only the template's slots and reports dropped regions", () => {
    const page = buildPage("Rep_Home", (files().ui.flexiPages as Record<string, Row>).Rep_Home);
    expect(page.template).toBe("desktopTemplate");
    expect(page.regions.map((r) => r.name)).toEqual(["top"]);
    const top = page.regions[0].components;
    expect(top.map((c) => [c.label, c.supported, c.halfWidth])).toEqual([
      ["Upcoming agenda", true, true],
      ["Unsubmitted visits", true, true],
      ["Q_Demo_Tracker", false, false],
    ]);
    expect(page.droppedRegions).toEqual([{ name: "sidebar", components: ["Recent items"] }]);
  });
  it("falls back to defaultFlexiPage for unknown templates and nests tabset tabs", () => {
    const page = buildPage("P", {
      type: "RecordPage",
      template: { name: "custom:weird" },
      flexiPageRegions: [
        {
          name: "main",
          type: "Region",
          itemInstances: [
            {
              componentInstance: { componentName: "flexipage:tabset" },
              itemInstances: [
                {
                  componentInstance: {
                    componentName: "flexipage:tab",
                    componentInstanceProperties: [{ name: "title", value: "Standard.Tab.detail" }, { name: "active", value: "true" }],
                  },
                  itemInstances: [comp("force:detailPanel")],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(page.template).toBe("defaultFlexiPage");
    expect(page.regions[0].components[0].tabs).toEqual([
      { title: "Details", active: true, components: [expect.objectContaining({ label: "Record details" })] },
    ]);
  });
});

describe("home components", () => {
  const props = (pairs: [string, string][]) => ({ componentInstanceProperties: pairs.map(([name, value]) => ({ name, value })) });
  it("keeps every Agentforce welcome property as a prompt, but only known properties elsewhere", () => {
    const page = buildPage("H", {
      type: "HomePage",
      template: { name: "home:desktopTemplate" },
      flexiPageRegions: [
        {
          name: "top",
          type: "Region",
          itemInstances: [
            comp("lsc4ce:lsAgentforceWelcome", props([["utterance1", "A"], ["utterance5", "B"], ["extra", "C"]])),
            comp("flexipage:richText", props([["richTextValue", "<p>Hi</p>"], ["decorate", "true"]])),
          ],
        },
      ],
    });
    const [welcome, rich] = page.regions[0].components;
    expect(Object.values(welcome.properties)).toEqual(["A", "B", "C"]);
    expect(rich.properties).toEqual({ richTextValue: "<p>Hi</p>" });
  });
  it("lays out embedded dashboards from the cache's reporting.json", () => {
    const describe = {
      id: "01ZHn000001Z3diMAC",
      name: "Field Rep Dashboard",
      dashboardType: "SpecifiedUser",
      components: [
        { id: "c1", header: "Donut", properties: { visualizationType: "Donut" } },
        { id: "c2", header: "Line", properties: { visualizationType: "Line", visualizationProperties: { legendPosition: "Right", showValues: true } } },
      ],
      layout: { numColumns: 12, rowHeight: 36, components: [{ column: 0, row: 0, colspan: 5, rowspan: 8 }, { column: 5, row: 0, colspan: 7, rowspan: 8 }] },
    };
    const d = dashboardFromDescribe(describe);
    expect(d.sharedResults).toBe(true);
    expect(d.components[1]).toEqual({
      id: "c2",
      title: "Line",
      subtitle: "",
      chart: "Line",
      groupBy: "",
      column: 5,
      row: 0,
      colspan: 7,
      rowspan: 8,
      legend: "Right",
      showValues: true,
      showTotal: false,
      combineSmall: false,
    });
    const f = files();
    const home = (f.ui.flexiPages as Record<string, Row>).Rep_Home as { flexiPageRegions: { itemInstances: Row[] }[] };
    home.flexiPageRegions[0].itemInstances.push(comp("desktopDashboards:embeddedDashboard", props([["dashboardName", "Rep_Dash"]])));
    const s = buildSnapshot({ ...f, reporting: { dashboards: { Rep_Dash: describe, Other: describe } } }, meta);
    expect(Object.keys(s.dashboards)).toEqual(["Rep_Dash"]);
    expect(s.dashboards.Rep_Dash.title).toBe("Field Rep Dashboard");
  });
  it("reads a report result's groupings as chart series", () => {
    const agg = (label: string, value: number) => ({ label, value });
    const meta = { reportMetadata: { aggregates: ["s!A", "s!B"] }, reportExtendedMetadata: { aggregateColumnInfo: { "s!A": { label: "Sum of A" } } } };
    const one = dashboardData({
      ...meta,
      groupingsDown: { groupings: [{ key: "0", label: "F2F" }, { key: "1", label: "Email" }] },
      factMap: { "0!T": { aggregates: [agg("22", 22), agg("1", 1)] }, "1!T": { aggregates: [agg("17", 17), agg("2", 2)] }, "T!T": { aggregates: [agg("39", 39)] } },
    });
    expect(one).toEqual({
      measures: ["Sum of A", "s!B"],
      categories: ["F2F", "Email"],
      grouped: false,
      series: [
        { label: "Sum of A", values: [22, 17], labels: ["22", "17"] },
        { label: "s!B", values: [1, 2], labels: ["1", "2"] },
      ],
      total: "39",
    });
    const two = dashboardData({
      ...meta,
      groupingsDown: {
        groupings: [
          { key: "0", label: "Jan", groupings: [{ key: "0_0", label: "X" }] },
          { key: "1", label: "Feb", groupings: [{ key: "1_0", label: "Y" }, { key: "1_1", label: "X" }] },
        ],
      },
      factMap: { "0_0!T": { aggregates: [agg("5", 5)] }, "1_0!T": { aggregates: [agg("6", 6)] }, "1_1!T": { aggregates: [agg("7", 7)] } },
    });
    expect(two.series).toEqual([
      { label: "X", values: [5, 7], labels: ["5", "7"] },
      { label: "Y", values: [null, 6], labels: ["", "6"] },
    ]);
  });
});

describe("effectiveProfile", () => {
  const permissions = {
    profile: {
      tabVisibilities: [{ tab: "MT_Accounts", visibility: "Hidden" }, { tab: "Keep", visibility: "DefaultOn" }],
      recordTypeVisibilities: [{ recordType: "Visit.Hidden", visible: false }],
    },
    permissionSets: [
      {
        fullName: "MedTech_Rep",
        tabVisibilities: [{ tab: "MT_Accounts", visibility: "Visible" }, { tab: "Keep", visibility: "None" }, { tab: "New", visibility: "DefaultOn" }],
        recordTypeVisibilities: [{ recordType: "Visit.Hidden", visible: true }],
      },
      { fullName: "Unassigned", tabVisibilities: [{ tab: "Other", visibility: "Visible" }] },
    ],
  };
  it("lets an assigned permission set turn a tab or record type on, never off", () => {
    const p = effectiveProfile(permissions, ["MedTech_Rep"]);
    const tabs = Object.fromEntries((p.tabVisibilities as Row[]).map((t) => [t.tab, t.visibility]));
    expect(tabs).toEqual({ MT_Accounts: "Visible", Keep: "DefaultOn", New: "DefaultOn" });
    expect(p.recordTypeVisibilities).toEqual([{ recordType: "Visit.Hidden", visible: true }]);
  });
  it("ignores permission sets the user doesn't have", () => {
    expect(effectiveProfile(permissions, [])).toBe(permissions.profile);
    expect((effectiveProfile(permissions, ["Unknown"]).tabVisibilities as Row[]).map((t) => t.tab)).not.toContain("Other");
  });
});

describe("buildSnapshot", () => {
  it("shows tabs a permission set makes visible", () => {
    const f = files();
    (f.permissions as Row).permissionSets = [{ fullName: "Admin_Tabs", tabVisibilities: [{ tab: "lsc4ce__AdminConsole", visibility: "Visible" }] }];
    expect(buildSnapshot(f, meta).tabs.map((t) => t.label)).not.toContain("Admin Console");
    expect(buildSnapshot(f, { ...meta, permissionSets: ["Admin_Tabs"] }).tabs.map((t) => t.label)).toContain("Admin Console");
  });

  it("builds home, objects, layouts, and compact layouts the preview needs", () => {
    const s = buildSnapshot(files(), meta);
    expect(s.home?.name).toBe("Rep_Home");
    expect(Object.keys(s.objects).sort()).toEqual(["Account", "Visit"]);
    const visit = s.objects.Visit;
    expect(visit.recordTypes.map((r) => r.name)).toEqual(["Field"]);
    expect(visit.defaultListView).toBe("All");
    expect(visit.listViews.map((l) => l.label)).toEqual(["All Visits", "My Visits"]);
    expect(s.layouts["Visit-Visit Layout"]).toEqual({
      name: "Visit-Visit Layout",
      sections: [{ label: "Information", columns: [["Name", "Status"]] }],
      relatedLists: [{ name: "ProviderVisits", label: "Provider Visits" }],
      actions: [],
    });
    expect(s.compactLayouts["Visit.VisitCompact"]).toEqual(["Status"]); // the name is the title
  });
});

describe("list views", () => {
  const views = (listViews: Record<string, Row>) => files({ ui: { ...files().ui, listViews } });
  const viewer = (over: Partial<ViewerSharing> = {}): ViewerSharing => ({
    role: "Rep",
    roleAndAbove: new Set(["Rep", "Manager"]),
    groups: new Set(["Pharma"]),
    territories: new Set(["Model.T1"]),
    territoryAndAbove: new Set(["Model.T1", "Model.Region"]),
    ...over,
  });

  it("sorts by label in code-unit order, drops recently viewed, and defaults to an All… name", () => {
    const f = views({
      "Visit.b": { fullName: "b", label: "planned" },
      "Visit.Upcoming": { fullName: "Upcoming", label: "Upcoming" },
      "Visit.All_Visit": { fullName: "All_Visit", label: "Everything" },
      "Visit.Recent": { fullName: "Recent", label: "Recent", filterScope: "MRU" },
    });
    const visit = buildSnapshot(f, meta).objects.Visit;
    expect(visit.listViews.map((l) => l.label)).toEqual(["Everything", "Upcoming", "planned"]);
    expect(visit.defaultListView).toBe("All_Visit");
  });

  it("hides views shared only with roles, groups, or territories the viewer isn't in", () => {
    const f = views({
      "Visit.Everyone": { fullName: "Everyone", label: "Everyone" },
      "Visit.All_Ceo": { fullName: "All_Ceo", label: "CEO only", sharedTo: { role: ["CEO"], group: [] } },
      "Visit.Mgr": { fullName: "Mgr", label: "Manager tree", sharedTo: { roleAndSubordinates: ["Manager"] } },
      "Visit.Grp": { fullName: "Grp", label: "Pharma group", sharedTo: { group: ["Pharma"] } },
      "Visit.Reg": { fullName: "Reg", label: "Region tree", sharedTo: { territoryAndSubordinates: ["Model.Region"] } },
      "Visit.Terr": { fullName: "Terr", label: "Other territory", sharedTo: { territory: ["Model.Region"] } },
    });
    const core = buildSnapshot(f, meta);
    expect(core.objects.Visit.defaultListView).toBe("All_Ceo");
    const visit = applyListViewSharing(core, viewer()).objects.Visit;
    expect(visit.listViews.map((l) => l.name)).toEqual(["Everyone", "Mgr", "Grp", "Reg"]);
    expect(visit.defaultListView).toBe("Everyone");
    expect(visit.hiddenListViews).toEqual([
      { label: "CEO only", reason: "Shared only with role CEO" },
      { label: "Other territory", reason: "Shared only with territory Model.Region" },
    ]);
    expect(applyListViewSharing(core, null)).toBe(core);
  });
});

describe("layout labels", () => {
  it("spaces out untranslated one-word section labels like the app", () => {
    expect(separatedWithSpaces("PV")).toBe("P V");
    expect(separatedWithSpaces("SystemInformation")).toBe("System Information");
    expect(separatedWithSpaces("Information")).toBe("Information");
  });

  it("uses translated section and related list labels, and keeps custom labels as typed", () => {
    const f = files();
    const layout = (f.ui.pageLayouts as Record<string, Row>)["Visit-Visit Layout"];
    layout.layoutSections = [
      { label: "SystemInformation", detailHeading: true, layoutColumns: [{ layoutItems: [{ fullName: "OwnerId" }] }] },
      { label: "MyCustom", customLabel: true, detailHeading: true, layoutColumns: [{ layoutItems: [{ fullName: "Name" }] }] },
      { label: "Information", detailHeading: true, layoutColumns: [{ layoutItems: [{ fullName: "Status" }] }] },
      { label: "Hidden heading", detailHeading: false, layoutColumns: [{ layoutItems: [{ fullName: "Channel" }] }] },
    ];
    f.translations = {
      layouts: { "Visit-Visit Layout": { sections: { Information: "Infos" }, relatedLists: { ProviderVisits: "PVs" } } },
    };
    const l = buildSnapshot(f, meta).layouts["Visit-Visit Layout"];
    expect(l.sections.map((s) => s.label)).toEqual(["System Information", "MyCustom", "Infos", null]);
    expect(l.relatedLists[0].label).toBe("PVs");
  });
});

describe("multiEntityRecordView", () => {
  const withMulti = (pv: Row | undefined, rtVis: Row[] = []): MetadataFiles => {
    const f = files();
    const ui = f.ui as Record<string, Record<string, Row>>;
    ui.flexiPages.Visit_Page = {
      type: "RecordPage",
      template: { name: "flexipage:recordHomeTemplateDesktop" },
      flexiPageRegions: [{ name: "main", type: "Region", itemInstances: [comp("industries_ls_commercial:multiEntityRecordView")] }],
    };
    ui.pageLayouts["ProviderVisit-PV Layout"] = { layoutSections: [{ label: "PV", detailHeading: true, layoutColumns: [{ layoutItems: [{ fullName: "IsConfirmed" }] }] }] };
    const visit = f.sobjects.Visit as { recordTypes: Row[] };
    visit.recordTypes[1].flexiPage = "Visit_Page";
    if (pv) f.sobjects.ProviderVisit = pv;
    (f.permissions.profile as Row).recordTypeVisibilities = [{ recordType: "Visit.Hidden", visible: false }, ...rtVis];
    return f;
  };

  it("stacks the Visit layout, then the ProviderVisit layout of the same record type name", () => {
    const pv = { label: "Provider Visit", recordTypes: [{ fullName: "Master", label: "Master" }, { fullName: "Field", label: "Field", layout: "ProviderVisit-PV Layout" }] };
    const s = buildSnapshot(withMulti(pv), meta);
    expect(s.objects.Visit.recordTypes[0].multiEntity).toEqual({ layouts: ["Visit-Visit Layout", "ProviderVisit-PV Layout"] });
    expect(s.layouts["ProviderVisit-PV Layout"].sections[0].label).toBe("P V"); // String.separatedWithSpaces splits every capital
  });

  it("falls back to the profile's default record type, then Master, and says so", () => {
    const pv = {
      label: "Provider Visit",
      recordTypes: [
        { fullName: "Master", label: "Master", layout: "ProviderVisit-Master" },
        { fullName: "Phone", label: "Phone", layout: "ProviderVisit-PV Layout" },
      ],
    };
    const def = buildSnapshot(withMulti(pv, [{ recordType: "ProviderVisit.Phone", default: true }]), meta).objects.Visit.recordTypes[0].multiEntity;
    expect(def?.layouts).toEqual(["Visit-Visit Layout", "ProviderVisit-PV Layout"]);
    expect(def?.note).toMatch(/Phone record type/);
    expect(buildSnapshot(withMulti(pv), meta).objects.Visit.recordTypes[0].multiEntity?.layouts[1]).toBe("ProviderVisit-Master");
  });

  it("shows the app's error when the linked object isn't published or readable", () => {
    const error = "MultiEntityRecordView configuration error. No access to the following entities: ProviderVisit";
    expect(buildSnapshot(withMulti(undefined), meta).objects.Visit.recordTypes[0].multiEntity).toEqual({ layouts: [], error });
    const pv = { recordTypes: [{ fullName: "Field", layout: "ProviderVisit-PV Layout" }] };
    const hidden = buildSnapshot(withMulti(pv), { ...meta, availableTables: new Set(["Visit"]) });
    expect(hidden.objects.Visit.recordTypes[0].multiEntity?.error).toBe(error);
  });
});

describe("fieldLabel", () => {
  const f = files({
    sobjects: {
      ...files().sobjects,
      ProviderVisit: { fields: [{ fullName: "OwnerId", label: "Owner ID" }, { fullName: "Type", label: "Visit Type" }] },
    },
    translations: { fields: { ProviderVisit: { labels: { Num__c: "Num" }, nameFieldLabel: "Visit Name" } } },
  });
  it("follows MetadataSobjectField: Record Type, name field, Type, translation, describe, item", () => {
    expect(fieldLabel(f, "ProviderVisit", { fullName: "RecordTypeId", label: "Record Type ID" })).toBe("Record Type");
    expect(fieldLabel(f, "ProviderVisit", { fullName: "Name" })).toBe("Visit Name");
    expect(fieldLabel(f, "ProviderVisit", { fullName: "Type" })).toBe("Type");
    expect(fieldLabel(f, "ProviderVisit", { fullName: "Num__c", label: "Num__c" })).toBe("Num");
    expect(fieldLabel(f, "ProviderVisit", { fullName: "OwnerId", label: "Owner" })).toBe("Owner ID");
    expect(fieldLabel(f, "ProviderVisit", { fullName: "Other__c", label: "Other" })).toBe("Other");
  });
});

describe("buildReportTree", () => {
  const folders = [
    { Id: "00l1", Name: "Sales", ParentId: null },
    { Id: "00l2", Name: "Archive", ParentId: "00l1" },
    { Id: "00l3", Name: "Empty", ParentId: null },
  ];
  const reports = [
    { Name: "Pipeline", Format: "Summary", FolderName: "Sales" },
    { Name: "Old", Format: "Matrix", FolderName: "Archive", Description: "Last year" },
    { Name: "Mine", Format: "Tabular", FolderName: "Private Reports" },
  ];

  it("puts LSC Reports first, then sections sorted by title with subfolders and pseudo-folders", () => {
    const tree = buildReportTree(folders, reports, true);
    expect(tree.map((t) => t.title)).toEqual(["LSC Reports", "Empty", "Private Reports", "Sales"]);
    expect(tree[0].children.map((c) => c.title)).toEqual(["Sales Chart"]);
    const sales = tree[3];
    expect(sales.children.map((c) => [c.kind, c.title])).toEqual([
      ["folder", "Archive"],
      ["report", "Pipeline"],
    ]);
    expect(sales.children[0].children[0]).toMatchObject({ title: "Old", native: false, description: "Last year" });
    expect(sales.children[1].native).toBe(true);
  });

  it("leaves out the Sales Chart and empty pseudo-folders when not configured", () => {
    const tree = buildReportTree(folders, reports.slice(0, 2), false);
    expect(tree.map((t) => t.title)).toEqual(["Empty", "Sales"]);
  });
});
