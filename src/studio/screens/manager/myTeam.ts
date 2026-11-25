/**
 * My Team (lifesciences-ios module/MyTeam). An online screen: the manager's
 * territories and one territory's week of activities come from the Connect API
 * (MyTeamAPIUtility), not from the device's database. Read-only.
 *
 * The collector gives the territory picker and the current week; the week
 * itself is read when a territory is picked or the week changes
 * (`loadMyTeamWeek`, behind `studio_manager_data`).
 */

import { apiRequest, dataPath } from "../../../salesforce/cli.js";
import type { ScreenContext } from "../context.js";
import { softFail } from "../context.js";
import { EVENT_COLORS, zonedInstant, zonedParts } from "../calendar.js";

export interface MyTeamTerritory {
  id: string;
  name: string;
  repName: string;
  /** "Name (Rep)" as the picklist shows it. */
  label: string;
}

export interface MyTeamWeekInfo {
  /** Any day of the week, YYYY-MM-DD. */
  date: string;
  /** "Mar 2 - Mar 8, 2026". */
  label: string;
  /** First day of the week, YYYY-MM-DD. */
  start: string;
}

export interface MyTeamActivity {
  id: string;
  /** "Visit (Face to Face)", "Time Off Territory". */
  type: string;
  color: string;
  /** Visit that is already completed: the device greys its marker. */
  muted: boolean;
  userName: string;
  timeRange: string;
  details: string;
  status: string;
  address: string;
}

export interface MyTeamDay {
  /** "Monday, March 2, 2026". */
  title: string;
  activities: MyTeamActivity[];
}

export interface MyTeamWeek extends MyTeamWeekInfo {
  days: MyTeamDay[];
}

export interface PublishedMyTeam {
  territories: MyTeamTerritory[];
  week: MyTeamWeekInfo;
  firstDay: string;
  timeZone: string;
  locale: string;
  /** Marker colour per activity type: the planner's colours where set, else the device's. */
  colors: Record<string, string>;
  /** Short line on what the preview leaves out, when the territories couldn't be read. */
  note?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// MyTeamActivityType.name / .iconColor (MyTeamActivityType.swift). Colours the device takes from the planner settings
// when set; the fallbacks are APTheme colorsets: Purple40 #7526e3, Pink40 #b60554 (AppPalette/Resources/APTheme.xcassets).
const TYPE_NAMES: Record<string, string> = {
  Visit: "Visit",
  TerritoryUserDowntime: "Time Off Territory",
  meeting: "Event",
  coaching_event: "Coaching Event",
  Event: "General Event",
};
const TYPE_COLORS: Record<string, string> = {
  Visit: EVENT_COLORS.plannedCall,
  TerritoryUserDowntime: EVENT_COLORS.timeOffTerritory,
  meeting: "#7526e3",
  coaching_event: "#b60554",
  Event: EVENT_COLORS.generalEvent,
};
/** OCEDBCallStatus.submited.rawValue (OCEDBModelStatus.swift:16). */
const SUBMITTED = "Completed";
const NO_VALUE = "-";

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** The week (of seven days) holding `date` (YYYY-MM-DD), starting on `firstDay`; Monday when it isn't recognised (CalendarControlModel). */
export function myTeamWeek(date: string, firstDay: string): MyTeamWeekInfo {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const base = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : Date.UTC(1970, 0, 1);
  const wd = new Date(base).getUTCDay();
  const idx = WEEKDAYS.indexOf(firstDay.trim().toLowerCase());
  const start = idx >= 0 ? idx : 1;
  const startMs = base - ((wd - start + 7) % 7) * 86400000;
  const s = new Date(startMs);
  const e = new Date(startMs + 6 * 86400000);
  // CalendarControlModel.swift:75 displayFullWeekWithYear, "MMM d - MMM d, yyyy".
  const label = `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()} - ${MONTHS[e.getUTCMonth()]} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
  return { date, label, start: isoOf(startMs) };
}

/** Today in `timeZone` as YYYY-MM-DD. */
export function todayIn(timeZone: string, nowMs = Date.now()): string {
  const p = zonedParts(nowMs, timeZone);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** Epoch seconds of the week's first midnight in `timeZone`, the `start-of-week` URL segment. */
export function startOfWeekEpoch(start: string, timeZone: string): number {
  const [y, mo, d] = start.split("-").map(Number);
  return Math.round(zonedInstant(y, mo, d, timeZone) / 1000);
}

/** "EEEE, MMMM d, yyyy" for an instant (DateFormatter.createFullWeekDayMonthDateYearDateFormatter). */
export function dayTitle(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${DAYS_FULL[p.wd]}, ${MONTHS_FULL[p.mo - 1]} ${p.d}, ${p.y}`;
}

function shortTime(ms: number, timeZone: string, locale: string): string {
  let loc = "en-US";
  try {
    loc = Intl.getCanonicalLocales(locale)[0] ?? loc;
  } catch {
    // keep en-US
  }
  return new Intl.DateTimeFormat(loc, { timeStyle: "short", timeZone }).format(new Date(ms));
}

export const typeLabel = (type: string, subtype?: string | null): string => {
  const name = TYPE_NAMES[type] ?? type;
  return subtype ? `${name} (${subtype})` : name;
};

interface RawActivity {
  id?: string;
  startDate?: number;
  endDate?: number;
  createdByName?: string | null;
  type?: string;
  subtype?: string | null;
  status?: string | null;
  details?: string | null;
  place?: string | null;
  address?: string | null;
}

/** MyTeamActivityMapper.createAcitivityViewModel. */
export function mapActivity(
  a: RawActivity,
  timeZone: string,
  locale: string,
  colors: Record<string, string> = TYPE_COLORS
): MyTeamActivity {
  const type = typeLabel(a.type ?? "", a.subtype);
  const status = a.status || NO_VALUE;
  return {
    id: a.id ?? "",
    type,
    color: colors[a.type ?? ""] ?? EVENT_COLORS.generalEvent,
    // MyTeamActivityItemCell.show: compares the label, subtype included, with "Visit".
    muted: type === "Visit" && status === SUBMITTED,
    userName: a.createdByName || NO_VALUE,
    timeRange: `${shortTime((a.startDate ?? 0) * 1000, timeZone, locale)} - ${shortTime((a.endDate ?? 0) * 1000, timeZone, locale)}`,
    details: a.details || NO_VALUE,
    status,
    address: a.address || NO_VALUE,
  };
}

/** One section per day the API returned, in its order (MyTeamActivityMapper.getSections). */
export function mapWeek(
  records: { dayDate?: number; activities?: RawActivity[] }[],
  timeZone: string,
  locale: string,
  colors?: Record<string, string>
): MyTeamDay[] {
  return records.map((r) => ({
    title: dayTitle((r.dayDate ?? 0) * 1000, timeZone),
    activities: (r.activities ?? []).map((a) => mapActivity(a, timeZone, locale, colors)),
  }));
}

/** MyTeamTerritoriesFetcher: the picklist shows "Territory (Rep)". */
export function mapTerritories(
  records: { territoryId?: string; territoryName?: string; salesRepName?: string | null }[]
): MyTeamTerritory[] {
  return records
    .filter((r) => r.territoryId)
    .map((r) => {
      const name = r.territoryName ?? "";
      const repName = r.salesRepName ?? "";
      return {
        id: r.territoryId as string,
        name,
        repName,
        label: repName ? `${name} (${repName})` : name,
      };
    });
}

/** GET on the Life Sciences Commercial Connect API; throws the org's error text when it refuses. */
async function connectGet<T>(org: string, rest: string): Promise<T> {
  const res = await apiRequest<{ response?: T; isSuccess?: boolean; message?: string | null } & T>(
    await dataPath(org, `/connect/life-sciences/commercial/${rest}`),
    "GET",
    undefined,
    org
  );
  if (!res.success || res.data === undefined)
    throw new Error(res.error || "No answer from the org.");
  // The Connect API wraps its answer: { isSuccess, message, response: { records } }.
  if (res.data.isSuccess === false)
    throw new Error(res.data.message || "The org refused the request.");
  return (res.data.response ?? res.data) as T;
}

/** Planner colours when set, else the device's fallbacks. */
export function typeColors(p: Record<string, unknown>): Record<string, string> {
  const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);
  return {
    ...TYPE_COLORS,
    Visit: hex(p.ColorPlannedCall) ?? TYPE_COLORS.Visit,
    TerritoryUserDowntime: hex(p.ColorTimeOffTerritory) ?? TYPE_COLORS.TerritoryUserDowntime,
    Event: hex(p.ColorGeneralEvent) ?? TYPE_COLORS.Event,
  };
}

