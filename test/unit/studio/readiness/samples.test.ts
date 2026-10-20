import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { invalidateSharedReads } = await import("../../../../src/config/read-cache.js");
const { default: samples } = await import("../../../../src/studio/readiness/features/samples.js");

type Row = Record<string, unknown>;
/** Rows (and optional COUNT override) returned per outer FROM-object, or a function of the query. */
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

beforeEach(() => {
  invalidateSharedReads();
  org = {};
  handlers = [];
  schema = [];
  vi.mocked(runSoqlQuery).mockReset();
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => (/FROM\s+LifeScienceTriggerHandler/i.test(q) ? Promise.resolve({ success: true, data: { totalSize: handlers.length, done: true, records: handlers } }) : respond(q))) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => schema) as never);
});

const run = async () => Object.fromEntries((await samples.checks!("test-org")).map((c) => [c.id, c]));
const queries = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));
const handler = (developerName: string, IsActive: boolean) => ({ DeveloperName: developerName, MasterLabel: developerName, IsActive });
const isCount = (q: string) => /SELECT COUNT\(\) /.test(q);

describe("samples readiness", () => {
  it("skips location checks when no rep locations exist", async () => {
    const r = await run();
    expect(r["samples.access.locations-have-a-rep"].status).toBe("skipped");
    expect(r["samples.data.rep-stock"].status).toBe("skipped");
  });

  it("never asks the inventory tables with an anti-join or semi-join", async () => {
    org.Location = (q) => (isCount(q) ? 2 : [{ Id: "L1", Name: "Bob Inventory", PrimaryUserId: "U1" }]);
    org.ProductionBatch = [{ Id: "B1" }];
    org.ProviderSampleLimit = [{ Id: "S1" }];
    org.ProductDisbursement = (q) => (isCount(q) ? 1 : [{ Id: "D1" }]);
    await run();
    const qs = queries();
    expect(qs.some((q) => q.includes("NOT IN") || q.includes("IN (SELECT"))).toBe(false);
    for (const q of qs.filter((q) => q.startsWith("SELECT Id, Name, PrimaryUserId FROM Location"))) expect(q).toMatch(/LIMIT 500$/);
  });

  it("splits unassigned rep locations into stocked (warning) and empty (info) by looking up their stock by id", async () => {
    org.Location = (q) => (isCount(q) ? 4 : q.includes("PrimaryUserId = null") ? [{ Id: "L1", Name: "Bob Inventory" }, { Id: "L2", Name: "Luke MSR2" }] : []);
    org.ProductItem = (q) => (q.includes("GROUP BY LocationId") ? [{ LocationId: "L1", cnt: 3 }] : []);
    const r = await run();
    expect(r["samples.access.locations-have-a-rep"]).toMatchObject({ status: "fail", severity: "warning", examples: ["Bob Inventory"] });
    expect(r["samples.access.locations-have-a-rep"].detail).toBe("1 of 4 User Inventory locations hold stock but have no Primary User.");
    expect(r["samples.access.empty-locations-unassigned"]).toMatchObject({ status: "fail", severity: "info", examples: ["Luke MSR2"] });
    expect(queries().find((q) => q.includes("FROM ProductItem") && q.includes("GROUP BY LocationId"))).toContain("LocationId IN ('L1','L2') AND QuantityOnHand > 0");
  });

  it("says rep stock was checked on a sample when there are more rep locations than the sample size", async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ Id: `L${i}`, Name: `Loc ${i}`, PrimaryUserId: `U${i}` }));
    org.Location = (q) => (isCount(q) ? 900 : many);
    org.ProductItem = (q) => (q.includes("GROUP BY LocationId") ? [{ LocationId: "L1", cnt: 3 }] : []);
    const c = (await run())["samples.data.rep-stock"];
    expect(c.status).toBe("pass");
    expect(c.detail).toBe("1 of 500 User Inventory locations hold stock. Checked a sample of 500 User Inventory locations, not every one in the org.");
  });

  it("checks marketable products only for stock in reps' own locations, by product id", async () => {
    org.Location = (q) => (isCount(q) ? 2 : [{ Id: "L1", Name: "Bob Inventory", PrimaryUserId: "U1" }, { Id: "L2", Name: "Spare", PrimaryUserId: null }]);
    org.ProductItem = (q) => (q.includes("GROUP BY Product2Id") ? [{ Product2Id: "P1", cnt: 2 }, { Product2Id: "P2", cnt: 1 }] : []);
    org.LifeSciMarketableProduct = (q) => (q.includes("ProductId IN") ? [{ ProductId: "P2" }] : []);
    org.Product2 = [{ Id: "P1", Name: "Orphan" }];
    const c = (await run())["samples.data.inventory-products-marketable"];
    expect(c).toMatchObject({ status: "fail", examples: ["Orphan"] });
    expect(c.detail).toBe(
      "2 inventory lines in reps' User Inventory locations for products with no marketable product. Checked the only User Inventory location with a Primary User."
    );
    expect(queries().find((q) => q.includes("GROUP BY Product2Id"))).toContain("LocationId IN ('L1')");
  });

  it("fails on negative stock found in the sampled inventory locations", async () => {
    org.Location = (q) => (q.includes("IsInventoryLocation = true") ? [{ Id: "L1", Name: "Warehouse" }] : []);
    org.ProductItem = (q) => (q.includes("QuantityOnHand < 0") ? [{ ProductItemNumber: "PI-1" }] : []);
    const c = (await run())["samples.data.no-negative-stock"];
    expect(c).toMatchObject({ status: "fail", severity: "error", examples: ["PI-1"] });
    expect(c.detail).toBe("1 product item and 0 batch items below zero. Checked the only inventory location.");
    expect(queries().find((q) => q.includes("QuantityOnHand < 0"))).toContain("LocationId IN ('L1')");
  });

  it("counts batch items of expired lots by lot id", async () => {
    org.ProductionBatch = (q) => (q.includes("ExpirationDate < TODAY") ? [{ Id: "B1" }] : []);
    org.ProductBatchItem = (q) => (q.includes("COUNT(Id)") ? (q.includes("ExpirationDate < TODAY") ? [{ ProductionBatchId: "B1", cnt: 2 }] : []) : [{ Name: "PBI-1", ExpirationDate: "2025-01-01" }]);
    const c = (await run())["samples.data.no-expired-stock"];
    expect(c).toMatchObject({ status: "fail", detail: "2 batch items past expiry with stock left.", examples: ["PBI-1 (expired 2025-01-01)"] });
    expect(queries().find((q) => q.includes("FROM ProductBatchItem") && q.includes("ExpirationDate < TODAY"))).toContain("ProductionBatchId IN ('B1')");
  });

  it("counts disbursements needing resolution over the last 90 days only", async () => {
    org.ProductDisbursement = (q) => (isCount(q) ? (q.includes("IsResolutionRequired") ? 2 : 10) : [{ Id: "D1", Name: "PD-1" }]);
    const c = (await run())["samples.data.disbursements-resolved"];
    expect(c).toMatchObject({ status: "fail", detail: "2 of 10 need resolution. Checked the 10 disbursements from the last 90 days." });
    const counted = vi.mocked(runSoqlQuery).mock.calls.map((x) => String(x[0])).filter((q) => q.includes("FROM ProductDisbursement") && isCount(q));
    for (const q of counted) expect(q).toContain("CreatedDate = LAST_N_DAYS:90");
  });

  it("counts limits on inactive products by product id", async () => {
    org.ProviderSampleLimit = (q) => (q.includes("GROUP BY") ? [{ ProductId: "M1", cnt: 3 }] : [{ Id: "S1" }]);
    org.LifeSciMarketableProduct = (q) => (q.includes("IsActive = false") ? [{ Id: "M1" }] : []);
    const c = (await run())["samples.data.limits-on-active-products"];
    expect(c).toMatchObject({ status: "fail", detail: "3 limits are on 1 inactive product." });
    expect(queries().find((q) => q.includes("FROM ProviderSampleLimit") && q.includes("GROUP BY"))).toContain("ProductId IN ('M1')");
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
