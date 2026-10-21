/**
 * Repeated first-sync runs: one run is a single noisy network sample, so a job
 * can run the simulation several times back to back and report the median and
 * spread. Pure aggregation — no I/O — so it is unit-testable on its own.
 *
 * The aggregate is itself a SimulationResult (the run whose total time is the
 * median, with median phase and per-table seconds) plus a `runs` summary, so
 * anything that reads a single-run result — history rows, the report, exports —
 * keeps working on it.
 */

import type { SimulationResult } from "../perf/simulate.js";

export const MAX_SIM_RUNS = 5;

export interface SimSpread {
  median: number;
  min: number;
  max: number;
}

export interface SimRunTimes {
  totalSeconds: number;
  metadataSeconds: number;
  dataSeconds: number;
}

export interface SimRunsSummary {
  /** Runs the aggregate is built from. */
  count: number;
  /** Runs asked for; more than `count` when the job was cancelled or a later run failed. */
  requested: number;
  perRun: SimRunTimes[];
  total: SimSpread;
  metadata: SimSpread;
  data: SimSpread;
}

export type MultiRunResult = SimulationResult & { runs?: SimRunsSummary };

/** Whole number of runs in 1..MAX_SIM_RUNS; anything else is 1. */
export function clampRuns(runs: unknown): number {
  const n = typeof runs === "number" ? Math.trunc(runs) : NaN;
  return Number.isFinite(n) ? Math.min(MAX_SIM_RUNS, Math.max(1, n)) : 1;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function spread(values: number[]): SimSpread {
  return { median: median(values), min: Math.min(...values), max: Math.max(...values) };
}

const timesOf = (r: SimulationResult): SimRunTimes => ({
  totalSeconds: r.metadata.seconds + r.totals.seconds,
  metadataSeconds: r.metadata.seconds,
  dataSeconds: r.totals.seconds,
});

/**
 * Combine completed runs. One run (and `requested` of 1) comes back unchanged.
 * Records, requests and bytes are expected to match across runs; a note says so
 * when they don't.
 */
export function aggregateRuns(
  results: SimulationResult[],
  requested = results.length
): MultiRunResult {
  if (results.length === 0) throw new Error("No completed runs to aggregate.");
  if (results.length === 1 && requested <= 1) return results[0];

  const perRun = results.map(timesOf);
  const total = spread(perRun.map((r) => r.totalSeconds));
  const metadata = spread(perRun.map((r) => r.metadataSeconds));
  const data = spread(perRun.map((r) => r.dataSeconds));

  // The run closest to the median total (the lower one when two tie) supplies everything that isn't a time.
  const order = perRun
    .map((r, i) => i)
    .sort((a, b) => perRun[a].totalSeconds - perRun[b].totalSeconds);
  const rep = results[order[Math.floor((order.length - 1) / 2)]];

  const tables = rep.tables.map((t) => {
    const seconds = results.flatMap((r) =>
      r.tables
        .filter((x) => x.sobject === t.sobject && x.developerName === t.developerName)
        .map((x) => x.seconds)
    );
    return { ...t, seconds: median(seconds) };
  });

  const notes = [...rep.notes];
  const sig = (r: SimulationResult) => `${r.totals.records}/${r.totals.requests}/${r.totals.bytes}`;
  if (new Set(results.map(sig)).size > 1) {
    const counts = results
      .map(
        (r) => `${r.totals.records.toLocaleString("en-US")} records / ${r.totals.requests} requests`
      )
      .join("; ");
    notes.push(
      `Records, requests or bytes differed between runs (${counts}); the org's data changed or a limit applied unevenly. Table counts shown are from the run closest to the median.`
    );
  }
  let delta = rep.delta;
  if (delta) {
    // Counts come from the representative run; only the seconds are medians over the runs that simulated delta.
    const withDelta = results
      .map((r) => r.delta)
      .filter((d): d is NonNullable<typeof d> => d !== undefined);
    const med = (pick: (d: NonNullable<typeof delta>) => number | undefined) =>
      median(withDelta.map(pick).filter((v): v is number => v !== undefined));
    delta = {
      ...delta,
      tables: delta.tables.map((t) => {
        const same = withDelta.flatMap((d) =>
          d.tables.filter((x) => x.sobject === t.sobject && x.developerName === t.developerName)
        );
        return {
          ...t,
          visibilitySeconds: median(same.map((x) => x.visibilitySeconds)),
          fetchSeconds: median(same.map((x) => x.fetchSeconds)),
          seconds: median(same.map((x) => x.seconds)),
        };
      }),
      totals: {
        ...delta.totals,
        visibilitySeconds: med((d) => d.totals.visibilitySeconds),
        fetchSeconds: med((d) => d.totals.fetchSeconds),
        seconds: med((d) => d.totals.seconds),
      },
    };
    if (withDelta.length > 1)
      notes.push(
        `Delta seconds are medians of ${withDelta.length} runs; delta counts are from the run closest to the median initial-sync total.`
      );
  }
  notes.push(
    results.length < requested
      ? `Medians of ${results.length} completed run(s) out of ${requested} requested.`
      : `Times are medians of ${results.length} runs back to back as the same login.`
  );

  const content = [...results].reverse().find((r) => r.content)?.content;
  if (content)
    notes.push(
      "Content downloads ran once, in the last run only; they are not part of the medians."
    );

  return {
    ...rep,
    ...(content ? { content } : {}),
    metadata: { ...rep.metadata, seconds: metadata.median },
    tables,
    totals: { ...rep.totals, seconds: data.median },
    ...(delta ? { delta } : {}),
    startedAt: results[0].startedAt,
    finishedAt: results[results.length - 1].finishedAt,
    notes,
    runs: { count: results.length, requested, perRun, total, metadata, data },
  };
}

/** "12.3 s" style seconds for the report. */
const sec = (s: number) => `${s.toFixed(1)}`;

/** Markdown section for a multi-run result; empty for a single run. */
export function renderRunsSection(result: { runs?: SimRunsSummary }): string {
  const runs = result.runs;
  if (!runs || runs.count < 2) return "";
  const row = (label: string, s: SimSpread) =>
    `| ${label} | ${sec(s.median)} | ${sec(s.min)} – ${sec(s.max)} |\n`;
  let out = `## Runs (${runs.count}${runs.requested > runs.count ? ` of ${runs.requested} requested` : ""})\n\n`;
  out += `| Seconds | Median | Min – max |\n|---|---|---|\n`;
  out += row("Total", runs.total) + row("Metadata", runs.metadata) + row("Data", runs.data);
  out += `\n| Run | Total | Metadata | Data |\n|---|---|---|---|\n`;
  runs.perRun.forEach((r, i) => {
    out += `| ${i + 1} | ${sec(r.totalSeconds)} | ${sec(r.metadataSeconds)} | ${sec(r.dataSeconds)} |\n`;
  });
  return out + `\nThe tables below show each table's median seconds across runs.\n\n`;
}
