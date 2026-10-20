import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn(), cachedDescribeSObject: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { invalidateSharedReads } = await import("../../../../src/config/read-cache.js");
const { default: activityPlan } = await import("../../../../src/studio/readiness/features/activity-plan.js");

type Row = Record<string, unknown>;
/** Rows (or a COUNT) returned per outer FROM-object, or a function of the query. */
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

const schemaRec = (sobject: string, isActive = true): ConfigRecord =>
  ({ category: "DbSchema", developerName: "db_" + sobject, label: sobject, isActive, isOrgLevel: false, fields: { SObject: sobject }, fieldTypes: {}, assignments: [{ name: "Rep", level: "Profile" }] }) as ConfigRecord;
const handler = (developerName: string, IsActive: boolean) => ({ DeveloperName: developerName, MasterLabel: developerName, IsActive });

beforeEach(() => {
  invalidateSharedReads();
  org = {};
  handlers = [];
  schema = [];
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => (/FROM\s+LifeScienceTriggerHandler/i.test(q) ? Promise.resolve({ success: true, data: { totalSize: handlers.length, done: true, records: handlers } }) : respond(q))) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => schema) as never);
});

const soqls = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));
const run = async () => Object.fromEntries((await activityPlan.checks!("test-org")).map((c) => [c.id, c]));

describe("activity-plan readiness", () => {
  it("fails when no time period covers today", async () => {
    org.TimePeriod = 0;
    expect((await run())["activity-plan.data.time-period-current"].status).toBe("fail");
  });

  it("fails DB Schema with fixes for missing objects", async () => {
    schema = [schemaRec("ActivityPlan")];
    const c = (await run())["activity-plan.mobile.db-schema"];
    expect(c.status).toBe("fail");
    expect(c.fixes!.length).toBeGreaterThan(0);
  });

  it("names a profile with users in plan territories that doesn't sync the plan objects", async () => {
    const objects = ["ActivityPlan", "ActivityPlanTerritory", "TimePeriod", "ProviderActivityGoal", "ProviderActivityGoalMeasure"];
    const appSettings = { ...schemaRec(""), category: "ProfileBasedAppSettings", fields: {}, assignments: [{ name: "Rep", level: "Profile" }, { name: "Medical", level: "Profile" }] } as ConfigRecord;
    schema = [...objects.map((o) => schemaRec(o)), appSettings];
    org.UserTerritory2Association = [{ pn: "Medical", cnt: 2 }];
    const c = (await run())["activity-plan.mobile.db-schema"];
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("Medical doesn't sync ActivityPlan");
  });

  const plan = (Id: string, Name: string) => ({ Id, Name });
  /** Goals per plan id, answered from the plan id the query names. */
  const goalsByPlan = (byPlan: Record<string, Row[]>) => (q: string) => byPlan[/ActivityPlanId = '(\w+)'/.exec(q)?.[1] ?? ""] ?? [];

  it("finds active plans with no territory by plan id, without an anti-join", async () => {
    org.ActivityPlan = [plan("P1", "Plan A"), plan("P2", "Plan B")];
    org.ActivityPlanTerritory = (q) => (q.includes("GROUP BY ActivityPlanId") ? [{ ActivityPlanId: "P1", cnt: 3 }] : []);
    const c = (await run())["activity-plan.data.plan-territory"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Plan B"]);
    expect(soqls().find((q) => q.includes("GROUP BY ActivityPlanId"))).toContain("ActivityPlanId IN ('P1','P2')");
    expect(soqls().some((q) => q.includes("NOT IN"))).toBe(false);
  });

  it("looks up plan coverage by staffed territory id", async () => {
    org.Territory2Model = [{ Id: "0MA1", State: "Active" }];
    org.Territory2 = [{ Id: "T1", Name: "North" }, { Id: "T2", Name: "South" }];
    org.UserTerritory2Association = (q) => (q.includes("GROUP BY Territory2Id") ? [{ Territory2Id: "T1", cnt: 1 }, { Territory2Id: "T2", cnt: 2 }] : []);
    org.ActivityPlanTerritory = (q) => (q.includes("GROUP BY TerritoryId") ? [{ TerritoryId: "T1", cnt: 1 }] : []);
    const c = (await run())["activity-plan.data.territory-coverage"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["South"]);
    expect(soqls().find((q) => q.includes("GROUP BY TerritoryId"))).toContain("TerritoryId IN ('T1','T2') AND ActivityPlan.IsActive = true");
  });

  it("reads each active plan's goals by plan id with a limit, and names plans with none", async () => {
    org.ActivityPlan = [plan("P1", "Plan A"), plan("P2", "Plan B")];
    org.ProviderActivityGoal = goalsByPlan({ P1: [{ Id: "G1", Name: "Goal 1" }] });
    const c = (await run())["activity-plan.data.plan-goals"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Plan B"]);
    expect(c.detail).toBe("1 active plan with no goals. Checked all 2 active plans.");
    const goalQueries = soqls().filter((q) => q.includes("FROM ProviderActivityGoal "));
    expect(goalQueries).toHaveLength(2);
    for (const q of goalQueries) expect(q).toMatch(/WHERE ActivityPlanId = 'P\d' LIMIT 250$/);
    expect(soqls().some((q) => q.includes("NOT IN"))).toBe(false);
  });

  it("looks up measures of the sampled goals by goal id and says which goals have none", async () => {
    org.ActivityPlan = [plan("P1", "Plan A")];
    org.ProviderActivityGoal = goalsByPlan({ P1: [{ Id: "G1", Name: "Dr A" }, { Id: "G2", Name: "Dr B" }] });
    org.ProviderActivityGoalMeasure = [{ ProviderActivityGoalId: "G1", Type: "Goal", ActivityWeightValue: null }];
    const c = (await run())["activity-plan.data.goal-measures"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("1 of 2 has no measures. Checked all 2 goals on active plans.");
    expect(c.examples).toEqual(["Dr B (Plan A)"]);
    expect(soqls().find((q) => q.includes("FROM ProviderActivityGoalMeasure"))).toContain("ProviderActivityGoalId IN ('G1','G2')");
  });

  it("says the goal checks covered a sample when a plan has more goals than it reads", async () => {
    org.ActivityPlan = [plan("P1", "Plan A")];
    const goals = Array.from({ length: 500 }, (_, i) => ({ Id: `G${i}`, Name: `Goal ${i}` }));
    org.ProviderActivityGoal = goalsByPlan({ P1: goals });
    const all = goals.map((g) => ({ ProviderActivityGoalId: g.Id, Type: "WeightedGoal", ActivityWeightValue: g.Id === "G0" ? null : 1 }));
    // Measures are read in IN-list chunks of goal ids: answer each with its own goals.
    org.ProviderActivityGoalMeasure = (q) => all.filter((m) => q.includes(`'${m.ProviderActivityGoalId}'`));
    const r = await run();
    expect(r["activity-plan.data.goal-measures"].status).toBe("pass");
    expect(r["activity-plan.data.goal-measures"].detail).toBe(
      "Every goal checked has measures. Checked 500 goals across 1 active plan (up to 500 per plan), not every goal in the org."
    );
    const w = r["activity-plan.config.weighted-weights"];
    expect(w.status).toBe("fail");
    expect(w.detail).toBe("1 of 500 weighted measures has no weight. Checked 500 goals across 1 active plan (up to 500 per plan), not every goal in the org.");
    expect(soqls().some((q) => q.includes("LIKE '%Weighted%'"))).toBe(false);
  });
});
