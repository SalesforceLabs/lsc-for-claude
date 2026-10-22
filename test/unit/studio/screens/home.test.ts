import { describe, it, expect } from "vitest";
import { cycleText, firstActivityType, lastRefreshedText, lastVisitText, sortNbc, visibleDates, visitTimeText } from "../../../../src/studio/screens/home.js";
import { pageDots } from "../../../../src-renderer/components/studio/screens/home-types.js";

const F = { timeZone: "America/Los_Angeles", locale: "en-US" };
const N = " ";

describe("home screen logic", () => {
  it("sorts NBC cards by score, then rank, then name", () => {
    const rows = [
      { score: 90, rank: 3, name: "B" },
      { score: 100, rank: 2, name: "Z" },
      { score: 90, rank: 1, name: "C" },
      { score: 90, rank: 1, name: "A" },
      { score: null, rank: 0, name: "N" },
    ];
    expect(sortNbc(rows).map((r) => r.name)).toEqual(["Z", "A", "C", "B", "N"]);
  });

  it("shows a date on the first row of each page of three and on day changes", () => {
    expect(visibleDates(["a", "a", "a", "a", "b", "b", ""])).toEqual([true, false, false, true, true, false, false]);
  });

  it("writes Last Refreshed as today, 1 day, or N days", () => {
    const now = new Date("2026-10-17T20:00:00Z");
    expect(lastRefreshedText(new Date("2026-10-17T13:30:46Z"), now, F)).toBe(`Last Refreshed: Today, 6:30${N}AM`);
    expect(lastRefreshedText(new Date("2026-10-16T13:30:46Z"), now, F)).toBe("Last Refreshed: 1 day ago");
    expect(lastRefreshedText(new Date("2026-10-12T13:30:46Z"), now, F)).toBe("Last Refreshed: 5 days ago");
    expect(lastRefreshedText(null, now, F)).toBe("Last Refreshed: --");
  });

  it("formats the last visit with U+202F before AM/PM", () => {
    expect(lastVisitText("2026-08-06T18:19:00Z", F)).toBe(`8/6/26, 11:19${N}AM`);
    expect(lastVisitText(null, F)).toBe("");
  });

  it("formats visit times in lowercase", () => {
    expect(visitTimeText(new Date("2026-05-14T20:38:00Z"), new Date("2026-05-14T21:19:00Z"), F)).toBe(`1:38${N}pm - 2:19${N}pm`);
  });

  it("counts whole days left in the cycle", () => {
    expect(cycleText(new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"), new Date("2026-10-17T20:00:00Z"), F)).toBe("75 days left (Jan 1, 2026 - Jan 1, 2027)");
    expect(cycleText(new Date("2026-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"), new Date("2026-10-17T20:00:00Z"), F)).toMatch(/^0 days left/);
  });

  it("picks the first activity type by display order, then label", () => {
    expect(firstActivityType([{ label: "B", order: 1 }, { label: "A", order: 1 }, { label: "Z", order: 0 }])).toBe("Z");
    expect(firstActivityType([{ label: "B", order: 1 }, { label: "A", order: 1 }])).toBe("A");
    expect(firstActivityType([])).toBeUndefined();
  });
});

describe("pageDots", () => {
  it("draws every dot when the pages fit, and shrinks the clipped edge when they do not", () => {
    expect(pageDots(1, 0)).toEqual([]);
    expect(pageDots(3, 1).map((d) => d.on)).toEqual([false, true, false]);
    const first = pageDots(61, 0);
    expect(first).toHaveLength(9);
    expect(first[0].on).toBe(true);
    expect(first.map((d) => d.small)).toEqual([false, false, false, false, false, false, false, false, true]);
    const mid = pageDots(61, 30);
    expect(mid.find((d) => d.on)?.index).toBe(30);
    expect(mid[0].small && mid[8].small).toBe(true);
    expect(pageDots(61, 60)[8].on).toBe(true);
  });
});
