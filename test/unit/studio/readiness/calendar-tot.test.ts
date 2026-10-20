import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn(), cachedDescribeSObject: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: calendarTot } = await import("../../../../src/studio/readiness/features/calendar-tot.js");

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

const run = async () => Object.fromEntries((await calendarTot.checks!("test-org")).map((c) => [c.id, c]));

describe("calendar-tot readiness", () => {
  it("fails when the Time Off Territory handlers are off", async () => {
    handlers = [handler("TUDOverlapHandler", false)];
    const c = (await run())["calendar-tot.enabled.trigger-handlers"];
    expect(c.status).toBe("fail");
    expect(c.fixes).toHaveLength(1);
  });

  it("fails when Planner Administration is missing", async () => {
    expect((await run())["calendar-tot.config.planner-business-hours"].status).toBe("fail");
  });

  it("flags holidays that are all in the past", async () => {
    org.Holiday = 0;
    expect((await run())["calendar-tot.data.holidays-ahead"].status).toBe("fail");
  });

  it("counts visits as calendar activity when there are no events", async () => {
    org.Event = 0;
    org.Visit = 24;
    const c = (await run())["calendar-tot.data.recent-events"];
    expect(c.status).toBe("pass");
    expect(c.detail).toBe("24 visits in the window.");
    org.Visit = 0;
    expect((await run())["calendar-tot.data.recent-events"].status).toBe("fail");
  });

  it("points working-day settings at their own Admin Console category", async () => {
    expect((await run())["calendar-tot.config.working-days"].uiPath).toBe("Admin Console > WorkingDaysConfig");
  });
});
