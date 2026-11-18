import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/studio/helpers.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/studio/helpers.js")>()),
  queryResult: vi.fn(),
  queryByIds: vi.fn(),
}));
const helpers = await import("../../../../src/studio/helpers.js");
const { collectCompliance } =
  await import("../../../../src/studio/screens/compliance/compliance.js");

beforeEach(() => {
  vi.mocked(helpers.queryResult).mockReset();
  vi.mocked(helpers.queryByIds).mockReset();
});

const ctx = (scope: string | null | undefined) =>
  ({
    org: "demo",
    format: { timeZone: "UTC", locale: "en-US" },
    scope: () => scope,
    config: async () => ({}),
    note: vi.fn(),
  }) as never;

describe("collectCompliance", () => {
  it("is undefined when the device doesn't sync ActionPlan or the org lacks it", async () => {
    expect(await collectCompliance(ctx(undefined))).toBeUndefined();
    vi.mocked(helpers.queryResult).mockRejectedValue(new Error("No such column 'ActionPlanType'"));
    expect(await collectCompliance(ctx(""))).toBeUndefined();
  });

  it("builds plans with account names and cycles", async () => {
    vi.mocked(helpers.queryResult).mockResolvedValue({
      totalSize: 1,
      done: true,
      records: [
        {
          Id: "P1",
          Name: "Plan A",
          ActionPlanState: "In Progress",
          TargetId: "A1",
          ActionPlanTemplateVersion: { ActionPlanTemplateId: "T1" },
        },
      ],
    } as never);
    vi.mocked(helpers.queryByIds).mockImplementation((async (_f: string, object: string) => {
      if (object === "Account") return [{ Id: "A1", Name: "St Mary" }];
      if (object === "PrvdEngmtComplianceCycle")
        return [
          {
            Id: "C1",
            Name: "Q1",
            ActionPlanId: "P1",
            EffectiveStartDate: "2000-01-01",
            EffectiveEndDate: "2000-02-01",
            Status: "Completed",
          },
        ];
      return [];
    }) as never);
    const r = await collectCompliance(ctx(""));
    expect(r?.plans).toHaveLength(1);
    expect(r?.plans[0]).toMatchObject({
      accountName: "St Mary",
      stateLabel: "Account Compliance in Progress",
      completeCount: 1,
      total: 1,
    });
  });
});
