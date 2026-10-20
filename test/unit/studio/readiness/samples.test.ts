import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: samples } = await import("../../../../src/studio/readiness/features/samples.js");

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

const run = async () => Object.fromEntries((await samples.checks!("test-org")).map((c) => [c.id, c]));
const handler = (developerName: string, IsActive: boolean) => ({ DeveloperName: developerName, MasterLabel: developerName, IsActive });

describe("samples readiness", () => {
  it("skips location checks when no rep locations exist", async () => {
    const r = await run();
    expect(r["samples.access.locations-have-a-rep"].status).toBe("skipped");
    expect(r["samples.data.rep-stock"].status).toBe("skipped");
  });

  it("warns only about unassigned rep locations that hold stock; empty ones are info", async () => {
    // Stocked: the semi-join on ProductItem; empty: the anti-join.
    vi.mocked(runSoqlQuery).mockImplementation(((q: string) => {
      if (/FROM Location WHERE .*PrimaryUserId = null AND Id IN \(SELECT LocationId FROM ProductItem/.test(q)) return respond(q.replace(/FROM Location/, "FROM StockedLocation"));
      if (/FROM Location WHERE .*PrimaryUserId = null AND Id NOT IN \(SELECT LocationId FROM ProductItem/.test(q)) return respond(q.replace(/FROM Location/, "FROM EmptyLocation"));
      return respond(q);
    }) as never);
    org.Location = 4;
    org.StockedLocation = [];
    org.EmptyLocation = [{ Id: "2", Name: "Luke MSR2" }];
    let r = await run();
    expect(r["samples.access.locations-have-a-rep"].status).toBe("pass");
    expect(r["samples.access.empty-locations-unassigned"]).toMatchObject({ status: "fail", severity: "info", examples: ["Luke MSR2"] });

    org.StockedLocation = [{ Id: "1", Name: "Bob Inventory" }];
    r = await run();
    expect(r["samples.access.locations-have-a-rep"]).toMatchObject({ status: "fail", severity: "warning", examples: ["Bob Inventory"] });
    expect(r["samples.access.locations-have-a-rep"].detail).toContain("hold stock");
  });

  it("checks marketable products only for stock in reps' own locations", async () => {
    org.Location = 1;
    org.ProductItem = [{ Product2: { Name: "Orphan" }, Location: { Name: "Bob Inventory" } }];
    const c = (await run())["samples.data.inventory-products-marketable"];
    expect(c.status).toBe("fail");
    const q = vi.mocked(runSoqlQuery).mock.calls.map((x) => String(x[0])).find((x) => x.includes("FROM ProductItem") && x.includes("LifeSciMarketableProduct"));
    expect(q).toContain("Location.LocationType = 'User Inventory'");
    expect(q).toContain("Location.PrimaryUserId != null");
  });

  it("fails on negative stock", async () => {
    org.ProductItem = [{ ProductItemNumber: "PI-1" }];
    const c = (await run())["samples.data.no-negative-stock"];
    expect(c.status).toBe("fail");
    expect(c.severity).toBe("error");
  });

  it("offers fixes for inactive core handlers", async () => {
    handlers = [handler("ProductDisbursementInventoryOpCreation", false)];
    const c = (await run())["samples.config.core-handlers"];
    expect(c.status).toBe("fail");
    expect(c.fixes?.[0]).toMatchObject({ kind: "setActive", record: { type: "triggerHandler" } });
  });

  it("skips limits sync when no limits exist", async () => {
    expect((await run())["samples.mobile.limits-db-schema"].status).toBe("skipped");
  });

  it("passes inventory sync when every object is active", async () => {
    const objs = ["ProductItem", "ProductBatchItem", "ProductionBatch", "ProductDisbursement", "Location", "LifeSciMarketableProduct"];
    org.EntityDefinition = objs.map((o) => ({ QualifiedApiName: o }));
    schema = objs.map((o) => schemaRec(o));
    expect((await run())["samples.mobile.inventory-db-schema"].status).toBe("pass");
  });
});
