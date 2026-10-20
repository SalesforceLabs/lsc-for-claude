import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn(), cachedDescribeSObject: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: calendarTot } = await import("../../../../src/studio/readiness/features/calendar-tot.js");

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

  const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ Id: `X${i}` }));

  it("counts visits as calendar activity when there are no events", async () => {
    org.Visit = ids(24);
    const c = (await run())["calendar-tot.data.recent-events"];
    expect(c.status).toBe("pass");
    expect(c.detail).toBe("24 visits in the window.");
    org.Visit = [];
    expect((await run())["calendar-tot.data.recent-events"].status).toBe("fail");
  });

  it("reads at most 500 event and visit ids instead of counting them, and says when it stopped", async () => {
    org.Event = ids(500);
    org.Visit = ids(3);
    const c = (await run())["calendar-tot.data.recent-events"];
    expect(c.detail).toBe("500 or more events and 3 visits in the window. Stopped counting at 500 of each.");
    const q = vi.mocked(runSoqlQuery).mock.calls.map((x) => String(x[0]));
    expect(q.find((s) => s.includes("FROM Event"))).toBe("SELECT Id FROM Event WHERE StartDateTime >= LAST_N_DAYS:30 LIMIT 500");
    expect(q.find((s) => s.includes("FROM Visit"))).toBe("SELECT Id FROM Visit WHERE PlannedVisitStartTime >= LAST_N_DAYS:30 LIMIT 500");
    expect(q.some((s) => /COUNT\(\)\s+FROM\s+(Event|Visit)/.test(s))).toBe(false);
  });

  it("points working-day settings at their own Admin Console category", async () => {
    expect((await run())["calendar-tot.config.working-days"].uiPath).toBe("Admin Console > WorkingDaysConfig");
  });
});
