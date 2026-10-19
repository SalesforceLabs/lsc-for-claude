/** Tableau Followed Metrics (LSCTableauViewController) — what the viewer's iPad shows. */

import { apiReadPost, apiRequest, dataPath } from "../../salesforce/cli.js";
import type { Row } from "../helpers.js";
import type { ScreenContext } from "./context.js";

/** How the comparison line reads: the relative change is bold and colored by its sign (PoPC+TableauSDK.swift). */
export interface PublishedTableauPopc {
  /** "+12.5%" — only in a full comparison. */
  relative?: string;
  tone?: "positive" | "negative" | "neutral";
  /** "(+1.2K) vs. prior month", or the "can't be compared" message. */
  comparison: string;
}

export interface PublishedTableauMetric {
  id: string;
  name: string;
  /** The big number, as the server formats it; "-" when it couldn't be read. */
  ban: string;
  /** Second line: the comparison (or why there is none). */
  popc: PublishedTableauPopc;
  /** Third line: the followed time range and the sub-metric's filters. */
  description: string;
  /** "Metric Unavailable" badge (MetricRowViewModel.isMetricUnavailable). */
  unavailable?: boolean;
  /** The detail screen's chart: the metric's time series from Data Cloud, when it can be reproduced. */
  detail?: PublishedTableauDetail;
}

export interface PublishedTableauTick {
  value: number;
  label: string;
}

/**
 * What the metric detail screen's line chart shows. The expected-range band and the trend sentences come from the
 * insights service, which answers only the mobile app's session, so they are not part of this.
 */
export interface PublishedTableauDetail {
  /** "month" draws one dot per month, "day" a line. */
  granularity: "day" | "month";
  /** [ISO date after the Activity Date shift, value as plotted (percent measures ×100)], oldest first. */
  series: [string, number][];
  startLabel: string;
  endLabel: string;
  /** The last point's value, formatted for the label beside it. */
  lastLabel: string;
  /** Axis ticks and the plotted domain (bottom padded like the device). */
  ticks: PublishedTableauTick[];
  domain: [number, number];
}

export interface PublishedTableau {
  metrics: PublishedTableauMetric[];
  /** False when the insights bundle couldn't be fetched, so every BAN is "-". */
  valuesLoaded: boolean;
  /** Where the BANs came from: the SFAP insights bundle (as the app), or the same all-time aggregate run as the connected user in Data Cloud. */
  valuesSource?: "insights" | "data-cloud" | "none";
}

// Localizable.strings (TableauEinsteinSDK).
const EMPTY_ALL_TIME_COMPARISON =
  "This metric displays data for all time, so it can’t be compared to a previous time range. Filter the metric to explore a different time range.";
const EMPTY_COMPARISON = "No comparison available.";
const ALL_TIME = "All";
const NO_VALUE = "No value";

const UNITS: Record<string, string> = {
  Day: "Day",
  Week: "Week",
  Month: "Month",
  Quarter: "Quarter",
  Year: "Year",
};

/** Label for a time range filter ("Current Month", "Last 7 Days", …); "All" for none (generateDescription in mobile.export.js). */
export function describeTimeRange(range: Row | null | undefined): string {
  const type = String(range?.timeRangeType ?? range?.operator ?? "");
  if (!type || type === "Undefined") return ALL_TIME;
  const n = range?.value ?? range?.n;
  const m = /^(This|Current|Previous|Last|Next)(Day|Week|Month|Quarter|Year)(ToDate)?s?$/.exec(type);
  if (m) {
    const [, which, unit, toDate] = m;
    const u = UNITS[unit];
    const tail = toDate ? " to Date" : "";
    if (which === "This" || which === "Current") return `Current ${u}${tail}`;
    if (which === "Previous") return `Previous ${u}${tail}`;
    if (n != null) return `${which} ${n} ${u}s`;
  }
  return type.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Compact number as `formatNumberValue` 'short' does: 2160 → "2.16K", 13390 → "13.39K". */
export function formatShort(raw: number): string {
  const abs = Math.abs(raw);
  if (abs < 1000) return fixed(raw);
  const steps: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [v, s] of steps) if (abs >= v) return `${trim(raw / v)}${s}`;
  return fixed(raw);
}

