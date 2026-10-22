import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn(), cachedDescribeSObject: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: lists } = await import("../../../../src/studio/readiness/features/lists-filters.js");

type Row = Record<string, unknown>;
/** Rows (or a COUNT override) per outer FROM-object, or a function of the query. */
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
  const queries = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));

  it("lists static lists with no members", async () => {
    org.LifeScienceAccountList = [{ Id: "1", Name: "Empty" }];
    const c = (await run())["lists-filters.data.static-lists-empty"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Empty"]);
  });

  it("samples static lists and looks their members up by list id, never with an anti-join", async () => {
    org.LifeScienceAccountList = [{ Id: "L1", Name: "Full" }, { Id: "L2", Name: "Empty" }];
    org.LifeSciAccountListMember = (q) => (q.includes("'L1'") ? [{ LifeScienceAccountListId: "L1", cnt: 3 }] : []);
    const c = (await run())["lists-filters.data.static-lists-empty"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("1 of 2 static lists has no members. Checked all 2 static lists.");
    expect(c.examples).toEqual(["Empty"]);
    const q = queries();
    expect(q.find((s) => s.includes("Type = 'List' AND IsRoute = false"))).toMatch(/LIMIT 500$/);
    expect(q.find((s) => s.includes("FROM LifeSciAccountListMember"))).toContain("LifeScienceAccountListId IN ('L1','L2')");
    expect(q.filter((s) => s.includes("LifeSciAccountListMember")).some((s) => s.includes("NOT IN"))).toBe(false);
  });

  it("says empty-route results cover a sample when there are more routes than it reads", async () => {
    org.LifeScienceAccountList = Array.from({ length: 500 }, (_, i) => ({ Id: `R${i}`, Name: `Route ${i}` }));
    org.LifeSciAccountListMember = (q) => [...q.matchAll(/'(R\d+)'/g)].map((m) => ({ LifeScienceAccountListId: m[1], cnt: 1 }));
    const c = (await run())["lists-filters.data.routes-empty"];
    expect(c.status).toBe("pass");
    expect(c.detail).toBe("Every route checked has stops. Checked a sample of 500 routes, not every one in the org.");
  });

  it("reads lists without counting the whole table", async () => {
    org.LifeScienceAccountList = Array.from({ length: 500 }, (_, i) => ({ Id: `L${i}` }));
    const c = (await run())["lists-filters.data.lists-exist"];
    expect(c.detail).toBe("At least 500 lists.");
    expect(queries().some((s) => s.includes("COUNT() FROM LifeScienceAccountList"))).toBe(false);
  });

  it("finds lists of inactive users by owner id", async () => {
    org.User = [{ Id: "U1" }, { Id: "U2" }];
    org.LifeScienceAccountList = (q) =>
      q.includes("GROUP BY OwnerId") ? [{ OwnerId: "U2", cnt: 2 }] : q.includes("OwnerId IN ('U2')") ? [{ Id: "L1", Name: "Old list" }] : [];
    const c = (await run())["lists-filters.data.inactive-owners"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("2 lists owned by 1 inactive user. Checked the lists of all 2 inactive users.");
    expect(c.examples).toEqual(["Old list"]);
    expect(queries().find((s) => s.includes("GROUP BY OwnerId"))).toContain("OwnerId IN ('U1','U2')");
    expect(queries().some((s) => s.includes("Owner.IsActive"))).toBe(false);
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
