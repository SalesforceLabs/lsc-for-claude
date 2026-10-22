import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: feature } = await import("../../../../src/studio/readiness/features/surveys.js");

type Row = Record<string, unknown>;
/** Rows (or a COUNT override) returned per outer FROM-object, or a function of the query. */
let org: Record<string, Row[] | number | ((soql: string) => Row[] | number)>;
let handlers: Row[];
let schema: ConfigRecord[];

function respond(soql: string) {
  let outer = soql;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1] ?? "";
  const entry = org[from] ?? [];
  const v = typeof entry === "function" ? entry(soql) : entry;
  const rows = typeof v === "number" ? [] : v;
  const total = typeof v === "number" ? v : rows.length;
  return Promise.resolve({ success: true, data: { totalSize: total, done: true, records: rows } });
}

const schemaRec = (sobject: string, profile = "Rep", isActive = true): ConfigRecord =>
  ({ category: "DbSchema", developerName: "db_" + sobject, label: sobject, isActive, isOrgLevel: false, fields: { SObject: sobject }, fieldTypes: {}, assignments: [{ name: profile, level: "Profile" }] }) as ConfigRecord;
const handler = (developerName: string, IsActive: boolean) => ({ DeveloperName: developerName, MasterLabel: developerName, IsActive });

beforeEach(() => {
  org = {};
  handlers = [];
  schema = [];
  vi.mocked(runSoqlQuery).mockClear();
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => (/FROM\s+LifeScienceTriggerHandler/i.test(q) ? Promise.resolve({ success: true, data: { totalSize: handlers.length, done: true, records: handlers } }) : respond(q))) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => schema) as never);
});

const run = async () => Object.fromEntries((await feature.checks!("test-org")).map((c) => [c.id, c]));
const queries = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));

describe("surveys readiness", () => {
  it("fails mobile surveys without an active version", async () => {
    org.Survey = [{ Id: "s1", Name: "Immunexis Access" }];
    const c = (await run())["surveys.config.active-version"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Immunexis Access"]);
  });

  it("skips survey checks when there are no mobile surveys", async () => {
    org.Survey = 0;
    const r = await run();
    expect(r["surveys.config.active-version"].status).toBe("skipped");
    expect(r["surveys.config.mobile-type"].status).toBe("skipped");
  });

  it("offers to switch on the colleague sharing handler when managed events have survey invitations", async () => {
    org.MngEvent = [{ Id: "e1" }];
    org.SurveyInvitation = [{ Id: "i1" }];
    handlers = [handler("ColleagueSurveySharingHandler", false)];
    const c = (await run())["surveys.enabled.colleague-sharing"];
    expect(c.status).toBe("fail");
    expect(c.fixes).toHaveLength(1);
  });

  it("skips the colleague sharing handler without managed event surveys", async () => {
    org.SurveyInvitation = [{ Id: "i1" }];
    handlers = [handler("ColleagueSurveySharingHandler", false)];
    expect((await run())["surveys.enabled.colleague-sharing"].status).toBe("skipped");
  });

  it("fails unshared mobile surveys when the org-wide default is Private", async () => {
    org.Survey = [{ Id: "s1", Name: "Immunexis Access" }];
    org.EntityDefinition = [{ InternalSharingModel: "Private" }];
    const c = (await run())["surveys.access.shared"];
    expect(c.status).toBe("fail");
    expect(c.severity).toBe("error");
    expect(c.detail).toContain("Private");
    expect(c.examples).toEqual(["Immunexis Access"]);
  });

  it("passes unshared mobile surveys when reps can read every survey", async () => {
    org.Survey = [{ Id: "s1", Name: "Immunexis Access" }];
    org.EntityDefinition = [{ InternalSharingModel: "Read" }];
    expect((await run())["surveys.access.shared"].status).toBe("pass");
  });

  it("flags offline responses that were never processed", async () => {
    org.SurveyResponseOffline = (q) => (q.includes("COUNT()") ? 3 : [{ Id: "r1" }]);
    const c = (await run())["surveys.data.unmigrated"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("3 offline responses from the last 90 days have waited over 2 days to be processed.");
  });

  it("checks for managed events and responses by reading one row, and counts only recent responses", async () => {
    org.SurveyResponseOffline = (q) => (q.includes("COUNT()") ? 0 : [{ Id: "r1" }]);
    const c = (await run())["surveys.data.unmigrated"];
    expect(c.status).toBe("pass");
    expect(c.detail).toBe("No offline response from the last 90 days has waited over 2 days.");
    const q = queries();
    expect(q).toContain("SELECT Id FROM MngEvent LIMIT 1");
    expect(q).toContain("SELECT Id FROM SurveyInvitation LIMIT 1");
    expect(q).toContain("SELECT Id FROM SurveyResponseOffline LIMIT 1");
    const counts = q.filter((x) => x.includes("COUNT() FROM SurveyResponseOffline WHERE"));
    expect(counts).toHaveLength(1);
    expect(counts[0]).toContain("CreatedDate = LAST_N_DAYS:90");
    expect(q.some((x) => /COUNT\(\) FROM MngEvent/.test(x))).toBe(false);
  });

  it("names the profile missing the response objects", async () => {
    schema = [schemaRec("Survey"), schemaRec("Survey", "Admin"), schemaRec("SurveyResponseOffline"), schemaRec("SurveyQstnResponseOffline"), schemaRec("SurveyResponseOffline", "Admin")];
    const c = (await run())["surveys.mobile.response-objects"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["SurveyQstnResponseOffline: missing for Admin"]);
  });

  it("only holds profiles that sync surveys to the response objects", async () => {
    // "Admin" syncs responses but not Survey itself, so it isn't one of the profiles that fill in surveys.
    schema = [schemaRec("Survey"), schemaRec("SurveyResponseOffline"), schemaRec("SurveyQstnResponseOffline"), schemaRec("SurveyResponseOffline", "Admin")];
    expect((await run())["surveys.mobile.response-objects"].status).toBe("pass");
  });
});
