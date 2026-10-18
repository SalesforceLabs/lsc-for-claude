import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: mod } = await import("../../../../src/studio/readiness/features/mobile-sync.js");

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

const dataRec = (sobject: string, isActive: boolean, extra: Partial<ConfigRecord> = {}) =>
  ({ ...schemaRec(sobject, isActive), fields: { SObject: sobject, Type: "OBJECT" }, ...extra }) as ConfigRecord;

describe("mobile-sync readiness", () => {
  it("fails when no object is switched on", async () => {
    schema = [dataRec("Account", false)];
    const c = (await run())["mobile-sync.enabled.synced-objects"];
    expect(c.status).toBe("fail");
    expect(c.severity).toBe("error");
  });

  it("passes when an object syncs", async () => {
    schema = [dataRec("Account", true)];
    expect((await run())["mobile-sync.enabled.synced-objects"].status).toBe("pass");
  });

  it("flags a profile name that matches no profile", async () => {
    org.Profile = [{ Name: "Other" }];
    schema = [dataRec("Account", true)];
    const c = (await run())["mobile-sync.access.profiles-exist"];
    expect(c.status).toBe("fail");
    expect(c.examples?.[0]).toContain("Rep");
  });

  it("flags active records that are assigned to nobody", async () => {
    schema = [dataRec("Account", true, { assignments: [] })];
    expect((await run())["mobile-sync.config.assigned"].status).toBe("fail");
  });

  it("flags records that report errors", async () => {
    schema = [dataRec("Account", true, { fields: { SObject: "Account", Type: "OBJECT", Errors: "Field X missing" } })];
    expect((await run())["mobile-sync.config.schema-errors"].status).toBe("fail");
  });

  it("skips the freshness check when no cache exists", async () => {
    schema = [dataRec("Account", true)];
    expect((await run())["mobile-sync.mobile.cache-fresh"].status).toBe("skipped");
  });
});
