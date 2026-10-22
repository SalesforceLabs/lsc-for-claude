import { describe, it, expect } from "vitest";
import { plainSeconds, renderSignoffReport } from "../../../src/studio/signoff-report.js";
import { aggregateRuns } from "../../../src/studio/sim-runs.js";
import type { SimulationResult } from "../../../src/perf/simulate.js";

type Status = "pass" | "warn" | "fail" | "no-data" | "no-threshold";

const evaluation = (metric: string, value: number | undefined, status: Status, threshold?: { warn?: number; fail?: number }, detail?: string) => ({
  metric,
  value,
  status,
  threshold,
  detail,
});

function persona(name: string, evaluations: ReturnType<typeof evaluation>[], over: Record<string, unknown> = {}) {
  return {
    persona: { name, users: ["rep@x.org"] },
    users: ["rep@x.org"],
    volumes: [],
    evaluations,
    status: evaluations.some((e) => e.status === "fail") ? "fail" : evaluations.some((e) => e.status === "warn") ? "warn" : "pass",
    ...over,
  };
}

function assessment(personas: ReturnType<typeof persona>[], over: Record<string, unknown> = {}) {
  return { profile: "Acme go-live", org: "acme-uat", generatedAt: "2026-10-17T09:30:00.000Z", status: "fail", personas, ...over };
}

function sim(meta: number, data: number, over: Partial<SimulationResult> = {}): SimulationResult {
  const tables = [
    { sobject: "Account", developerName: "Account", records: 900, requests: 3, bytes: 2_000_000, seconds: data * 0.6 },
    { sobject: "Visit", developerName: "Visit", records: 100, requests: 1, bytes: 500_000, seconds: data * 0.4 },
  ];
  return {
    user: { username: "rep@x.org", id: "005A", territory: "North" },
    org: { instanceUrl: "https://x.my.salesforce.com", apiVersion: "v67.0" },
    flow: "enhanced",
    metadata: { bytes: 4_000_000, seconds: meta, version: "v1", requests: 2 },
    tables,
    totals: { records: 1000, requests: 4, bytes: 2_500_000, seconds: data, tablesDownloaded: 2, tablesSkipped: 0, tablesFailed: 0 },
    startedAt: "2026-10-17T10:00:00.000Z",
    finishedAt: "2026-10-17T10:00:10.000Z",
    notes: ["base"],
    ...over,
  };
}

const failing = () =>
  assessment([
    persona("Field Rep", [
      evaluation("predictedRecordsTotal", 50_000, "pass", { warn: 100_000, fail: 200_000 }),
      evaluation("deltaSyncP95Sec", 138, "warn", { warn: 120, fail: 300 }),
      evaluation("initialSyncP95Sec", 1800, "fail", { warn: 600, fail: 900 }, "rep / North"),
      evaluation("dbSizeP95Gb", undefined, "no-data", { fail: 2 }),
      evaluation("syncFailureRatePct", 1, "no-threshold"),
    ]),
  ]);

