import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: visit } = await import("../../../../src/studio/readiness/features/visit.js");

type Row = Record<string, unknown>;
/** Rows (and optional COUNT override) returned per outer FROM-object. */
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

  it("marks a check unknown when its query fails", async () => {
    vi.mocked(runSoqlQuery).mockResolvedValue({ success: false, error: "boom" } as never);
    expect((await run())["visit.data.recent-visits"].status).toBe("unknown");
  });
});
