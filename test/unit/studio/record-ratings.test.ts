import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/studio/helpers.js", async (orig) => ({ ...(await orig<typeof import("../../../src/studio/helpers.js")>()), query: vi.fn() }));
const helpers = await import("../../../src/studio/helpers.js");
const { readRatingLayout } = await import("../../../src/studio/screens/record-ratings.js");

beforeEach(() => {
  vi.mocked(helpers.query).mockReset();
});

const ctx = { org: "demo" } as never;

describe("readRatingLayout", () => {
  it("reads the setup entities through the Tooling API and labels by MasterLabel when ElementLabel is blank", async () => {
    vi.mocked(helpers.query).mockImplementation(async (soql: string) => {
      if (soql.includes("FROM PrvdClassificationLayout ")) return [{ Id: "L1" }];
      if (soql.includes("FROM PrvdClsfnLayoutAttribute")) {
        return [
          { PrvdClsfnAttrDefinitionId: "D2", RowNumber: 1, ColumnNumber: 0 },
          { PrvdClsfnAttrDefinitionId: "D1", RowNumber: 0, ColumnNumber: 0 },
        ];
      }
      return [
        { Id: "D1", ElementLabel: null, MasterLabel: "Influence Rating", ClassificationType: "Account", FieldApiName: "Influence__c", DisplayType: "Continuum", IsActive: true },
        { Id: "D2", ElementLabel: "Targeted", MasterLabel: "Targeted Account", ClassificationType: "ProviderAcctTerritoryInfo", FieldApiName: "IsTargetedAccount", DisplayType: "Checkbox", IsActive: true },
      ];
    });
    const items = await readRatingLayout(ctx, "Field_Rep_Rating_Layout");
    expect(items?.map((i) => i.label)).toEqual(["Influence Rating", "Targeted"]);
    expect(vi.mocked(helpers.query).mock.calls.every((c) => c[2] === true)).toBe(true);
  });

  it("is null when the org can't answer", async () => {
    vi.mocked(helpers.query).mockRejectedValue(new Error("sObject type 'PrvdClassificationLayout' is not supported"));
    expect(await readRatingLayout(ctx, "Field_Rep_Rating_Layout")).toBeNull();
  });
});
