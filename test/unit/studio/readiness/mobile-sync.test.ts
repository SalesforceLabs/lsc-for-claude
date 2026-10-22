import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  apiRequest: vi.fn(),
  dataPath: vi.fn(async (_org: string, rest: string) => `/services/data/v67.0${rest}`),
}));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));
// Who's in scope is its own module (scope.ts); it fails by default, so the older population reads run.
vi.mock("../../../../src/studio/scope.js", () => ({ ipadProfiles: vi.fn(), territoryProfiles: vi.fn() }));

const { apiRequest, runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const scope = await import("../../../../src/studio/scope.js");
/** The scope's iPad profiles are these. */
const ipad = (...names: string[]) =>
  vi.mocked(scope.ipadProfiles).mockResolvedValue(names.map((name, i) => ({ id: `00e${i}`, name, users: 1, licensed: 1, group: "ipad", reason: "", detected: "ipad", overridden: false, territory: true, unsure: false })));
const { default: mod, territoryTagMismatch } = await import("../../../../src/studio/readiness/features/mobile-sync.js");

type Row = Record<string, unknown>;
/** Rows (and optional COUNT override) returned per outer FROM-object; an Error makes that query fail. */
let org: Record<string, Row[] | number | Error>;
let handlers: Row[];
let schema: ConfigRecord[];

function respond(soql: string) {
  let outer = soql;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1] ?? "";
  const v = org[from] ?? [];
  if (v instanceof Error) return Promise.resolve({ success: false, error: v.message });
  const rows = typeof v === "number" ? [] : v;
  const total = typeof v === "number" ? v : rows.length;
  return Promise.resolve({ success: true, data: { totalSize: total, done: true, records: rows } });
}

const schemaRec = (sobject: string, isActive = true): ConfigRecord =>
  ({ category: "DbSchema", developerName: "db_" + sobject, label: sobject, isActive, isOrgLevel: false, fields: { SObject: sobject }, fieldTypes: {}, assignments: [{ name: "Rep", level: "Profile" }] }) as ConfigRecord;
const handler = (developerName: string, IsActive: boolean) => ({ DeveloperName: developerName, MasterLabel: developerName, IsActive });

beforeEach(() => {
  vi.mocked(scope.ipadProfiles).mockRejectedValue(new Error("no scope"));
  vi.mocked(scope.territoryProfiles).mockRejectedValue(new Error("no scope"));
  org = {};
  handlers = [];
  schema = [];
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => (/FROM\s+LifeScienceTriggerHandler/i.test(q) ? Promise.resolve({ success: true, data: { totalSize: handlers.length, done: true, records: handlers } }) : respond(q))) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => schema) as never);
  vi.mocked(apiRequest).mockResolvedValue({ success: true, data: { sObjects: [] } } as never);
});

const run = async () => Object.fromEntries((await mod.checks!("test-org")).map((c) => [c.id, c]));
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const dataRec = (sobject: string, isActive: boolean, extra: Partial<ConfigRecord> = {}) =>
  ({ ...schemaRec(sobject, isActive), fields: { SObject: sobject, Type: "OBJECT" }, ...extra }) as ConfigRecord;

