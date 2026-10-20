import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: mod } = await import("../../../../src/studio/readiness/features/mobile-sync.js");

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
  org = {};
  handlers = [];
  schema = [];
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => (/FROM\s+LifeScienceTriggerHandler/i.test(q) ? Promise.resolve({ success: true, data: { totalSize: handlers.length, done: true, records: handlers } }) : respond(q))) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => schema) as never);
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

  it("leaves out synced profiles with no LSC-licensed user", async () => {
    org.User = [{ pn: "Manager", cnt: 3 }];
    schema = [dataRec("Account", true)]; // assigned to Rep only
    const c = (await run())["mobile-sync.config.profile-app-settings"];
    expect(c.status).toBe("pass");
    expect(c.detail).toContain("0 synced profiles");
  });

  it("counts every LSC profile as synced when an active record is org-level", async () => {
    org.User = [{ pn: "Manager", cnt: 3 }];
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

  it("ignores a stale cache for a profile with no LSC-licensed user", async () => {
    org.User = [{ pn: "Manager", cnt: 1 }];
    org.LifeSciMobileMetadataRecord = [{ Id: "c1", Status: "Active", LastModifiedDate: ago(10), ProfileId: "00e1" }];
    org.Profile = [{ Id: "00e1", Name: "Rep" }];
    org.LifeSciConfigRecord = [{ n: "db_Account", m: ago(2) }];
    schema = [dataRec("Account", true)];
    expect((await run())["mobile-sync.mobile.cache-fresh"].status).toBe("pass");
  });
});
