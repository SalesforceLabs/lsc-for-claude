import { describe, it, expect } from "vitest";
import { clipToDays, textColorFor, weekDays, windowDays, zonedInstant, zonedParts } from "../../../../src/studio/screens/calendar.js";
import { formatTime, hourHeight, parseStartTime, placeStacked, pointFor, tileBox } from "../../../../src-renderer/components/studio/screens/calendar-types.js";

const PT = "America/Los_Angeles";
// Sat Oct 17 2026, 10:50 in Los Angeles.
const NOW = Date.parse("2026-10-17T17:50:00Z");

describe("week range", () => {
  it("starts on the admin's first day of the week", () => {
    expect(weekDays(NOW, PT, "Monday").map((d) => d.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(weekDays(NOW, PT, "Sunday")[0].date).toBe("2026-10-11");
    expect(weekDays(NOW, PT, "Saturday")[0].date).toBe("2026-10-17");
  });

  it("marks today and numbers the days like the day cell", () => {
    const days = weekDays(NOW, PT, "Monday");
    expect(days.filter((d) => d.today).map((d) => d.date)).toEqual(["2026-10-17"]);
    expect(days.map((d) => d.dayOfMonth)).toEqual([12, 13, 14, 15, 16, 17, 18]);
    expect(days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("uses the viewer's time zone for today", () => {
    // 06:30Z is still Saturday evening in Los Angeles but already Sunday in UTC and Tokyo.
    const late = Date.parse("2026-10-18T06:30:00Z");
    expect(weekDays(late, PT, "Sunday")[0].date).toBe("2026-10-11");
    expect(weekDays(late, "UTC", "Sunday")[0].date).toBe("2026-10-18");
    expect(weekDays(late, "Asia/Tokyo", "Monday").find((d) => d.today)?.date).toBe("2026-10-18");
  });

  it("falls back to Sunday for an unknown first day", () => {
    expect(weekDays(NOW, PT, "")[0].weekday).toBe(0);
  });

  it("crosses a month boundary", () => {
    const days = weekDays(Date.parse("2026-10-31T19:00:00Z"), PT, "Monday");
    expect(days.map((d) => d.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});

describe("zoned time", () => {
  it("finds the instant a wall-clock time occurs, across a DST change", () => {
    expect(new Date(zonedInstant(2026, 10, 17, PT)).toISOString()).toBe("2026-10-17T07:00:00.000Z");
    expect(new Date(zonedInstant(2026, 11, 2, PT)).toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(zonedParts(NOW, PT)).toMatchObject({ y: 2026, mo: 10, d: 17, h: 10, mi: 50, wd: 6 });
  });

  it("clips an event to each day it touches, in minutes since local midnight", () => {
    const days = weekDays(NOW, PT, "Monday");
    const start = Date.parse("2026-10-17T05:00:00Z"); // Fri 22:00 PT
    const end = Date.parse("2026-10-17T09:00:00Z"); // Sat 02:00 PT
    expect(clipToDays(start, end, days, PT)).toEqual([
      { day: 4, startMin: 1320, endMin: 1440 },
      { day: 5, startMin: 0, endMin: 120 },
    ]);
  });

  it("ignores events outside the week and ones that end at midnight", () => {
    const days = weekDays(NOW, PT, "Monday");
    expect(clipToDays(Date.parse("2026-10-20T17:00:00Z"), Date.parse("2026-10-20T18:00:00Z"), days, PT)).toEqual([]);
    // Ends exactly at Sunday-Monday midnight: only the previous day.
    const monday = zonedInstant(2026, 10, 12, PT);
    expect(clipToDays(monday - 3600000, monday, days, PT)).toEqual([]);
    expect(clipToDays(monday, monday + 3600000, days, PT)).toEqual([{ day: 0, startMin: 0, endMin: 60 }]);
  });

  it("measures a day with 25 hours on the wall clock of its start", () => {
    const days = weekDays(Date.parse("2026-11-01T20:00:00Z"), PT, "Sunday"); // fall back on Nov 1
    const start = zonedInstant(2026, 11, 1, PT, 23, 0);
    expect(clipToDays(start, start + 3600000, days, PT)).toEqual([{ day: 0, startMin: 1440 - 60 + 60, endMin: 1440 + 0 + 60 }]);
  });
});

describe("hour labels", () => {
  it("formats with the admin TimeFormat pattern", () => {
    expect(formatTime(8 * 60, "h:mm a")).toBe("8:00 AM");
    expect(formatTime(0, "h:mm a")).toBe("12:00 AM");
    expect(formatTime(12 * 60, "h:mm a")).toBe("12:00 PM");
    expect(formatTime(17 * 60 + 5, "h:mm a")).toBe("5:05 PM");
    expect(formatTime(9 * 60, "HH:mm")).toBe("09:00");
    expect(formatTime(13 * 60 + 30, "H:mm")).toBe("13:30");
    expect(formatTime(13 * 60, "hh a")).toBe("01 PM");
    expect(formatTime(9 * 60, "h 'at' a")).toBe("9 at AM");
  });

  it("parses the grid's start time", () => {
    expect(parseStartTime("08:00")).toBe(480);
    expect(parseStartTime("7:30")).toBe(450);
    expect(parseStartTime("nope")).toBe(480);
  });
});

describe("event layout math", () => {
  it("fits DayDuration hours in the visible grid", () => {
    expect(hourHeight(9)).toBeCloseTo(60.33, 2);
    expect(pointFor(8 * 60, 9)).toBeCloseTo(482.67, 2);
    expect(hourHeight(0)).toBeCloseTo(60.33, 2);
  });

  it("indents overlapping events and starts a new cluster once the first has ended", () => {
    const placed = placeStacked([
      { startMin: 540, endMin: 600, id: "a" },
      { startMin: 570, endMin: 630, id: "b" },
      { startMin: 600, endMin: 660, id: "c" },
      { startMin: 720, endMin: 780, id: "d" },
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.seg.id, [p.column, p.counter, p.count]]));
    expect(by).toEqual({ a: [0, 0, 1], b: [1, 0, 1], c: [0, 0, 1], d: [0, 0, 1] });
  });

  it("puts events that start together side by side and indents later overlaps", () => {
    const placed = placeStacked([
      { startMin: 540, endMin: 600, id: "a" },
      { startMin: 545, endMin: 600, id: "b" },
      { startMin: 570, endMin: 660, id: "c" },
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.seg.id, [p.column, p.counter, p.count]]));
    expect(by.a).toEqual([0, 0, 2]);
    expect(by.b).toEqual([0, 1, 2]);
    expect(by.c).toEqual([1, 0, 1]);
  });

  it("gives a lone event the full day and indents stacked tiles by 10pt", () => {
    expect(placeStacked([{ startMin: 0, endMin: 30 }])).toEqual([{ seg: { startMin: 0, endMin: 30 }, column: 0, counter: 0, count: 1 }]);
    expect(tileBox({ column: 0, counter: 0, count: 1 }, 112.86)).toEqual({ left: 2, width: 112.86 - 4 });
    const second = tileBox({ column: 1, counter: 0, count: 1 }, 112.86);
    expect(second.left).toBeCloseTo(12);
    expect(second.left + second.width).toBeCloseTo(112.86 - 2);
  });

  it("pages whole weeks from last month to next month", () => {
    const days = windowDays(NOW, PT, "Monday");
    expect(days[0].date).toBe("2026-08-31");
    expect(days[days.length - 1].date).toBe("2026-12-06");
    expect(days.length % 7).toBe(0);
    expect(days.filter((d) => d.today).map((d) => d.date)).toEqual(["2026-10-17"]);
  });

  it("derives tile text from the background as CalendarEventsColorSchema does", () => {
    expect(textColorFor("#d8e6fe")).toBe("#59677f");
    expect(textColorFor("#000000")).toBe("#000000");
  });
});
