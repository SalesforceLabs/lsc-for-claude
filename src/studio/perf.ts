/**
 * Studio "Testing → Performance": runs an NFR assessment (src/perf) as a
 * background job the GUI polls, and finds representative users to test.
 *
 * Jobs live in the MCP server process's memory — the Electron app keeps the
 * finished result in its own run history, so nothing here needs to persist.
 * Every query a run issues is read-only.
 */

import { cachedDescribeSObject, runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import { runAssessment, type AssessmentResult } from "../perf/assessment.js";
import type { NfrProfile } from "../perf/nfr.js";
import type { OrgQuerier } from "../perf/sync-volume.js";
import { query } from "./helpers.js";

export type PerfJobState = "running" | "done" | "failed" | "cancelled";

export interface PerfJobStatus {
  jobId: string;
  org: string;
  state: PerfJobState;
  startedAt: string;
  finishedAt?: string;
  /** The step in progress, e.g. "Rep (1/2): Counting 41 tables for rep@x in T-01". */
  step: string;
  /** Org queries issued so far — a heartbeat for long table counts. */
  queries: number;
  result?: AssessmentResult;
  error?: string;
}

export interface PerfDeps {
  querier: (org: string) => OrgQuerier;
  telemetryFields: (org: string) => () => Promise<Set<string>>;
}

const defaultDeps: PerfDeps = {
  querier: (org) => ({
    soql: (q) => runSoqlQuery(q, org),
    tooling: (q) => runToolingQuery(q, org),
  }),
  telemetryFields: (org) => async () => {
    const result = await cachedDescribeSObject("DeviceSyncSummary", org);
    return new Set(result.success ? (result.data?.fields ?? []).map((f) => f.name) : []);
  },
};

interface PerfJob extends PerfJobStatus {
  cancelled: boolean;
}

/** Finished jobs kept for polling; the oldest are dropped beyond this. */
const MAX_FINISHED_JOBS = 10;
const jobs = new Map<string, PerfJob>();

class CancelledError extends Error {
  constructor() {
    super("Run cancelled");
  }
}

function snapshot(job: PerfJob): PerfJobStatus {
  const { cancelled: _cancelled, ...status } = job;
  return { ...status };
}

function pruneFinished() {
  const finished = [...jobs.values()].filter((j) => j.state !== "running");
  for (const job of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_JOBS))) jobs.delete(job.jobId);
}

/** Wrap a querier so the job counts queries and stops issuing them once cancelled. */
function tracked(inner: OrgQuerier, job: PerfJob): OrgQuerier {
  const guard = () => {
    if (job.cancelled) throw new CancelledError();
  };
  const wrap =
    (fn: OrgQuerier["soql"]): OrgQuerier["soql"] =>
    async (q) => {
      guard();
      job.queries++;
      const result = await fn(q);
      guard();
      return result;
    };
  return { soql: wrap((q) => inner.soql(q)), tooling: wrap((q) => inner.tooling(q)) };
}

export function startPerfRun(
  profile: NfrProfile,
  org: string,
  deps: PerfDeps = defaultDeps
): PerfJobStatus {
  if (!profile.personas.length) throw new Error("Add at least one persona to the test plan.");
  if ([...jobs.values()].some((j) => j.state === "running" && j.org === org)) {
    throw new Error("A performance run is already in progress for this org.");
  }

  const job: PerfJob = {
    jobId: `perf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    org,
    state: "running",
    startedAt: new Date().toISOString(),
    step: "Starting",
    queries: 0,
    cancelled: false,
  };
  jobs.set(job.jobId, job);

  // Studio counts as the connected org user; each persona's own DB Schema filters scope the counts to that persona.
  const querier = tracked(deps.querier(org), job);

  runAssessment(profile, org, querier, querier, deps.telemetryFields(org), {
    onStep: (step) => {
      job.step = step;
    },
  })
    .then((result) => {
      if (job.cancelled) {
        job.state = "cancelled";
      } else {
        job.state = "done";
        job.result = result;
      }
    })
    .catch((err) => {
      job.state = job.cancelled ? "cancelled" : "failed";
      if (!job.cancelled) job.error = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      job.step = job.state === "done" ? "Finished" : job.state === "cancelled" ? "Cancelled" : "Failed";
      pruneFinished();
    });

  return snapshot(job);
}

export function perfRunStatus(jobId: string): PerfJobStatus {
  const job = jobs.get(jobId);
  if (!job) throw new Error("This performance run is no longer available (the engine may have restarted).");
  return snapshot(job);
}

export function cancelPerfRun(jobId: string): PerfJobStatus {
  const job = jobs.get(jobId);
  if (!job) throw new Error("This performance run is no longer available.");
  if (job.state === "running") {
    job.cancelled = true;
    job.step = "Cancelling…";
  }
  return snapshot(job);
}

// ---------------------------------------------------------------------------
// User search
// ---------------------------------------------------------------------------

export interface PerfUser {
  id: string;
  username: string;
  name: string;
  profile: string;
  /** Territories in the active territory model. */
  territories: number;
}

function likeValue(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Active standard users matching a name/username search and/or a profile,
 * most-territories first — the heaviest users are the ones worth testing.
 */
export async function searchPerfUsers(
  filters: { search?: string; profile?: string },
  org: string
): Promise<PerfUser[]> {
  const where = ["IsActive = true", "UserType = 'Standard'"];
  const search = filters.search?.trim();
  if (search) {
    const v = likeValue(search);
    where.push(`(Name LIKE '%${v}%' OR Username LIKE '%${v}%')`);
  }
  if (filters.profile) where.push(`Profile.Name = '${filters.profile.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);

  const users = await query(
    `SELECT Id, Username, Name, Profile.Name FROM User WHERE ${where.join(" AND ")} ORDER BY Name LIMIT 200`,
    org
  );
  if (users.length === 0) return [];

  const ids = users.map((u) => `'${String(u.Id)}'`).join(",");
  const counts = await query(
    `SELECT UserId, COUNT(Id) cnt FROM UserTerritory2Association WHERE UserId IN (${ids}) AND Territory2.Territory2Model.State = 'Active' GROUP BY UserId`,
    org
  );
  const byUser = new Map(counts.map((r) => [String(r.UserId), Number(r.cnt ?? r.expr0 ?? 0)]));

  return users
    .map((u) => ({
      id: String(u.Id),
      username: String(u.Username),
      name: String(u.Name),
      profile: String((u.Profile as { Name?: string } | null)?.Name ?? ""),
      territories: byUser.get(String(u.Id)) ?? 0,
    }))
    .sort((a, b) => b.territories - a.territories || a.name.localeCompare(b.name))
    .slice(0, 50);
}
