import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/studio/helpers.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/studio/helpers.js")>()),
  query: vi.fn(),
}));
vi.mock("../../../../src/salesforce/cli.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/salesforce/cli.js")>()),
  orgApiVersionDetails: vi.fn(),
}));
const cli = await import("../../../../src/salesforce/cli.js");
const helpers = await import("../../../../src/studio/helpers.js");
const sales = await import("../../../../src/studio/screens/manager/salesData.js");
const planReview = await import("../../../../src/studio/screens/manager/planReview.js");

beforeEach(() => {
  vi.mocked(helpers.query).mockReset();
});

describe("pivotSales", () => {
  it("makes one row per account and one column per product, summing repeats", () => {
    const t = sales.pivotSales(
      [
        { AccountFullName__c: "Zed", Product__c: "P2", Measure1Total__c: 5 },
        { AccountFullName__c: "Amy", Product__c: "P1", Measure1Total__c: 3 },
        { AccountFullName__c: "Amy", Product__c: "P1", Measure1Total__c: 4 },
      ],
      1,
      new Map([
        ["P1", "Alpha"],
        ["P2", "Beta"],
      ])
    );
    expect(t.products).toEqual(["Alpha", "Beta"]);
    expect(t.rows).toEqual([
      { account: "Amy", values: [7, null] },
      { account: "Zed", values: [null, 5] },
    ]);
  });
});

describe("collectSalesData", () => {
  const ctx = (scope: (t: string) => string | undefined) =>
    ({ org: "o", scope, note: vi.fn() }) as never;
  it("says the tables aren't synced rather than inventing rows", async () => {
    const out = await sales.collectSalesData(ctx(() => undefined));
    expect(out?.tables).toEqual([]);
    expect(out?.note).toMatch(/^Not in the preview: this rep's DB Schema doesn't sync/);
    expect(helpers.query).not.toHaveBeenCalled();
  });
  it("reads a synced table and caps it", async () => {
    vi.mocked(helpers.query).mockImplementation((async (soql: string) =>
      soql.includes("FROM Product2")
        ? [{ Id: "a0B000000000001AAA", Name: "Drug" }]
        : Array.from({ length: 2001 }, (_, i) => ({
            AccountFullName__c: `A${i}`,
            Product__c: "a0B000000000001AAA",
            Measure1Total__c: 1,
          }))) as never);
    const out = await sales.collectSalesData(
      ctx((t) => (t === "LifeSciDrugPrescriptionData__dlm" ? "" : undefined))
    );
    expect(out?.tables).toHaveLength(1);
    expect(out?.tables[0]).toMatchObject({ type: "HCP", truncated: true, products: ["Drug"] });
    expect(out?.tables[0].rows).toHaveLength(2000);
    expect(out?.note).toContain("first 2,000 rows");
  });
});

describe("collectPlanReview", () => {
  it("marks the tab as a web view with the org's https address", async () => {
    vi.mocked(cli.orgApiVersionDetails).mockResolvedValue({
      instanceUrl: "https://x.my.salesforce.com/",
    } as never);
    expect(await planReview.collectPlanReview({ org: "o" } as never)).toEqual({
      webView: true,
      instanceUrl: "https://x.my.salesforce.com",
    });
  });

  it("leaves the address out when the org reports none or an http one", async () => {
    vi.mocked(cli.orgApiVersionDetails).mockResolvedValue({ instanceUrl: "http://x" } as never);
    expect(await planReview.collectPlanReview({ org: "o" } as never)).toEqual({ webView: true });
  });
});
