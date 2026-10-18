/**
 * Field sync telemetry from DeviceSyncSummary — the record the LSC iOS app
 * uploads after every sync (OCE SyncStatistics.swift). Field semantics:
 * - SyncTrigger "Initial" marks a first sync; every other trigger is a delta.
 * - Type "clm" rows describe content downloads, not data sync, and are skipped.
 * - DownloadFreezeTime / UploadFreezeTime / MetadataDownloadDuration are ms.
 * - CompletionStatus (Finished / Cancelled / Failed) is the outcome where the
 *   org has it. Otherwise IsDownloadCompleted tells whether a sync that reached
 *   the download step finished it, and a missing DownloadStart means the sync
 *   stopped before downloading (cancelled or failed in an earlier step).
 * - ErrorCode is only ever the app's clock-skew warning (420), not a failure.
 * - SyncSummaryData is JSON; DBSize inside it is the data DB size in GB.
 *
 * Several fields were added in later app versions, so callers select only the
 * fields the org's describe reports.
 */

export const TELEMETRY_FIELDS = [
  "Id",
  "CreatedDate",
  "CreatedById",
  "SyncTrigger",
  "Type",
  "CompletionStatus",
  "IsDownloadCompleted",
  "DownloadStart",
  "DownloadEnd",
  "DownloadFreezeTime",
  "DownloadedRecords",
  "UploadStart",
  "UploadEnd",
  "UploadFreezeTime",
  "UploadRecords",
  "MetadataDownloadStart",
  "MetadataDownloadDuration",
  "MetadataUpdated",
  "SyncEndDate",
  "Network",
  "AppVersion",
  "SyncSummaryData",
] as const;

/** How a sync ended. "stopped-early": it never reached the download step. */
export type SyncOutcome = "completed" | "failed" | "cancelled" | "stopped-early";

export interface SyncSample {
  id: string;
  createdDate: string;
  user: string;
  kind: "initial" | "delta";
  outcome: SyncOutcome;
  failed: boolean;
  totalSec: number | undefined;
  downloadSec: number | undefined;
  uploadSec: number | undefined;
  metadataSec: number | undefined;
  downloadedRecords: number | undefined;
  dbSizeGb: number | undefined;
  network: string;
  appVersion: string;
}

function ms(value: unknown): number | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function spanSec(start: unknown, end: unknown, freezeMs: unknown): number | undefined {
  const s = ms(start);
  const e = ms(end);
  if (s === undefined || e === undefined || e < s) return undefined;
  return Math.max(0, (e - s - (num(freezeMs) ?? 0)) / 1000);
}

