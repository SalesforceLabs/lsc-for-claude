/** Structural copy of PublishedCalendar in src/studio/screens/calendar.ts, plus the pure layout math the screen draws with. */

export interface CalendarDay {
  date: string;
  dayOfMonth: number;
  weekday: number;
  today: boolean;
}

export interface CalendarSegment {
  id: string;
  kind: "visit" | "event" | "tot" | "holiday";
  title: string;
  day: number;
  startMin: number;
  endMin: number;
  allDay: boolean;
  background: string;
  text: string;
  faded?: boolean;
  done?: boolean;
  icon?: CalendarIcon;
}

export type CalendarIcon = "handshake" | "phone" | "screen" | "mailbox" | "fax" | "clipboard";

export interface CalendarAccount {
  id: string;
  name: string;
  person: boolean;
  lastVisit: string;
}

export interface PublishedCalendar {
  settings: { startTime: string; dayDuration: number; timeFormat: string; firstDay: string; showLastVisit: boolean };
  timeZone: string;
  locale: string;
  now: string;
  nowMin: number;
  days: CalendarDay[];
  accounts: CalendarAccount[];
  segments: CalendarSegment[];
}

/** Height of the scrolling time grid, measured on the device: y 291 to the screen bottom at 834. */
export const GRID_VIEW_HEIGHT = 543;

/** CalendarVariables.TimeViewDimensions.hourHeight: the visible grid shows DayDuration hours. */
export function hourHeight(dayDuration: number): number {
  return GRID_VIEW_HEIGHT / (dayDuration > 0 ? dayDuration : 9);
}

/** y of a minute-of-day in the grid (CalendarWeekViewController pointFor). */
export function pointFor(minute: number, dayDuration: number): number {
  return (minute / 60) * hourHeight(dayDuration);
}

/** "HH:mm" → minutes since midnight (8:00 when malformed). */
export function parseStartTime(startTime: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(startTime.trim());
  return m ? Math.min(Number(m[1]), 23) * 60 + Math.min(Number(m[2]), 59) : 480;
}

/**
 * Formats minutes since midnight with the admin's TimeFormat pattern (ICU/NSDateFormatter letters):
 * h/hh 12-hour, H/HH 24-hour, mm, a = AM/PM; quoted text and other characters pass through.
 */
export function formatTime(minute: number, pattern: string): string {
  const h24 = Math.floor(minute / 60) % 24;
  const mm = String(minute % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  let out = "";
  for (let i = 0; i < pattern.length; ) {
    const ch = pattern[i];
    if (ch === "'") {
      const end = pattern.indexOf("'", i + 1);
      out += end < 0 ? pattern.slice(i + 1) : end === i + 1 ? "'" : pattern.slice(i + 1, end);
      i = end < 0 ? pattern.length : end + 1;
      continue;
    }
    let n = 1;
    while (pattern[i + n] === ch) n++;
    if (ch === "h") out += n > 1 ? String(h12).padStart(2, "0") : String(h12);
    else if (ch === "H") out += n > 1 ? String(h24).padStart(2, "0") : String(h24);
    else if (ch === "m") out += mm;
    else if (ch === "a") out += h24 < 12 ? "AM" : "PM";
    else out += ch.repeat(n);
    i += n;
  }
  return out;
}

export interface PlacedSegment<T> {
  seg: T;
  /** Stack depth: each step indents the tile by STACK_OFFSET. */
  column: number;
  /** Position among tiles that start together and share one row (side by side). */
  counter: number;
  /** How many share that row. */
  count: number;
}

/** CalendarEventsCollectionViewLayout.stackOffsetWidth and eventCellsEdgeOffset.horizontal. */
export const STACK_OFFSET = 10;
export const EDGE_OFFSET = 2;

/**
 * Tile placement of CalendarEventsCollectionViewLayout.attributeForCells: events are walked in order;
 * those starting within 15 minutes of an event already in a column's row sit beside it, an event that
 * clears the column's span stacks below in the same column, and anything else opens a new column
 * that is indented by 10pt. A cluster ends when an event starts after the cluster's first event ended.
 */
export function placeStacked<T extends { startMin: number; endMin: number }>(segs: T[]): PlacedSegment<T>[] {
  const sorted = [...segs].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: PlacedSegment<T>[] = [];
  let columns: T[][][] = [];
  let lastEnd: number | undefined;
  const flush = () => {
    columns.forEach((rows, column) =>
      rows.forEach((row) =>
        row.forEach((seg, counter) => out.push({ seg, column, counter, count: row.length }))
      )
    );
    columns = [];
    lastEnd = undefined;
  };
  for (const ev of sorted) {
    if (lastEnd !== undefined && ev.startMin >= lastEnd) flush();
    let placed = false;
    outer: for (const column of columns) {
      for (const row of column) {
        const first = column[0][0];
        const last = column[column.length - 1][0];
        const spanEnd = last.endMin - last.startMin >= 1 / 60 ? last.endMin - 1 / 60 : last.endMin;
        if (first.startMin > spanEnd) continue;
        if (row.some((o) => Math.abs(ev.startMin - o.startMin) < 15)) {
          row.push(ev);
          placed = true;
          break outer;
        }
        if (!(first.startMin <= ev.endMin && ev.startMin <= spanEnd)) {
          column.push([ev]);
          placed = true;
          break outer;
        }
      }
    }
    if (!placed) columns.push([[ev]]);
    if (lastEnd === undefined) lastEnd = ev.endMin;
  }
  flush();
  return out;
}

/** Left and width of a placed tile inside a day column of width `colW` (calculateWidth / calculateXPosition). */
export function tileBox(p: { column: number; counter: number; count: number }, colW: number): { left: number; width: number } {
  const width = (colW - EDGE_OFFSET * (p.count + 1) - STACK_OFFSET * p.column) / p.count;
  return { width, left: p.counter * width + STACK_OFFSET * p.column + EDGE_OFFSET * (p.counter + 1) };
}