function trim(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function fixed(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A percent as the server formats it: 2000.08 → "2,000.08%". */
export function formatPercent(v: number): string {
  return `${fixed(v)}%`;
}

/** The BAN from a ban group's `popc` insight (`target_period_value.formatted`), or "-" (MetricRowViewModel.extractContent). */
export function parseBan(bundle: Row | undefined): string {
  const facts = popcFacts(bundle);
  const t = facts?.target_period_value as Row | undefined;
  if (!t || t.is_nan === true) return "-";
  if (typeof t.formatted === "string" && t.formatted) return t.formatted;
  return typeof t.raw === "number" ? formatShort(t.raw) : "-";
}

/** A Percentage measure is shown ×100 with grouping: 20.00075 → "2,000.08%" (half-up, after trimming float noise). */
export function formatPercentMeasure(v: number, decimals = 2): string {
  const scaled = Number((v * 100).toPrecision(12));
  const f = 10 ** decimals;
  const r = (Math.sign(scaled) * Math.round(Math.abs(scaled) * f)) / f;
  return `${r.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

/** BAN text for a raw aggregate: percentages in full, other numbers compact (11.6975 → "11.70", 13391 → "13.39K"). */
export function formatBanValue(v: number, dataType: string | undefined, decimals?: number): string {
  if (dataType === "Percentage") return formatPercentMeasure(v, decimals ?? 2);
  return formatShort(Number(v.toPrecision(12)));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 1, 2024" from an ISO date (the chart's axis labels). */
export function formatChartDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** An axis value: "600", "1K", "2.5K", "0.5" — whole numbers when large, trimmed decimals when small. */
export function formatAxisValue(v: number, percent: boolean): string {
  const abs = Math.abs(v);
  let text: string;
  if (abs >= 1e9) text = `${trim(v / 1e9)}B`;
  else if (abs >= 1e6) text = `${trim(v / 1e6)}M`;
  else if (abs >= 1e3) text = `${trim(v / 1e3)}K`;
  else text = String(Math.round(v * 100) / 100);
  return percent ? `${text}%` : text;
}

/** Days from `from` to `to` (both ISO dates). */
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86400000);
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** The first of the current month in `timeZone`, as ISO (DATETRUNC('month', TODAY())). */
export function firstOfThisMonth(now: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit" }).formatToParts(now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${get("year")}-${get("month")}-01`;
}

/**
 * Activity Date: `DATEADD('day', DATEDIFF('day', {MAX(date)}, DATETRUNC('month', TODAY())), date)` — the latest day moves to the
 * first of this month. Sorted oldest first; points sharing a shifted day are not merged (the rows are already grouped by day).
 */
export function shiftSeries(rows: [string, number][], firstOfMonth: string | null): [string, number][] {
  const sorted = rows.filter(([d, v]) => /^\d{4}-\d{2}-\d{2}/.test(d) && Number.isFinite(v)).map(([d, v]) => [d.slice(0, 10), v] as [string, number]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (!sorted.length || !firstOfMonth) return sorted;
  const shift = dayDiff(sorted[sorted.length - 1][0], firstOfMonth);
  return sorted.map(([d, v]) => [addDays(d, shift), v]);
}

/** One dot per month when every point falls on the 1st, else a daily line. */
export function seriesGranularity(series: [string, number][]): "day" | "month" {
  return series.length > 1 && series.every(([d]) => d.endsWith("-01")) ? "month" : "day";
}

/**
 * Y axis fitted to the device's charts. The device lets Tableau's native engine pick the ticks (the viz spec only says
 * range Auto + includeZero, ticks Auto, so the algorithm is not in the iOS repo or its JS bundle); this reproduces what was
 * measured on five metrics: start at 0 (or the minimum when negative), reach 1.25x the highest value, three steps of
 * 1/2/5 x 10^n, plus 7 for small whole-number counts (0/7/14); the bottom is padded 4.2% so the axis sits under the 0 tick.
 */
export function chartTicks(min: number, max: number, percent: boolean, countLike = false): { ticks: PublishedTableauTick[]; domain: [number, number] } {
  const lo = Math.min(0, min);
  let hi = max * 1.25;
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const candidates = (countLike && pow === 1 ? [1, 2, 5, 7, 10] : [1, 2, 5, 10]).map((m) => m * pow);
  const step = candidates.reduce((best, c) => (Math.abs(Math.log(c / raw)) < Math.abs(Math.log(best / raw)) ? c : best));
  const ticks: PublishedTableauTick[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const value = Math.round(v / step) * step;
    ticks.push({ value, label: formatAxisValue(value, percent) });
  }
  return { ticks, domain: [lo - (hi - lo) * 0.042, hi] };
}

/** The chart for a series of plotted values. */
export function buildDetail(series: [string, number][], percent: boolean, granularity: "day" | "month" = seriesGranularity(series)): PublishedTableauDetail | undefined {
  if (series.length < 2) return undefined;
  const values = series.map((p) => p[1]);
  const { ticks, domain } = chartTicks(Math.min(...values), Math.max(...values), percent, !percent && values.every(Number.isInteger) && Math.max(...values) < 100);
  return {
    granularity,
    series,
    startLabel: formatChartDate(series[0][0]),
    endLabel: formatChartDate(series[series.length - 1][0]),
    lastLabel: formatAxisValue(values[values.length - 1], percent),
    ticks,
    domain,
  };
}

function popcFacts(bundle: Row | undefined): Row | undefined {
  const groups = (bundle?.insightGroups ?? []) as Row[];
  const ban = groups.find((g) => g.type === "ban");
  const insights = (ban?.insights ?? []) as Row[];
  const popc = insights.find((i) => i.insightType === "popc") as Row | undefined;
  return (popc?.result as Row | undefined)?.facts as Row | undefined;
}

/** The comparison line (getPopc / generateTrend in mobile.export.js; PoPC.parse): bold relative change, then "(diff) vs. prior …". */
export function parsePopc(bundle: Row | undefined, allTime: boolean): PublishedTableauPopc {
  const facts = popcFacts(bundle);
  const empty = allTime ? EMPTY_ALL_TIME_COMPARISON : EMPTY_COMPARISON;
  if (!facts) return { comparison: allTime ? empty : NO_VALUE };
  const diff = facts.difference as Row | undefined;
  const cmp = facts.comparison_period_value as Row | undefined;
  const target = facts.target_period_value as Row | undefined;
  if (!diff || !cmp || !target || cmp.is_nan === true || target.is_nan === true) return { comparison: empty };
  const absolute = (diff.absolute as Row | undefined)?.formatted;
  const relative = (diff.relative as Row | undefined)?.formatted;
  if (typeof absolute !== "string" || typeof relative !== "string") return { comparison: empty };
  const direction = String(diff.direction ?? "").toLowerCase();
  const up = direction === "up" || direction === "increase";
  const down = direction === "down" || direction === "decrease";
  const period = String(facts.comparison_period_label ?? facts.comparison_type_label ?? "prior period").toLowerCase();
  return {
    relative: up && !relative.startsWith("+") ? `+${relative}` : relative,
    tone: up ? "positive" : down ? "negative" : "neutral",
    comparison: `(${absolute}) vs. ${period}`,
  };
}

interface Follow {
  id: string;
  label: string;
  modelId: string;
  followedTimeRange: Row | null;
}

async function get(org: string, path: string): Promise<Row | undefined> {
  const res = await apiRequest<Row>(path, "GET", undefined, org);
  return res.success && res.data && typeof res.data === "object" ? res.data : undefined;
}

/** The viewer's followed sub-metrics. The `followed-assets` endpoint honors the user id; `followed-asset-refs` returns the caller's own follows. */
async function loadFollows(ctx: ScreenContext): Promise<Follow[]> {
  const data = await get(ctx.adminOrg, await dataPath(ctx.adminOrg, `/tableau/follow/followers/${ctx.userId}/followed-assets?followedAssetType=SemanticSubMetric`));
  const rows = (data?.followedAssets ?? []) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label ?? ""),
    modelId: String(r.modelId ?? ""),
    followedTimeRange: (r.followedTimeRange as Row | null) ?? null,
  }));
}

