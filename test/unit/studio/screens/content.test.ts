import { describe, it, expect } from "vitest";
import { buildSections, byTitle, isCurrent, mediumDate, todayIn, type PublishedContent, type PublishedContentCard } from "../../../../src/studio/screens/content.js";
import { collapseLabel, inSegment, sectionTitle, visibleSections } from "../../../../src-renderer/components/studio/screens/content-logic.js";

const card = (id: string, name: string, extra: Partial<PublishedContentCard> = {}): PublishedContentCard => ({
  id,
  name,
  type: "PDF",
  pages: 3,
  date: "Jun 8, 2026",
  isCustom: false,
  ownedByViewer: false,
  shareable: false,
  ...extra,
});

describe("isCurrent", () => {
  it("accepts null activation and deactivation", () => expect(isCurrent(null, null, "2026-10-17")).toBe(true));
  it("activation is inclusive of today", () => {
    expect(isCurrent("2026-10-17", null, "2026-10-17")).toBe(true);
    expect(isCurrent("2026-10-18", null, "2026-10-17")).toBe(false);
  });
  it("deactivation today already hides it", () => {
    expect(isCurrent(null, "2026-10-17", "2026-10-17")).toBe(false);
    expect(isCurrent(null, "2026-10-18", "2026-10-17")).toBe(true);
  });
});

describe("dates", () => {
  it("formats a medium date in the viewer's zone", () => {
    expect(mediumDate("2026-06-08T12:40:59.000+0000", { timeZone: "America/Los_Angeles", locale: "en-US" })).toBe("Jun 8, 2026");
    expect(mediumDate("2026-06-08T03:00:00.000+0000", { timeZone: "America/Los_Angeles", locale: "en-US" })).toBe("Jun 7, 2026");
    expect(mediumDate("nonsense", { timeZone: "UTC", locale: "en-US" })).toBe("");
  });
  it("resolves today in the viewer's zone", () => {
    const now = new Date("2026-10-18T03:00:00Z");
    expect(todayIn("America/Los_Angeles", now)).toBe("2026-10-17");
    expect(todayIn("UTC", now)).toBe("2026-10-18");
  });
});

describe("sorting and sections", () => {
  it("sorts by title ignoring case", () => {
    expect(["b", "A", "c"].map((name) => ({ name })).sort(byTitle).map((x) => x.name)).toEqual(["A", "b", "c"]);
  });
  it("puts untagged presentations in a last No Category section", () => {
    const cards = [card("1", "Zed"), card("2", "alpha"), card("3", "Mid")];
    const sections = buildSections(cards, new Map([["3", ["Efficacy"]]]), true);
    expect(sections).toEqual([
      { title: "Efficacy", cardIds: ["3"] },
      { title: "", cardIds: ["2", "1"] },
    ]);
  });
  it("lists a presentation under every topic it has, topics alphabetical", () => {
    const sections = buildSections([card("1", "One")], new Map([["1", ["Safety", "Access"]]]), true);
    expect(sections.map((s) => s.title)).toEqual(["Access", "Safety"]);
  });
  it("is one untitled section without tags", () => {
    expect(buildSections([card("1", "B"), card("2", "a")], new Map(), false)).toEqual([{ title: "", cardIds: ["2", "1"] }]);
  });
  it("names the empty tag No Category", () => {
    expect(sectionTitle("")).toBe("No Category");
    expect(sectionTitle("Safety")).toBe("Safety");
  });
});

describe("segments and search", () => {
  const mine = card("m", "Mine", { isCustom: true, ownedByViewer: true });
  const theirs = card("t", "Theirs", { isCustom: true });
  const plain = card("p", "Plain");
  const data: PublishedContent = {
    columns: 4,
    segments: ["Presentations", "My Presentations", "Favorites"],
    canCreate: true,
    cards: [mine, theirs, plain],
    hasTags: true,
    sections: [{ title: "", cardIds: ["m", "t", "p"] }],
  };
  const none = new Set<string>();

  it("Presentations hides the viewer's own custom ones when they are managed", () => {
    expect(inSegment(mine, "Presentations", true, none)).toBe(false);
    expect(inSegment(mine, "Presentations", false, none)).toBe(true);
    expect(inSegment(theirs, "Presentations", true, none)).toBe(true);
  });
  it("My Presentations is custom and owned", () => {
    expect(visibleSections(data, { segment: "My Presentations", search: "", favorites: none })[0].cards.map((c) => c.id)).toEqual(["m"]);
  });
  it("Favorites is the device-local set", () => {
    expect(visibleSections(data, { segment: "Favorites", search: "", favorites: none })).toEqual([]);
    expect(visibleSections(data, { segment: "Favorites", search: "", favorites: new Set(["p"]) })[0].cards.map((c) => c.id)).toEqual(["p"]);
  });
  it("searches names case-insensitively and drops empty sections", () => {
    expect(visibleSections(data, { segment: "Presentations", search: "PLA", favorites: none })[0].cards.map((c) => c.id)).toEqual(["p"]);
    expect(visibleSections(data, { segment: "Presentations", search: "zzz", favorites: none })).toEqual([]);
  });
});

describe("collapseLabel", () => {
  it("flips once every section is collapsed", () => {
    expect(collapseLabel(["a", "b"], new Set())).toBe("Collapse All");
    expect(collapseLabel(["a", "b"], new Set(["a"]))).toBe("Collapse All");
    expect(collapseLabel(["a", "b"], new Set(["a", "b"]))).toBe("Expand All");
  });
});