function parseSummaryData(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function syncOutcome(r: Record<string, unknown>): SyncOutcome {
  switch (r.CompletionStatus) {
    case "Finished":
      return "completed";
    case "Failed":
      return "failed";
    case "Cancelled":
      return "cancelled";
  }
  if (ms(r.DownloadStart) === undefined) return "stopped-early";
  return r.IsDownloadCompleted === false ? "failed" : "completed";
}

/** Convert one DeviceSyncSummary row; returns null for non-data rows. */
export function toSyncSample(r: Record<string, unknown>): SyncSample | null {
  if (typeof r.Type === "string" && r.Type.toLowerCase() === "clm") return null;

  const createdBy = r.CreatedBy as Record<string, unknown> | null | undefined;
  const outcome = syncOutcome(r);

  const starts = [r.UploadStart, r.MetadataDownloadStart, r.DownloadStart]
    .map(ms)
    .filter((v): v is number => v !== undefined);
  const end = ms(r.SyncEndDate) ?? ms(r.DownloadEnd);
  const freeze = (num(r.DownloadFreezeTime) ?? 0) + (num(r.UploadFreezeTime) ?? 0);
  const totalSec =
    starts.length > 0 && end !== undefined && end >= Math.min(...starts)
      ? Math.max(0, (end - Math.min(...starts) - freeze) / 1000)
      : undefined;

  const metadataMs = num(r.MetadataDownloadDuration);
  const summary = parseSummaryData(r.SyncSummaryData);

  return {
    id: r.Id as string,
    createdDate: r.CreatedDate as string,
    user: (createdBy?.Username as string) || (r.CreatedById as string) || "",
    kind: r.SyncTrigger === "Initial" ? "initial" : "delta",
    outcome,
    failed: outcome === "failed",
    totalSec,
    downloadSec: spanSec(r.DownloadStart, r.DownloadEnd, r.DownloadFreezeTime),
    uploadSec: spanSec(r.UploadStart, r.UploadEnd, r.UploadFreezeTime),
    metadataSec: metadataMs !== undefined && metadataMs >= 0 ? metadataMs / 1000 : undefined,
    downloadedRecords: num(r.DownloadedRecords),
    dbSizeGb: num(summary.DBSize),
    network: (r.Network as string) || "unknown",
    appVersion: (r.AppVersion as string) || "unknown",
  };
}

/** Nearest-rank percentile; undefined for an empty list. */
export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export interface Distribution {
  n: number;
  p50: number | undefined;
  p90: number | undefined;
  p95: number | undefined;
  max: number | undefined;
}

export function distribution(values: Array<number | undefined>): Distribution {
  const v = values.filter((x): x is number => x !== undefined);
  return {
    n: v.length,
    p50: percentile(v, 50),
    p90: percentile(v, 90),
    p95: percentile(v, 95),
    max: v.length ? Math.max(...v) : undefined,
  };
}

export interface TelemetrySummary {
  samples: number;
  outcomes: Record<SyncOutcome, number>;
  /** Failed downloads as a share of syncs that finished or failed; cancelled and stopped-early syncs are left out. */
  failureRatePct: number | undefined;
  initial: { total: Distribution; download: Distribution; records: Distribution };
  delta: { total: Distribution; download: Distribution; upload: Distribution };
  metadataDownload: Distribution;
  dbSizeGb: Distribution;
  byNetwork: Array<{ key: string; n: number; deltaP95: number | undefined }>;
  byAppVersion: Array<{ key: string; n: number; deltaP95: number | undefined; failureRatePct: number }>;
  slowest: SyncSample[];
  /** How much of the window the samples cover; set by loadTelemetry. */
  coverage?: TelemetryCoverage;
}

/**
 * Which syncs were read. "all": every sync in the window. "sampled": the window
 * held more syncs than the row cap, so the newest few from each slice of it were
 * read — percentiles then describe a sample spread across the window.
 */
export interface TelemetryCoverage {
  mode: "all" | "sampled";
  /** Row cap that applied to one query. */
  limit: number;
  /** Days in one slice of the window when sampled. */
  sliceDays?: number;
  /** Oldest and newest sync read (CreatedDate). */
  oldest?: string;
  newest?: string;
}

function groupBy(samples: SyncSample[], key: (s: SyncSample) => string): Map<string, SyncSample[]> {
  const groups = new Map<string, SyncSample[]>();
  for (const s of samples) {
    const k = key(s);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return groups;
}

export function summarize(samples: SyncSample[]): TelemetrySummary {
  const ok = samples.filter((s) => s.outcome === "completed");
  const initial = ok.filter((s) => s.kind === "initial");
  const delta = ok.filter((s) => s.kind === "delta");
  const decided = (list: SyncSample[]) => list.filter((s) => s.outcome === "completed" || s.outcome === "failed");
  const failureRate = (list: SyncSample[]) => {
    const d = decided(list);
    return d.length ? (d.filter((s) => s.failed).length / d.length) * 100 : 0;
  };
  const outcomes: Record<SyncOutcome, number> = { completed: 0, failed: 0, cancelled: 0, "stopped-early": 0 };
  for (const s of samples) outcomes[s.outcome]++;

  return {
    samples: samples.length,
    outcomes,
    failureRatePct: decided(samples).length ? failureRate(samples) : undefined,
    initial: {
      total: distribution(initial.map((s) => s.totalSec)),
      download: distribution(initial.map((s) => s.downloadSec)),
      records: distribution(initial.map((s) => s.downloadedRecords)),
    },
    delta: {
      total: distribution(delta.map((s) => s.totalSec)),
      download: distribution(delta.map((s) => s.downloadSec)),
      upload: distribution(delta.map((s) => s.uploadSec)),
    },
    metadataDownload: distribution(ok.map((s) => s.metadataSec)),
    dbSizeGb: distribution(ok.map((s) => s.dbSizeGb)),
    byNetwork: [...groupBy(ok, (s) => s.network)].map(([key, list]) => ({
      key,
      n: list.length,
      deltaP95: percentile(
        list.filter((s) => s.kind === "delta" && s.totalSec !== undefined).map((s) => s.totalSec as number),
        95
      ),
    })),
    byAppVersion: [...groupBy(samples, (s) => s.appVersion)].map(([key, list]) => ({
      key,
      n: list.length,
      deltaP95: percentile(
        list
          .filter((s) => s.outcome === "completed" && s.kind === "delta" && s.totalSec !== undefined)
          .map((s) => s.totalSec as number),
        95
      ),
      failureRatePct: failureRate(list),
    })),
    slowest: [...ok]
      .filter((s) => s.totalSec !== undefined)
      .sort((a, b) => (b.totalSec as number) - (a.totalSec as number))
      .slice(0, 10),
  };
}

function soqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Rows one telemetry query reads when the caller doesn't say. */
export const TELEMETRY_ROW_LIMIT = 10000;

export interface TelemetryFilters {
  days: number;
  usernames?: string[];
  /** Users by Id — preferred over usernames, which need a join. */
  userIds?: string[];
  profileName?: string;
  limit?: number;
  /** Read only this CreatedDate span (ISO datetimes, from inclusive, to exclusive) instead of the last `days`. */
  range?: { from: string; to: string };
}

/** Build the DeviceSyncSummary query, selecting only fields the org exposes. */
export function buildTelemetryQuery(availableFields: Set<string>, filters: TelemetryFilters): string {
  const lower = new Set([...availableFields].map((f) => f.toLowerCase()));
  const fields = TELEMETRY_FIELDS.filter((f) => lower.has(f.toLowerCase()));
  const where = [
    filters.range
      ? `CreatedDate >= ${filters.range.from} AND CreatedDate < ${filters.range.to}`
      : `CreatedDate = LAST_N_DAYS:${Math.max(1, Math.floor(filters.days))}`,
  ];
  if (filters.userIds?.length) {
    where.push(`CreatedById IN (${filters.userIds.map((u) => `'${soqlString(u)}'`).join(",")})`);
  } else if (filters.usernames?.length) {
    where.push(
      `CreatedBy.Username IN (${filters.usernames.map((u) => `'${soqlString(u)}'`).join(",")})`
    );
  }
  if (filters.profileName) {
    where.push(`CreatedBy.Profile.Name = '${soqlString(filters.profileName)}'`);
  }
  return `SELECT ${[...fields, "CreatedBy.Username"].join(", ")} FROM DeviceSyncSummary WHERE ${where.join(
    " AND "
  )} ORDER BY CreatedDate DESC LIMIT ${filters.limit ?? TELEMETRY_ROW_LIMIT}`;
}