/**
 * Insights bundle for one follow. The app gets a JWT from the org's SFAP service and POSTs to the insights service
 * (AnalyticsNetworkClient / InsightsRestApi); this does the same, with the token in memory only. The org runs the
 * query as the connected (admin) user, so values are computed with admin data access, not the viewer's.
 */
async function fetchBundle(jwt: { jwt: string; baseUri: string }, body: Row): Promise<Row | undefined> {
  if (!/^https:\/\/[\w.-]+(:\d+)?(\/|$)/.test(jwt.baseUri)) return undefined; // the token only goes over https
  try {
    const r = await fetch(`${jwt.baseUri.replace(/\/$/, "")}/analytics/insights/v2/bundle`, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${jwt.jwt}`,
        "x-sfdc-sourceapp": "platform",
        "x-sfdc-sourcecontext": "mobile",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return undefined;
    const json = (await r.json()) as Row;
    return ((json.bundle as Row | undefined)?.bundle as Row | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}

interface SemanticObject {
  apiName: string;
  dataObjectName: string;
  filters?: unknown[];
  semanticDimensions?: Row[];
  semanticMeasurements?: Row[];
}

const AGG: Record<string, string> = { Sum: "SUM", Average: "AVG", Min: "MIN", Max: "MAX", Count: "COUNT" };

/** Split `a, b, c` on top-level commas (outside parens and string literals). */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/**
 * A semantic calculated measure's row expression as Data Cloud SQL: `[Obj].[Field]` becomes the data object's column,
 * "text" a SQL literal, `IIF(c, a, b)` a CASE. Only single-object expressions of plain comparisons; anything else is undefined.
 */
export function expressionToSql(expr: string, objects: SemanticObject[]): { sql: string; table: string } | undefined {
  const text = expr.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
  const tables = new Set<string>();
  let ok = true;
  const walk = (e: string): string => {
    const iif = /^IIF\s*\(([\s\S]*)\)$/i.exec(e.trim());
    if (iif) {
      const a = splitArgs(iif[1]);
      if (a.length !== 3) {
        ok = false;
        return "";
      }
      return `CASE WHEN ${walk(a[0])} THEN ${walk(a[1])} ELSE ${walk(a[2])} END`;
    }
    return e
      .replace(/"([^"]*)"/g, (_m, lit: string) => `'${lit.replace(/'/g, "''")}'`)
      .replace(/\[([^\]]+)\]\.\[([^\]]+)\]/g, (_m, o: string, f: string) => {
        const obj = objects.find((x) => x.apiName === o);
        const field = [...(obj?.semanticDimensions ?? []), ...(obj?.semanticMeasurements ?? [])].find((x) => x.apiName === f);
        if (!obj || typeof field?.dataObjectFieldName !== "string") {
          ok = false;
          return "";
        }
        tables.add(obj.dataObjectName);
        return `"${field.dataObjectFieldName}"`;
      });
  };
  const sql = walk(text);
  if (!ok || tables.size !== 1 || !/^[\w\s"'.,()=<>!+\-*/%]*$/.test(sql)) return undefined;
  return { sql, table: [...tables][0] };
}

/**
 * All-time BAN for an unfiltered followed sub-metric, computed in Data Cloud (`ssot/query-sql`): the aggregate the insights
 * service evaluates for the "All" range, run with the connected user's access rather than the viewer's. Undefined when the metric isn't that simple.
 */
async function computeAllTimeBan(org: string, sub: Row, model: Row | undefined): Promise<string | undefined> {
  const metric = sub.semanticMetric as Row | undefined;
  const ref = (metric?.measurementReference as Row | undefined)?.calculatedFieldApiName;
  const agg = AGG[String(metric?.aggregationType)];
  if (!model || !agg || typeof ref !== "string") return undefined;
  const some = (arr: unknown) => Array.isArray(arr) && arr.length > 0;
  if (some(sub.filters) || some(metric?.filters) || some(model.semanticModelFilters)) return undefined;
  const calc = ((model.semanticCalculatedMeasurements ?? []) as Row[]).find((c) => c.apiName === ref);
  const objects = (model.semanticDataObjects ?? []) as SemanticObject[];
  if (!calc || typeof calc.expression !== "string" || some(calc.filters) || objects.some((o) => some(o.filters))) return undefined;
  const e = expressionToSql(calc.expression, objects);
  if (!e) return undefined;
  const res = await apiReadPost<Row>(await dataPath(org, "/ssot/query-sql"), { sql: `SELECT ${agg}(${e.sql}) AS v FROM "${e.table}"` }, org);
  const v = (res.data?.data as unknown[][] | undefined)?.[0]?.[0];
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  if (!res.success || !Number.isFinite(n)) return undefined;
  return formatBanValue(n, typeof calc.dataType === "string" ? calc.dataType : undefined, typeof calc.decimalPlace === "number" ? calc.decimalPlace : undefined);
}

/**
 * The data object column behind a metric's time dimension and whether the Activity Date shift applies: the semantic model's
 * calculated date is either a plain `[Obj].[Date]` or the shifted `DATEADD('day', DATEDIFF('day', {MAX(date)}, DATETRUNC('month', TODAY())), date)`.
 */
export function timeColumn(ref: Row | undefined, model: Row | undefined): { table: string; column: string; shifted: boolean } | undefined {
  const objects = (model?.semanticDataObjects ?? []) as SemanticObject[];
  const column = (o: string, f: string): { table: string; column: string } | undefined => {
    const obj = objects.find((x) => x.apiName === o);
    const field = (obj?.semanticDimensions ?? []).find((x) => x.apiName === f);
    return obj && typeof field?.dataObjectFieldName === "string" ? { table: obj.dataObjectName, column: field.dataObjectFieldName } : undefined;
  };
  const tf = ref?.tableFieldReference as Row | undefined;
  if (tf) {
    const c = column(String(tf.tableApiName), String(tf.fieldApiName));
    return c && { ...c, shifted: false };
  }
  const calc = ((model?.semanticCalculatedDimensions ?? []) as Row[]).find((d) => d.apiName === ref?.calculatedFieldApiName);
  if (typeof calc?.expression !== "string") return undefined;
  const text = calc.expression.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
  const plain = /^\[([^\]]+)\]\.\[([^\]]+)\]$/.exec(text);
  if (plain) {
    const c = column(plain[1], plain[2]);
    return c && { ...c, shifted: false };
  }
  const shifted = /^DATEADD\('day',\s*DATEDIFF\('day',\s*\{MAX\(\[([^\]]+)\]\.\[([^\]]+)\]\)\},\s*DATETRUNC\('month',\s*TODAY\(\)\)\),\s*\[([^\]]+)\]\.\[([^\]]+)\]\)$/.exec(text);
  if (shifted && shifted[1] === shifted[3] && shifted[2] === shifted[4]) {
    const c = column(shifted[1], shifted[2]);
    return c && { ...c, shifted: true };
  }
  return undefined;
}

