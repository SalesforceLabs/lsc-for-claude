import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: mod } = await import("../../../../src/studio/readiness/features/briefings.js");

type Row = Record<string, unknown>;
/** Rows (and optional COUNT override) returned per outer FROM-object; an Error makes that query fail, a function answers by the SOQL. */
let org: Record<string, Row[] | number | Error | ((soql: string) => Row[])>;
let handlers: Row[];
let schema: ConfigRecord[];

function respond(soql: string) {
  let outer = soql;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1] ?? "";
  const entry = org[from] ?? [];
  const v = typeof entry === "function" ? entry(soql) : entry;
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

describe("briefings readiness", () => {
  it("skips the pipeline checks when the toggle is off", async () => {
    org.PresentationContent = new Error("sObject type 'PresentationContent' is not supported");
    const r = await run();
    expect(r["briefings.data.briefings-current"].status).toBe("skipped");
    expect(r["briefings.mobile.db-schema-profiles"].status).toBe("skipped");
  });

  it("fails when briefings are older than the stale window", async () => {
    org.PresentationContent = [{ Id: "p1", CreatedDate: ago(30) }];
    const c = (await run())["briefings.data.briefings-current"];
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("30 days ago");
  });

  it("passes when briefings are recent", async () => {
    org.PresentationContent = [{ Id: "p1", CreatedDate: ago(1) }];
    expect((await run())["briefings.data.briefings-current"].status).toBe("pass");
  });

  const queries = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));

  it("reads the newest briefing and summary by an indexed field, without counting either table", async () => {
    org.PresentationContent = [{ Id: "p1", CreatedDate: ago(2) }];
    org.PrvdAccountTerritorySummary = [{ SystemModstamp: ago(3) }];
    const r = await run();
    expect(r["briefings.data.briefings-current"].detail).toBe("The newest briefing was created 2 days ago.");
    expect(r["briefings.data.summaries-current"].detail).toBe("The newest account summary was updated 3 days ago.");
    const q = queries();
    expect(q).toContain("SELECT CreatedDate FROM PresentationContent ORDER BY CreatedDate DESC LIMIT 1");
    expect(q).toContain("SELECT SystemModstamp FROM PrvdAccountTerritorySummary ORDER BY SystemModstamp DESC LIMIT 1");
    expect(q.some((s) => /COUNT\(|MAX\(/.test(s) && /PresentationContent|PrvdAccountTerritorySummary/.test(s))).toBe(false);
  });

  it("fails summaries when none exist", async () => {
    org.PresentationContent = [{ Id: "p1" }];
    expect((await run())["briefings.data.summaries-current"].status).toBe("fail");
  });

  it("looks up each receiving profile's briefings by its users' ids", async () => {
    org.PrstCntntDefAssignment = [{ IsActive: true, AssignedTo: { Name: "Rep" } }, { IsActive: true, AssignedTo: { Name: "Manager" } }];
    org.PermissionSetAssignment = (q) => (q.includes("Profile.Name = 'Rep'") && !q.includes("GROUP BY") ? [{ AssigneeId: "U1" }, { AssigneeId: "U1" }, { AssigneeId: "U2" }] : []);
    org.User = (q) => (q.includes("Profile.Name = 'Manager'") ? [{ Id: "M1" }] : []);
    org.PresentationContent = (q) => (q.includes("TargetUserId IN ('U1','U2')") ? [{ Id: "p1" }] : q.includes("TargetUserId") ? [] : [{ Id: "p0" }]);
    const c = (await run())["briefings.data.profiles-have-content"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Manager"]);
    expect(c.detail).toBe(
      "1 profile with no briefings yet: Manager. Checked all 3 users with Use Briefings in these profiles (every active user where none has it)."
    );
    const q = queries();
    expect(q).toContain("SELECT Id FROM PresentationContent WHERE TargetUserId IN ('M1') LIMIT 1");
    expect(q.some((s) => s.includes("GROUP BY TargetUser.Profile.Name"))).toBe(false);
  });

  it("fails licenses that are missing from the org", async () => {
    org.PresentationContent = [{ cnt: 1 }];
    const c = (await run())["briefings.access.licenses"];
    expect(c.status).toBe("fail");
    expect(c.examples?.[0]).toContain("not in this org");
  });

  it("fails when no schedule flow is active", async () => {
    org.PresentationContent = [{ cnt: 1 }];
    org.FlowDefinitionView = [{ Label: "Briefings: Schedule Daily Briefings of Provider Accounts", ApiName: "ScheduleDailyBriefings", ActiveVersionId: null }];
    expect((await run())["briefings.config.scheduled-flow"].status).toBe("fail");
  });

  it("matches licenses by developer name, not label", async () => {
    org.PresentationContent = [{ cnt: 1 }];
    org.PermissionSetLicense = [
      ["IndustriesLSC4CEPsl", "Life Science Commercial"],
      ["HealthCloudStarter", "Health Cloud Starter"],
      ["SiteMgmtSiteSelAssistanceAgentPsl", "Agentforce for Life Sciences Cloud Feature Access"],
      ["EinsteinGPTPromptTemplatesPsl", "Einstein Prompt Templates"],
    ].map(([DeveloperName, MasterLabel]) => ({ DeveloperName, MasterLabel, TotalLicenses: 10, UsedLicenses: 2 }));
    expect((await run())["briefings.access.licenses"].status).toBe("pass");
  });

  it("counts standard permission set assignments by permission set id", async () => {
    org.PresentationContent = [{ cnt: 1 }];
    const names = ["HealthCloudStarter", "EinsteinGPTPromptTemplateManager", "EinsteinGPTPromptTemplateUser", "AccsAgtfrceForLifeSciCustEngmt"];
    org.PermissionSet = names.map((Name, i) => ({ Id: `0PS${i}`, Name }));
    org.PermissionSetAssignment = (q) => (/GROUP BY PermissionSetId/.test(q) ? [{ psid: "0PS0", cnt: 8 }, { psid: "0PS1", cnt: 1 }, { psid: "0PS2", cnt: 9 }] : []);
    const c = (await run())["briefings.access.standard-permission-sets"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Access LSC CE Agentforce"]);
  });
});
