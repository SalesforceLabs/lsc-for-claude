/** Home components that read data (NBC cards, Visits To Submit, Activity Plan Progress) — the viewer's rows, as their iPad shows them. */

import { inList, query, type Row } from "../helpers.js";
import { formatAddress } from "./accounts.js";
import type { ScreenContext } from "./context.js";

export interface HomeNbcCard {
  accountId: string;
  name: string;
  /** Latest-modified HealthcareProviderSpecialty (the card's second Name node). */
  specialty: string;
  /** ContactPointAddress.FullAddress of the newest active address. */
  address: string;
  /** PATI.IsTargetedAccount in the viewer's territory — the "Target" pill shows only when true. */
  target: boolean;
  /** "8/6/26, 11:19 AM" in the viewer's zone, or "" (the card shows "No data available"). */
  lastVisit: string;
  score: number | null;
  insight: string;
  /** ProviderActivityGoal.ProratedOverallGoal; null hides the "Activity Plan Progress" pill. */
  planProgress: number | null;
}

export interface HomeVisit {
  id: string;
  /** "May 14, 2026", "Today", or "" when the previous row of the page already shows the day. */
  dateLabel: string;
  /** "1:38 pm - 2:19 pm". */
  time: string;
  account: string;
  address: string;
  channel: string;
  /** "3 Attendees" when the visit has more than one child visit. */
  attendees: string;
}

export interface PublishedHome {
  nbc?: {
    cards: HomeNbcCard[];
    /** NextBestCustomersViewModel.lastSyncText; "Last Refreshed: --" when unknown. */
    lastRefreshed: string;
    /** Provenance of lastRefreshed: the iPad reads its own device-local lastSyncDate, so this is an org-side approximation. */
    lastRefreshedSource: string;
  };
  visits?: { total: number; items: HomeVisit[] };
  plan?: {
    /** "75 days left (Jan 1, 2026 - Jan 1, 2027)"; absent without an active cycle. */
    cycle?: string;
    /** First active ProviderActivityMeasureType the Activity Type picker lands on. */
    activityType?: string;
    /** The "Progress Over Time" x axis, from the cycle's days (ActivityPlanViewModel.buildProgressSeries); absent without an active cycle. */
    axis?: PaceAxis;
  };
}

type Format = ScreenContext["format"];

const str = (v: unknown) => (typeof v === "string" ? v : "");
const NNBSP = "\u202f";
const chunks = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

