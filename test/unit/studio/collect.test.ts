import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../src/config/types.js";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
}));
vi.mock("../../../src/config/collect.js", () => ({
  collectCategoryRecords: vi.fn(),
}));

const { runSoqlQuery, runToolingQuery } = await import("../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../src/config/collect.js");
const { collectFeatureMap, collectItemDetail } = await import("../../../src/studio/collect.js");
const { getFeature } = await import("../../../src/studio/features.js");

type Row = Record<string, unknown>;

const GOOD_VAV_CODE = `(() => {
  function unwrapProxy(r) { return JSON.parse(JSON.stringify(r)); }
  return unwrapProxy([]);
})();`;

/** Org fixture: rows returned per FROM-object; an Error value makes that query fail. */
let org: Record<string, Row[] | Error>;
let configRecords: Record<string, ConfigRecord[]>;

function respond(query: string) {
  // Strip parenthesised subqueries/lists so the outer FROM wins.
  let outer = query;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1] ?? "";
  const rows = org[from] ?? [];
  if (rows instanceof Error) return Promise.resolve({ success: false, error: rows.message });
  return Promise.resolve({ success: true, data: { totalSize: rows.length, done: true, records: rows } });
}

function configRec(
  category: string,
  developerName: string,
  fields: Record<string, unknown>,
  isActive = true,
  profiles: string[] = []
): ConfigRecord {
  return {
    category,
    developerName,
    label: developerName,
    isActive,
    isOrgLevel: false,
    fields,
    fieldTypes: {},
    assignments: profiles.map((name) => ({ name, level: "Profile" })),
  } as ConfigRecord;
}

function vav(id: string, name: string, over: Row = {}): Row {
  return {
    Id: id,
    Name: name,
    ComponentName: "c",
    Type: "VisitActionValidation",
    ObjectName: "ProviderVisit",
    OperationEventType: "OnUpdate",
    CodeText: GOOD_VAV_CODE,
    CreatedDate: "2026-01-01T00:00:00.000+0000",
    ...over,
  };
}

async function visitMap() {
  return collectFeatureMap(getFeature("visit")!, "test-org");
}

beforeEach(() => {
  org = {
    EntityDefinition: [
      { QualifiedApiName: "Visit", Label: "Visit" },
      { QualifiedApiName: "ProviderVisit", Label: "Provider Visit" },
    ],
  };
  configRecords = {
    DbSchema: [configRec("DbSchema", "DbSchema_Visit", { SObject: "Visit" })],
  };
  vi.mocked(runSoqlQuery).mockImplementation(respond as never);
  vi.mocked(runToolingQuery).mockImplementation(respond as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async (_org: string, q: string) => {
    if (q.includes("LIKE")) return configRecords.admin ?? [];
    const list = /Category IN \(([^)]*)\)/.exec(q)?.[1] ?? /Category = ('\w+')/.exec(q)?.[1] ?? "";
    const categories = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    return categories.flatMap((c) => configRecords[c] ?? []);
  }) as never);
});

describe("collectFeatureMap — custom scripts", () => {
  it("flags every Visit Action Validation after the first as not running", async () => {
    org.LifeScienceCustomScript = [vav("a01", "First"), vav("a02", "Second"), vav("a03", "Third")];
    const s = (await visitMap()).surfaces.find((x) => x.id === "customScripts")!;

    expect(s.findings[0]).toMatchObject({ severity: "error", title: "3 Visit Action Validation scripts — only 1 runs" });
    expect(s.items[0].findings).toEqual([]);
    expect(s.items[0].properties["Executes at Sign/Submit"]).toBe(true);
    for (const item of s.items.slice(1)) {
      expect(item.findings[0]).toMatchObject({ severity: "error", title: "Will not run" });
      expect(item.properties["Executes at Sign/Submit"]).toBe(false);
    }
  });

  it("flags Visit Action Validation scripts missing ObjectName / OperationEventType", async () => {
    org.LifeScienceCustomScript = [vav("a01", "Broken", { ObjectName: null, OperationEventType: null })];
    const [item] = (await visitMap()).surfaces.find((x) => x.id === "customScripts")!.items;
    const titles = item.findings.map((f) => f.title);
    expect(titles).toContain("ObjectName must be ProviderVisit");
    expect(titles).toContain("OperationEventType must be OnUpdate");
  });

  it("runs static checks on CodeText", async () => {
    org.LifeScienceCustomScript = [
      vav("a01", "Empty", { CodeText: "" }),
      { ...vav("a02", "Workflow", { Type: "Validation", ObjectName: "Visit" }), CodeText: "return [check()];" },
    ];
    const s = (await visitMap()).surfaces.find((x) => x.id === "customScripts")!;
    const [empty, workflow] = s.items;
    expect(empty.findings.map((f) => f.title)).toContain("CodeText is empty");
    expect(workflow.findings.map((f) => f.title)).toEqual(["Results aren't unwrapped", "Not wrapped in an IIFE"]);
  });

  it("only includes scripts for the feature's objects", async () => {
    org.LifeScienceCustomScript = [
      vav("a01", "Visit VAV"),
      vav("a02", "Account script", { Type: "Validation", ObjectName: "Account" }),
    ];
    const s = (await visitMap()).surfaces.find((x) => x.id === "customScripts")!;
    expect(s.items.map((i) => i.label)).toEqual(["Visit VAV"]);

    const samples = await collectFeatureMap(getFeature("samples")!, "test-org");
    expect(samples.surfaces.find((x) => x.id === "customScripts")!.items).toEqual([]);
  });
});

