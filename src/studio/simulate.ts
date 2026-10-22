/**
 * Studio "Testing → First sync": runs simulateInitialSync (src/perf/simulate.ts)
 * as a background job the GUI polls. The simulation runs as whichever sf CLI
 * connection the user picks — an admin or an end user — and is read-only.
 *
 * Jobs live in the MCP server process's memory; the Electron app keeps finished
 * results in its own history. One simulation runs at a time: each one downloads
 * a user's whole initial sync, and two at once would skew each other's timings.
 *
 * Instead of an sf CLI connection the GUI can pass a login it made through the
 * LSC mobile app's connected app — the only kind the org's mobile sync
 * endpoints answer. The token is used for that job only and never returned.
 *
 * A job can run the simulation several times back to back (`runs`, see
 * sim-runs.ts); the result is then the median across them. Every run uses the
 * same `network` profile.
 */

import { resolveNetwork } from "../perf/device/network.js";
import { createTokenSession, type TokenLogin } from "../perf/device/session.js";
import {
  simulateInitialSync,
  type SimulateOptions,
  type SimulationResult,
} from "../perf/simulate.js";
import { aggregateRuns, clampRuns, type MultiRunResult } from "./sim-runs.js";

export type SimJobState = "running" | "done" | "failed" | "cancelled";

/** The options the GUI can set; the rest keep simulateInitialSync's defaults. */
export type SimRunOptions = Pick<
  SimulateOptions,
  | "territory"
  | "forceFlow"
  | "include"
  | "exclude"
  | "maxSeconds"
  | "maxRecordsPerTable"
  | "maxTotalRecords"
  | "delta"
  | "content"
  | "network"
  | "deviceRamGB"
  | "dynamicBatchSize"
> & {
  /** Back-to-back runs as the same login (1–5, default 1); the result reports their median and spread. */
  runs?: number;
};

export interface SimJobStatus {
  jobId: string;
  /** sf CLI alias or username the simulation runs as. */
  connection: string;
  state: SimJobState;
  startedAt: string;
  finishedAt?: string;
  step: string;
  /** Tables finished out of the total, and records downloaded so far, once the data download starts. */
  tables?: { done: number; total: number; records: number };
  result?: MultiRunResult;
  error?: string;
}

export interface SimDeps {
  simulate: (opts: SimulateOptions) => Promise<SimulationResult>;
}

const defaultDeps: SimDeps = { simulate: simulateInitialSync };

interface SimJob extends SimJobStatus {
  controller: AbortController;
}

const MAX_FINISHED_JOBS = 10;
const jobs = new Map<string, SimJob>();

function snapshot(job: SimJob): SimJobStatus {
  const { controller: _controller, tables, ...status } = job;
  return tables ? { ...status, tables: { ...tables } } : { ...status };
}

function pruneFinished() {
  const finished = [...jobs.values()].filter((j) => j.state !== "running");
  for (const job of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_JOBS)))
    jobs.delete(job.jobId);
}

export function startSimulation(
  connection: string | TokenLogin,
  options: SimRunOptions = {},
  deps: SimDeps = defaultDeps
): SimJobStatus {
  const login = typeof connection === "string" ? undefined : connection;
  const name = (login ? login.username : (connection as string)).trim();
  if (!name) throw new Error("Choose the sf CLI connection to run the simulation as.");
  resolveNetwork(options.network); // a bad custom profile fails the start, not the job
  // Built before the job exists so a bad login fails the start rather than the job.
  const session = login ? createTokenSession(login) : undefined;
  if ([...jobs.values()].some((j) => j.state === "running")) {
    throw new Error("A first-sync simulation is already in progress.");
  }

  const job: SimJob = {
    jobId: `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    connection: name,
    state: "running",
    startedAt: new Date().toISOString(),
    step: "Connecting",
    controller: new AbortController(),
  };
  jobs.set(job.jobId, job);

  const { runs: runsOption, content: contentOption, ...simOptions } = options;
  const requested = clampRuns(runsOption);
  const completed: SimulationResult[] = [];

  const runAll = async () => {
    let partial: SimulationResult | undefined;
    const extraNotes: string[] = [];
    for (let i = 1; i <= requested && !job.controller.signal.aborted; i++) {
      const prefix = requested > 1 ? `Run ${i} of ${requested} · ` : "";
      if (requested > 1) job.step = `${prefix}Connecting`;
      job.tables = undefined;
      try {
        const result = await deps.simulate({
          ...simOptions,
          // Content downloads run once, in the last run only.
          ...(contentOption && i === requested ? { content: contentOption } : {}),
          username: name,
          // The same session for every run, so a mobile login's token is read once.
          ...(session ? { session } : {}),
          signal: job.controller.signal,
          onStep: (step, tables) => {
            if (job.controller.signal.aborted) return;
            job.step = `${prefix}${step}`;
            if (tables) job.tables = tables;
          },
        });
        // A cancelled run still returns what it downloaded; it only stands alone when no run finished.
        if (job.controller.signal.aborted) partial = result;
        else completed.push(result);
      } catch (err) {
        // A later run failing keeps the earlier ones.
        if (completed.length === 0 || job.controller.signal.aborted) throw err;
        const message = err instanceof Error ? err.message : String(err);
        extraNotes.push(
          `Run ${i} of ${requested} failed (${message}); the result covers the runs before it.`
        );
        break;
      }
    }
    const results = completed.length > 0 ? completed : partial ? [partial] : [];
    if (results.length === 0) return undefined;
    const aggregate = aggregateRuns(results, completed.length > 0 ? requested : 1);
    if (aggregate.runs && partial)
      extraNotes.push("The run in progress when cancelled is left out of the medians.");
    aggregate.notes.push(...extraNotes);
    return aggregate;
  };

  runAll()
    .then((result) => {
      job.state = job.controller.signal.aborted ? "cancelled" : "done";
      job.result = result;
    })
    .catch((err) => {
      job.state = job.controller.signal.aborted ? "cancelled" : "failed";
      if (!job.controller.signal.aborted)
        job.error = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      job.step =
        job.state === "done" ? "Finished" : job.state === "cancelled" ? "Cancelled" : "Failed";
      pruneFinished();
    });

  return snapshot(job);
}

export function simulationStatus(jobId: string): SimJobStatus {
  const job = jobs.get(jobId);
  if (!job)
    throw new Error("This simulation is no longer available (the engine may have restarted).");
  return snapshot(job);
}

/** The simulation in progress, so a GUI that lost track of it can reattach. */
export function activeSimulation(): SimJobStatus | null {
  const job = [...jobs.values()].find((j) => j.state === "running");
  return job ? snapshot(job) : null;
}

export function cancelSimulation(jobId: string): SimJobStatus {
  const job = jobs.get(jobId);
  if (!job) throw new Error("This simulation is no longer available.");
  if (job.state === "running") {
    job.controller.abort();
    job.step = "Cancelling…";
  }
  return snapshot(job);
}
