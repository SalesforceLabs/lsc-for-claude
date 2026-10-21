import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));
// Who's in scope is its own module (scope.ts); it fails by default, so the older population reads run.
vi.mock("../../../../src/studio/scope.js", () => ({ ipadProfiles: vi.fn(), territoryProfiles: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const scope = await import("../../../../src/studio/scope.js");
/** The scope's iPad profiles are these. */
const ipad = (...names: string[]) =>
  vi.mocked(scope.ipadProfiles).mockResolvedValue(names.map((name, i) => ({ id: `00e${i}`, name, users: 1, licensed: 1, group: "ipad", reason: "", detected: "ipad", overridden: false, territory: true, unsure: false })));
const { default: feature } = await import("../../../../src/studio/readiness/features/app-alerts.js");

type Row = Record<string, unknown>;
/** Rows (or a COUNT override) returned per outer FROM-object. */
let org: Record<string, Row[] | number>;
let handlers: Row[];
let schema: ConfigRecord[];

function respond(soql: string) {
  let outer = soql;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1] ?? "";
  const v = org[from] ?? [];
  const rows = typeof v === "number" ? [] : v;
  const total = typeof v === "number" ? v : rows.length;
  return Promise.resolve({ success: true, data: { totalSize: total, done: true, records: rows } });
}

const schemaRec = (sobject: string, profile = "Rep", isActive = true): ConfigRecord =>
  ({ category: "DbSchema", developerName: "db_" + sobject, label: sobject, isActive, isOrgLevel: false, fields: { SObject: sobject }, fieldTypes: {}, assignments: [{ name: profile, level: "Profile" }] }) as ConfigRecord;
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
});

const run = async () => Object.fromEntries((await feature.checks!("test-org")).map((c) => [c.id, c]));

describe("app alerts readiness", () => {
  it("lists alerts in effect that no territory targets", async () => {
    org.AppAlert = [{ Id: "a1", Subject: "Visit Confirmation" }];
    const c = (await run())["app-alerts.access.targeted"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Visit Confirmation"]);
  });

  it("skips targeting when no alert is in effect", async () => {
    org.AppAlert = 0;
    expect((await run())["app-alerts.access.targeted"].status).toBe("skipped");
  });

  it("flags alerts that end before they start", async () => {
    org.AppAlert = [{ Subject: "Backwards", EffectiveDate: "2026-05-01T00:00:00.000+0000", ValidUntilDate: "2026-04-01T00:00:00.000+0000" }, { Subject: "Fine", EffectiveDate: "2026-04-01T00:00:00.000+0000", ValidUntilDate: "2026-05-01T00:00:00.000+0000" }];
    const c = (await run())["app-alerts.config.dates"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Backwards"]);
  });

  it("offers to switch on the sharing handler", async () => {
    handlers = [handler("NotificationTerritorySharingHandler", false)];
    expect((await run())["app-alerts.enabled.handlers"].fixes).toHaveLength(1);
  });

  it("doesn't count personal alerts owned by a rep", async () => {
    // fieldProfiles reads ProfileBasedAppSettings through the same mock: "Rep" is a field profile.
    schema = [schemaRec("AppAlert", "Rep")];
    org.AppAlert = [
      { Id: "a1", Subject: "Sample order request", Owner: { Profile: { Name: "Rep" } } },
      { Id: "a2", Subject: "Quarterly survey", Owner: { Profile: { Name: "System Administrator" } } },
    ];
    const c = (await run())["app-alerts.access.targeted"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Quarterly survey"]);
    expect(c.detail).toBe("1 of 2 have no territory and reach nobody but their owner. Checked all 2 alerts in effect.");
  });

  it("looks up territories and sharing by alert id instead of an anti-join", async () => {
    org.AppAlert = [
      { Id: "a1", Subject: "Targeted" },
      { Id: "a2", Subject: "Shared" },
      { Id: "a3", Subject: "Nobody" },
    ];
    org.AppAlertTerritory = [{ AlertReferenceRecordId: "a1", cnt: 2 }];
    org.AppAlertShare = [{ ParentId: "a2", cnt: 1 }];
    const c = (await run())["app-alerts.access.targeted"];
    expect(c).toMatchObject({ status: "fail", examples: ["Nobody"] });
    const qs = vi.mocked(runSoqlQuery).mock.calls.map((x) => String(x[0]));
    expect(qs.some((q) => q.includes("NOT IN"))).toBe(false);
    expect(qs.find((q) => q.includes("Owner.Profile.Name FROM AppAlert"))).toMatch(/LIMIT 500$/);
    expect(qs.find((q) => q.includes("FROM AppAlertTerritory") && q.includes("GROUP BY"))).toContain("AlertReferenceRecordId IN ('a1','a2','a3')");
    expect(qs.find((q) => q.includes("FROM AppAlertShare"))).toContain("ParentId IN ('a1','a2','a3') AND RowCause != 'Owner'");
  });

  it("says targeting was checked on a sample when more alerts are in effect than the sample size", async () => {
    org.AppAlert = Array.from({ length: 500 }, (_, i) => ({ Id: `a${i}`, Subject: `Alert ${i}` }));
    org.AppAlertTerritory = org.AppAlert.map((r) => ({ AlertReferenceRecordId: r.Id, cnt: 1 }));
    const c = (await run())["app-alerts.access.targeted"];
    expect(c).toMatchObject({ status: "pass", detail: "Every one is targeted. Checked a sample of 500 alerts in effect, not every one in the org." });
  });

  it("judges expired alerts on a sample read by id, without counting the whole table", async () => {
    vi.mocked(runSoqlQuery).mockImplementation(((q: string) => {
      if (q === "SELECT Id FROM AppAlert LIMIT 500") return respond("SELECT Id FROM Sample");
      if (q.includes("FROM AppAlert WHERE Id IN") && q.includes("ValidUntilDate < TODAY")) return respond("SELECT Id FROM Expired");
      return respond(q);
    }) as never);
    org.Sample = [{ Id: "a1" }, { Id: "a2" }, { Id: "a3" }];
    org.Expired = [{ Id: "a1" }, { Id: "a2" }];
    const c = (await run())["app-alerts.data.expired"];
    expect(c).toMatchObject({ status: "fail", detail: "2 of 3 have expired. Checked all 3 alerts." });
    const counts = vi.mocked(runSoqlQuery).mock.calls.map((x) => String(x[0])).filter((q) => /^SELECT COUNT\(\) FROM AppAlert WHERE ValidUntilDate/.test(q));
    expect(counts).toEqual([]);
  });

  it("passes when every untargeted alert is a rep's own", async () => {
    schema = [schemaRec("AppAlert", "Rep")];
    org.AppAlert = [{ Id: "a1", Subject: "Sample order request", Owner: { Profile: { Name: "Rep" } } }];
    expect((await run())["app-alerts.access.targeted"].status).toBe("pass");
  });

  it("doesn't need alert territories on the iPad", async () => {
    schema = [schemaRec("AppAlert"), schemaRec("AppAlertUserResponse")];
    expect((await run())["app-alerts.mobile.alert-objects"].status).toBe("pass");
  });

  it("names the profile missing user responses", async () => {
    schema = [schemaRec("AppAlert"), schemaRec("AppAlertUserResponse", "Other")];
    const c = (await run())["app-alerts.mobile.alert-objects"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["AppAlertUserResponse: missing for Rep"]);
  });
});
