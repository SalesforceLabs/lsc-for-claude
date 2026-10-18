/** Planner calendar (PlannerContainerViewController) — the viewer's week and synced accounts, as their iPad shows them. */

import { inList, query, queryResult, type Row } from "../helpers.js";
import { softFail, type ScreenContext } from "./context.js";

export interface CalendarDay {
  /** yyyy-mm-dd in the viewer's time zone. */
  date: string;
  /** Day of month, as CalendarDayCell's "dd" shows it. */
  dayOfMonth: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  today: boolean;
}

export type CalendarEventKind = "visit" | "event" | "tot" | "holiday" | "todo";

/** One event clipped to one day (a multi-day event gets one segment per day). */
export interface CalendarSegment {
  id: string;
  kind: CalendarEventKind;
  title: string;
  /** Index into `days`. */
  day: number;
  /** Minutes since local midnight. */
  startMin: number;
  endMin: number;
  allDay: boolean;
  /** Tile background and text (`#rrggbb`), CalendarEventsColorSchema. */
  background: string;
  text: string;
  /** Planned/unconfirmed calls draw at half alpha. */
  faded?: boolean;
  /** Call submitted or completed (the tile is the completed colour). */
  done?: boolean;
  /** ProviderVisit.IsConfirmed on a call that isn't submitted: the Filter Events "Confirmed Visit" toggle (PlannerFilterItemsFetcher / CalendarEventsFiltersQueryComposer). */
  confirmed?: boolean;
  /** An Assessment Task's Status as its picklist label ("Not Started"); the Filter Events drill-in toggles on it. */
  status?: string;
  /** CalendarCallIconSymbol: the call's channel icon, or the event's. */
  icon?: CalendarIcon;
}

export type CalendarIcon = "handshake" | "phone" | "screen" | "mailbox" | "fax" | "clipboard";

export interface CalendarAccount {
  id: string;
  name: string;
  person: boolean;
  /** Short date, or "" when the viewer has never visited. */
  lastVisit: string;
}

export interface PublishedCalendar {
  settings: {
    /** "HH:mm" the grid scrolls to. */
    startTime: string;
    /** Hours shown on screen (sets the point height of an hour). */
    dayDuration: number;
    /** ICU-ish pattern, e.g. "h:mm a". */
    timeFormat: string;
    firstDay: string;
    showLastVisit: boolean;
  };
  timeZone: string;
  locale: string;
  /** Collection time (ISO) — the week and the current-time line come from it. */
  now: string;
  /** Minutes since local midnight at `now`. */
  nowMin: number;
  /** Whole weeks from the first day of the week containing the 1st of last month to the end of next month's last week; segments index into this. */
  days: CalendarDay[];
  accounts: CalendarAccount[];
  segments: CalendarSegment[];
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// Palette defaults in CalendarEventMetadataImplementation.DefaultColorHex (light mode). Planned and completed calls are
// the colours measured on a device with no admin colours set (Kondo's #d8e6fe / #c9c9c9 don't match what it draws).
export const EVENT_COLORS = {
  plannedCall: "#aacbfe",
  confirmedCall: "#57a3fd",
  completedCall: "#a0a0a0",
  generalEvent: "#04e1cb",
  timeOffTerritory: "#feb9a5",
  holiday: "#fedfd0",
  // CalendarEventMetadataImplementation.DefaultColorHex.toDoBackground = colorPaletteYellow70.
  toDo: "#e4a201",
};

/** Local y/m/d/h/m/s and weekday of an instant in `timeZone`. */
export function zonedParts(ms: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number; s: number; wd: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" }).formatToParts(new Date(ms));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "Sun");
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour") % 24, mi: n("minute"), s: n("second"), wd };
}

/** The instant a wall-clock time occurs in `timeZone`. */
export function zonedInstant(y: number, mo: number, d: number, timeZone: string, h = 0, mi = 0): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, timeZone);
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    guess += wall - shown;
  }
  return guess;
}

