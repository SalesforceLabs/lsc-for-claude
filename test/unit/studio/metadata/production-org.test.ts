import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: { current: Record<string, unknown>[] } = { current: [] };
vi.mock("../../../../src/studio/helpers.js", async (orig) => ({ ...(await orig<typeof import("../../../../src/studio/helpers.js")>()), query: vi.fn(async () => rows.current) }));

import { forgetLiveOrg, isProductionOrg } from "../../../../src/studio/metadata/live.js";

const check = async (org: Record<string, unknown>) => {
  forgetLiveOrg("o");
  rows.current = [org];
  return isProductionOrg("o");
};

describe("isProductionOrg", () => {
  beforeEach(() => forgetLiveOrg("o"));
  it("is true only for a real production org", async () => {
    expect(await check({ IsSandbox: false, TrialExpirationDate: null, OrganizationType: "Enterprise Edition" })).toBe(true);
  });
  it("is false for sandboxes, trials and Developer Edition", async () => {
    expect(await check({ IsSandbox: true })).toBe(false);
    expect(await check({ IsSandbox: false, TrialExpirationDate: "2026-10-30T00:00:00.000+0000" })).toBe(false);
    expect(await check({ IsSandbox: false, OrganizationType: "Developer Edition" })).toBe(false);
  });
});
