import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn(), cachedDescribeSObject: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { invalidateSharedReads } = await import("../../../../src/config/read-cache.js");
const { default: territoryUsers } = await import("../../../../src/studio/readiness/features/territory-users.js");

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
  invalidateSharedReads();
  org = {};
  handlers = [];
  schema = [];
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => (/FROM\s+LifeScienceTriggerHandler/i.test(q) ? Promise.resolve({ success: true, data: { totalSize: handlers.length, done: true, records: handlers } }) : respond(q))) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => schema) as never);
});

const soqls = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));
const run = async () => Object.fromEntries((await territoryUsers.checks!("test-org")).map((c) => [c.id, c]));

describe("territory-users readiness", () => {
  it("fails when a territory handler is off, with a switch-on fix", async () => {
    handlers = [handler("Territory2Handler", false)];
    const c = (await run())["territory-users.enabled.trigger-handlers"];
    expect(c.status).toBe("fail");
    expect(c.fixes).toHaveLength(1);
  });

  it("fails DB Schema when territory objects are not synced", async () => {
    expect((await run())["territory-users.mobile.db-schema"].status).toBe("fail");
  });

  const territory = (Id: string, Name: string, ParentTerritory2Id: string | null = null) => ({ Id, Name, ParentTerritory2Id });

  it("counts a territory with no user of its own as staffed when a territory above it has one", async () => {
    org.Territory2Model = [{ Id: "0MA1", State: "Active" }];
    org.Territory2 = [territory("0MI1", "Region"), territory("0MI2", "Area", "0MI1"), territory("0MI3", "Orphan")];
    org.ObjectTerritory2Association = [{ Territory2Id: "0MI2", cnt: 5 }, { Territory2Id: "0MI3", cnt: 2 }];
    org.UserTerritory2Association = [{ Territory2Id: "0MI1", cnt: 1 }];
    const c = (await run())["territory-users.data.territory-staffed"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Orphan (2 accounts)"]);
    expect(c.detail).toContain("Area by Region");
  });

  it("passes when every territory with accounts is covered from above", async () => {
    org.Territory2Model = [{ Id: "0MA1", State: "Active" }];
    org.Territory2 = [territory("0MI1", "Region"), territory("0MI2", "Area", "0MI1")];
    org.ObjectTerritory2Association = [{ Territory2Id: "0MI2", cnt: 5 }];
    org.UserTerritory2Association = [{ Territory2Id: "0MI1", cnt: 1 }];
    expect((await run())["territory-users.data.territory-staffed"].status).toBe("pass");
  });

  const activeModel = () => {
    org.Territory2Model = [{ Id: "0MA1", State: "Active" }];
    org.Territory2 = [territory("0MI000000000001AAA", "North"), territory("0MI000000000002AAA", "South")];
  };

  it("compares territory info with alignment by account and territory", async () => {
    activeModel();
    // The account is aligned and has info, but for different territories.
    org.ProviderAcctTerritoryInfo = [{ AccountId: "001000000000001AAA", Account: { Name: "Dr A" }, Territory2Id: "0MI000000000001AAA", Territory2: { Name: "North" } }];
    org.ObjectTerritory2Association = [{ ObjectId: "001000000000001", Object: { Name: "Dr A" }, Territory2Id: "0MI000000000002", Territory2: { Name: "South" } }];
    const c = (await run())["territory-users.data.pati-matches-alignment"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Dr A in North: info row, not aligned", "Dr A in South: aligned, no info row"]);
    expect(c.detail).toContain("Checked all 1 alignment and 1 territory info row in the active model.");
  });

  it("matches 15- and 18-character ids when territory info is in step", async () => {
    activeModel();
    org.ProviderAcctTerritoryInfo = [{ AccountId: "001000000000001AAA", Territory2Id: "0MI000000000001AAA" }];
    org.ObjectTerritory2Association = [{ ObjectId: "001000000000001", Territory2Id: "0MI000000000001" }];
    expect((await run())["territory-users.data.pati-matches-alignment"].status).toBe("pass");
  });

  it("samples alignments and territory info by territory id with a limit, and looks the other side up by account id", async () => {
    activeModel();
    org.ProviderAcctTerritoryInfo = [{ AccountId: "001A", Territory2Id: "0MI000000000001AAA" }];
    org.ObjectTerritory2Association = [{ ObjectId: "001B", Territory2Id: "0MI000000000001AAA" }];
    await run();
    const q = soqls();
    expect(q.some((s) => s.includes("NOT IN") || s.includes("COUNT()"))).toBe(false);
    expect(q.find((s) => s.includes("FROM ProviderAcctTerritoryInfo WHERE Territory2Id IN"))).toMatch(/LIMIT 500$/);
    expect(q.find((s) => s.includes("FROM ObjectTerritory2Association WHERE SobjectType = 'Account' AND Territory2Id IN"))).toMatch(/LIMIT 500$/);
    expect(q.find((s) => s.includes("FROM ProviderAcctTerritoryInfo WHERE AccountId IN"))).toContain("AccountId IN ('001B')");
    expect(q.find((s) => s.includes("FROM ObjectTerritory2Association WHERE ObjectId IN"))).toContain("ObjectId IN ('001A') AND SobjectType = 'Account'");
  });

  it("says the territory info result is a sample when a territory chunk fills its share", async () => {
    activeModel();
    const rows = Array.from({ length: 500 }, (_, i) => ({ AccountId: `001${i}`, ObjectId: `001${i}`, Territory2Id: "0MI000000000001AAA" }));
    org.ProviderAcctTerritoryInfo = rows;
    org.ObjectTerritory2Association = rows;
    const c = (await run())["territory-users.data.pati-matches-alignment"];
    expect(c.status).toBe("pass");
    expect(c.detail).toBe("In step. Checked a sample of 500 alignments and 500 territory info rows from across the active model, not every one in it.");
  });

  it("counts alignments only for territories with no user of their own", async () => {
    org.Territory2Model = [{ Id: "0MA1", State: "Active" }];
    org.Territory2 = [territory("0MI1", "Region"), territory("0MI2", "Area", "0MI1"), territory("0MI3", "Orphan")];
    org.ObjectTerritory2Association = [{ Territory2Id: "0MI3", cnt: 2 }];
    org.UserTerritory2Association = [{ Territory2Id: "0MI1", cnt: 1 }];
    const c = (await run())["territory-users.data.territory-staffed"];
    expect(c.detail).toBe("1 territory with accounts has no user on it or above it. Checked the accounts of all 2 territories with no user of their own.");
    expect(soqls().find((q) => q.includes("FROM ObjectTerritory2Association") && q.includes("GROUP BY"))).toContain("Territory2Id IN ('0MI3','0MI2')");
  });
});
