import { describe, expect, it } from "vitest";
import { joinNames, seatStatuses } from "../../../src-renderer/components/studio/inline-lwc-seats";

describe("seatStatuses", () => {
  it("leaves a screen with one inline LWC alone", () => {
    expect(seatStatuses([{ id: "a", name: "lscMobileInline_nbc_msl" }]).size).toBe(0);
  });

  it("gives the web view to the last one on the page", () => {
    const s = seatStatuses([
      { id: "a", name: "lscMobileInline_nbc_msl" },
      { id: "b", name: "lscMobileInline_ThisWeekSVisits" },
    ]);
    expect(s.get("a")).toEqual({ owner: false, ownerName: "lscMobileInline_ThisWeekSVisits", names: ["lscMobileInline_nbc_msl", "lscMobileInline_ThisWeekSVisits"] });
    expect(s.get("b")?.owner).toBe(true);
  });
});

describe("joinNames", () => {
  it("lists names without the prefix", () => {
    expect(joinNames(["lscMobileInline_a", "lscMobileInline_b"])).toBe("a and b");
    expect(joinNames(["lscMobileInline_a", "lscMobileInline_b", "lscMobileInline_c"])).toBe("a, b and c");
  });
});