describe("mobile-sync readiness", () => {
  it("fails when no object is switched on", async () => {
    schema = [dataRec("Account", false)];
    const c = (await run())["mobile-sync.enabled.synced-objects"];
    expect(c.status).toBe("fail");
    expect(c.severity).toBe("error");
  });

  it("passes when an object syncs", async () => {
    schema = [dataRec("Account", true)];
    expect((await run())["mobile-sync.enabled.synced-objects"].status).toBe("pass");
  });

  it("flags a profile name that matches no profile", async () => {
    org.Profile = [{ Name: "Other" }];
    schema = [dataRec("Account", true)];
    const c = (await run())["mobile-sync.access.profiles-exist"];
    expect(c.status).toBe("fail");
    expect(c.examples?.[0]).toContain("Rep");
  });

  it("flags active records that are assigned to nobody", async () => {
    schema = [dataRec("Account", true, { assignments: [] })];
    expect((await run())["mobile-sync.config.assigned"].status).toBe("fail");
  });

  it("flags records that report errors", async () => {
    schema = [dataRec("Account", true, { fields: { SObject: "Account", Type: "OBJECT", Errors: "Field X missing" } })];
    expect((await run())["mobile-sync.config.schema-errors"].status).toBe("fail");
  });

  it("skips the freshness check when no cache exists", async () => {
    schema = [dataRec("Account", true)];
    expect((await run())["mobile-sync.mobile.cache-fresh"].status).toBe("skipped");
  });

  const settingsRec = (developerName: string, profiles: string[], isOrgLevel = false) =>
    ({ category: "ProfileBasedAppSettings", developerName, label: developerName, isActive: true, isOrgLevel, fields: {}, fieldTypes: {}, assignments: profiles.map((name) => ({ name, level: "Profile" })) }) as ConfigRecord;

  it("passes app settings when profiles without their own record use the org-level one", async () => {
    schema = [dataRec("Account", true), settingsRec("OrgLevel", [], true)];
    const c = (await run())["mobile-sync.config.profile-app-settings"];
    expect(c.status).toBe("pass");
    expect(c.detail).toContain("OrgLevel");
    expect(c.detail).toContain("Rep");
  });

  it("still flags missing app settings when there is no org-level record", async () => {
    schema = [dataRec("Account", true), settingsRec("Other", ["Manager"])];
    expect((await run())["mobile-sync.config.profile-app-settings"].status).toBe("fail");
  });

  it("leaves out synced profiles that aren't iPad profiles in the scope", async () => {
    ipad("Manager");
    schema = [dataRec("Account", true)]; // assigned to Rep only
    const c = (await run())["mobile-sync.config.profile-app-settings"];
    expect(c.status).toBe("pass");
    expect(c.detail).toContain("0 synced profiles");
  });

  it("counts every iPad profile as synced when an active record is org-level", async () => {
    ipad("Manager");
    schema = [dataRec("Account", true, { isOrgLevel: true, assignments: [] })];
    const c = (await run())["mobile-sync.mobile.nav-tabs"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Manager"]);
  });

  it("passes the tab bar check when a profile without UI Settings tabs can open a Lightning app", async () => {
    org.SetupEntityAccess = [{ pn: "Rep", cnt: 2 }];
    schema = [dataRec("Account", true)];
    expect((await run())["mobile-sync.mobile.nav-tabs"].status).toBe("pass");
  });

  it("fails the tab bar check when a profile has no Lightning app and no UI Settings tabs", async () => {
    org.SetupEntityAccess = [];
    schema = [dataRec("Account", true)];
    const c = (await run())["mobile-sync.mobile.nav-tabs"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Rep"]);
  });

  it("reads changes per record from grouped rows and flags a stale profile", async () => {
    org.LifeSciMobileMetadataRecord = [{ Id: "c1", Status: "Active", LastModifiedDate: ago(10), ProfileId: "00e1" }];
    org.Profile = [{ Id: "00e1", Name: "Rep" }];
    org.LifeSciConfigFieldValue = [{ n: "db_Account", m: ago(2) }];
    schema = [dataRec("Account", true)];
    const c = (await run())["mobile-sync.mobile.cache-fresh"];
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("Rep (1 change");
  });

  it("ignores a stale cache for a profile outside the scope's iPad profiles", async () => {
    ipad("Manager");
    org.LifeSciMobileMetadataRecord = [{ Id: "c1", Status: "Active", LastModifiedDate: ago(10), ProfileId: "00e1" }];
    org.Profile = [{ Id: "00e1", Name: "Rep" }];
    org.LifeSciConfigRecord = [{ n: "db_Account", m: ago(2) }];
    schema = [dataRec("Account", true)];
    expect((await run())["mobile-sync.mobile.cache-fresh"].status).toBe("pass");
  });

  it("sizes unfiltered high-volume objects from the org's record counts, counting only what they leave out", async () => {
    schema = [dataRec("Task", true), dataRec("Event", true)];
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data: { sObjects: [{ name: "Task", count: 80_000 }] } } as never);
    org.Event = 10;
    const c = (await run())["mobile-sync.config.unfiltered-high-volume"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Task (80,000 rows)"]);
    expect(String(vi.mocked(apiRequest).mock.calls[0][0])).toContain("/limits/recordCount?sObjects=Task%2CEvent");
    const counts = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0])).filter((q) => q.startsWith("SELECT COUNT() FROM"));
    expect(counts).toEqual(["SELECT COUNT() FROM Event"]);
  });
});