/**
 * The detail chart's series for an unfiltered, all-time followed metric: the metric's aggregate per day of its time dimension,
 * from Data Cloud (`ssot/query-sql`, read-only, the connected user's access), then shifted like Activity Date.
 */
async function computeDetail(org: string, sub: Row, model: Row | undefined, timeZone: string): Promise<PublishedTableauDetail | undefined> {
  const metric = sub.semanticMetric as Row | undefined;
  const ref = (metric?.measurementReference as Row | undefined)?.calculatedFieldApiName;
  const agg = AGG[String(metric?.aggregationType)];
  if (!model || !agg || typeof ref !== "string") return undefined;
  const some = (arr: unknown) => Array.isArray(arr) && arr.length > 0;
  if (some(sub.filters) || some(metric?.filters) || some(model.semanticModelFilters)) return undefined;
  const calc = ((model.semanticCalculatedMeasurements ?? []) as Row[]).find((c) => c.apiName === ref);
  const objects = (model.semanticDataObjects ?? []) as SemanticObject[];
  if (!calc || typeof calc.expression !== "string" || some(calc.filters) || objects.some((o) => some(o.filters))) return undefined;
  const e = expressionToSql(calc.expression, objects);
  const time = timeColumn(metric?.timeDimensionReference as Row | undefined, model);
  if (!e || !time || time.table !== e.table || !/^\w+$/.test(time.column)) return undefined;
  const res = await apiReadPost<Row>(await dataPath(org, "/ssot/query-sql"), { sql: `SELECT "${time.column}" AS d, ${agg}(${e.sql}) AS v FROM "${e.table}" GROUP BY "${time.column}"` }, org);
  const rows = res.data?.data as unknown[][] | undefined;
  if (!res.success || !Array.isArray(rows)) return undefined;
  const percent = calc.dataType === "Percentage";
  const points = rows.flatMap((r): [string, number][] => {
    const n = typeof r[1] === "number" ? r[1] : typeof r[1] === "string" && r[1] !== "" ? Number(r[1]) : NaN;
    return typeof r[0] === "string" && Number.isFinite(n) ? [[r[0], percent ? Number((n * 100).toPrecision(12)) : n]] : [];
  });
  // Monthly data stays monthly after the day shift, so the dot-or-line choice is made on the stored dates.
  return buildDetail(shiftSeries(points, time.shifted ? firstOfThisMonth(new Date(), timeZone) : null), percent, seriesGranularity(shiftSeries(points, null)));
}