const iso = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The seven days of the week containing `nowMs`, starting on `firstDay` (FirstDayOfTheWeek; Sunday when unrecognised). */
export function weekDays(nowMs: number, timeZone: string, firstDay: string): CalendarDay[] {
  const now = zonedParts(nowMs, timeZone);
  const start = Math.max(0, WEEKDAYS.indexOf(firstDay.trim().toLowerCase()));
  const back = (now.wd - start + 7) % 7;
  const base = Date.UTC(now.y, now.mo - 1, now.d - back);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(base + i * 86400000);
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    return { date: iso(y, mo, d), dayOfMonth: d, weekday: dt.getUTCDay(), today: y === now.y && mo === now.mo && d === now.d };
  });
}

/** The days the screen can page through: last month, this month and next month, in whole weeks. */
export function windowDays(nowMs: number, timeZone: string, firstDay: string): CalendarDay[] {
  const now = zonedParts(nowMs, timeZone);
  const start = Math.max(0, WEEKDAYS.indexOf(firstDay.trim().toLowerCase()));
  const first = Date.UTC(now.y, now.mo - 2, 1);
  const last = Date.UTC(now.y, now.mo + 1, 0);
  const from = first - ((new Date(first).getUTCDay() - start + 7) % 7) * 86400000;
  const to = last + ((start + 6 - new Date(last).getUTCDay() + 7) % 7) * 86400000;
  const out: CalendarDay[] = [];
  for (let t = from; t <= to; t += 86400000) {
    const dt = new Date(t);
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    out.push({ date: iso(y, mo, d), dayOfMonth: d, weekday: dt.getUTCDay(), today: y === now.y && mo === now.mo && d === now.d });
  }
  return out;
}

/** Instants bounding day `i` of `days` (midnight to next midnight in the viewer's zone). */
function dayBounds(day: CalendarDay, timeZone: string): [number, number] {
  const [y, m, d] = day.date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return [zonedInstant(y, m, d, timeZone), zonedInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone)];
}

/** Clip [startMs, endMs) to each day it touches; times are minutes since local midnight. */
export function clipToDays(startMs: number, endMs: number, days: CalendarDay[], timeZone: string, bounds?: [number, number][]): { day: number; startMin: number; endMin: number }[] {
  const end = Math.max(endMs, startMs);
  const out: { day: number; startMin: number; endMin: number }[] = [];
  days.forEach((day, i) => {
    const [from, to] = bounds?.[i] ?? dayBounds(day, timeZone);
    if (end < from || (end === from && startMs < end) || startMs >= to) return;
    const s = Math.max(startMs, from);
    const e = Math.min(end, to);
    out.push({ day: i, startMin: Math.round((s - from) / 60000), endMin: Math.round((e - from) / 60000) });
  });
  return out;
}

/** CalendarEventsColorSchema: text is the background with 0.5 taken off each channel. */
/** CalendarCallIconSymbol.callIcon(for:): mail, phone, remote screen and fax have their own; everything else is a handshake. */
function channelIcon(channel: string): CalendarIcon {
  const c = channel.toLowerCase();
  return c === "email" ? "mailbox" : c === "phone" ? "phone" : c === "remote" ? "screen" : c === "fax" ? "fax" : "handshake";
}

export function textColorFor(background: string): string {
  const v = parseInt(background.replace("#", "").slice(0, 6), 16);
  const ch = (shift: number) => Math.max(0, Math.round(((v >> shift) & 255) - 127.5));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** AssessmentTask.Status picklist API value to its label ("NotStarted" becomes "Not Started"), as Filter Events lists them. */
export const statusLabel = (v: string): string => v.replace(/([a-z])([A-Z])/g, "$1 $2");

const hex = (v: unknown): string | undefined => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined);
const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const chunks = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const soqlTime = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Short date as DateFormatter(.short) — "8/6/26" in en-US. */
function shortDate(date: string, locale: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  let loc = "en-US";
  try {
    loc = Intl.getCanonicalLocales(locale)[0] ?? loc;
  } catch {
    // keep en-US
  }
  return new Intl.DateTimeFormat(loc, { dateStyle: "short", timeZone: "UTC" }).format(d);
}