describe("mobile-sync DB Schema settings", () => {
  const rec = (sobject: string, fields: Record<string, unknown>, isActive = true) => dataRec(sobject, isActive, { fields: { SObject: sobject, Type: "DATA", ...fields } });
  const fieldRows = (obj: string, ...names: string[]) => names.map((n) => ({ EntityDefinition: { QualifiedApiName: obj }, QualifiedApiName: n }));

  it("offers SystemModstamp for a delta date field the object doesn't have", async () => {
    schema = [rec("TopicAssignment", { DeltaDateField: "LastModifiedDate" }), rec("Account", { DeltaDateField: "LastModifiedDate" })];
    org.FieldDefinition = [...fieldRows("TopicAssignment", "Id", "SystemModstamp"), ...fieldRows("Account", "Id", "SystemModstamp", "LastModifiedDate")];
    const c = (await run())["mobile-sync.config.delta-field-exists"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["TopicAssignment: no LastModifiedDate on TopicAssignment"]);
    expect(c.fixes).toEqual([expect.objectContaining({ kind: "setConfigField", developerName: "db_TopicAssignment", field: "DeltaDateField", from: "LastModifiedDate", to: "SystemModstamp" })]);
  });

  it("leaves objects the org doesn't have to other checks", async () => {
    schema = [rec("Gone__c", { DeltaDateField: "LastModifiedDate" })];
    expect((await run())["mobile-sync.config.delta-field-exists"].status).toBe("pass");
  });

  it("switches DeviceSyncTransactionRecord from Configuration to data", async () => {
    schema = [rec("Account", {}), rec("DeviceSyncTransactionRecord", { Type: "CONFIGURATION" })];
    const c = (await run())["mobile-sync.config.upload-table"];
    expect(c.status).toBe("fail");
    expect(c.fixes).toEqual([expect.objectContaining({ field: "Type", from: "CONFIGURATION", to: "DATA" })]);
  });

  it("switches on a DeviceSyncTransactionRecord record that is off, and fails with none", async () => {
    schema = [rec("Account", {}), rec("DeviceSyncTransactionRecord", {}, false)];
    expect((await run())["mobile-sync.config.upload-table"].fixes).toEqual([expect.objectContaining({ kind: "setActive", to: true })]);
    schema = [rec("Account", {})];
    const c = (await run())["mobile-sync.config.upload-table"];
    expect(c.status).toBe("fail");
    expect(c.fixes ?? []).toEqual([]);
  });

  it("flags Account set to Configuration and one-way sync on objects reps write", async () => {
    schema = [rec("Account", { Type: "CONFIGURATION" }), rec("ProviderAcctTerritoryInfo", { OneWaySync: true, WhereSoql: "Territory2.Name = '{USER.TERRITORY}'" }), rec("Product2", { OneWaySync: true })];
    const r = await run();
    expect(r["mobile-sync.config.accounts-are-data"].fixes).toEqual([expect.objectContaining({ field: "Type", to: "DATA" })]);
    const oneWay = r["mobile-sync.config.two-way-for-rep-written"];
    expect(oneWay.examples).toEqual(["ProviderAcctTerritoryInfo"]);
    expect(oneWay.fixes).toEqual([expect.objectContaining({ field: "OneWaySync", from: true, to: false })]);
  });

  it("warns about unfiltered Account and territory info", async () => {
    schema = [rec("Account", {}), rec("ProviderAcctTerritoryInfo", { WhereSoql: "IsActive = true" })];
    const r = await run();
    expect(r["mobile-sync.config.account-filter"].status).toBe("fail");
    expect(r["mobile-sync.config.territory-info-filter"].status).toBe("fail");
    schema = [rec("Account", { WhereSoql: "Id IN ({ACCOUNT.IDS})" }), rec("ProviderAcctTerritoryInfo", { WhereSoql: "Territory2.Name = '{USER.TERRITORY}'" })];
    const ok = await run();
    expect(ok["mobile-sync.config.account-filter"].status).toBe("pass");
    expect(ok["mobile-sync.config.territory-info-filter"].status).toBe("pass");
  });

  it("flags a territory name tag compared with an Id field", async () => {
    schema = [rec("ActivityPlan", { WhereSoql: "TerritoryList INCLUDES ('{USER.TERRITORY}')" })];
    expect((await run())["mobile-sync.config.territory-tags"].examples?.[0]).toContain("TerritoryList");
  });
});

describe("territoryTagMismatch()", () => {
  it("accepts names with names and Ids with Ids", () => {
    expect(territoryTagMismatch("Territory2.Name = '{USER.TERRITORY}'")).toBeNull();
    expect(territoryTagMismatch("Territory2Id IN ('{USER.TERRITORYID}')")).toBeNull();
  });

  it("names the field compared with the wrong tag", () => {
    expect(territoryTagMismatch("Territory2Id = '{USER.TERRITORY}'")).toContain("Territory2Id");
    expect(territoryTagMismatch("Territory2.Id IN ('{USER.TERRITORY}')")).toContain("Territory2.Id");
    expect(territoryTagMismatch("Territory2.Name = '{USER.TERRITORYID}'")).toContain("Territory2.Name");
  });
});
