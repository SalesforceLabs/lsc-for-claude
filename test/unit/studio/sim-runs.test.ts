import { describe, it, expect, afterEach } from "vitest";
import { aggregateRuns, clampRuns, median, renderRunsSection } from "../../../src/studio/sim-runs.js";
import { activeSimulation, cancelSimulation, simulationStatus, startSimulation, type SimDeps } from "../../../src/studio/simulate.js";
import type { SimulationResult } from "../../../src/perf/simulate.js";
import { asSimSummary, multiRuns, simSummary } from "../../../src-renderer/components/studio/sim-types.js";

function run(meta: number, data: number, tableSeconds: number[] = [data], over: Partial<SimulationResult["totals"]> = {}): SimulationResult {
  const tables = tableSeconds.map((seconds, i) => ({ sobject: `T${i}`, developerName: `T${i}`, records: 10, requests: 1, bytes: 100, seconds }));
  return {
    user: { username: "rep@x.org", id: "005A" },
    org: { instanceUrl: "https://x.my.salesforce.com", apiVersion: "v67.0" },
    flow: "enhanced",
    metadata: { bytes: 1000, seconds: meta, version: "v1", requests: 2 },
    tables,
    totals: { records: 10 * tables.length, requests: tables.length, bytes: 100 * tables.length, seconds: data, tablesDownloaded: tables.length, tablesSkipped: 0, tablesFailed: 0, ...over },
    startedAt: "2026-10-17T10:00:00.000Z",
    finishedAt: "2026-10-17T10:00:10.000Z",
    notes: ["base"],
  };
}

describe("aggregateRuns", () => {
  it("returns a single requested run unchanged", () => {
    const r = run(1, 2);
    expect(aggregateRuns([r])).toBe(r);
  });

  it("reports medians, spread and per-table medians", () => {
    const agg = aggregateRuns([run(2, 10, [4, 6]), run(1, 30, [20, 10]), run(3, 20, [8, 12])]);
    expect(agg.runs).toMatchObject({
      count: 3,
      requested: 3,
      total: { median: 23, min: 12, max: 31 },
      metadata: { median: 2, min: 1, max: 3 },
      data: { median: 20, min: 10, max: 30 },
    });
    expect(agg.metadata.seconds).toBe(2);
    expect(agg.totals.seconds).toBe(20);
    expect(agg.tables.map((t) => t.seconds)).toEqual([8, 10]);
    expect(agg.runs?.perRun).toHaveLength(3);
    expect(agg.notes).toContain("base");
    expect(agg.notes.some((n) => /differed/.test(n))).toBe(false);
  });

  it("averages the middle two for an even count", () => {
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(aggregateRuns([run(0, 10), run(0, 20)]).runs?.data.median).toBe(15);
  });

  it("notes when records differ between runs", () => {
    const agg = aggregateRuns([run(1, 2), run(1, 3, [3], { records: 99 })]);
    expect(agg.notes.some((n) => /differed between runs/.test(n))).toBe(true);
  });

  it("notes cancelled runs as fewer than requested", () => {
    const agg = aggregateRuns([run(1, 2), run(1, 3)], 5);
    expect(agg.runs).toMatchObject({ count: 2, requested: 5 });
    expect(agg.notes.some((n) => /2 completed run\(s\) out of 5/.test(n))).toBe(true);
  });

  it("clamps runs to 1–5", () => {
    expect([clampRuns(undefined), clampRuns(0), clampRuns(3.7), clampRuns(9), clampRuns("2")]).toEqual([1, 1, 3, 5, 1]);
  });

  it("renders a markdown section only for several runs", () => {
    expect(renderRunsSection(aggregateRuns([run(1, 2)]))).toBe("");
    const md = renderRunsSection(aggregateRuns([run(1, 2), run(1, 4)]));
    expect(md).toContain("## Runs (2)");
    expect(md).toContain("| Total | 4.0 | 3.0 – 5.0 |");
  });
});