describe("renderSignoffReport", () => {
  it("leads with a verdict, per-persona targets and plain-language risks", () => {
    const md = renderSignoffReport({ assessment: failing() });
    expect(md).toContain("# Go-live sign-off: Acme go-live");
    expect(md).toContain("**Date:** 2026-10-17");
    expect(md).toContain("**Org:** acme-uat");
    expect(md).toContain("**Not ready for sign-off.** 1 of 4 targets were missed across 1 persona (Field Rep).");
    expect(md).toContain("| Field Rep | 1 | Not ready | 1 of 4 | 1 | 1 | 1 |");
    expect(md).toContain("| Delta sync p95 | 2.3 min | 2 min | 5 min | Close to limit |");
    expect(md).toContain("Field Rep: Delta sync p95 is 2.3 min against a 2 min target. This is close to the limit.");
    expect(md).toContain("Initial sync p95 is 30 min against a 15 min limit. Driven by rep / North.");
    expect(md).toContain("Device DB size p95 has a target but could not be measured");
  });

  it("says 'is close to its limit' for a single near-limit target", () => {
    const md = renderSignoffReport({ assessment: failing() });
    expect(md).toContain("and 1 is close to its limit.");
  });

  it("orders risks with the missed targets first", () => {
    const md = renderSignoffReport({ assessment: failing() });
    const risks = md.slice(md.indexOf("## Top risks"));
    expect(risks.indexOf("Initial sync p95")).toBeLessThan(risks.indexOf("Device DB size"));
    expect(risks.indexOf("Device DB size")).toBeLessThan(risks.indexOf("Delta sync p95"));
  });

  it("says ready when every target is met", () => {
    const md = renderSignoffReport({
      assessment: assessment([persona("Rep", [evaluation("predictedRecordsTotal", 10, "pass", { warn: 100, fail: 200 })])], { status: "pass" }),
    });
    expect(md).toContain("**Ready for sign-off.** All 1 targets were met across 1 persona.");
    expect(md).toContain("No risks found");
  });

  it("is not proven while a target couldn't be measured", () => {
    const md = renderSignoffReport({
      assessment: assessment([
        persona("Rep", [
          evaluation("predictedRecordsTotal", 10, "pass", { warn: 100 }),
          evaluation("deltaSyncP95Sec", undefined, "no-data", { warn: 120 }),
          evaluation("dbSizeP95Gb", undefined, "no-data", { fail: 2 }),
        ]),
      ]),
    });
    expect(md).toContain("**Not proven yet.** 1 of 3 targets were met");
    expect(md).not.toContain("Ready for sign-off");
    expect(md).toContain("| Rep | 1 | Not proven | 1 of 3 | 0 | 0 | 2 |");
    expect(md.indexOf("Delta sync p95 has a target but could not be measured")).toBeGreaterThan(md.indexOf("## Top risks"));
  });

  it("is not proven, not missing, when every target is unmeasured", () => {
    const md = renderSignoffReport({ assessment: assessment([persona("Rep", [evaluation("deltaSyncP95Sec", undefined, "no-data", { warn: 120 })])]) });
    expect(md).toContain("**Not proven yet.** 0 of 1");
    expect(md).not.toContain("No verdict yet");
  });

  it("has no verdict when no targets were set", () => {
    const md = renderSignoffReport({ assessment: assessment([persona("Rep", [evaluation("predictedRecordsTotal", 10, "no-threshold")])]) });
    expect(md).toContain("**No verdict yet.**");
  });

  it("summarises first-sync results with the spread over several runs and embeds both detailed reports", () => {
    const multi = aggregateRuns([sim(2, 100), sim(3, 200), sim(2, 150)]);
    const md = renderSignoffReport({ assessment: failing(), simulations: [multi] });
    expect(md).toContain("## First sync results");
    expect(md).toContain("| rep@x.org (North) |");
    expect(md).toContain("over 3 runs");
    expect(md).toContain("Slowest tables for rep@x.org: Account");
    expect(md).toContain("## Appendix: detailed results");
    expect(md).toContain("#### Persona: Field Rep");
    expect(md).toContain("### First sync: rep@x.org");
    expect(md).toContain("#### Simulated First Sync");
    expect(md).toContain("##### Runs (3)");
  });

  it("raises failed first-sync tables as a risk", () => {
    const bad = sim(2, 10);
    bad.tables[1].error = "boom";
    const md = renderSignoffReport({ assessment: failing(), simulations: [bad] });
    expect(md).toContain("First sync for rep@x.org: 1 table failed to download (Visit).");
  });

  it("compares with a baseline by persona and metric", () => {
    const base = assessment([persona("field rep", [evaluation("deltaSyncP95Sec", 90, "pass", { warn: 120, fail: 300 }), evaluation("predictedRecordsTotal", 50_000, "pass", { warn: 100_000 })])], {
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    const md = renderSignoffReport({ assessment: failing(), baseline: base });
    expect(md).toContain("## Changes since the baseline");
    expect(md).toContain("| Field Rep | Delta sync p95 | 90 s | 2.3 min | worse by 48 s | Met to Close to limit |");
    expect(md).toContain("| Field Rep | Predicted records synced (total) | 50,000 | 50,000 | no change | Met |");
    expect(renderSignoffReport({ assessment: failing() })).not.toContain("Changes since the baseline");
  });

  it("rejects the wrong shapes with clear errors", () => {
    expect(() => renderSignoffReport({ assessment: {} })).toThrow(/no personas/);
    expect(() => renderSignoffReport({ assessment: { personas: [], profile: 3 } })).toThrow(/no plan name/);
    expect(() => renderSignoffReport({ assessment: assessment([{ evaluations: [], volumes: [] } as never]) })).toThrow(/persona 1 has no name/);
    expect(() => renderSignoffReport({ assessment: assessment([persona("A", [{ metric: "x" } as never])]) })).toThrow(/without a metric and status/);
    expect(() => renderSignoffReport({ assessment: failing(), baseline: { personas: "no" } })).toThrow(/The baseline is not a performance run result/);
    expect(() => renderSignoffReport({ assessment: failing(), simulations: [{ user: {} }] })).toThrow(/Simulation 1 is not a first-sync result/);
    expect(() => renderSignoffReport({ assessment: failing(), simulations: [{ user: { username: "a" }, metadata: {} }] })).toThrow(/no metadata timing/);
    expect(() => renderSignoffReport({ assessment: failing(), days: 0 })).toThrow(/Days/);
  });
});

describe("plainSeconds", () => {
  it("picks seconds, minutes or hours", () => {
    expect([plainSeconds(45), plainSeconds(138), plainSeconds(120), plainSeconds(9000)]).toEqual(["45 s", "2.3 min", "2 min", "2.5 h"]);
  });
});
