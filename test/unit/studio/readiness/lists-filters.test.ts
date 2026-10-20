import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn(), cachedDescribeSObject: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: lists } = await import("../../../../src/studio/readiness/features/lists-filters.js");

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

const run = async () => Object.fromEntries((await lists.checks!("test-org")).map((c) => [c.id, c]));

describe("lists-filters readiness", () => {
  it("lists static lists with no members", async () => {
    org.LifeScienceAccountList = [{ Id: "1", Name: "Empty" }];
    const c = (await run())["lists-filters.data.static-lists-empty"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Empty"]);
  });

  it("passes DB Schema when every list object syncs", async () => {
    schema = ["LifeScienceAccountList", "LifeSciAccountListMember", "LifeScienceAccountListObject", "LifeSciAccountListColumn", "LifeSciAcctListFilterCrit"].map((o) => schemaRec(o));
    expect((await run())["lists-filters.mobile.db-schema"].status).toBe("pass");
  });

  it("counts a list as having criteria when any of its object rows has some", async () => {
    // Target Accounts: criteria on the territory info row only; the join rows have none.
    org.LifeScienceAccountListObject = [
      { Id: "o1", LifeScienceAccountListId: "L1" },
      { Id: "o2", LifeScienceAccountListId: "L1" },
    ];
    org.LifeSciAcctListFilterCrit = [{ LifeSciAccountListObjectId: "o2" }];
    org.LifeScienceAccountList = [{ Id: "L1", Name: "Target Accounts" }];
    const r = await run();
    expect(r["lists-filters.config.filters-have-criteria"].status).toBe("pass");
    expect(r["lists-filters.config.lists-have-columns"].status).toBe("fail");
  });

  it("checks only filters, not static lists, for an object row", async () => {
    await run();
    const q = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0])).find((s) => /NOT IN \(SELECT LifeScienceAccountListId FROM LifeScienceAccountListObject\)/.test(s));
    expect(q).toContain("Type = 'Filter'");
    expect(q).toContain("ReportIdentifier = null");
  });
});