describe("collectFeatureMap — mobile sync and resilience", () => {
  it("warns when the primary object has no active DB Schema record", async () => {
    configRecords.DbSchema = [configRec("DbSchema", "DbSchema_Visit", { SObject: "Visit" }, false)];
    const db = (await visitMap()).surfaces.find((x) => x.id === "dbSchema")!;
    expect(db.findings).toEqual([
      expect.objectContaining({ severity: "warning", title: "Visit isn't synced to LSC Mobile" }),
      expect.objectContaining({ severity: "info", title: "ProviderVisit isn't synced to LSC Mobile" }),
    ]);
    // Switched off → switch it on, not a second record; missing → offer to add one.
    expect(db.findings[0].fixes).toBeUndefined();
    expect(db.findings[1].fixes).toEqual([
      expect.objectContaining({
        kind: "createConfigRecord",
        label: "Add ProviderVisit to iPad sync",
        category: "DbSchema",
        developerName: "DbSchema_ProviderVisit",
        fields: expect.arrayContaining([{ name: "SObject", value: "ProviderVisit" }, { name: "WhereSoql", value: "" }]),
      }),
    ]);
    expect(db.creates?.[0]).toMatchObject({ label: "New DB Schema record", developerName: "DbSchema_New" });
  });

  it("isolates a failing surface without failing the map", async () => {
    org.ValidationRule = new Error("INVALID_TYPE: sObject type 'ValidationRule' is not supported");
    const map = await visitMap();
    const vr = map.surfaces.find((x) => x.id === "validationRules")!;
    expect(vr.error).toContain("INVALID_TYPE");
    expect(map.surfaces.find((x) => x.id === "objects")!.items).toHaveLength(2);
  });

  it("names auto-labelled admin settings by the records they reference", async () => {
    configRecords.admin = [
      configRec("CallDiscussionRecordType", "CDRT_1KeHn000000XZEQKA4_012Hn000000HDZKIA4", {
        ProductId: "1KeHn000000XZEQKA4",
        RecordTypes: "012Hn000000HDZKIA4",
      }),
      configRec("VisitSettings", "VisitSettingsDefaultConfiguration", { RecordTypes: "012Hn000000HDZKIA4" }),
    ];
    org.LifeSciMarketableProduct = [{ Id: "1KeHn000000XZEQKA4", Name: "Cordim" }];
    org.RecordType = [{ Id: "012Hn000000HDZKIA4", Name: "Patient Tracking" }];
    const [auto, named] = (await visitMap()).surfaces.find((x) => x.id === "adminSettings")!.items;
    expect(auto.label).toBe("Cordim · Patient Tracking");
    expect(auto.properties).toMatchObject({ ProductId: "Cordim", RecordTypes: "Patient Tracking" });
    expect(named.label).toBe("VisitSettingsDefaultConfiguration");
  });

  it("reports feature objects missing from the org", async () => {
    const objects = (await visitMap()).surfaces.find((x) => x.id === "objects")!;
    expect(objects.findings.map((f) => f.title)).toContain("ProductDisbursement not found in this org");
  });
});