export async function collectCalendar(ctx: ScreenContext): Promise<PublishedCalendar | undefined> {
  const { format } = ctx;
  const planner = (await ctx.config(["PlannerAdministration"])).PlannerAdministration;
  if (!planner) return undefined;
  const nowMs = Date.now();
  const firstDay = text(planner.FirstDayOfTheWeek) || "Sunday";
  const days = windowDays(nowMs, format.timeZone, firstDay);
  const nowP = zonedParts(nowMs, format.timeZone);
  const bounds = days.map((d) => dayBounds(d, format.timeZone));
  const weekFrom = bounds[0][0];
  const weekTo = bounds[bounds.length - 1][1];
  const territories = ctx.territories.slice(0, 1).map((t) => t.id);
  const colors = {
    planned: hex(planner.ColorPlannedCall) ?? EVENT_COLORS.plannedCall,
    confirmed: hex(planner.ColorConfirmedCall) ?? EVENT_COLORS.confirmedCall,
    completed: hex(planner.ColorCompletedCall) ?? EVENT_COLORS.completedCall,
    general: hex(planner.ColorGeneralEvent) ?? EVENT_COLORS.generalEvent,
    tot: hex(planner.ColorTimeOffTerritory) ?? EVENT_COLORS.timeOffTerritory,
    holiday: hex(planner.ColorHolidayEvent) ?? EVENT_COLORS.holiday,
    todo: hex(planner.ColorToDo) ?? EVENT_COLORS.toDo,
  };
  const [accounts, segments] = await Promise.all([
    collectAccounts(ctx, planner.PlannerShowLastCallDate !== false),
    collectSegments(ctx, { days, bounds, weekFrom, weekTo, territories, colors, callConfirmation: planner.CallConfirmation === true }),
  ]);
  return {
    settings: {
      startTime: text(planner.StartTime) || "08:00",
      dayDuration: Number(planner.DayDuration) > 0 ? Number(planner.DayDuration) : 9,
      timeFormat: text(planner.TimeFormat) || "h:mm a",
      firstDay,
      showLastVisit: planner.PlannerShowLastCallDate !== false,    },
    timeZone: format.timeZone,
    locale: format.locale,
    now: new Date(nowMs).toISOString(),
    nowMin: nowP.h * 60 + nowP.mi,
    days,
    accounts,
    segments,
  };
}

/** Accounts the Calendar's pane holds (first by name); the account lists' member ids cover this many. */
export const CALENDAR_ACCOUNTS = 2000;

