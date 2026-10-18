import { describe, expect, it } from "vitest";
import { filterSegments, paneAccounts, subDetail, subKey, typeRows, visitVariant, weekRange, withLiveClock } from "../../../../src-renderer/components/studio/screens/calendar-logic";
import { categoryRows, slideLabel, visibleSections } from "../../../../src-renderer/components/studio/screens/content-logic";

const seg = (id: string, kind: "visit" | "event" | "tot" | "holiday", done?: boolean) => ({ id, kind, title: id, day: 0, startMin: 0, endMin: 30, allDay: false, background: "", text: "", done });
const acct = (id: string, person: boolean) => ({ id, name: id, person, lastVisit: "" });

describe("calendar helpers", () => {
  it("moves the clock and today's column", () => {
    const data = { timeZone: "UTC", now: "2026-01-01", nowMin: 0, days: [{ date: "2026-01-01", today: true }, { date: "2026-01-02", today: false }] } as never;
    const out = withLiveClock(data, new Date("2026-01-02T10:15:00Z")) as unknown as { now: string; nowMin: number; days: { today: boolean }[] };
    expect(out.now).toBe("2026-01-02");
    expect(out.nowMin).toBe(615);
    expect(out.days.map((d) => d.today)).toEqual([false, true]);
    // outside the window: unchanged
    expect(withLiveClock(data, new Date("2027-01-01T00:00:00Z"))).toBe(data);
  });
  it("filters segments by kind and visit variant", () => {
    const segs = [seg("a", "event"), seg("b", "visit", true), seg("c", "visit"), seg("d", "tot")];
    expect(filterSegments(segs, new Set())).toBe(segs);
    expect(filterSegments(segs, new Set(["event"])).map((s) => s.id)).toEqual(["b", "c", "d"]);
    const sub = new Set([subKey("visit", "Completed Visit")]);
    expect(filterSegments(segs, new Set(), sub).map((s) => s.id)).toEqual(["a", "c", "d"]);
  });
  it("names variants and drill-in details", () => {
    expect(visitVariant({ done: true })).toBe("Completed Visit");
    expect(visitVariant({})).toBe("Planned Visit");
    const names = ["Completed", "Skipped"];
    expect(subDetail("todo", names, new Set())).toBe("All");
    expect(subDetail("todo", names, new Set([subKey("todo", "Skipped")]))).toBe("Completed");
    expect(subDetail("todo", names, new Set(names.map((n) => subKey("todo", n))))).toBe("None");
  });
  it("counts and narrows the accounts pane", () => {
    const list = [acct("1", true), acct("2", false), acct("3", true)];
    expect(typeRows(list)).toEqual([{ value: "All", count: 3 }, { value: "HCO", count: 1 }, { value: "HCP", count: 2 }]);
    expect(paneAccounts(list, "HCP", undefined).map((a) => a.id)).toEqual(["1", "3"]);
    expect(paneAccounts(list, "All", ["2", "3"]).map((a) => a.id)).toEqual(["2", "3"]);
    expect(paneAccounts(list, "HCO", ["1", "3"])).toEqual([]);
  });
  it("gives Monday to Sunday of the week", () => {
    expect(weekRange("2026-10-17")).toEqual({ from: "10/12/26", to: "10/18/26" });
    expect(weekRange("2026-10-18T09:00:00Z")).toEqual({ from: "10/12/26", to: "10/18/26" });
    expect(weekRange("2026-01-01")).toEqual({ from: "12/29/25", to: "1/4/26" });
    expect(weekRange("nope")).toBeUndefined();
  });
});

describe("content helpers", () => {
  const card = (id: string, name: string, shareable: boolean) => ({ id, name, type: "PDF", pages: 1, date: "", isCustom: false, ownedByViewer: false, shareable });
  const data = {
    segments: ["Presentations", "Favorites"],
    cards: [card("a", "Alpha", true), card("b", "Beta", false), card("c", "Gamma", true)],
    sections: [{ title: "Oncology", cardIds: ["a", "b"] }, { title: "", cardIds: ["c"] }],
  } as never;
  it("filters sections by approval and category", () => {
    const view = { segment: "Presentations", search: "", favorites: new Set<string>() };
    expect(visibleSections(data, view).map((s) => s.cards.length)).toEqual([2, 1]);
    expect(visibleSections(data, { ...view, approvedOnly: true }).map((s) => s.cards.map((c) => c.id))).toEqual([["a"], ["c"]]);
    expect(visibleSections(data, { ...view, category: "Oncology", search: "bet" }).map((s) => s.cards.map((c) => c.id))).toEqual([["b"]]);
  });
  it("lists categories with counts", () => {
    expect(categoryRows(data)).toEqual([
      { title: null, label: "All", count: 3 },
      { title: "Oncology", label: "Oncology", count: 2 },
      { title: "", label: "No Category", count: 1 },
    ]);
  });
  it("labels slides", () => {
    expect(slideLabel(0, 4)).toBe("1 of 4 Slides");
  });
});