describe("collectFeatureMap — flows", () => {
  const flowRow = (id: string, object: string, active = true) => ({
    DurableId: id,
    ApiName: id,
    Label: `${object} flow`,
    TriggerType: "RecordAfterSave",
    IsActive: active,
    TriggerObjectOrEventLabel: object,
  });

  it("notes that active flows on synced objects run when the iPad syncs", async () => {
    org.FlowDefinitionView = [flowRow("300a", "Visit"), flowRow("300b", "Visit", false), flowRow("300c", "Provider Visit"), flowRow("300d", "Case")];
    const flows = (await visitMap()).surfaces.find((x) => x.id === "flows")!;
    expect(flows.items.map((i) => i.id)).toEqual(["300a", "300b", "300c"]);
    expect(flows.items.every((i) => i.detailKind === "flow")).toBe(true);
    // Visit is synced; the inactive flow and the unsynced ProviderVisit flow get nothing.
    expect(flows.items.map((i) => i.findings.map((f) => f.title))).toEqual([["Runs when the iPad syncs, not on Save"], [], []]);
  });
});

describe("collectItemDetail", () => {
  it("rejects malformed Ids before querying", async () => {
    await expect(collectItemDetail("apexTrigger", "x' OR Id != '", "test-org")).rejects.toThrow("Invalid record Id");
    expect(runToolingQuery).not.toHaveBeenCalled();
  });

  it("returns a validation rule's formula", async () => {
    org.ValidationRule = [{ Id: "03d000000000001", ErrorMessage: "Nope", Active: true, Metadata: { errorConditionFormula: "ISBLANK(Name)" } }];
    const detail = await collectItemDetail("validationRule", "03d000000000001", "test-org");
    expect(detail.code).toEqual({ language: "formula", text: "ISBLANK(Name)" });
  });

  it("returns a flow's outline and health checks from its active version", async () => {
    org.FlowDefinitionView = [{ ActiveVersionId: "301000000000001", LatestVersionId: "301000000000002", Description: "Defaults" }];
    org.Flow = [
      {
        Id: "301000000000001",
        VersionNumber: 3,
        Metadata: { start: { object: "Visit", triggerType: "RecordAfterSave", recordTriggerType: "CreateAndUpdate" } },
      },
    ];
    const detail = await collectItemDetail("flow", "300000000000001", "test-org");
    expect(detail.properties).toMatchObject({ Description: "Defaults", Showing: "Active version (v3)" });
    expect(detail.flow?.trigger).toBe("After a Visit is saved — when it's created or updated");
    expect(detail.findings?.map((f) => f.title)).toEqual(["Runs on every save"]);
    expect(detail.code?.text).toContain("After a Visit is saved");
    expect(vi.mocked(runToolingQuery).mock.calls[0][0]).toContain("WHERE Id = '301000000000001'");
  });

  it("says so for packaged flows whose versions can't be read", async () => {
    org.FlowDefinitionView = [{ ActiveVersionId: "pkg__MyFlow-1", LatestVersionId: "pkg__MyFlow-1" }];
    const detail = await collectItemDetail("flow", "pkg__MyFlow", "test-org");
    expect(detail.flow).toBeUndefined();
    expect(detail.properties.Source).toBe("Managed package — its steps aren't readable");
    expect(runToolingQuery).not.toHaveBeenCalled();
  });

  it("rejects malformed flow keys", async () => {
    await expect(collectItemDetail("flow", "x' OR DurableId != '", "test-org")).rejects.toThrow("Invalid record Id");
  });

  it("omits code for managed-package triggers with hidden bodies", async () => {
    org.ApexTrigger = [{ Id: "01q000000000001", Name: "VisitTrigger", Status: "Active", ApiVersion: 67, Body: "(hidden)" }];
    const detail = await collectItemDetail("apexTrigger", "01q000000000001", "test-org");
    expect(detail.code).toBeUndefined();
    expect(detail.properties.Source).toBe("Hidden — managed package");
  });
});

async function orgMap(id: string) {
  return collectFeatureMap(getFeature(id)!, "test-org");
}

