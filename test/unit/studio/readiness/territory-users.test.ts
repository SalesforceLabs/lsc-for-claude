import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn(), cachedDescribeSObject: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { invalidateSharedReads } = await import("../../../../src/config/read-cache.js");
const { default: territoryUsers } = await import("../../../../src/studio/readiness/features/territory-users.js");

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
  invalidateSharedReads();
  org = {};
  handlers = [];
  schema = [];
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => (/FROM\s+LifeScienceTriggerHandler/i.test(q) ? Promise.resolve({ success: true, data: { totalSize: handlers.length, done: true, records: handlers } }) : respond(q))) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => schema) as never);
});

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

  it("compares territory info with alignment by account and territory", async () => {
    // The account is aligned and has info, but for different territories.
    org.ProviderAcctTerritoryInfo = [{ AccountId: "001000000000001AAA", Account: { Name: "Dr A" }, Territory2Id: "0MI000000000001AAA", Territory2: { Name: "North" } }];
    org.ObjectTerritory2Association = [{ ObjectId: "001000000000001", Object: { Name: "Dr A" }, Territory2Id: "0MI000000000002", Territory2: { Name: "South" } }];
    const c = (await run())["territory-users.data.pati-matches-alignment"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Dr A in North: info row, not aligned", "Dr A in South: aligned, no info row"]);
  });

  it("matches 15- and 18-character ids when territory info is in step", async () => {
    org.ProviderAcctTerritoryInfo = [{ AccountId: "001000000000001AAA", Territory2Id: "0MI000000000001AAA" }];
    org.ObjectTerritory2Association = [{ ObjectId: "001000000000001", Territory2Id: "0MI000000000001" }];
    expect((await run())["territory-users.data.pati-matches-alignment"].status).toBe("pass");
  });
});
