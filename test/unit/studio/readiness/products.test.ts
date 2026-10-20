import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: products } = await import("../../../../src/studio/readiness/features/products.js");

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

const run = async () => Object.fromEntries((await products.checks!("test-org")).map((c) => [c.id, c]));
const handler = (developerName: string, IsActive: boolean) => ({ DeveloperName: developerName, MasterLabel: developerName, IsActive });

describe("products readiness", () => {
  it("flags active messages past their end date", async () => {
    org.ProductGuidance = [{ Name: "Old claim", EffectiveEndDate: "2025-10-01" }];
    const c = (await run())["products.data.guidance-not-expired"];
    expect(c.status).toBe("fail");
    expect(c.examples![0]).toContain("Old claim");
    // The iPad already hides ended messages, and the handler only removes sharing — not a warning, no auto-off claim.
    expect(c.severity).toBe("info");
    expect(c.steps.join(" ")).not.toMatch(/switched off automatically/);
  });

  it("flags an active product under an inactive parent", async () => {
    org.LifeSciMarketableProduct = [
      { Id: "P1", Name: "Brand", IsActive: false },
      { Id: "C1", Name: "Child", ParentProductId: "P1" },
    ];
    const c = (await run())["products.data.hierarchy-parents-active"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Child"]);
  });

  it("skips restriction checks when none exist", async () => {
    expect((await run())["products.data.restrictions-on-active-products"].status).toBe("skipped");
  });

  it("fails the admin settings check when no record exists, passes when one does", async () => {
    expect((await run())["products.config.admin-settings"].status).toBe("fail");
    schema = [{ category: "ProductAdminSettings", developerName: "p", isActive: true, fields: {}, fieldTypes: {}, assignments: [] } as unknown as ConfigRecord];
    expect((await run())["products.config.admin-settings"].status).toBe("pass");
  });

  it("offers a switch-on fix for inactive product handlers", async () => {
    handlers = [handler("ProductGuidanceDeactivationHandler", false)];
    const c = (await run())["products.config.product-handlers"];
    expect(c.status).toBe("fail");
    expect(c.fixes).toHaveLength(1);
  });

  it("offers to switch on a disabled DB Schema record", async () => {
    org.EntityDefinition = [{ QualifiedApiName: "Product2" }];
    schema = [schemaRec("Product2", false)];
    const c = (await run())["products.mobile.db-schema"];
    expect(c.status).toBe("fail");
    expect(c.fixes?.[0]).toMatchObject({ kind: "setActive", record: { type: "config", category: "DbSchema" } });
  });
});
