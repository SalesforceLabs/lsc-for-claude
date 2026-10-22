import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/studio/helpers.js", async (orig) => ({ ...(await orig<typeof import("../../../src/studio/helpers.js")>()), query: vi.fn() }));
const helpers = await import("../../../src/studio/helpers.js");
const { focusTerritoryIds, focusedProfile, memoFocus, spread, trackFocusUse, withProfileFocus } = await import("../../../src/studio/profile-focus.js");

beforeEach(() => vi.mocked(helpers.query).mockReset());

describe("profile focus", () => {
  it("records a check that read the picked profile", async () => {
    const r = await withProfileFocus("Rep", () => trackFocusUse(async () => focusedProfile()));
    expect(r).toEqual({ value: "Rep", used: true });
    expect(await withProfileFocus("Rep", () => trackFocusUse(async () => 1))).toEqual({ value: 1, used: false });
  });

  it("is not used when no profile is picked", async () => {
    expect(await withProfileFocus(undefined, () => trackFocusUse(async () => focusedProfile()))).toEqual({ value: undefined, used: false });
  });

  it("passes a shared load's use on to every check that reads it", async () => {
    const shared = memoFocus(async () => focusedProfile());
    const plain = memoFocus(async () => 2);
    const [a, b, c] = await withProfileFocus("Rep", () =>
      Promise.all([trackFocusUse(shared), trackFocusUse(() => shared()), trackFocusUse(plain)])
    );
    expect([a.used, b.used, c.used]).toEqual([true, true, false]);
  });

  it("reads the profile's territories once per load", async () => {
    vi.mocked(helpers.query).mockResolvedValue([{ Territory2Id: "0MI1" }, { Territory2Id: "0MI2" }]);
    const ids = await withProfileFocus("Rep", async () => [await focusTerritoryIds("org"), await focusTerritoryIds("org")]);
    expect(ids).toEqual([["0MI1", "0MI2"], ["0MI1", "0MI2"]]);
    expect(helpers.query).toHaveBeenCalledTimes(1);
    expect(vi.mocked(helpers.query).mock.calls[0][0]).toContain("User.Profile.Name = 'Rep'");
    expect(await focusTerritoryIds("org")).toBeUndefined();
  });

  it("spreads a long id list instead of taking the first ones", () => {
    expect(spread(["a", "b", "c", "d", "e"], 2)).toEqual(["a", "d"]);
    expect(spread(["a", "b"], 5)).toEqual(["a", "b"]);
  });
});
