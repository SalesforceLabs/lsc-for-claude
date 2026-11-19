import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/studio/helpers.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/studio/helpers.js")>()),
  query: vi.fn(),
  queryByIds: vi.fn(),
}));
const helpers = await import("../../../../src/studio/helpers.js");
const { collectKam } = await import("../../../../src/studio/screens/kam/kam.js");

beforeEach(() => {
  vi.mocked(helpers.query).mockReset();
  vi.mocked(helpers.queryByIds).mockReset();
});

const ctx = (scope: (t: string) => string | null | undefined) =>
  ({ org: "demo", scope, note: vi.fn(), softFail: undefined, isScaleError: () => false }) as never;

describe("collectKam", () => {
  it("is undefined when the device syncs neither plan table", async () => {
    expect(await collectKam(ctx(() => undefined))).toBeUndefined();
    expect(helpers.query).not.toHaveBeenCalled();
  });

  it("returns an empty plan map with defaults when synced but no plans match", async () => {
    vi.mocked(helpers.query).mockResolvedValue([]);
    vi.mocked(helpers.queryByIds).mockResolvedValue([]);
    const kam = await collectKam(ctx((t) => (t === "AccountPlan" ? "" : undefined)));
    expect(kam).toMatchObject({ plans: {}, mode: "status", configRead: false });
  });
});
