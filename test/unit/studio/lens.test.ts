import { describe, it, expect } from "vitest";
import type { FeatureMap, StudioItem, StudioSurface } from "../../../src-renderer/components/studio/types.js";
import { fitCounts, fitFor, sortByFit, audienceProfiles } from "../../../src-renderer/components/studio/lens.js";
import { allFindings } from "../../../src-renderer/components/studio/findings.js";

function item(id: string, audience?: StudioItem["audience"], findings: StudioItem["findings"] = []): StudioItem {
  return { id, label: id, properties: {}, findings, audience };
}

const rep = { profile: "LSC Rep" };
const everyone = item("everyone");
const forRep = item("rep", { profiles: ["lsc rep"], permissionSets: [] });
const forManager = item("manager", { profiles: ["LSC Manager"], permissionSets: [] }, [{ severity: "error", title: "Broken" }]);
const byPermSet = item("ps", { profiles: [], permissionSets: ["Samples_Access"] });
const nobody = item("nobody", { profiles: [], permissionSets: [] });

const surface: StudioSurface = {
  id: "s",
  title: "S",
  lane: "l",
  description: "",
  items: [forManager, byPermSet, everyone, nobody, forRep],
  findings: [{ severity: "info", title: "Surface note" }],
};

describe("View as lens", () => {
  it("classifies items for a profile, matching names case-insensitively", () => {
    expect(fitFor(everyone, rep)).toEqual({ fit: "applies" });
    expect(fitFor(forRep, rep)).toEqual({ fit: "applies", reason: "Assigned to LSC Rep" });
    expect(fitFor(forManager, rep)).toEqual({ fit: "excluded", reason: "Assigned to LSC Manager" });
    expect(fitFor(byPermSet, rep)).toEqual({ fit: "conditional", reason: "Only for users with Samples_Access" });
    expect(fitFor(nobody, rep)).toEqual({ fit: "excluded", reason: "Not assigned to any profile" });
  });

  it("treats everything as applying when no lens is set", () => {
    expect(surface.items.every((i) => fitFor(i, null).fit === "applies")).toBe(true);
    expect(sortByFit(surface.items, null)).toBe(surface.items);
  });

  it("counts, sorts, and drops excluded items' findings", () => {
    expect(fitCounts(surface, rep)).toEqual({ applies: 2, conditional: 1, excluded: 2 });
    expect(sortByFit(surface.items, rep).map((i) => i.id)).toEqual(["everyone", "rep", "ps", "manager", "nobody"]);
    expect(allFindings(surface, rep).map((f) => f.title)).toEqual(["Surface note"]);
    expect(allFindings(surface).map((f) => f.title)).toEqual(["Surface note", "Broken"]);
  });

  it("collects profile names a map assigns config to", () => {
    const map = { surfaces: [surface] } as FeatureMap;
    expect(audienceProfiles(map)).toEqual(["LSC Manager", "lsc rep"]);
  });
});
