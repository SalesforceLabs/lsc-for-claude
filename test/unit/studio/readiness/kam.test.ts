import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn(), cachedDescribeSObject: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: kam } = await import("../../../../src/studio/readiness/features/kam.js");

type Row = Record<string, unknown>;
let org: Record<string, Row[] | number | ((soql: string) => Row[])>;
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

const schemaRec = (sobject: string, isActive = true): ConfigRecord =>
  ({ category: "DbSchema", developerName: "db_" + sobject, label: sobject, isActive, isOrgLevel: false, fields: { SObject: sobject }, fieldTypes: {}, assignments: [{ name: "Rep", level: "Profile" }] }) as ConfigRecord;
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

const run = async () => Object.fromEntries((await kam.checks!("test-org")).map((c) => [c.id, c]));
const queries = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));

describe("kam readiness", () => {
  it("fails the sharing check with a switch-on fix when a handler is off", async () => {
    handlers = [handler("AccountPlanToParticipantSharingHandler", false), handler("AssessmentTaskSharingHandler", true)];
    const c = (await run())["kam.enabled.sharing-handlers"];
    expect(c.status).toBe("fail");
    expect(c.fixes).toHaveLength(1);
  });

  it("skips plan checks when there are no plans", async () => {
    const r = await run();
    expect(r["kam.data.plans-have-objectives"].status).toBe("skipped");
  });

  it("reads a sample of plans and objectives and looks their children up by id, never with an anti-join", async () => {
    org.AccountPlan = [{ Id: "P1", Name: "Plan A" }, { Id: "P2", Name: "Plan B" }];
    org.AccountPlanObjective = (q) => (q.includes("GROUP BY") ? [{ AccountPlanId: "P1", cnt: 2 }] : [{ Id: "O1", Name: "Grow share" }]);
    org.AccountPlanParticipant = [{ AccountPlanId: "P1", cnt: 1 }, { AccountPlanId: "P2", cnt: 3 }];
    org.ActionPlan = [];
    const r = await run();
    const q = queries();
    expect(q.some((x) => x.includes("NOT IN (SELECT"))).toBe(false);
    expect(q).toContain("SELECT Id, Name FROM AccountPlan LIMIT 500");
    expect(q).toContain("SELECT Id, Name FROM AccountPlanObjective LIMIT 500");
    expect(q.find((x) => x.includes("FROM AccountPlanObjective WHERE AccountPlanId"))).toContain("AccountPlanId IN ('P1','P2')");
    expect(q.find((x) => x.includes("FROM ActionPlan WHERE"))).toContain("TargetId IN ('O1') AND ActionPlanType = 'KAM'");

    expect(r["kam.data.plans-have-objectives"].status).toBe("fail");
    expect(r["kam.data.plans-have-objectives"].detail).toBe("1 of 2 account plans has no objectives. Checked all 2 account plans.");
    expect(r["kam.data.plans-have-objectives"].examples).toEqual(["Plan B"]);
    expect(r["kam.data.plans-have-participants"].status).toBe("pass");
    expect(r["kam.data.plans-have-participants"].detail).toBe("Every one has participants. Checked all 2 account plans.");
    expect(r["kam.data.objectives-have-action-plans"].detail).toBe("1 of 1 objective has no action plan. Checked all 1 objective.");
  });

  it("says a full sample of plans is a sample", async () => {
    org.AccountPlan = Array.from({ length: 500 }, (_, i) => ({ Id: "P" + i, Name: "Plan " + i }));
    org.AccountPlanParticipant = org.AccountPlan.map((p) => ({ AccountPlanId: p.Id, cnt: 1 }));
    expect((await run())["kam.data.plans-have-participants"].detail).toBe("Every one has participants. Checked a sample of 500 account plans, not every one in the org.");
  });

  it("fails when no template is published", async () => {
    org.ActionPlanTemplate = 0;
    expect((await run())["kam.config.published-templates"].status).toBe("fail");
  });

  it("offers to add missing DB Schema objects", async () => {
    schema = [schemaRec("AccountPlan")];
    const c = (await run())["kam.mobile.db-schema"];
    expect(c.status).toBe("fail");
    expect(c.fixes!.some((f) => f.kind === "createConfigRecord")).toBe(true);
  });

  it("names the field profiles of plan owners that don't sync the plan objects", async () => {
    const objects = ["AccountPlan", "AccountPlanObjective", "AccountPlanParticipant", "AccountPlanStakeholder", "ActionPlan", "ActionPlanItem", "ActionPlanTemplate", "ActionPlanTemplateAssignment", "GoalDefinition", "AssessmentTask"];
    const kamOnly = (o: string) => ({ ...schemaRec(o), assignments: [{ name: "KAM", level: "Profile" }] }) as ConfigRecord;
    // Field profiles come from the mobile app settings; both KAM and Rep are field profiles.
    const appSettings = { ...schemaRec(""), category: "ProfileBasedAppSettings", fields: {}, assignments: [{ name: "KAM", level: "Profile" }, { name: "Rep", level: "Profile" }] } as ConfigRecord;
    schema = [...objects.map(kamOnly), appSettings];
    org.User = [{ pn: "Rep", cnt: 3 }];
    const c = (await run())["kam.mobile.db-schema"];
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("Rep doesn't sync AccountPlan");
    expect(c.examples).toEqual(["Rep"]);
    expect(c.fixes!.every((f) => f.kind === "setProfileAssignments")).toBe(true);
  });

  it("passes DB Schema when the KAM profile is the only one that uses plans", async () => {
    const objects = ["AccountPlan", "AccountPlanObjective", "AccountPlanParticipant", "AccountPlanStakeholder", "ActionPlan", "ActionPlanItem", "ActionPlanTemplate", "ActionPlanTemplateAssignment", "GoalDefinition", "AssessmentTask"];
    schema = objects.map((o) => ({ ...schemaRec(o), assignments: [{ name: "KAM", level: "Profile" }] }) as ConfigRecord);
    org.User = [{ pn: "KAM", cnt: 1 }];
    expect((await run())["kam.mobile.db-schema"].status).toBe("pass");
  });
});
