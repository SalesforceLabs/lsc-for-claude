// Calendar interactions that are pure: the live clock in the user's zone, the Filter Events kinds, and the accounts pane's Type / Lists filters.
import type { CalendarAccount, CalendarDay, CalendarSegment, PublishedCalendar } from "./calendar-types";

/** Wall-clock date ("YYYY-MM-DD") and minute of day in an IANA zone; undefined when the zone is not valid. */
export function zonedNow(timeZone: string, at: Date = new Date()): { date: string; minutes: number } | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
  } catch {
    return undefined;
  }
}

/**
 * The calendar as of right now in the user's zone: the now-line minute and today's column follow the clock rather than the moment of the snapshot.
 * Days stay as collected (the window is fixed); when today falls outside the window the snapshot's own flags are kept.
 */
export function withLiveClock(data: PublishedCalendar, at: Date = new Date()): PublishedCalendar {
  const now = zonedNow(data.timeZone, at);
  if (!now || !data.days.some((d) => d.date === now.date)) return data;
  const days: CalendarDay[] = data.days.map((d) => (d.today === (d.date === now.date) ? d : { ...d, today: d.date === now.date }));
  return { ...data, now: now.date, nowMin: now.minutes, days };
}

/** The Filter Events switches: segment kinds the user can turn off. Assessment Tasks and Visits have their own drill-ins, so they are not switches. */
export const EVENT_SWITCHES: { label: string; kind: CalendarSegment["kind"] }[] = [
  { label: "Event", kind: "event" },
  { label: "Holiday", kind: "holiday" },
  { label: "Time Off Territory", kind: "tot" },
];

/** The Visit drill-in's toggles (PlannerFilterItemsFetcher's call variations, as named on the device). */
export const VISIT_VARIANTS = ["Completed Visit", "Confirmed Visit", "Planned Visit"];
/** The Assessment Task drill-in's toggles: the ToDo Status picklist, as the device lists it. */
export const TODO_STATUSES = ["Completed", "In Progress", "Not Started", "Skipped"];

/** Key of a drill-in toggle in the hidden set. */
export const subKey = (group: "visit" | "todo", name: string) => `${group}:${name}`;

/** A visit's variant: submitted ones are Completed; the preview does not collect Confirmed. */
export function visitVariant(s: Pick<CalendarSegment, "done">): string {
  return s.done ? "Completed Visit" : "Planned Visit";
}

/** CalendarEventFilterItem.getSelectedItemsName: "All", "None", or the names that are on. */
export function subDetail(group: "visit" | "todo", names: string[], hiddenSub: ReadonlySet<string>): string {
  const on = names.filter((n) => !hiddenSub.has(subKey(group, n)));
  return on.length === names.length ? "All" : on.length === 0 ? "None" : on.join(", ");
}

export function filterSegments(segments: CalendarSegment[], hidden: ReadonlySet<CalendarSegment["kind"]>, hiddenSub: ReadonlySet<string> = new Set()): CalendarSegment[] {
  if (hidden.size === 0 && hiddenSub.size === 0) return segments;
  return segments.filter((s) => !hidden.has(s.kind) && !(s.kind === "visit" && hiddenSub.has(subKey("visit", visitVariant(s)))));
}

/** Type popover rows: All / HCO / HCP with "N Accounts". */
export function typeRows(accounts: CalendarAccount[]): { value: "All" | "HCO" | "HCP"; count: number }[] {
  const hco = accounts.filter((a) => !a.person).length;
  return [
    { value: "All", count: accounts.length },
    { value: "HCO", count: hco },
    { value: "HCP", count: accounts.length - hco },
  ];
}

export const accountsLabel = (n: number) => `${n} Account${n === 1 ? "" : "s"}`;

/** The accounts pane after the Type and Lists choices (a list narrows to its members; a list without member data keeps everyone). */
export function paneAccounts(accounts: CalendarAccount[], type: "All" | "HCO" | "HCP", memberIds: string[] | undefined): CalendarAccount[] {
  const ids = memberIds ? new Set(memberIds) : undefined;
  return accounts.filter((a) => (type === "All" || (type === "HCO") === !a.person) && (!ids || ids.has(a.id)));
}

/** The "+" menu on the device (CalendarCreateEventViewController); no org data feeds it, so it is fixed. */
export const CREATE_EVENT_TYPES = ["Assessment Task", "Event", "Planned Visit", "Time Off Territory"];

/** Event Indicator legend: swatches observed on the device. */
export const EVENT_INDICATOR: { label: string; color: string }[] = [
  { label: "Assessment Task", color: "#e5a000" },
  { label: "Completed Visit", color: "#a0a0a0" },
  { label: "Confirmed Visit", color: "#0a5cb0" },
  { label: "Event", color: "#00c4b0" },
  { label: "Holiday", color: "#ffb88c" },
  { label: "Planned Visit", color: "#a8c8ff" },
  { label: "Time Off Territory", color: "#ff5a2d" },
];

/** The Delete Events form's default dates ("M/D/YY"): Monday to Sunday of the week containing `nowIso`. */
export function weekRange(nowIso: string): { from: string; to: string } | undefined {
  const [y, m, d] = nowIso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const at = new Date(Date.UTC(y, m - 1, d));
  const monday = new Date(at.getTime() - ((at.getUTCDay() + 6) % 7) * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const f = (t: Date) => `${t.getUTCMonth() + 1}/${t.getUTCDate()}/${String(t.getUTCFullYear()).slice(2)}`;
  return { from: f(monday), to: f(sunday) };
}
