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
const { default: mod } = await import("../../../../src/studio/readiness/features/events.js");

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
  vi.mocked(scope.ipadProfiles).mockRejectedValue(new Error("no scope"));
  vi.mocked(scope.territoryProfiles).mockRejectedValue(new Error("no scope"));
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

const queries = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));

describe("events readiness", () => {
  it("tells whether Managed Event exists from one row, not a count", async () => {
    org.MngEvent = [{ Id: "1" }];
    await run();
    expect(queries()).toContain("SELECT Id FROM MngEvent LIMIT 1");
    expect(queries().some((q) => q.includes("COUNT() FROM MngEvent"))).toBe(false);
  });

  it("checks event dates on a sample read with LIMIT and no ORDER BY, and says how much it read", async () => {
    org.MngEvent = (q) =>
      q.includes("EndDateTime")
        ? [
            { Name: "Good", StartDateTime: "2026-05-01T09:00:00Z", EndDateTime: "2026-05-01T10:00:00Z" },
            { Name: "Backwards", StartDateTime: "2026-05-01T10:00:00Z", EndDateTime: "2026-05-01T09:00:00Z" },
          ]
        : [{ Id: "1" }];
    const c = (await run())["events.data.event-dates"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("1 of 2 ends before it starts. Checked all 2 events with an end date.");
    expect(c.examples).toEqual(["Backwards"]);
    const q = queries().find((q) => q.includes("EndDateTime != null"))!;
    expect(q).toMatch(/LIMIT 500$/);
    expect(q).not.toContain("ORDER BY");
  });

  it("says the event dates check covers a sample when there are more events than it reads", async () => {
    const row = { Name: "E", StartDateTime: "2026-05-01T09:00:00Z", EndDateTime: "2026-05-01T10:00:00Z" };
    org.MngEvent = (q) => (q.includes("EndDateTime") ? Array.from({ length: 500 }, () => row) : [{ Id: "1" }]);
    const c = (await run())["events.data.event-dates"];
    expect(c.status).toBe("pass");
    expect(c.detail).toBe("Every one ends after it starts. Checked a sample of 500 events with an end date, not every one in the org.");
  });

  it("finds events carrying compliance statements from a sample, ignoring empty lists", async () => {
    org.MngEvent = (q) =>
      q.includes("ComplianceStatements")
        ? [
            { Name: "Empty", ComplianceStatements: "[]" },
            { Name: "Blank", ComplianceStatements: null },
            { Name: "Has one", ComplianceStatements: '[{"id":"x"}]' },
          ]
        : [{ Id: "1" }];
    const c = (await run())["events.config.compliance"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("1 of 3 events carries compliance statements but no definition exists. Checked all 3 events.");
    expect(c.examples).toEqual(["Has one"]);
    expect(queries().some((q) => q.includes("ComplianceStatements != null"))).toBe(false);
    expect(queries().find((q) => q.includes("SELECT Name, ComplianceStatements FROM MngEvent"))).toMatch(/LIMIT 500$/);
  });

  it("passes the compliance check on definitions alone, without reading events", async () => {
    org.MngEvent = [{ Id: "1" }];
    org.ComplianceStatementDef = 2;
    expect((await run())["events.config.compliance"].status).toBe("pass");
    expect(queries().some((q) => q.includes("ComplianceStatements FROM MngEvent"))).toBe(false);
  });

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
    org.EventMgmtParticipantType = 2;
    org.EventMgmtParticipantRole = 3;
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

  it("fails when some field users can't read Managed Event, counted by profile", async () => {
    org.MngEvent = [{ Id: "1" }];
    org.Profile = [{ Name: "Rep" }];
    org.PermissionSetAssignment = [{ PermissionSetId: "0PS1" }];
    org.ObjectPermissions = (q) => (q.includes("ParentId IN ('0PS1')") ? [{ ParentId: "0PS1" }] : []);
    let anti = "";
    org.User = (q) => {
      if (!q.includes("NOT IN")) return [{ pn: "Rep", cnt: 5 }];
      anti = q;
      return [{ pn: "Rep", cnt: 2 }];
    };
    const c = (await run())["events.access.event-read"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("2 of 5 active field users can't read Managed Event.");
    expect(c.examples).toEqual(["Rep: 2 users"]);
    expect(anti).toContain("PermissionSetId IN ('0PS1')");
  });

  it("passes events.access.event-read only when every field user can read it", async () => {
    org.MngEvent = [{ Id: "1" }];
    org.Profile = [{ Name: "Rep" }];
    org.PermissionSetAssignment = [{ PermissionSetId: "0PS1" }];
    org.ObjectPermissions = (q) => (q.includes("ParentId IN ('0PS1')") ? [{ ParentId: "0PS1" }] : []);
    org.User = (q) => (q.includes("NOT IN") ? [] : [{ pn: "Rep", cnt: 5 }]);
    expect((await run())["events.access.event-read"].status).toBe("pass");
  });

  it("fails events.access.event-read when nothing grants Read, even with no anti-join", async () => {
    org.MngEvent = [{ Id: "1" }];
    org.Profile = [{ Name: "Rep" }];
    org.User = [{ pn: "Rep", cnt: 3 }];
    const c = (await run())["events.access.event-read"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Rep: 3 users"]);
  });

  it("skips the type-role map when there are no participant types or roles to map", async () => {
    org.MngEvent = [{ Id: "1" }];
    org.MngEventType = [{ Id: "t1", Name: "Lunch", TargetTemplate: "Presentation" }];
    org.EventMgmtParticipantType = 2;
    const c = (await run())["events.data.type-role-map"];
    expect(c.status).toBe("skipped");
    expect(c.detail).toBe("No participant roles exist yet, so there is nothing to map.");
  });

  it("needs BusinessHours synced only while the business hours handler is on", async () => {
    org.MngEvent = [{ Id: "1" }];
    org.EntityDefinition = [{ QualifiedApiName: "BusinessHours" }];
    schema = [schemaRec("MngEvent")];
    expect((await run())["events.mobile.business-hours"].status).toBe("skipped");
    handlers = [handler("MngEventBusinessHoursHandler", true)];
    const c = (await run())["events.mobile.business-hours"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["BusinessHours"]);
    schema = [schemaRec("MngEvent"), schemaRec("BusinessHours")];
    expect((await run())["events.mobile.business-hours"].status).toBe("pass");
  });
});
