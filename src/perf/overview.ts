/**
 * Pure helpers behind Studio's Testing → Sync health: the org verdict, the
 * daily trend, the users most at risk (a simple, explainable score) and the
 * DB Schema settings worth a look. No org access here.
 */

import {
  DEFAULT_THRESHOLDS,
  evaluateMetric,
  type MetricEvaluation,
  type Thresholds,
} from "./nfr.js";
import { distribution, percentile, type SyncSample, type TelemetrySummary } from "./telemetry.js";
import type { DbSchemaEntry } from "./sync-volume.js";

/**
 * Rules of thumb for a customer with no NFR document. Only the metadata
 * download target has a published source (DEFAULT_THRESHOLDS); the failure
 * rate bounds are Studio's own and are labelled as such in the UI.
 */
export const OVERVIEW_THRESHOLDS: Thresholds = {
  ...DEFAULT_THRESHOLDS,
  syncFailureRatePct: { warn: 2, fail: 10 },
};

export type OverviewStatus = "healthy" | "struggling" | "failing" | "no-data";

export interface OverviewVerdict {
  status: OverviewStatus;
  headline: string;
  evaluations: MetricEvaluation[];
}

/** Share of reps flagged as at risk above which the org counts as struggling. */
const STRUGGLING_SHARE = 0.1;
/** A score at or above this marks a rep as needing attention. */
export const ATTENTION_SCORE = 20;

export function evaluateOrg(
  summary: TelemetrySummary,
  thresholds: Thresholds = OVERVIEW_THRESHOLDS
): MetricEvaluation[] {
  return [
    evaluateMetric("deltaSyncP95Sec", summary.delta.total.p95, thresholds.deltaSyncP95Sec),
    evaluateMetric("initialSyncP95Sec", summary.initial.total.p95, thresholds.initialSyncP95Sec),
    evaluateMetric(
      "metadataDownloadP95Sec",
      summary.metadataDownload.p95,
      thresholds.metadataDownloadP95Sec
    ),
    evaluateMetric("syncFailureRatePct", summary.failureRatePct, thresholds.syncFailureRatePct),
    evaluateMetric("dbSizeP95Gb", summary.dbSizeGb.p95, thresholds.dbSizeP95Gb),
  ];
}

