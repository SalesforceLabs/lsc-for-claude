import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/studio/helpers.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/studio/helpers.js")>()),
  query: vi.fn(),
}));
vi.mock("../../../../src/salesforce/cli.js", () => ({
  apiRequest: vi.fn(async (path: string) => ({
    success: true,
    data: {
      fields: path.includes("ProviderAcctProductInfo")
        ? [{ name: "MYM_Advocacy__c", type: "picklist" }]
        : [{ name: "IsTargetedAccount", type: "boolean" }],
    },
  })),
  dataPath: vi.fn(async (_o: string, p: string) => p),
}));
const helpers = await import("../../../../src/studio/helpers.js");
const { readRatingSources } =
  await import("../../../../src/studio/screens/actions/rating-values.js");

beforeEach(() => {
  vi.mocked(helpers.query).mockReset();
});

const ctx = {
  org: "demo",
  territories: [
    { id: "T1", name: "One" },
    { id: "T2", name: "Two" },
  ],
  scope: () => "",
  note: () => {},
} as never;

const item = (sobject: string, field: string) => ({
  label: field,
  sobject,
  field,
  displayType: "",
  row: 0,
  column: 0,
});

describe("readRatingSources", () => {
  it("keeps the first territory's row and one row per product, by product name", async () => {
    vi.mocked(helpers.query).mockImplementation(async (soql: string) => {
      if (soql.includes("FROM ProviderAcctTerritoryInfo"))
        return [
          { AccountId: "A1", Territory2Id: "T2", IsTargetedAccount: false },
          { AccountId: "A1", Territory2Id: "T1", IsTargetedAccount: true },
        ];
      return [
        {
          AccountId: "A1",
          ProductId: "P2",
          TerritoryId: "T1",
          Product: { Name: "Zed" },
          MYM_Advocacy__c: "High",
        },
        {
          AccountId: "A1",
          ProductId: "P1",
          TerritoryId: "T2",
          Product: { Name: "Alpha" },
          MYM_Advocacy__c: "Low",
        },
        {
          AccountId: "A1",
          ProductId: "P1",
          TerritoryId: "T1",
          Product: { Name: "Alpha" },
          MYM_Advocacy__c: "Mid",
        },
      ];
    });
    const r = await readRatingSources(
      ctx,
      [
        item("ProviderAcctTerritoryInfo", "IsTargetedAccount"),
        item("ProviderAcctProductInfo", "MYM_Advocacy__c"),
      ],
      ["A1"]
    );
    expect(r.territory.get("A1")?.row.IsTargetedAccount).toBe(true);
    expect(r.product.get("A1")?.map((p) => [p.product, p.row.MYM_Advocacy__c])).toEqual([
      ["Alpha", "Mid"],
      ["Zed", "High"],
    ]);
  });

  it("reads nothing when the viewer has no territory", async () => {
    const r = await readRatingSources(
      { ...(ctx as object), territories: [] } as never,
      [item("ProviderAcctTerritoryInfo", "IsTargetedAccount")],
      ["A1"]
    );
    expect(r.territory.size).toBe(0);
    expect(helpers.query).not.toHaveBeenCalled();
  });
});
