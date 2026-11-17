import { describe, expect, it } from "vitest";
import {
  BY_ID,
  chooserCards,
  nextEnabled,
  nextStep,
} from "../../../../src-renderer/components/studio/actions/create/logic";

const rts = [
  { name: "HCP", label: "HCP" },
  { name: "HCO", label: "HCO" },
];

describe("new account chooser", () => {
  it("lists the record types, then By ID under license", () => {
    expect(chooserCards(rts).map((c) => [c.id, c.section])).toEqual([
      ["HCP", "type"],
      ["HCO", "type"],
      [BY_ID, "license"],
    ]);
    expect(chooserCards(rts, false)).toHaveLength(2);
  });
  it("groups person and organization record types into HCP and HCO", () => {
    const org = [
      { name: "HCO_RT", label: "Healthcare Organization" },
      { name: "HCP_RT", label: "Healthcare Provider" },
      { name: "PA", label: "Person Account" },
    ];
    expect(chooserCards(org).map((c) => c.id)).toEqual(["HCP", "HCO", BY_ID]);
    expect(nextStep("HCP", org)).toEqual({ to: "form", index: 1 });
    expect(nextStep("HCO", org)).toEqual({ to: "form", index: 0 });
  });
  it("keeps Next off until a choice is made", () => {
    expect(nextEnabled(null)).toBe(false);
    expect(nextEnabled("HCO")).toBe(true);
  });
  it("goes to the chosen record type's form, or to the By ID lookup", () => {
    expect(nextStep(null, rts)).toBeNull();
    expect(nextStep("HCO", rts)).toEqual({ to: "form", index: 1 });
    expect(nextStep(BY_ID, rts)).toEqual({ to: "byId" });
    expect(nextStep("gone", rts)).toBeNull();
  });
});
