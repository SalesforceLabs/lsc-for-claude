import { describe, it, expect, afterEach } from "vitest";
import {
  activeSimulation,
  cancelSimulation,
  simulationStatus,
  startSimulation,
  type SimDeps,
} from "../../../src/studio/simulate.js";
import type { SimulateOptions, SimulationResult } from "../../../src/perf/simulate.js";
import {
  asSimSummary,
  connectionLabel,
  connectionRef,
  formatBytes,
  newConnections,
  parseSObjectList,
  rankTables,
  simSummary,
} from "../../../src-renderer/components/studio/sim-types.js";

function result(over: Partial<SimulationResult> = {}): SimulationResult {
  return {
    user: { username: "rep@x.org", id: "005A", profile: "Rep", territory: "T1" },
    org: { instanceUrl: "https://x.my.salesforce.com", apiVersion: "v67.0" },
    flow: "enhanced",
    metadata: { bytes: 2_000_000, seconds: 3, version: "Rep v1", requests: 2 },
    tables: [
      { sobject: "Account", developerName: "Account", records: 10, requests: 1, bytes: 100, seconds: 2 },
      { sobject: "Visit__c", developerName: "Visit", records: 5, requests: 1, bytes: 50, seconds: 4, truncated: "maxRecordsPerTable" },
      { sobject: "Opt__c", developerName: "Opt", records: 0, requests: 0, bytes: 0, seconds: 0, skipped: "cancelled" },
      { sobject: "Bad__c", developerName: "Bad", records: 0, requests: 1, bytes: 0, seconds: 1, error: "INVALID_FIELD" },
    ],
    totals: { records: 15, requests: 3, bytes: 150, seconds: 7, tablesDownloaded: 2, tablesSkipped: 1, tablesFailed: 1 },
    startedAt: "2026-10-17T10:00:00.000Z",
    finishedAt: "2026-10-17T10:00:10.000Z",
    notes: [],
    ...over,
  };
}

/** Every stand-in's finisher, so cleanup can settle jobs a test left running. */
const pending: Array<() => void> = [];

/** A simulate stand-in the test finishes by hand, recording the options it was given. */
function controllable() {
  const calls: SimulateOptions[] = [];
  let resolve!: (r: SimulationResult) => void;
  let reject!: (e: Error) => void;
  const deps: SimDeps = {
    simulate: (opts) => {
      calls.push(opts);
      return new Promise((res, rej) => {
        resolve = res;
        reject = rej;
        pending.push(() => res(result()));
      });
    },
  };
  return { deps, calls, resolve: (r: SimulationResult) => resolve(r), reject: (e: Error) => reject(e) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("first-sync simulation jobs", () => {
  afterEach(async () => {
    const running = activeSimulation();
    if (running) cancelSimulation(running.jobId);
    pending.splice(0).forEach((finish) => finish());
    await settle();
  });

  it("runs as the chosen connection and reports progress, then the result", async () => {
    const c = controllable();
    const started = startSimulation("  rep1 ", { territory: "T1", maxSeconds: 60 }, c.deps);
    expect(started).toMatchObject({ connection: "rep1", state: "running", step: "Connecting" });
    expect(c.calls[0]).toMatchObject({ username: "rep1", territory: "T1", maxSeconds: 60 });
    expect(c.calls[0].signal).toBeInstanceOf(AbortSignal);

    c.calls[0].onStep?.("Downloading data (enhanced flow)", { done: 1, total: 4, records: 10 });
    expect(simulationStatus(started.jobId)).toMatchObject({ step: "Downloading data (enhanced flow)", tables: { done: 1, total: 4, records: 10 } });
    expect(activeSimulation()?.jobId).toBe(started.jobId);

    c.resolve(result());
    await settle();
    const done = simulationStatus(started.jobId);
    expect(done.state).toBe("done");
    expect(done.step).toBe("Finished");
    expect(done.result?.totals.records).toBe(15);
    expect(done.finishedAt).toBeDefined();
    expect(activeSimulation()).toBeNull();
  });

  it("runs one simulation at a time", () => {
    const c = controllable();
    startSimulation("rep1", {}, c.deps);
    expect(() => startSimulation("rep2", {}, controllable().deps)).toThrow(/already in progress/);
  });

  it("needs a connection", () => {
    expect(() => startSimulation("  ", {}, controllable().deps)).toThrow(/Choose the sf CLI connection/);
  });

  it("aborts on cancel and keeps the partial result", async () => {
    const c = controllable();
    const { jobId } = startSimulation("rep1", {}, c.deps);
    const cancelling = cancelSimulation(jobId);
    expect(cancelling.step).toBe("Cancelling…");
    expect(c.calls[0].signal?.aborted).toBe(true);
    // Progress that arrives after the cancel doesn't overwrite "Cancelling…".
    c.calls[0].onStep?.("Downloading data", { done: 2, total: 4, records: 0 });
    expect(simulationStatus(jobId).step).toBe("Cancelling…");
    c.resolve(result());
    await settle();
    expect(simulationStatus(jobId)).toMatchObject({ state: "cancelled", step: "Cancelled" });
    expect(simulationStatus(jobId).result).toBeDefined();
  });

  it("reports a failure's message", async () => {
    const c = controllable();
    const { jobId } = startSimulation("rep1", {}, c.deps);
    c.reject(new Error("user-info returned 404"));
    await settle();
    expect(simulationStatus(jobId)).toMatchObject({ state: "failed", step: "Failed", error: "user-info returned 404" });
  });

  it("says when a job is gone", () => {
    expect(() => simulationStatus("sim-missing")).toThrow(/no longer available/);
    expect(() => cancelSimulation("sim-missing")).toThrow(/no longer available/);
  });
});

describe("renderer simulation helpers", () => {
  it("summarizes a server result for the history list", () => {
    const s = simSummary(result());
    expect(s).toEqual({ username: "rep@x.org", profile: "Rep", flow: "enhanced", records: 15, seconds: 10, failed: 1, truncated: true });
    expect(asSimSummary(s)).toEqual(s);
    expect(asSimSummary(null)).toBeNull();
    expect(asSimSummary({ username: "x" })).toBeNull();
  });

  it("ranks downloaded tables slowest first and lists skipped and failed ones separately", () => {
    const { downloaded, flagged } = rankTables(result().tables);
    expect(downloaded.map((t) => t.sobject)).toEqual(["Visit__c", "Account"]);
    expect(flagged.map((t) => t.sobject)).toEqual(["Opt__c", "Bad__c"]);
  });

  it("parses object lists", () => {
    expect(parseSObjectList(" Account, Contact\nAccount  Visit__c ")).toEqual(["Account", "Contact", "Visit__c"]);
    expect(parseSObjectList("  ,\n")).toBeUndefined();
  });

  it("spots the connection a browser login added", () => {
    const before = [{ username: "admin@x.org", orgId: "00D", instanceUrl: "https://x" }];
    const after = [...before, { alias: "rep1", username: "Rep@x.org", orgId: "00D", instanceUrl: "https://x" }];
    expect(newConnections(before, after).map((c) => c.username)).toEqual(["Rep@x.org"]);
    expect(newConnections(after, after)).toEqual([]);
  });

  it("labels and references connections by alias when there is one", () => {
    expect(connectionLabel({ alias: "rep1", username: "rep@x.org" })).toBe("rep1 · rep@x.org");
    expect(connectionLabel({ username: "rep@x.org" })).toBe("rep@x.org");
    expect(connectionRef({ alias: "rep1", username: "rep@x.org" })).toBe("rep1");
    expect(connectionRef({ username: "rep@x.org" })).toBe("rep@x.org");
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