export async function collectTableau(ctx: ScreenContext): Promise<PublishedTableau | undefined> {
  const follows = await loadFollows(ctx);
  if (!follows.length) return { metrics: [], valuesLoaded: true };

  const subs = ((await get(ctx.adminOrg, await dataPath(ctx.adminOrg, `/ssot/semantic/sub-metrics/${follows.map((f) => f.id).join(",")}`)))?.items ?? []) as Row[];
  const subById = new Map(subs.map((s) => [String(s.id), s]));

  const models = new Map<string, Row>();
  for (const id of new Set(follows.map((f) => f.modelId).filter(Boolean))) {
    const m = await get(ctx.adminOrg, await dataPath(ctx.adminOrg, `/ssot/semantic/models/${id}`));
    if (m) models.set(id, m);
  }

  const jwt = await get(ctx.adminOrg, await dataPath(ctx.adminOrg, "/sfap/lightning-jwt-service"));
  const token = typeof jwt?.jwt === "string" && typeof jwt.baseUri === "string" ? { jwt: jwt.jwt, baseUri: jwt.baseUri } : undefined;

  const metrics: PublishedTableauMetric[] = [];
  let loaded = true;
  const sources = new Set<string>();
  for (const f of follows) {
    const sub = subById.get(f.id);
    const metric = sub?.semanticMetric as Row | undefined;
    if (!sub || !metric) {
      metrics.push({ id: f.id, name: f.label, ban: "-", popc: { comparison: NO_VALUE }, description: ALL_TIME, unavailable: true });
      continue;
    }
    const allTime = describeTimeRange(f.followedTimeRange) === ALL_TIME;
    const filters = (sub.filters ?? []) as Row[];
    let bundle: Row | undefined;
    const model = models.get(f.modelId);
    const modelName = typeof model?.apiName === "string" ? model.apiName : undefined;
    if (token && modelName) {
      // createBundleRequestV2 (mobile.export.js): the followed time range, not the sub-metric's own.
      bundle = await fetchBundle(token, {
        input: {
          type: "BASIC",
          submetric: { definition: { metric: metric.apiName, filters } },
          timeRange: allTime ? undefined : f.followedTimeRange,
          semantic_model: modelName,
        },
        config: {},
        options: { outputFormat: "HTML", timeZone: ctx.format.timeZone },
      });
    }
    let ban = parseBan(bundle);
    if (bundle) sources.add("insights");
    else if (allTime) {
      // The JWT/insights path needs the mobile app's session (the org 404s it for CLI logins), so compute the all-time aggregate directly.
      const computed = await computeAllTimeBan(ctx.adminOrg, sub, model);
      if (computed) {
        ban = computed;
        sources.add("data-cloud");
      }
    }
    if (ban === "-") loaded = false;
    const detail = allTime && !bundle ? await computeDetail(ctx.adminOrg, sub, model, ctx.format.timeZone).catch(() => undefined) : undefined;
    metrics.push({
      id: f.id,
      name: String(metric.label ?? f.label),
      ban,
      popc: bundle ? parsePopc(bundle, allTime) : { comparison: allTime ? EMPTY_ALL_TIME_COMPARISON : NO_VALUE },
      description: describeTimeRange(f.followedTimeRange),
      ...(detail ? { detail } : {}),
    });
  }
  // Device order is alphabetical by metric name (observed; the SDK view models don't sort).
  metrics.sort((a, b) => a.name.localeCompare(b.name));
  const valuesSource = sources.has("insights") ? "insights" : sources.has("data-cloud") ? "data-cloud" : "none";
  return { metrics, valuesLoaded: loaded, valuesSource };
}
