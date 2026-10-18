import { describe, expect, it } from "vitest";
import { filterSegments, subKey, visitVariant } from "../../../../src-renderer/components/studio/screens/calendar-logic";
import { statusLabel } from "../../../../src/studio/screens/calendar";
import type { CalendarSegment } from "../../../../src-renderer/components/studio/screens/calendar-types";

const seg = (o: Partial<CalendarSegment>): CalendarSegment => ({ id: "x", kind: "visit", title: "t", day: 0, startMin: 0, endMin: 60, allDay: false, background: "#fff", text: "#000", ...o });

describe("Filter Events", () => {
  it("names the visit variants like CalendarEventsFiltersQueryComposer", () => {
    expect(visitVariant({ done: true, confirmed: true })).toBe("Completed Visit");
    expect(visitVariant({ confirmed: true })).toBe("Confirmed Visit");
    expect(visitVariant({})).toBe("Planned Visit");
  });

  it("hides confirmed visits and Assessment Tasks by status", () => {
    const all = [seg({ id: "a" }), seg({ id: "b", confirmed: true }), seg({ id: "c", kind: "todo", allDay: true, status: "Not Started" }), seg({ id: "d", kind: "todo", allDay: true, status: "Skipped" })];
    const hidden = new Set([subKey("visit", "Confirmed Visit"), subKey("todo", "Skipped")]);
    expect(filterSegments(all, new Set(), hidden).map((s) => s.id)).toEqual(["a", "c"]);
    expect(filterSegments(all, new Set(["todo"]), new Set()).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("turns a status API value into its label", () => {
    expect(statusLabel("NotStarted")).toBe("Not Started");
    expect(statusLabel("InProgress")).toBe("In Progress");
    expect(statusLabel("Completed")).toBe("Completed");
  });
});
