import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: mod } = await import("../../../../src/studio/readiness/features/events.js");

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

describe("events readiness", () => {
  it("skips everything when Managed Event is not in the org", async () => {
    org.MngEvent = new Error("sObject type 'MngEvent' is not supported");
    const r = await run();
    expect(r["events.enabled.core-handlers"].status).toBe("skipped");
    expect(r["events.mobile.db-schema"].status).toBe("skipped");
  });

  it("offers fixes for inactive handlers", async () => {
    org.MngEvent = [{ Id: "1" }];
    handlers = [handler("MngEventDateTimeValidationHandler", false)];
    const c = (await run())["events.enabled.core-handlers"];
    expect(c.status).toBe("fail");
    expect(c.fixes?.[0]).toMatchObject({ kind: "setActive", record: { type: "triggerHandler" } });
  });

  it("fails event types that have no active type-role map", async () => {
    org.MngEvent = [{ Id: "1" }];
    org.MngEventType = [{ Id: "t1", Name: "Speaker Program", TargetTemplate: "SpeakerMeeting" }, { Id: "t2", Name: "Lunch", TargetTemplate: "Presentation" }];
    org.EventMgmtPtcpTypeRoleMap = [{ MngEventTypeId: "t1" }];
    const c = (await run())["events.data.type-role-map"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Lunch"]);
  });

  it("fails types without a template", async () => {
    org.MngEvent = [{ Id: "1" }];
    org.MngEventType = [{ Id: "t1", Name: "Bare", TargetTemplate: null }];
    expect((await run())["events.data.event-template"].status).toBe("fail");
  });

  it("errors when a server-only object is synced", async () => {
    org.MngEvent = [{ Id: "1" }];
    schema = [schemaRec("BudgetMngEventType")];
    const c = (await run())["events.mobile.no-server-only-objects"];
    expect(c.status).toBe("fail");
    expect(c.severity).toBe("error");
  });
});