const HEADLINE_NAME: Partial<Record<string, string>> = {
  deltaSyncP95Sec: "update sync time",
  initialSyncP95Sec: "first sync time",
  metadataDownloadP95Sec: "app setup download time",
  syncFailureRatePct: "the share of failed syncs",
  dbSizeP95Gb: "device database size",
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function orgVerdict(
  summary: TelemetrySummary,
  reps: number,
  needAttention: number
): OverviewVerdict {
  const evaluations = evaluateOrg(summary);
  if (summary.samples === 0)
    return { status: "no-data", headline: "No sync data yet", evaluations };
  const named = (status: "fail" | "warn") =>
    evaluations
      .filter((e) => e.status === status)
      .map((e) => HEADLINE_NAME[e.metric] ?? e.metric)
      .join(" and ");
  const failing = named("fail");
  if (failing)
    return { status: "failing", headline: `${capitalize(failing)} beyond the limit`, evaluations };
  const share = reps > 0 ? needAttention / reps : 0;
  const warning = named("warn");
  if (warning)
    return {
      status: "struggling",
      headline: `${capitalize(warning)} close to the limit`,
      evaluations,
    };
  if (share >= STRUGGLING_SHARE)
    return { status: "struggling", headline: "Some reps are struggling", evaluations };
  return { status: "healthy", headline: "Sync looks healthy", evaluations };
}

export interface DailyPoint {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  syncs: number;
  failures: number;
  initialP90: number | undefined;
  deltaP90: number | undefined;
}

/** One point per calendar day that had syncs, oldest first. */
export function dailyTrend(samples: SyncSample[]): DailyPoint[] {
  const byDay = new Map<string, SyncSample[]>();
  for (const s of samples) {
    const day = (s.createdDate || "").slice(0, 10);
    if (!day) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  const totals = (list: SyncSample[], kind: SyncSample["kind"]) =>
    list.filter((s) => s.outcome === "completed" && s.kind === kind).map((s) => s.totalSec);
  return [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => ({
      day,
      syncs: list.length,
      failures: list.filter((s) => s.failed).length,
      initialP90: distribution(totals(list, "initial")).p90,
      deltaP90: distribution(totals(list, "delta")).p90,
    }));
}

export interface DayAggregate {
  day: string;
  status: string;
  count: number;
}

/** Org-wide counts over the whole window, from GROUP BY day and status rows. */
export function totalsFromAggregates(aggs: DayAggregate[]): {
  syncs: number;
  failed: number;
  failureRatePct: number | undefined;
} {
  const syncs = aggs.reduce((n, a) => n + a.count, 0);
  const failed = aggs.filter((a) => a.status === "Failed").reduce((n, a) => n + a.count, 0);
  const decided = aggs
    .filter((a) => a.status === "Finished" || a.status === "Failed")
    .reduce((n, a) => n + a.count, 0);
  return { syncs, failed, failureRatePct: decided ? (failed / decided) * 100 : undefined };
}

/** Daily counts from the aggregates (whole window); percentiles stay from the rows pulled. */
export function mergeDaily(fromRows: DailyPoint[], aggs: DayAggregate[]): DailyPoint[] {
  if (aggs.length === 0) return fromRows;
  const rowDays = new Map(fromRows.map((d) => [d.day, d]));
  const days = new Set(aggs.map((a) => a.day));
  return [...days].sort().map((day) => {
    const mine = aggs.filter((a) => a.day === day);
    return {
      day,
      syncs: mine.reduce((n, a) => n + a.count, 0),
      failures: mine.filter((a) => a.status === "Failed").reduce((n, a) => n + a.count, 0),
      initialP90: rowDays.get(day)?.initialP90,
      deltaP90: rowDays.get(day)?.deltaP90,
    };
  });
}

export interface AtRiskUser {
  /** Username as the telemetry records it; the caller joins name, profile and Id. */
  username: string;
  score: number;
  reasons: string[];
  syncs: number;
  failedSyncs: number;
  deltaP90Sec: number | undefined;
  initialP90Sec: number | undefined;
  maxRecords: number | undefined;
  dbSizeGb: number | undefined;
}

interface OrgBaseline {
  deltaMedian: number | undefined;
  initialMedian: number | undefined;
  recordsMedian: number | undefined;
  dbSizeMedian: number | undefined;
}

export function orgBaseline(summary: TelemetrySummary): OrgBaseline {
  return {
    deltaMedian: summary.delta.total.p50,
    initialMedian: summary.initial.total.p50,
    recordsMedian: summary.initial.records.p50,
    dbSizeMedian: summary.dbSizeGb.p50,
  };
}

const times = (n: number) => `${n.toFixed(1)}×`;
/** Ratios under this aren't worth mentioning. */
const SLOW_RATIO = 2;
/** Comparing a rep's p90 to the org needs a few syncs behind it. */
const MIN_SYNCS_FOR_RATIO = 2;
/** Syncs needed before a failure rate counts for its full weight. */
const MIN_SYNCS_FOR_RATE = 3;

/**
 * Score one rep. Points: slow delta syncs up to 30 (10 per 1× over the org
 * median, from 2×), slow first syncs up to 15 (5 per 1×), failures up to 50
 * (0.8 per % of syncs that failed, capped at 40, plus 1 per failed sync up to
 * 10; with fewer than 3 syncs and a single failure, just 5), many records up to 10 and a large device DB up to 10 (both from 2× the
 * org median). A rep scoring 0 isn't listed.
 */
export function scoreUser(username: string, samples: SyncSample[], base: OrgBaseline): AtRiskUser {
  const done = samples.filter((s) => s.outcome === "completed");
  const delta = done.filter((s) => s.kind === "delta").map((s) => s.totalSec);
  const initial = done.filter((s) => s.kind === "initial").map((s) => s.totalSec);
  const decided = samples.filter((s) => s.outcome === "completed" || s.outcome === "failed");
  const failed = decided.filter((s) => s.failed).length;
  const reasons: string[] = [];
  let score = 0;

  const deltaP90 = distribution(delta).p90;
  const deltaN = delta.filter((v) => v !== undefined).length;
  if (deltaP90 !== undefined && base.deltaMedian && deltaN >= MIN_SYNCS_FOR_RATIO) {
    const ratio = deltaP90 / base.deltaMedian;
    if (ratio >= SLOW_RATIO) {
      score += Math.min(30, 10 * (ratio - 1));
      reasons.push(`Delta syncs take ${times(ratio)} the org median`);
    }
  }

  const initialP90 = distribution(initial).p90;
  const initialN = initial.filter((v) => v !== undefined).length;
  if (initialP90 !== undefined && base.initialMedian && initialN >= MIN_SYNCS_FOR_RATIO) {
    const ratio = initialP90 / base.initialMedian;
    if (ratio >= SLOW_RATIO) {
      score += Math.min(15, 5 * (ratio - 1));
      reasons.push(`First syncs take ${times(ratio)} the org median`);
    }
  }

  // One failure out of one sync is noise: the rate term needs a few syncs or repeated failures.
  if (failed > 0) {
    if (decided.length >= MIN_SYNCS_FOR_RATE || failed >= 2) {
      score += Math.min(40, (failed / decided.length) * 100 * 0.8) + Math.min(10, failed);
    } else {
      score += 5;
    }
    reasons.push(`${failed} of ${decided.length} syncs failed`);
  }

  const records = samples
    .map((s) => s.downloadedRecords)
    .filter((v): v is number => v !== undefined);
  const maxRecords = records.length ? Math.max(...records) : undefined;
  if (
    maxRecords !== undefined &&
    base.recordsMedian &&
    maxRecords / base.recordsMedian >= SLOW_RATIO
  ) {
    const ratio = maxRecords / base.recordsMedian;
    score += Math.min(10, 5 * (ratio - 1));
    reasons.push(`Downloads ${times(ratio)} the usual number of records`);
  }

  const sizes = done.map((s) => s.dbSizeGb).filter((v): v is number => v !== undefined);
  const dbSize = percentile(sizes, 90);
  if (dbSize !== undefined && base.dbSizeMedian && dbSize / base.dbSizeMedian >= SLOW_RATIO) {
    const ratio = dbSize / base.dbSizeMedian;
    score += Math.min(10, 5 * (ratio - 1));
    reasons.push(`Device database is ${times(ratio)} the org median (${dbSize.toFixed(2)} GB)`);
  }

  return {
    username,
    score: Math.round(score),
    reasons,
    syncs: samples.length,
    failedSyncs: failed,
    deltaP90Sec: deltaP90,
    initialP90Sec: initialP90,
    maxRecords,
    dbSizeGb: dbSize,
  };
}

/** Reps with a non-zero score, highest first, up to `limit`; `all` counts everyone scored. */
export function rankUsersAtRisk(
  samples: SyncSample[],
  summary: TelemetrySummary,
  limit = 25
): { ranked: AtRiskUser[]; reps: number; needAttention: number } {
  const byUser = new Map<string, SyncSample[]>();
  for (const s of samples) {
    if (!s.user) continue;
    byUser.set(s.user, [...(byUser.get(s.user) ?? []), s]);
  }
  const base = orgBaseline(summary);
  const scored = [...byUser]
    .map(([user, list]) => scoreUser(user, list, base))
    .filter((u) => u.score > 0);
  scored.sort(
    (a, b) =>
      b.score - a.score || b.failedSyncs - a.failedSyncs || a.username.localeCompare(b.username)
  );
  return {
    ranked: scored.slice(0, limit),
    reps: byUser.size,
    needAttention: scored.filter((u) => u.score >= ATTENTION_SCORE).length,
  };
}

/** Territory count at which being in many territories is worth pointing out. */
export const MANY_TERRITORIES = 10;

export function territoryReason(count: number): string | undefined {
  return count >= MANY_TERRITORIES ? `In ${count} territories` : undefined;
}

export interface SchemaRisk {
  developerName: string;
  sobject: string;
  /** Item id on the Mobile Sync board's Synced Objects surface. */
  itemId: string;
  severity: "warning" | "info";
  title: string;
  detail: string;
}

/**
 * Objects whose records are files or carry file bodies by design (content,
 * email templates, signatures, presentations), so syncing attachments for them
 * is expected and not worth a warning.
 */
const EXPECTED_ATTACHMENT_SOBJECTS = new Set(
  [
    "CommSubConsentCmplSnpsht",
    "ContentDocument",
    "ContentDocumentLink",
    "ContentVersion",
    "DigitalSignature",
    "LifeSciEmailTemplate",
    "LifeSciEmailTmplFragment",
    "LifeSciEmailTmplRelaFrgmt",
    "LifeSciEmailTmplSnapshot",
    "LifeScienceEmail",
    "PresentationPage",
    "StaticResource",
  ].map((s) => s.toLowerCase())
);

/**
 * Cheap checks on active DB Schema records: no filter, attachments synced.
 * Filter-less rules are limited to data objects; `attachmentRecords` holds the
 * developer names that have attachments turned on. Objects in
 * EXPECTED_ATTACHMENT_SOBJECTS are not warned about for attachments.
 */
export function schemaRisks(
  entries: DbSchemaEntry[],
  attachmentRecords: Set<string> = new Set()
): SchemaRisk[] {
  const risks: SchemaRisk[] = [];
  for (const e of entries) {
    const base = {
      developerName: e.developerName,
      sobject: e.sobject,
      itemId: `DbSchema:${e.developerName}`,
    };
    if (!e.whereSoql) {
      risks.push({
        ...base,
        severity: "info",
        title: `${e.sobject} syncs with no filter`,
        detail:
          "Every record the rep can access is downloaded. A filter on high-volume objects keeps syncs short.",
      });
    }
    if (
      attachmentRecords.has(e.developerName) &&
      !EXPECTED_ATTACHMENT_SOBJECTS.has(e.sobject.toLowerCase())
    ) {
      risks.push({
        ...base,
        severity: "warning",
        title: `${e.sobject} syncs attachments`,
        detail:
          "File bodies are downloaded to the iPad along with the records, which can add a lot to sync time and device size.",
      });
    }
  }
  // Attachments first, then unfiltered objects, each alphabetical.
  return risks.sort(
    (a, b) =>
      Number(a.severity === "info") - Number(b.severity === "info") ||
      a.sobject.localeCompare(b.sobject)
  );
}
