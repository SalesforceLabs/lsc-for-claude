/**
 * Studio "Testing → First sync": runs simulateInitialSync (src/perf/simulate.ts)
 * as a background job the GUI polls. The simulation runs as whichever sf CLI
 * connection the user picks — an admin or an end user — and is read-only.
 *
 * Jobs live in the MCP server process's memory; the Electron app keeps finished
 * results in its own history. One simulation runs at a time: each one downloads
 * a user's whole initial sync, and two at once would skew each other's timings.
 */

import { simulateInitialSync, type SimulateOptions, type SimulationResult } from "../perf/simulate.js";

export type SimJobState = "running" | "done" | "failed" | "cancelled";

/** The options the GUI can set; the rest keep simulateInitialSync's defaults. */
export type SimRunOptions = Pick<
  SimulateOptions,
  "territory" | "forceFlow" | "include" | "exclude" | "maxSeconds" | "maxRecordsPerTable" | "maxTotalRecords"
>;

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
  result?: SimulationResult;
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
  for (const job of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_JOBS))) jobs.delete(job.jobId);
}

export function startSimulation(connection: string, options: SimRunOptions = {}, deps: SimDeps = defaultDeps): SimJobStatus {
  const name = connection.trim();
  if (!name) throw new Error("Choose the sf CLI connection to run the simulation as.");
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

  deps
    .simulate({
      ...options,
      username: name,
      signal: job.controller.signal,
      onStep: (step, tables) => {
        if (job.controller.signal.aborted) return;
        job.step = step;
        if (tables) job.tables = tables;
      },
    })
    .then((result) => {
      // A cancelled run still returns what it downloaded; keep it so the GUI can show the partial result.
      job.state = job.controller.signal.aborted ? "cancelled" : "done";
      job.result = result;
    })
    .catch((err) => {
      job.state = job.controller.signal.aborted ? "cancelled" : "failed";
      if (!job.controller.signal.aborted) job.error = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      job.step = job.state === "done" ? "Finished" : job.state === "cancelled" ? "Cancelled" : "Failed";
      pruneFinished();
    });

  return snapshot(job);
}

export function simulationStatus(jobId: string): SimJobStatus {
  const job = jobs.get(jobId);
  if (!job) throw new Error("This simulation is no longer available (the engine may have restarted).");
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