describe("collectFeatureMap — Mobile Sync", () => {
  it("builds the effective sync query and flags duplicates and unassigned records", async () => {
    configRecords.DbSchema = [
      configRec("DbSchema", "Visit_A", { SObject: "Visit", MandatoryFields: "Id;Name", WhereSoql: "OwnerId = :userId" }, true, ["Rep"]),
      configRec("DbSchema", "Visit_B", { SObject: "Visit" }, true, ["Rep"]),
      configRec("DbSchema", "Orphan", { SObject: "Account" }),
    ];
    const map = await orgMap("mobile-sync");
    expect(map.lanes.map((l) => l.id)).toEqual(["schema", "profiles", "ui", "settings"]);
    const synced = map.surfaces.find((s) => s.id === "syncedObjects")!;
    const [orphan, a, b] = synced.items;
    expect(a.code).toEqual({ language: "soql", text: "SELECT\n  Id,\n  Name\nFROM Visit\nWHERE OwnerId = :userId" });
    expect(a.findings.map((f) => f.title)).toEqual(["Duplicate for Rep"]);
    expect(b.findings.map((f) => f.title)).toEqual(["Duplicate for Rep"]);
    expect(orphan.findings.map((f) => f.title)).toEqual(["Not assigned to any profile"]);
    expect(synced.findings[0].title).toBe("2 objects sync without a filter");
  });

  it("warns when a profile with DB Schema has no live metadata cache", async () => {
    configRecords.DbSchema = [configRec("DbSchema", "Visit_A", { SObject: "Visit" }, true, ["Rep"])];
    org.LifeSciMobileMetadataRecord = [{ Id: "m1", Name: "Cache", Status: "Draft", ProfileId: null }];
    const [rep] = (await orgMap("mobile-sync")).surfaces.find((s) => s.id === "mobileProfiles")!.items;
    expect(rep.findings[0]).toMatchObject({ severity: "warning", title: "No active metadata cache" });
  });

  it("flags navigation tabs sharing an order on one profile", async () => {
    configRecords.UISchema = [
      configRec("UISchema", "Home", { Type: "TAB", TabOrder: 1, TabName: "Home" }, true, ["Rep"]),
      configRec("UISchema", "Calendar", { Type: "TAB", TabOrder: 1, TabName: "Calendar" }, true, ["Rep"]),
    ];
    const tabs = (await orgMap("mobile-sync")).surfaces.find((s) => s.id === "navigationTabs")!;
    expect(tabs.items[1].findings[0].title).toBe('Same tab order as "Home"');
  });
});

describe("collectFeatureMap — Territory & Users", () => {
  it("errors when no territory model is active and reports unavailable rule objects", async () => {
    org.Territory2Model = [{ Id: "0MA1", Name: "Draft model", State: "Planning" }];
    org.TerritoryGeoAssignmentRule = new Error("sObject type 'TerritoryGeoAssignmentRule' is not supported.");
    const map = await orgMap("territory-users");
    expect(map.surfaces.find((s) => s.id === "territoryModels")!.findings[0]).toMatchObject({
      severity: "error",
      title: "No active territory model",
    });
    const geo = map.surfaces.find((s) => s.id === "geoRules")!;
    expect(geo.error).toBeUndefined();
    expect(geo.findings[0].title).toBe("Not available in this org");
  });

  it("checks license capacity", async () => {
    org.PermissionSetLicense = [
      { Id: "p1", MasterLabel: "Full", DeveloperName: "IndustriesLSC4CEPsl", UsedLicenses: 10, TotalLicenses: 10 },
      { Id: "p2", MasterLabel: "Nearly", DeveloperName: "CLMPsl", UsedLicenses: 9, TotalLicenses: 10 },
      { Id: "p3", MasterLabel: "Fine", DeveloperName: "HealthCloudPsl", UsedLicenses: 1, TotalLicenses: 10 },
    ];
    const items = (await orgMap("territory-users")).surfaces.find((s) => s.id === "psls")!.items;
    expect(items.map((i) => i.findings.map((f) => f.severity))).toEqual([["error"], ["warning"], []]);
  });

  it("flags field users without a territory or the Life Science Commercial license", async () => {
    configRecords.ProfileBasedAppSettings = [configRec("ProfileBasedAppSettings", "Rep_Settings", {}, true, ["Rep"])];
    org.User = [
      {
        Id: "005A",
        Name: "Covered",
        Profile: { Name: "Rep" },
        UserTerritory2Associations: { records: [{ Territory2: { Name: "North" } }] },
        PermissionSetLicenseAssignments: { records: [{ PermissionSetLicense: { MasterLabel: "Life Science Commercial", DeveloperName: "IndustriesLSC4CEPsl" } }] },
      },
      { Id: "005B", Name: "Bare", Profile: { Name: "Rep" }, UserTerritory2Associations: null, PermissionSetLicenseAssignments: null },
    ];
    const s = (await orgMap("territory-users")).surfaces.find((x) => x.id === "fieldUsers")!;
    expect(s.items[0].findings).toEqual([]);
    expect(s.items[1].findings.map((f) => f.title)).toEqual(["No territory", "No Life Science Commercial license"]);
  });
});