function dateOf(iso: unknown): Date | null {
  const d = new Date(str(iso));
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmt = (d: Date, f: Format, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(f.locale, { timeZone: f.timeZone, ...o }).format(d);
const dayKey = (d: Date, f: Format) => fmt(d, f, { year: "numeric", month: "numeric", day: "numeric" });

/** NBC "Last Visit": short date and time ("8/6/26, 11:19 AM"), the device putting U+202F before AM/PM. */
export function lastVisitText(iso: unknown, f: Format): string {
  const d = dateOf(iso);
  return d ? fmt(d, f, { dateStyle: "short", timeStyle: "short" }).replace(/\s+(AM|PM)$/i, `${NNBSP}$1`) : "";
}

/** AgendaTableViewCell: "1:38 pm - 2:19 pm" (hours format, lowercased, U+202F before am/pm). */
export function visitTimeText(start: Date, end: Date, f: Format): string {
  const t = (d: Date) => fmt(d, f, { hour: "numeric", minute: "2-digit" }).replace(/\s+(AM|PM)$/i, `${NNBSP}$1`).toLowerCase();
  return `${t(start)} - ${t(end)}`;
}

/** AgendaTableViewItem.determineDisplayableDates (3 per page): the first row of a page and any change of day show a date. */
export function visibleDates(days: string[], perPage = 3): boolean[] {
  let last: string | null = null;
  return days.map((day, i) => {
    if (!day) return false;
    if (i % perPage === 0 || day !== last) {
      last = day;
      return true;
    }
    return false;
  });
}

const LAST_REFRESHED_SOURCE =
  "Approximation: NextBestCustomersViewModel.lastSyncText shows the device's own syncService.lastSyncDate, falling back to SharedUserSettings.lastSync(). The snapshot uses the newest completed data sync's DownloadStart from DeviceSyncSummary, so it can differ from a real iPad by the time between the sync and the data being saved.";

/** NextBestCustomersViewModel.lastSyncText. The device reads its own lastSyncDate; the org's copy is the newest completed data sync's DownloadStart (= the row's LastSyncTime). */
export function lastRefreshedText(sync: Date | null, now: Date, f: Format): string {
  if (!sync) return "Last Refreshed: --";
  if (dayKey(sync, f) === dayKey(now, f)) return `Last Refreshed: Today, ${fmt(sync, f, { hour: "numeric", minute: "2-digit" }).replace(/\s+(AM|PM)$/i, `${NNBSP}$1`)}`;
  const days = Math.floor((now.getTime() - sync.getTime()) / 86400000);
  return days <= 1 ? "Last Refreshed: 1 day ago" : `Last Refreshed: ${days} days ago`;
}

/** Score descending, then rank, then account name (compareByScoreRankName); no score at all sorts by rank. */
export function sortNbc<T extends { score: number | null; rank: number; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.rank - b.rank || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** ActivityPlanProductsCoordinator.calculateCycleData: whole days from now to the end, never negative. */
export function cycleText(start: Date, end: Date, now: Date, f: Format): string {
  const day = (d: Date) => new Intl.DateTimeFormat(f.locale, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(d);
  const left = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 86400000));
  return `${left} days left (${day(start)} - ${day(end)})`;
}

export interface PaceAxis {
  /** Days in the cycle (allDates.count); the x axis runs 0...days-1. */
  days: number;
  /** Index of today, clamped into the cycle. */
  today: number;
  /** Month ticks; the last tick (the final day) carries no label, as SwiftUI Charts clips it. */
  ticks: { index: number; label: string }[];
}

/**
 * ActivityPlanViewModel.buildProgressSeries: one x step per local calendar day from the cycle start to its end, today
 * clamped into that range, and month ticks at the first day, at every `step`th month start (step = ceil(months / min(4, months))),
 * and at the last day.
 */
export function paceAxis(start: Date, end: Date, now: Date, f: Format): PaceAxis {
  const ymd = (d: Date) => {
    const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: f.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  const s = ymd(start);
  const e = Math.max(ymd(end), s);
  const days = Math.round((e - s) / 86400000) + 1;
  const at = (i: number) => new Date(s + i * 86400000);
  const today = Math.max(0, Math.min(days - 1, Math.round((ymd(now) - s) / 86400000)));
  const first = at(0);
  const last = at(days - 1);
  const totalMonths = (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth() + 1;
  const step = Math.max(1, Math.ceil(totalMonths / Math.max(2, Math.min(4, totalMonths))));
  const label = (d: Date) => new Intl.DateTimeFormat(f.locale, { timeZone: "UTC", month: "short" }).format(d);
  const ticks = new Map<number, string>([[0, label(first)]]);
  for (let i = 0; i < days; i++) {
    const d = at(i);
    if (d.getUTCDate() !== 1) continue;
    const m = (d.getUTCFullYear() - first.getUTCFullYear()) * 12 + d.getUTCMonth() - first.getUTCMonth();
    if (m % step === 0) ticks.set(i, label(d));
  }
  ticks.set(days - 1, "");
  return { days, today, ticks: [...ticks].sort((a, b) => a[0] - b[0]).map(([index, l]) => ({ index, label: l })) };
}

/** The earliest-created sibling first: ties on DisplayOrder fall back to the label. */
export function firstActivityType(rows: { label: string; order: number }[]): string | undefined {
  return [...rows].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))[0]?.label;
}

async function inBatches(ids: string[], run: (part: string[]) => Promise<Row[]>): Promise<Row[]> {
  const parts = chunks(ids, 200);
  const rows: Row[] = [];
  for (let i = 0; i < parts.length; i += 4) rows.push(...(await Promise.all(parts.slice(i, i + 4).map(run))).flat());
  return rows;
}

/** Rows the viewer can read (the queries run as the admin): UserRecordAccess, 200 ids per query. */
async function readable(ids: string[], ctx: ScreenContext): Promise<Set<string>> {
  const rows = await inBatches(ids, (part) =>
    query(`SELECT RecordId FROM UserRecordAccess WHERE UserId = '${ctx.userId}' AND HasReadAccess = true AND RecordId IN (${inList(part)})`, ctx.org).catch(() => [] as Row[])
  );
  return new Set(rows.map((r) => str(r.RecordId)));
}

const scoped = (ctx: ScreenContext, table: string): string | null => {
  const s = ctx.scope(table);
  return s === undefined || s === null ? null : s ? ` AND (${s})` : "";
};

interface NbcProps {
  maxCards: number;
}

function nbcProps(ctx: ScreenContext): NbcProps | null {
  const comp = ctx.core.home?.regions.flatMap((r) => r.components).find((c) => c.supported && /nbctopcards$/i.test(c.name));
  return comp ? { maxCards: Number(comp.properties.totalCards) || 10 } : null;
}

/** NextBestCustomersViewModel: fetchTopScores by rank, the first `maxCards` sorted by score, each card filled from the ARC graph's nodes. */
async function collectNbc(ctx: ScreenContext, now: Date): Promise<PublishedHome["nbc"]> {
  const props = nbcProps(ctx);
  const terr = ctx.territories.map((t) => t.id);
  const w = scoped(ctx, "TerritoryAccountScore");
  if (!props || !terr.length || w === null) return undefined;
  const today = new Date(now.getTime()).toISOString().slice(0, 10);
  const rows = await query(
    `SELECT AccountId, Account.Name, TerritoryId, TotalScore, Rank, LastModifiedDate, LSDO_Score_Summary__c FROM TerritoryAccountScore
     WHERE TerritoryId IN (${inList(terr)}) AND AccountId != null AND (SnoozeUntilDate = null OR SnoozeUntilDate < ${today}T00:00:00Z)${w} ORDER BY Rank ASC, Account.Name ASC LIMIT 400`,
    ctx.org
  ).catch(async () =>
    query(
      `SELECT AccountId, Account.Name, TerritoryId, TotalScore, Rank, LastModifiedDate FROM TerritoryAccountScore
       WHERE TerritoryId IN (${inList(terr)}) AND AccountId != null AND (SnoozeUntilDate = null OR SnoozeUntilDate < ${today}T00:00:00Z)${w} ORDER BY Rank ASC, Account.Name ASC LIMIT 400`,
      ctx.org
    )
  );
  // One row per account, the viewer's selected territory first (the card's score node filters on {!userTerritory}).
  const picked = new Map<string, Row>();
  for (const r of rows) {
    const id = str(r.AccountId);
    const cur = picked.get(id);
    if (!cur || (str(r.TerritoryId) === terr[0] && str(cur.TerritoryId) !== terr[0])) picked.set(id, r);
  }
  let candidates = [...picked.values()];
  const ids = candidates.map((r) => str(r.AccountId));
  if (!ids.length) return { cards: [], lastRefreshed: "Last Refreshed: --", lastRefreshedSource: LAST_REFRESHED_SOURCE };
  // The device's last_call join: an account visited (Submitted) after its score was last modified is left out.
  const visits = await inBatches(ids, (part) =>
    query(`SELECT AccountId, MAX(PlannedStartTime) m FROM ProviderVisit WHERE Status = 'Submitted' AND AccountId IN (${inList(part)}) GROUP BY AccountId`, ctx.org).catch(() => [] as Row[])
  );
  const lastCall = new Map(visits.map((r) => [str(r.AccountId), dateOf(r.m)]));
  candidates = candidates.filter((r) => {
    const c = lastCall.get(str(r.AccountId));
    const mod = dateOf(r.LastModifiedDate);
    return !c || !mod || c.getTime() <= mod.getTime();
  });
  const ok = await readable(candidates.map((r) => str(r.AccountId)), ctx);
  const top = candidates.filter((r) => ok.has(str(r.AccountId))).slice(0, props.maxCards);
  const topIds = top.map((r) => str(r.AccountId));
  const q = (soql: (list: string) => string) => inBatches(topIds, (part) => query(soql(inList(part)), ctx.org).catch(() => [] as Row[]));
  const [specs, addrs, patis, goals, sync] = await Promise.all([
    q((l) => `SELECT AccountId, Name, LastModifiedDate FROM HealthcareProviderSpecialty WHERE AccountId IN (${l}) ORDER BY LastModifiedDate DESC`),
    q((l) => `SELECT ParentId, FullAddress, Street, PostalCode, City, State, Country, LastModifiedDate FROM ContactPointAddress WHERE ParentId IN (${l}) AND IsActive = true ORDER BY LastModifiedDate DESC`),
    q((l) => `SELECT AccountId, IsTargetedAccount, LastProviderVisitDate FROM ProviderAcctTerritoryInfo WHERE AccountId IN (${l}) AND Territory2Id = '${terr[0]}' AND IsActive = true ORDER BY LastModifiedDate DESC`),
    q((l) => `SELECT AccountId, ProratedOverallGoal FROM ProviderActivityGoal WHERE AccountId IN (${l}) ORDER BY LastModifiedDate DESC`),
    query(`SELECT DownloadStart FROM DeviceSyncSummary WHERE OwnerId = '${ctx.userId}' AND Type = 'data' AND DownloadEnd != null ORDER BY DownloadStart DESC LIMIT 1`, ctx.org).catch(() => [] as Row[]),
  ]);
  const first = (rows: Row[], key: string) => {
    const m = new Map<string, Row>();
    for (const r of rows) if (!m.has(str(r[key]))) m.set(str(r[key]), r);
    return m;
  };
  const spec = first(specs, "AccountId");
  const addr = first(addrs, "ParentId");
  const pati = first(patis, "AccountId");
  const goal = first(goals, "AccountId");
  const sorted = sortNbc(
    top.map((r) => ({ r, score: str(r.TerritoryId) === terr[0] && r.TotalScore != null ? Number(r.TotalScore) : null, rank: Number(r.Rank ?? 0), name: str((r.Account as Row | undefined)?.Name) }))
  );
  const cards = sorted.map(({ r, score, name }): HomeNbcCard => {
    const id = str(r.AccountId);
    const a = addr.get(id);
    const g = goal.get(id);
    return {
      accountId: id,
      name,
      specialty: str(spec.get(id)?.Name),
      address: a ? str(a.FullAddress) || formatAddress(a) : "",
      target: pati.get(id)?.IsTargetedAccount === true,
      lastVisit: lastVisitText(pati.get(id)?.LastProviderVisitDate, ctx.format),
      score,
      insight: str(r.LSDO_Score_Summary__c),
      planProgress: g && g.ProratedOverallGoal != null ? Number(g.ProratedOverallGoal) : null,
    };
  });
  return { cards, lastRefreshed: lastRefreshedText(dateOf(sync[0]?.DownloadStart), now, ctx.format), lastRefreshedSource: LAST_REFRESHED_SOURCE };
}

/** UnsubmittedCallsDashboardViewModel + AgendaCallModel.Query.unsubmitted: the viewer's past, not-yet-submitted parent visits in the selected territory. */
async function collectVisits(ctx: ScreenContext, now: Date): Promise<PublishedHome["visits"]> {
  const terr = ctx.territories[0]?.id;
  const w = scoped(ctx, "Visit");
  if (!terr || w === null) return undefined;
  const me = ctx.userId;
  const rows = await query(
    `SELECT Id, PlannedVisitStartTime, PlannedVisitEndTime, Account.Name, PlaceId, Channel FROM Visit
     WHERE Status != 'Completed' AND TerritoryId = '${terr}' AND PlannedVisitStartTime != null
     AND (PlannedVisitEndTime = null OR PlannedVisitEndTime < ${now.toISOString().replace(/\.\d+Z$/, "Z")})
     AND (CreatedById = '${me}' OR OwnerId = '${me}') AND ParentVisitId = null${w} ORDER BY PlannedVisitStartTime ASC LIMIT 2000`,
    ctx.org
  );
  const ok = await readable(rows.map((r) => str(r.Id)), ctx);
  const shown = rows.filter((r) => ok.has(str(r.Id)));
  const places = [...new Set(shown.map((r) => str(r.PlaceId)).filter((p) => p.startsWith("8lW")))];
  const addrRows = await inBatches(places, (part) => query(`SELECT Id, Street, PostalCode, City, State, Country FROM ContactPointAddress WHERE Id IN (${inList(part)})`, ctx.org).catch(() => [] as Row[]));
  const addr = new Map(addrRows.map((r) => [str(r.Id), formatAddress(r)]));
  const kids = new Map<string, number>();
  const parentIds = shown.map((r) => str(r.Id));
  for (const r of await inBatches(parentIds, (part) => query(`SELECT ParentVisitId, COUNT(Id) n FROM Visit WHERE ParentVisitId IN (${inList(part)}) GROUP BY ParentVisitId`, ctx.org).catch(() => [] as Row[])))
    kids.set(str(r.ParentVisitId), Number(r.n ?? 0));
  const defaultMinutes = 60;
  const starts = shown.map((r) => dateOf(r.PlannedVisitStartTime) ?? now);
  const dates = visibleDates(starts.map((d) => dayKey(d, ctx.format)));
  const today = dayKey(now, ctx.format);
  const items = shown.map((r, i): HomeVisit => {
    const start = starts[i];
    const end = dateOf(r.PlannedVisitEndTime) ?? new Date(start.getTime() + defaultMinutes * 60000);
    const n = kids.get(str(r.Id)) ?? 0;
    return {
      id: str(r.Id),
      dateLabel: !dates[i] ? "" : dayKey(start, ctx.format) === today ? "Today" : fmt(start, ctx.format, { month: "long", day: "numeric", year: "numeric" }),
      time: visitTimeText(start, end, ctx.format),
      account: str((r.Account as Row | undefined)?.Name),
      address: addr.get(str(r.PlaceId)) ?? "--",
      channel: str(r.Channel),
      attendees: n > 1 ? `${n} Attendees` : "",
    };
  });
  return { total: items.length, items };
}

/** ActivityPlanProductsCoordinator: the active, unexpired plan cycle of the viewer's territory, and the picker's first activity type. */
async function collectPlan(ctx: ScreenContext, now: Date): Promise<PublishedHome["plan"]> {
  const terr = ctx.territories[0]?.id;
  if (!terr) return undefined;
  const [plans, types] = await Promise.all([
    query(
      `SELECT ActivityPlan.TimePeriod.StartDate, ActivityPlan.TimePeriod.EndDate FROM ActivityPlanTerritory
       WHERE TerritoryId = '${terr}' AND ActivityPlan.IsActive = true AND ActivityPlan.Type = 'AccountGoal'`,
      ctx.org
    ).catch(() => [] as Row[]),
    query("SELECT MasterLabel, DisplayOrder FROM ProviderActivityMeasureType WHERE IsActive = true", ctx.org).catch(() => [] as Row[]),
  ]);
  const out: NonNullable<PublishedHome["plan"]> = {};
  for (const p of plans) {
    const tp = (p.ActivityPlan as Row | undefined)?.TimePeriod as Row | undefined;
    const start = dateOf(tp?.StartDate);
    const end = dateOf(tp?.EndDate);
    if (start && end && end.getTime() > now.getTime()) {
      out.cycle = cycleText(start, end, now, ctx.format);
      out.axis = paceAxis(start, end, now, ctx.format);
      break;
    }
  }
  out.activityType = firstActivityType(types.map((t) => ({ label: str(t.MasterLabel), order: Number(t.DisplayOrder ?? 0) })));
  return out;
}

export async function collectHome(ctx: ScreenContext): Promise<PublishedHome | undefined> {
  const now = new Date();
  const [nbc, visits, plan] = await Promise.all([collectNbc(ctx, now).catch(() => undefined), collectVisits(ctx, now).catch(() => undefined), collectPlan(ctx, now).catch(() => undefined)]);
  return nbc || visits || plan ? { nbc, visits, plan } : undefined;
}
