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
}

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
  /** Column within its overlap cluster and the cluster's column count. */
  col: number;
  cols: number;
}

/**
 * Side-by-side columns for overlapping events (CalendarEventsCollectionViewLayout): events that
 * overlap share a cluster; each takes the first free column and the cluster divides the day width.
 */
export function placeSegments<T extends { startMin: number; endMin: number }>(segs: T[]): PlacedSegment<T>[] {
  const sorted = [...segs].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: PlacedSegment<T>[] = [];
  let cluster: PlacedSegment<T>[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const p of cluster) p.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const seg of sorted) {
    if (cluster.length && seg.startMin >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= seg.startMin);
    if (col < 0) col = colEnds.length;
    colEnds[col] = seg.endMin;
    clusterEnd = cluster.length ? Math.max(clusterEnd, seg.endMin) : seg.endMin;
    const placed = { seg, col, cols: 1 };
    cluster.push(placed);
    out.push(placed);
  }
  flush();
  return out;
}