describe("collectFeatureMap — Actions & Home Page", () => {
  beforeEach(() => {
    org.Profile = [{ Name: "Rep" }];
    org.PermissionSet = [{ Name: "LSC_Rep", NamespacePrefix: "lsc4ce" }];
    org.RecordType = [{ DeveloperName: "Detailing", Name: "Detailing" }];
  });

  it("flags hardcoded org URLs and names that don't exist in the org", async () => {
    configRecords.QuickAction = [
      configRec("QuickAction", "New_Visit", { Location: "HomePage", Profiles: "Rep;Ghost", PermissionSets: "lsc4ce__LSC_Rep", RecordTypes: "Detailing" }),
    ];
    configRecords.CustomAction = [
      configRec("CustomAction", "Maps", { EntityType: "HomePage", ActionTarget: "https://acme--uat.sandbox.lightning.force.com/lightning/n/Maps" }),
    ];
    const home = (await orgMap("actions-home")).surfaces.find((s) => s.id === "homeActions")!;
    const [visit, maps] = home.items;
    expect(visit.findings.map((f) => f.title)).toEqual(['Profile "Ghost" not found']);
    expect(maps.findings[0]).toMatchObject({ severity: "warning", title: "Hardcoded org URL" });

    const coverage = (await orgMap("actions-home")).surfaces.find((s) => s.id === "profileCoverage")!;
    expect(coverage.items.map((i) => [i.label, i.findings.map((f) => f.title)])).toEqual([
      ["Ghost", ["Profile doesn't exist"]],
      ["Rep", []],
    ]);
  });

  it("notes sort-order collisions and hides empty location surfaces", async () => {
    configRecords.QuickAction = [
      configRec("QuickAction", "Email", { Location: "Search", SObject: "Account", SortOrder: 1 }),
      configRec("QuickAction", "Insight", { Location: "Search", SObject: "Account", SortOrder: 1 }),
    ];
    const map = await orgMap("actions-home");
    const search = map.surfaces.find((s) => s.id === "searchActions")!;
    expect(search.findings[0].title).toBe("Same sort order: Email, Insight");
    expect(map.surfaces.find((s) => s.id === "visitActions")).toBeUndefined();
    expect(map.surfaces.find((s) => s.id === "homeActions")).toBeDefined();
  });
});

describe("collectFeatureMap — audiences for the View as lens", () => {
  it("tags DB Schema, nav tabs, caches, and per-profile rows with who they apply to", async () => {
    configRecords.DbSchema = [
      configRec("DbSchema", "Visit_Rep", { SObject: "Visit" }, true, ["Rep"]),
      { ...configRec("DbSchema", "Account_All", { SObject: "Account" }), isOrgLevel: true },
    ];
    configRecords.UISchema = [configRec("UISchema", "Home", { Type: "TAB", TabOrder: 1 }, true, ["Rep"])];
    org.LifeSciMobileMetadataRecord = [
      { Id: "m1", Name: "Base", Status: "Active", ProfileId: null },
      { Id: "m2", Name: "Rep", Status: "Active", ProfileId: "00eR" },
    ];
    org.Profile = [{ Id: "00eR", Name: "Rep" }];
    const map = await orgMap("mobile-sync");
    const items = (id: string) => map.surfaces.find((s) => s.id === id)!.items;

    expect(items("syncedObjects").map((i) => [i.label, i.audience])).toEqual([
      ["Account", undefined],
      ["Visit", { profiles: ["Rep"], permissionSets: [] }],
    ]);
    expect(items("navigationTabs")[0].audience).toEqual({ profiles: ["Rep"], permissionSets: [] });
    expect(items("metadataCache").map((i) => i.audience)).toEqual([undefined, { profiles: ["Rep"], permissionSets: [] }]);
    expect(items("mobileProfiles")[0].audience).toEqual({ profiles: ["Rep"], permissionSets: [] });
  });

  it("scopes actions by their Profiles / PermissionSets fields, else to everyone", async () => {
    configRecords.QuickAction = [
      configRec("QuickAction", "Rep_Only", { Location: "HomePage", Profiles: "Rep" }),
      configRec("QuickAction", "PS_Only", { Location: "HomePage", PermissionSets: "LSC_Rep" }),
      configRec("QuickAction", "Everyone", { Location: "HomePage" }),
    ];
    const home = (await orgMap("actions-home")).surfaces.find((s) => s.id === "homeActions")!;
    expect(home.items.map((i) => i.audience)).toEqual([
      { profiles: ["Rep"], permissionSets: [] },
      { profiles: [], permissionSets: ["LSC_Rep"] },
      undefined,
    ]);
  });
});