describe("renderer helpers for aggregated results", () => {
  it("summarizes the median and loads old single-run rows", () => {
    const agg = aggregateRuns([run(1, 9), run(1, 19), run(1, 29)]);
    expect(simSummary(agg)).toMatchObject({ seconds: 20, runs: 3 });
    expect(simSummary(run(1, 9)).runs).toBeUndefined();
    expect(multiRuns(run(1, 9))).toBeNull();
    expect(multiRuns({ runs: { count: 3 } as never })).toBeNull();
    expect(asSimSummary({ username: "u", records: 1, seconds: 2, runs: "x" })?.runs).toBeUndefined();
    expect(asSimSummary({ username: "u", records: 1, seconds: 2 })).not.toBeNull();
  });
});

const settle = () => new Promise((r) => setTimeout(r, 0));

/** A simulate stand-in that hands each call to the test so it can finish runs one at a time. */
function stepped() {
  const calls: Array<{ opts: Parameters<SimDeps["simulate"]>[0]; resolve: (r: SimulationResult) => void; reject: (e: Error) => void }> = [];
  const deps: SimDeps = {
    simulate: (opts) => new Promise((resolve, reject) => void calls.push({ opts, resolve, reject })),
  };
  return { deps, calls };
}

describe("multi-run jobs", () => {
  afterEach(async () => {
    const running = activeSimulation();
    if (running) cancelSimulation(running.jobId);
    await settle();
  });

  it("runs back to back with one session, prefixes steps and aggregates", async () => {
    const s = stepped();
    const login = { instanceUrl: "https://acme.my.salesforce.com", accessToken: "00Dsecret!token", username: "rep@acme.com" };
    const { jobId } = startSimulation(login, { runs: 3 }, s.deps);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].opts).not.toHaveProperty("runs");
    s.calls[0].opts.onStep?.("Downloading Account");
    expect(simulationStatus(jobId).step).toBe("Run 1 of 3 · Downloading Account");
    s.calls[0].resolve(run(1, 10));
    await settle();
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1].opts.session).toBe(s.calls[0].opts.session);
    s.calls[1].resolve(run(1, 30));
    await settle();
    s.calls[2].resolve(run(1, 20));
    await settle();
    const done = simulationStatus(jobId);
    expect(done.state).toBe("done");
    expect(done.result?.runs?.data.median).toBe(20);
    expect(JSON.stringify(done)).not.toContain("00Dsecret");
  });

  it("cancel keeps completed runs and drops the partial one from the medians", async () => {
    const s = stepped();
    const { jobId } = startSimulation("rep1", { runs: 3 }, s.deps);
    s.calls[0].resolve(run(1, 10));
    await settle();
    cancelSimulation(jobId);
    s.calls[1].resolve(run(1, 2));
    await settle();
    const status = simulationStatus(jobId);
    expect(status.state).toBe("cancelled");
    expect(s.calls).toHaveLength(2);
    expect(status.result?.totals.seconds).toBe(10);
    expect(status.result?.runs).toMatchObject({ count: 1, requested: 3 });
  });

  it("cancelled during the first run keeps the partial result alone", async () => {
    const s = stepped();
    const { jobId } = startSimulation("rep1", { runs: 3 }, s.deps);
    cancelSimulation(jobId);
    s.calls[0].resolve(run(1, 2));
    await settle();
    expect(simulationStatus(jobId).result?.totals.seconds).toBe(2);
    expect(simulationStatus(jobId).result?.runs).toBeUndefined();
  });

  it("a later failure keeps earlier runs; a first-run failure fails the job", async () => {
    const s = stepped();
    const { jobId } = startSimulation("rep1", { runs: 2 }, s.deps);
    s.calls[0].resolve(run(1, 10));
    await settle();
    s.calls[1].reject(new Error("boom"));
    await settle();
    const status = simulationStatus(jobId);
    expect(status.state).toBe("done");
    expect(status.result?.notes.some((n) => /Run 2 of 2 failed \(boom\)/.test(n))).toBe(true);

    const f = stepped();
    const second = startSimulation("rep1", { runs: 2 }, f.deps);
    f.calls[0].reject(new Error("404"));
    await settle();
    expect(simulationStatus(second.jobId)).toMatchObject({ state: "failed", error: "404" });
  });
});
