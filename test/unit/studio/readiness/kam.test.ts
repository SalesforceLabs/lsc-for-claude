import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn(), cachedDescribeSObject: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: kam } = await import("../../../../src/studio/readiness/features/kam.js");

type Row = Record<string, unknown>;
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

const run = async () => Object.fromEntries((await kam.checks!("test-org")).map((c) => [c.id, c]));

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
