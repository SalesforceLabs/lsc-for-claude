/**
 * Studio "Testing → Sync health": org-wide sync health from field telemetry
 * (DeviceSyncSummary) and the users most at risk, with no test plan needed.
 * Read-only, and a fixed handful of aggregate queries however many reps there are.
 */

import { z } from "zod";
import { cachedDescribeSObject, runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import { DEFAULT_TELEMETRY_DAYS } from "../perf/nfr.js";
import { loadDbSchemaEntries, type OrgQuerier } from "../perf/sync-volume.js";
import { attachmentsOn } from "../perf/table-hints.js";
import { buildTelemetryQuery, summarize, toSyncSample, type SyncSample, type TelemetrySummary } from "../perf/telemetry.js";
import {
  dailyTrend,
  mergeDaily,
  totalsFromAggregates,
  type DayAggregate,
  orgVerdict,
  rankUsersAtRisk,
  schemaRisks,
  territoryReason,
  type AtRiskUser,
  type DailyPoint,
  type OverviewVerdict,
  type SchemaRisk,
} from "../perf/overview.js";

export const syncOverviewInput = {
  days: z.number().int().min(1).max(365).optional(),
};

export interface SyncOverviewUser extends AtRiskUser {
  /** Null when the username couldn't be matched to a user (for example a deleted one). */
  userId: string | null;
  name: string;
  profile: string;
  /** Territories in the active model. */
  territories: number;
}

export interface SyncOverviewResult {
  days: number;
  telemetry: TelemetrySummary | null;
  verdict: OverviewVerdict | null;
  /** Reps with at least one sync in the window. */
  reps: number;
  /** Reps scoring high enough to need attention. */
  needAttention: number;
  daily: DailyPoint[];
  /** Whole-window counts from aggregate queries; null when they couldn't run. */
  totals: { syncs: number; failed: number; failureRatePct: number | undefined } | null;
  /** The rows behind per-rep numbers and percentiles: how many, from which day, and whether the window was cut. */
  rowsCoverage: { rows: number; from: string | null; truncated: boolean } | null;
  usersAtRisk: SyncOverviewUser[];
  schemaRisks: SchemaRisk[];
  notes: string[];
}

export interface SyncOverviewDeps {
  querier: (org: string) => OrgQuerier;
  telemetryFields: (org: string) => () => Promise<Set<string>>;
}

const defaultDeps: SyncOverviewDeps = {
  querier: (org) => ({
    soql: (q, options) => runSoqlQuery(q, org, options),
    tooling: (q) => runToolingQuery(q, org),
  }),
  telemetryFields: (org) => async () => {
    const result = await cachedDescribeSObject("DeviceSyncSummary", org);
    return new Set(result.success ? (result.data?.fields ?? []).map((f) => f.name) : []);
  },
};

type Row = Record<string, unknown>;

/** Rows read from DeviceSyncSummary; a window with more syncs than this is cut at the newest. */
const TELEMETRY_LIMIT = 10000;
const MAX_AT_RISK = 25;

const soqlString = (v: string) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const inList = (values: string[]) => values.map((v) => `'${soqlString(v)}'`).join(",");
const idKey = (id: string) => id.slice(0, 15);

async function rows(org: OrgQuerier, soql: string): Promise<Row[]> {
  const result = await org.soql(soql);
  if (!result.success) throw new Error(result.error || "Query failed");
  return (result.data?.records ?? []) as Row[];
}

async function loadSamples(
  org: OrgQuerier,
  fields: Set<string>,
  days: number
): Promise<{ samples: SyncSample[]; rows: number; truncated: boolean }> {
  const result = await org.soql(buildTelemetryQuery(fields, { days, limit: TELEMETRY_LIMIT }));
  if (!result.success) throw new Error(result.error || "DeviceSyncSummary query failed");
  const records = result.data?.records ?? [];
  return {
    samples: records.map((r) => toSyncSample(r)).filter((s): s is SyncSample => s !== null),
    rows: records.length,
    truncated: records.length >= TELEMETRY_LIMIT || result.data?.truncated === true,
  };
}

/** Syncs per day and outcome over the whole window, so the trend and totals don't depend on the row cap. */
async function loadAggregates(org: OrgQuerier, fields: Set<string>, days: number): Promise<DayAggregate[] | null> {
  const has = (f: string) => [...fields].some((x) => x.toLowerCase() === f.toLowerCase());
  const status = has("CompletionStatus");
  const where = [`CreatedDate = LAST_N_DAYS:${Math.max(1, Math.floor(days))}`, ...(has("Type") ? [`Type != 'clm'`] : [])];
  const select = `SELECT DAY_ONLY(CreatedDate) d${status ? ", CompletionStatus st" : ""}, COUNT(Id) c FROM DeviceSyncSummary WHERE ${where.join(" AND ")} GROUP BY DAY_ONLY(CreatedDate)${status ? ", CompletionStatus" : ""}`;
  const toAgg = (r: Record<string, unknown>, st: string): DayAggregate => ({ day: String(r.d), status: st, count: Number(r.c ?? r.expr0 ?? 0) });
  try {
    const all = await rows(org, select);
    if (status || !has("IsDownloadCompleted") || !has("DownloadStart")) {
      return all.map((r) => toAgg(r, String(r.st ?? "")));
    }
    // No CompletionStatus here: read the outcome the way the per-sync rows do (syncOutcome) — a sync that
    // reached the download step either finished it or failed; the rest stopped before downloading.
    const reached = await rows(
      org,
      `SELECT DAY_ONLY(CreatedDate) d, IsDownloadCompleted ok, COUNT(Id) c FROM DeviceSyncSummary WHERE ${where.join(" AND ")} AND DownloadStart != null GROUP BY DAY_ONLY(CreatedDate), IsDownloadCompleted`
    );
    const out: DayAggregate[] = reached.map((r) => toAgg(r, r.ok === false ? "Failed" : "Finished"));
    const reachedByDay = new Map<string, number>();
    for (const a of out) reachedByDay.set(a.day, (reachedByDay.get(a.day) ?? 0) + a.count);
    for (const r of all) {
      const left = Number(r.c ?? r.expr0 ?? 0) - (reachedByDay.get(String(r.d)) ?? 0);
      if (left > 0) out.push({ day: String(r.d), status: "Stopped early", count: left });
    }
    return out;
  } catch {
    return null;
  }
}

/** Name, profile and active-model territory count for the ranked usernames: two queries however many. */
async function joinUsers(org: OrgQuerier, ranked: AtRiskUser[]): Promise<SyncOverviewUser[]> {
  if (ranked.length === 0) return [];
  const users = await rows(org, `SELECT Id, Username, Name, Profile.Name FROM User WHERE Username IN (${inList(ranked.map((u) => u.username))})`);
  const byName = new Map(users.map((u) => [String(u.Username).toLowerCase(), u]));
  const ids = users.map((u) => String(u.Id));
  const counts = new Map<string, number>();
  if (ids.length) {
    const grouped = await rows(
      org,
      `SELECT UserId, COUNT(Id) cnt FROM UserTerritory2Association WHERE UserId IN (${inList(ids)}) AND Territory2.Territory2Model.State = 'Active' GROUP BY UserId`
    );
    for (const r of grouped) counts.set(idKey(String(r.UserId)), Number(r.cnt ?? r.expr0 ?? 0));
  }
  return ranked.map((u) => {
    const row = byName.get(u.username.toLowerCase());
    const territories = row ? (counts.get(idKey(String(row.Id))) ?? 0) : 0;
    const extra = territoryReason(territories);
    return {
      ...u,
      reasons: extra ? [...u.reasons, extra] : u.reasons,
      userId: row ? String(row.Id) : null,
      name: row ? String(row.Name) : u.username,
      profile: row ? String((row.Profile as { Name?: string } | null)?.Name ?? "") : "",
      territories,
    };
  });
}


/** Developer names of active DB Schema records with attachments turned on. */
async function attachmentRecords(org: OrgQuerier): Promise<Set<string>> {
  const category = await org.tooling(`SELECT Id FROM LifeSciConfigCategory WHERE Category = 'DbSchema' LIMIT 1`);
  const categoryId = category.data?.records?.[0]?.Id as string | undefined;
  if (!category.success || !categoryId) return new Set();
  const [records, values] = await Promise.all([
    org.tooling(`SELECT Id, DeveloperName FROM LifeSciConfigRecord WHERE LifeSciConfigCategoryId = '${categoryId}' AND IsActive = true`),
    org.tooling(`SELECT LifeSciConfigRecordId, PicklistValue FROM LifeSciConfigFieldValue WHERE FieldName = 'AttachmentsSupport' AND PicklistValue != null`),
  ]);
  if (!records.success || !values.success) return new Set();
  const on = new Set(
    (values.data?.records ?? [])
      .filter((v) => attachmentsOn(v.PicklistValue == null ? null : String(v.PicklistValue)))
      .map((v) => String(v.LifeSciConfigRecordId))
  );
  return new Set((records.data?.records ?? []).filter((r) => on.has(String(r.Id))).map((r) => String(r.DeveloperName)));
}

async function loadSchemaRisks(org: OrgQuerier, notes: string[]): Promise<SchemaRisk[]> {
  try {
    const entries = await loadDbSchemaEntries(org);
    const withAttachments = await attachmentRecords(org).catch(() => new Set<string>());
    return schemaRisks(entries, withAttachments);
  } catch (e) {
    notes.push(`Couldn't read DB Schema records: ${(e as Error).message}`);
    return [];
  }
}

export async function syncOverview(
  org: string,
  input: { days?: number },
  deps: SyncOverviewDeps = defaultDeps
): Promise<SyncOverviewResult> {
  const days = input.days ?? DEFAULT_TELEMETRY_DAYS;
  const querier = deps.querier(org);
  const notes: string[] = [];
  const result: SyncOverviewResult = {
    days,
    telemetry: null,
    verdict: null,
    reps: 0,
    needAttention: 0,
    daily: [],
    totals: null,
    rowsCoverage: null,
    usersAtRisk: [],
    schemaRisks: [],
    notes,
  };

  const risks = loadSchemaRisks(querier, notes);
  try {
    const fields = await deps.telemetryFields(org)();
    if (fields.size === 0) {
      notes.push("DeviceSyncSummary isn't available in this org, so there is no field sync data to show.");
    } else {
      const [{ samples, rows: rowCount, truncated }, aggs] = await Promise.all([
        loadSamples(querier, fields, days),
        loadAggregates(querier, fields, days),
      ]);
      const summary = summarize(samples);
      const totals = aggs && aggs.length ? totalsFromAggregates(aggs) : null;
      // The failure rate is the whole window's, not just the rows pulled.
      if (totals?.failureRatePct !== undefined) summary.failureRatePct = totals.failureRatePct;
      if (samples.length === 0) notes.push(`No syncs were recorded in the last ${days} days.`);
      const oldest = samples.map((s) => s.createdDate.slice(0, 10)).sort()[0] ?? null;
      result.rowsCoverage = { rows: rowCount, from: oldest, truncated };
      if (truncated) {
        notes.push(
          `This window has more than ${rowCount.toLocaleString("en-US")} syncs. Per-rep numbers and sync times cover only the most recent part, from ${oldest ?? "the latest day"} on; the daily counts and failure totals cover the whole window.`
        );
      }
      const ranking = rankUsersAtRisk(samples, summary, MAX_AT_RISK);
      result.telemetry = summary;
      result.reps = ranking.reps;
      result.needAttention = ranking.needAttention;
      result.verdict = orgVerdict(summary, ranking.reps, ranking.needAttention);
      result.daily = mergeDaily(dailyTrend(samples), aggs ?? []);
      result.totals = totals;
      try {
        result.usersAtRisk = await joinUsers(querier, ranking.ranked);
      } catch (e) {
        notes.push(`Couldn't look up names and territories: ${(e as Error).message}`);
        result.usersAtRisk = ranking.ranked.map((u) => ({ ...u, userId: null, name: u.username, profile: "", territories: 0 }));
      }
    }
  } catch (e) {
    notes.push(`Couldn't read sync telemetry: ${(e as Error).message}`);
  }
  result.schemaRisks = await risks;
  return result;
}
