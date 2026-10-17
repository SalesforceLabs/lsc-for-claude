/** Tableau Followed Metrics (LSCTableauViewController) — what the viewer's iPad shows. */

import { apiRequest } from "../../salesforce/cli.js";
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
}

export interface PublishedTableau {
  metrics: PublishedTableauMetric[];
  /** False when the insights bundle couldn't be fetched, so every BAN is "-". */
  valuesLoaded: boolean;
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
  const data = await get(ctx.org, `/services/data/v66.0/tableau/follow/followers/${ctx.userId}/followed-assets?followedAssetType=SemanticSubMetric`);
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

export async function collectTableau(ctx: ScreenContext): Promise<PublishedTableau | undefined> {
  const follows = await loadFollows(ctx);
  if (!follows.length) return { metrics: [], valuesLoaded: true };

  const subs = ((await get(ctx.org, `/services/data/v66.0/ssot/semantic/sub-metrics/${follows.map((f) => f.id).join(",")}`))?.items ?? []) as Row[];
  const subById = new Map(subs.map((s) => [String(s.id), s]));

  const modelNames = new Map<string, string>();
  for (const id of new Set(follows.map((f) => f.modelId).filter(Boolean))) {
    const m = await get(ctx.org, `/services/data/v66.0/ssot/semantic/models/${id}`);
    if (typeof m?.apiName === "string") modelNames.set(id, m.apiName);
  }

  const jwt = await get(ctx.org, "/services/data/v62.0/sfap/lightning-jwt-service");
  const token = typeof jwt?.jwt === "string" && typeof jwt.baseUri === "string" ? { jwt: jwt.jwt, baseUri: jwt.baseUri } : undefined;

  const metrics: PublishedTableauMetric[] = [];
  let loaded = !!token;
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
    const model = modelNames.get(f.modelId);
    if (token && model) {
      // createBundleRequestV2 (mobile.export.js): the followed time range, not the sub-metric's own.
      bundle = await fetchBundle(token, {
        input: {
          type: "BASIC",
          submetric: { definition: { metric: metric.apiName, filters } },
          timeRange: allTime ? undefined : f.followedTimeRange,
          semantic_model: model,
        },
        config: {},
        options: { outputFormat: "HTML", timeZone: ctx.format.timeZone },
      });
    }
    if (!bundle) loaded = false;
    metrics.push({
      id: f.id,
      name: String(metric.label ?? f.label),
      ban: parseBan(bundle),
      popc: bundle ? parsePopc(bundle, allTime) : { comparison: allTime ? EMPTY_ALL_TIME_COMPARISON : NO_VALUE },
      description: describeTimeRange(f.followedTimeRange),
    });
  }
  // Device order is alphabetical by metric name (observed; the SDK view models don't sort).
  metrics.sort((a, b) => a.name.localeCompare(b.name));
  return { metrics, valuesLoaded: loaded };
}