export async function collectMyTeam(ctx: ScreenContext): Promise<PublishedMyTeam | undefined> {
  const planner = (await ctx.config(["PlannerAdministration"]).catch(() => ({}))) as Record<
    string,
    Record<string, unknown>
  >;
  const colors = typeColors(planner.PlannerAdministration ?? {});
  const fd = planner.PlannerAdministration?.FirstDayOfTheWeek;
  const firstDay = typeof fd === "string" && fd ? fd : "Monday";
  const week = myTeamWeek(todayIn(ctx.format.timeZone), firstDay);
  let note: string | undefined;
  const territories = await connectGet<{ records?: Parameters<typeof mapTerritories>[0] }>(
    ctx.adminOrg,
    `users/${ctx.userId}/managed-territories`
  )
    .then((r) => mapTerritories(r.records ?? []))
    .catch((err) => {
      note = "Not in the preview: the territories this rep manages couldn't be read.";
      return softFail(ctx, "My Team territories", [] as MyTeamTerritory[])(err);
    });
  return {
    territories,
    week,
    firstDay,
    timeZone: ctx.format.timeZone,
    locale: ctx.format.locale,
    colors,
    ...(note ? { note } : {}),
  };
}

/** `studio_manager_data` kind "myTeamWeek": one territory's activities for the week holding `date`. */
export async function loadMyTeamWeek(
  org: string,
  opts: {
    territoryId?: string;
    date: string;
    firstDay: string;
    timeZone: string;
    locale: string;
    /** `PublishedMyTeam.colors`, so the week is drawn in the viewer's planner colours. */
    colors?: Record<string, string>;
  }
): Promise<MyTeamWeek> {
  const info = myTeamWeek(opts.date, opts.firstDay);
  if (!opts.territoryId) return { ...info, days: [] };
  const epoch = startOfWeekEpoch(info.start, opts.timeZone);
  if (!/^[a-zA-Z0-9]{15,18}$/.test(opts.territoryId)) throw new Error("Not a territory Id.");
  const res = await connectGet<{ records?: Parameters<typeof mapWeek>[0] }>(
    org,
    `territory/${opts.territoryId}/start-of-week/${epoch}/weekly-territory-activities`
  );
  return { ...info, days: mapWeek(res.records ?? [], opts.timeZone, opts.locale, opts.colors) };
}