/** The accounts pane: the viewer's synced accounts by name (ICU order), with Last Visit from their territory's ProviderAcctTerritoryInfo. */
async function collectAccounts(ctx: ScreenContext, showLastVisit: boolean): Promise<CalendarAccount[]> {
  const scope = ctx.scope("Account");
  if (scope === undefined || scope === null) return [];
  const result = await queryResult(`SELECT Id, Name, IsPersonAccount FROM Account ${scope ? `WHERE ${scope} ` : ""}ORDER BY Name ASC NULLS LAST`, ctx.org, false, {
    allowTruncated: true,
    maxRows: CALENDAR_ACCOUNTS,
  }).catch(softFail(ctx, "Calendar accounts pane", null));
  const rows = (result?.records ?? []) as Row[];
  if (result?.truncated) {
    ctx.note(`Calendar accounts pane: showing the first ${rows.length.toLocaleString("en-US")} of ${result.totalSize.toLocaleString("en-US")} accounts by name.`);
  }
  const last = new Map<string, string>();
  const terrs = ctx.territories.map((t) => t.id);
  if (showLastVisit && terrs.length) {
    const parts = chunks(rows.map((r) => text(r.Id)), 200);
    const batches: Row[][] = [];
    for (let i = 0; i < parts.length; i += 4) {
      batches.push(
        ...(await Promise.all(
          parts.slice(i, i + 4).map((ids) =>
            query(
              `SELECT AccountId, LastProviderVisitDate FROM ProviderAcctTerritoryInfo WHERE Territory2Id IN (${inList(terrs)}) AND AccountId IN (${inList(ids)}) AND LastProviderVisitDate != null`,
              ctx.org
            ).catch(softFail(ctx, "Calendar accounts pane (Last Visit)", [] as Row[]))
          )
        ))
      );
    }
    for (const pati of batches) {
      for (const p of pati) {
        const id = text(p.AccountId);
        const d = text(p.LastProviderVisitDate).slice(0, 10);
        if (d > (last.get(id) ?? "")) last.set(id, d);
      }
    }
  }
  const collator = new Intl.Collator(ctx.format.locale.replace(/_/g, "-"));
  return rows
    .map((r) => ({ id: text(r.Id), name: text(r.Name), person: r.IsPersonAccount === true, lastVisit: last.has(text(r.Id)) ? shortDate(last.get(text(r.Id)) ?? "", ctx.format.locale) : "" }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

interface WeekArgs {
  days: CalendarDay[];
  bounds: [number, number][];
  weekFrom: number;
  weekTo: number;
  territories: string[];
  /** The admin's "call confirmation" switch: only then does a confirmed call draw in the confirmed colour (CalendarEventsColorSchema.getPlannedCallBackgroundColor). */
  callConfirmation: boolean;
  colors: { planned: string; confirmed: string; completed: string; general: string; tot: string; holiday: string; todo: string };
}

/** The window's events within each table's sync scope (CalendarEventsDefaultQueryComposer), clipped per day. */
async function collectSegments(ctx: ScreenContext, a: WeekArgs): Promise<CalendarSegment[]> {
  const { org, userId, format } = ctx;
  const from = soqlTime(a.weekFrom);
  const to = soqlTime(a.weekTo);
  const out: CalendarSegment[] = [];
  const add = (id: string, kind: CalendarEventKind, title: string, startMs: number, endMs: number, allDay: boolean, background: string, extra: { done?: boolean; confirmed?: boolean; status?: string; icon?: CalendarIcon } = {}) => {
    for (const c of clipToDays(startMs, endMs, a.days, format.timeZone, a.bounds)) {
      out.push({ id, kind, title, allDay, background, text: textColorFor(background), ...extra, ...c });
    }
  };
  const scoped = (table: string): string | null => {
    const s = ctx.scope(table);
    return s === undefined || s === null ? null : s ? ` AND (${s})` : "";
  };
  // Chunks of ids run four at a time.
  const inBatches = async (ids: string[], run: (part: string[]) => Promise<Row[]>): Promise<Row[]> => {
    const parts = chunks(ids, 200);
    const rows: Row[] = [];
    for (let i = 0; i < parts.length; i += 4) rows.push(...(await Promise.all(parts.slice(i, i + 4).map(run))).flat());
    return rows;
  };
  // Records the viewer can't read aren't on their device.
  const readable = async (ids: string[]): Promise<Set<string>> => {
    const rows = await inBatches(ids, (part) => query(`SELECT RecordId, HasReadAccess FROM UserRecordAccess WHERE UserId = '${userId}' AND RecordId IN (${inList(part)})`, org).catch(softFail(ctx, "Calendar", [] as Row[])));
    return new Set(rows.filter((r) => r.HasReadAccess === true).map((r) => text(r.RecordId)));
  };
  // CalendarEventsColorSchema inputs: the call's own record says whether it was submitted, and by which channel.
  const providerVisits = async (ids: string[]): Promise<Map<string, Row>> => {
    const rows = await inBatches(ids, (part) => query(`SELECT VisitId, Status, VisitSubmitDateTime, Channel, IsConfirmed FROM ProviderVisit WHERE VisitId IN (${inList(part)})`, org).catch(softFail(ctx, "Calendar", [] as Row[])));
    return new Map(rows.map((r) => [text(r.VisitId), r]));
  };

  await Promise.all([
    (async () => {
      const w = scoped("Visit");
      if (w === null || !a.territories.length) return;
      const rows = await query(
        `SELECT Id, Name, Status, PlannedVisitStartTime, PlannedVisitEndTime, Account.Name FROM Visit
         WHERE ParentVisitId = null AND PlannedVisitStartTime < ${to} AND PlannedVisitEndTime > ${from}
         AND Id IN (SELECT VisitId FROM ProviderVisit WHERE TerritoryId IN (${inList(a.territories)}))${w} LIMIT 4000`,
        org
      ).catch(softFail(ctx, "Calendar", [] as Row[]));
      const ids = rows.map((r) => text(r.Id));
      const [ok, pvs] = await Promise.all([readable(ids), providerVisits(ids)]);
      for (const r of rows.filter((r) => ok.has(text(r.Id)))) {
        const pv = pvs.get(text(r.Id));
        const done = Boolean(pv?.VisitSubmitDateTime) || text(pv?.Status).toLowerCase() === "completed" || text(r.Status).toLowerCase() === "completed";
        const title = text((r.Account as Row | null)?.Name) || text(r.Name);
        const confirmed = !done && pv?.IsConfirmed === true;
        add(text(r.Id), "visit", title, Date.parse(text(r.PlannedVisitStartTime)), Date.parse(text(r.PlannedVisitEndTime)), false, done ? a.colors.completed : confirmed && a.callConfirmation ? a.colors.confirmed : a.colors.planned, { done, ...(confirmed ? { confirmed } : {}), icon: channelIcon(text(pv?.Channel)) });
      }
    })(),
    (async () => {
      const w = scoped("Event");
      if (w === null) return;
      const rows = await query(
        `SELECT Id, Subject, StartDateTime, EndDateTime, IsAllDayEvent FROM Event
         WHERE OwnerId = '${userId}' AND StartDateTime < ${to} AND EndDateTime > ${from}${w} LIMIT 4000`,
        org
      ).catch(softFail(ctx, "Calendar", [] as Row[]));
      const ok = await readable(rows.map((r) => text(r.Id)));
      for (const r of rows.filter((r) => ok.has(text(r.Id)))) {
        add(text(r.Id), "event", text(r.Subject), Date.parse(text(r.StartDateTime)), Date.parse(text(r.EndDateTime)), r.IsAllDayEvent === true, a.colors.general, { icon: "clipboard" });
      }
    })(),
    (async () => {
      const w = scoped("TerritoryUserDowntime");
      if (w === null || !a.territories.length) return;
      const rows = await query(
        `SELECT Id, Name, StartDate, EndDate FROM TerritoryUserDowntime
         WHERE TerritoryId IN (${inList(a.territories)}) AND StartDate < ${to} AND EndDate > ${from}${w} LIMIT 4000`,
        org
      ).catch(softFail(ctx, "Calendar", [] as Row[]));
      for (const r of rows) add(text(r.Id), "tot", text(r.Name), Date.parse(text(r.StartDate)), Date.parse(text(r.EndDate)), false, a.colors.tot, { icon: "clipboard" });
    })(),
    (async () => {
      // selectStatementForToDoEvent: AssessmentTask with DueDate in range and IsVisibleInPlanner, drawn all-day on the due date.
      const w = scoped("AssessmentTask");
      if (w === null) return;
      const rows = await query(
        `SELECT Id, Name, Status, DueDate FROM AssessmentTask
         WHERE IsVisibleInPlanner = true AND DueDate >= ${a.days[0].date} AND DueDate <= ${a.days[a.days.length - 1].date}${w} LIMIT 2000`,
        org
      ).catch(softFail(ctx, "Calendar", [] as Row[]));
      const ok = await readable(rows.map((r) => text(r.Id)));
      for (const r of rows.filter((r) => ok.has(text(r.Id)))) {
        const [y, m, d] = text(r.DueDate).slice(0, 10).split("-").map(Number);
        if (!y) continue;
        const start = zonedInstant(y, m, d, format.timeZone);
        add(text(r.Id), "todo", text(r.Name), start, start + 1000, true, a.colors.todo, { status: statusLabel(text(r.Status)), icon: "clipboard" });
      }
    })(),
    (async () => {
      const w = scoped("Holiday");
      if (w === null) return;
      const rows = await query(
        `SELECT Id, Name, ActivityDate FROM Holiday WHERE ActivityDate >= ${a.days[0].date} AND ActivityDate <= ${a.days[a.days.length - 1].date}${w} LIMIT 500`,
        org
      ).catch(softFail(ctx, "Calendar", [] as Row[]));
      for (const r of rows) {
        const [y, m, d] = text(r.ActivityDate).slice(0, 10).split("-").map(Number);
        const start = zonedInstant(y, m, d, format.timeZone);
        add(text(r.Id), "holiday", text(r.Name), start, start + 86400000, true, a.colors.holiday);
      }
    })(),
  ]);
  return out;
}
