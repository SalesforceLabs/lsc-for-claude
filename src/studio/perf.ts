/**
 * Studio "Testing → Performance": runs an NFR assessment (src/perf) as a
 * background job the GUI polls, and finds representative users to test.
 *
 * Jobs live in the MCP server process's memory — the Electron app keeps the
 * finished result in its own run history, so nothing here needs to persist.
 * Every query a run issues is read-only.
 */

import { cachedDescribeSObject, runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import { runAssessment, type AssessmentResult, type StepProgress } from "../perf/assessment.js";
import { DEFAULT_TELEMETRY_DAYS, type NfrProfile, type Persona } from "../perf/nfr.js";
import type { OrgQuerier } from "../perf/sync-volume.js";
import { createCompiledSchemaSource, type CompiledSchemaSource } from "../perf/compiled-schema.js";
import { createDeviceSession } from "../perf/device/session.js";
import { checkPlan, findHeaviestUsers, personaTerritories, type PerfUser, type PlanCheck } from "../perf/users.js";

export type { PerfUser, PlanCheck } from "../perf/users.js";

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
  /** Persona and user positions (1-based) and tables counted in the current territory pass. */
  progress?: StepProgress;
  result?: AssessmentResult;
  error?: string;
}

export interface PerfDeps {
  querier: (org: string) => OrgQuerier;
  telemetryFields: (org: string) => () => Promise<Set<string>>;
  /** Table lists from the compiled metadata archive; without it every user falls back to DB Schema records. */
  compiledSchema?: (org: string, querier: OrgQuerier) => CompiledSchemaSource;
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
  compiledSchema: (org, querier) => createCompiledSchemaSource({ org: querier, getSession: () => createDeviceSession(org) }),
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
  const { cancelled: _cancelled, progress, ...status } = job;
  return progress ? { ...status, progress: { ...progress } } : { ...status };
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
    onStep: (step, progress) => {
      job.step = step;
      if (progress) job.progress = progress;
    },
    compiledSchema: deps.compiledSchema?.(org, querier),
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

/** The run in progress for an org, so a GUI that lost track of it can reattach. */
export function activePerfRun(org: string): PerfJobStatus | null {
  const job = [...jobs.values()].find((j) => j.state === "running" && j.org === org);
  return job ? snapshot(job) : null;
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
// Users
// ---------------------------------------------------------------------------

/**
 * Active standard users matching a name/username search and/or a profile,
 * most-territories first — the heaviest users are the ones worth testing —
 * with their sync counts over the last `days` days.
 */
export async function searchPerfUsers(
  filters: { search?: string; profile?: string; days?: number },
  org: string,
  deps: PerfDeps = defaultDeps
): Promise<PerfUser[]> {
  return findHeaviestUsers(deps.querier(org), { ...filters, days: filters.days ?? DEFAULT_TELEMETRY_DAYS, limit: 50 });
}

/** Pre-flight check of a plan's users, selections, and territories. */
export async function checkPerfPlan(profile: NfrProfile, org: string, deps: PerfDeps = defaultDeps): Promise<PlanCheck> {
  return checkPlan(deps.querier(org), org, profile);
}

/** Territories a persona's users are in, for picking the persona's territory. */
export async function perfTerritories(
  persona: Pick<Persona, "users" | "select">,
  org: string,
  deps: PerfDeps = defaultDeps
): Promise<Array<{ id: string; name: string; users: number }>> {
  return personaTerritories(deps.querier(org), persona);
}
