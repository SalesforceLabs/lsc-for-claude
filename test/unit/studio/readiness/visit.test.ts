import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: visit } = await import("../../../../src/studio/readiness/features/visit.js");

type Row = Record<string, unknown>;
/** Rows (and optional COUNT override) returned per outer FROM-object. */
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

beforeEach(() => {
  org = {};
  handlers = [];
  schema = [];
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => (/FROM\s+LifeScienceTriggerHandler/i.test(q) ? Promise.resolve({ success: true, data: { totalSize: handlers.length, done: true, records: handlers } }) : respond(q))) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => schema) as never);
});

const run = async () => Object.fromEntries((await visit.checks!("test-org")).map((c) => [c.id, c]));
const handler = (developerName: string, IsActive: boolean) => ({ DeveloperName: developerName, MasterLabel: developerName, IsActive });

describe("visit readiness", () => {
  it("flags inactive guardrail handlers with a switch-on fix", async () => {
    handlers = [handler("VisitConflictValidationHandler", false), handler("VisitorLockHandler", true)];
    const c = (await run())["visit.config.guardrail-handlers"];
    expect(c.status).toBe("fail");
    expect(c.fixes).toHaveLength(1);
    expect(c.fixes![0]).toMatchObject({ kind: "setActive", to: true });
  });

  it("skips the action validation check when the org has no such script", async () => {
    expect((await run())["visit.config.action-validation-script"].status).toBe("skipped");
  });

  it("fails when a later validation script is ignored", async () => {
    org.LifeScienceCustomScript = [
      { Id: "1", Name: "A", ObjectName: "ProviderVisit", OperationEventType: "OnUpdate", CodeText: "" },
      { Id: "2", Name: "B", ObjectName: "ProviderVisit", OperationEventType: "OnUpdate", CodeText: "" },
    ];
    const c = (await run())["visit.config.action-validation-script"];
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("B will not run");
  });

  it("reports unsynced visit objects", async () => {
    org.EntityDefinition = [{ QualifiedApiName: "ProviderVisit" }];
    schema = [];
    expect((await run())["visit.mobile.db-schema"].status).toBe("fail");
    schema = [schemaRec("ProviderVisit")];
    expect((await run())["visit.mobile.db-schema"].status).toBe("pass");
  });

  const queries = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));

  it("looks for stuck visits only within a CreatedDate window", async () => {
    org.Visit = [{ Id: "v1", Name: "V-1" }];
    const c = (await run())["visit.data.stuck-in-progress"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("1 visit from the last 90 days In Progress for more than 14 days.");
    expect(queries().find((q) => q.includes("Status = 'InProgress'"))).toContain("CreatedDate = LAST_N_DAYS:90 AND CreatedDate < LAST_N_DAYS:14");
  });

  it("checks the rollup on the accounts of recently completed visits, looked up by id", async () => {
    org.Visit = (q) => (q.includes("ActualVisitEndTime") ? [{ AccountId: "A1" }, { AccountId: "A2" }, { AccountId: "A1" }] : []);
    org.ProviderAcctTerritoryInfo = [{ AccountId: "A1" }];
    const c = (await run())["visit.data.rollup-fresh"];
    expect(c.status).toBe("pass");
    expect(c.detail).toBe("1 of 2 visited accounts has territory info showing a last visit date in the last 30 days. Checked the accounts of all 3 visits completed in the last 30 days.");
    const q = queries();
    expect(q.find((s) => s.includes("ActualVisitEndTime"))).toMatch(/^SELECT AccountId FROM Visit WHERE LastModifiedDate = LAST_N_DAYS:30 .* LIMIT 500$/);
    expect(q.find((s) => s.includes("FROM ProviderAcctTerritoryInfo"))).toContain("AccountId IN ('A1','A2') AND LastProviderVisitDate = LAST_N_DAYS:30");
    expect(q.some((s) => s.includes("COUNT() FROM ProviderAcctTerritoryInfo"))).toBe(false);
  });

  it("fails the rollup when no visited account shows the visit, and says it's a sample", async () => {
    org.Visit = (q) => (q.includes("ActualVisitEndTime") ? Array.from({ length: 500 }, (_, i) => ({ AccountId: `A${i}` })) : []);
    const c = (await run())["visit.data.rollup-fresh"];
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("Checked the accounts of a sample of 500 visits completed in the last 30 days, not every one in the org.");
  });

  it("marks a check unknown when its query fails", async () => {
    vi.mocked(runSoqlQuery).mockResolvedValue({ success: false, error: "boom" } as never);
    expect((await run())["visit.data.recent-visits"].status).toBe("unknown");
  });
});
