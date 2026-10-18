import { describe, it, expect } from "vitest";
import { asRunSummary, runSummary, sparkPoints, trendRows } from "../../../src-renderer/components/studio/perf-history.js";
import type { AssessmentResult, MetricEvaluation } from "../../../src-renderer/components/studio/perf-types.js";

const result = (personas: Array<{ name: string; evals: MetricEvaluation[] }>): AssessmentResult =>
  ({
    profile: "Plan",
    org: "qa",
    generatedAt: "2026-10-17T00:00:00Z",
    status: "pass",
    personas: personas.map((p) => ({
      persona: { name: p.name, users: ["u@x"] },
      users: ["u@x"],
      volumes: [],
      evaluations: p.evals,
      status: "pass",
    })),
  }) as unknown as AssessmentResult;

const ev = (metric: MetricEvaluation["metric"], value: number | undefined, status: MetricEvaluation["status"], warn?: number, fail?: number): MetricEvaluation => ({
  metric,
  value,
  status,
  threshold: warn === undefined && fail === undefined ? undefined : { warn, fail },
});

describe("runSummary", () => {
  it("records every metric per persona", () => {
    const s = runSummary(result([{ name: "Rep", evals: [ev("predictedRecordsTotal", 100, "pass", 200, 400)] }]));
    expect(s.personas).toEqual([{ name: "Rep", metrics: { predictedRecordsTotal: { value: 100, status: "pass", warn: 200, fail: 400 } } }]);
  });

  it("picks the most severe metric across personas", () => {
    const s = runSummary(
      result([
        { name: "Rep", evals: [ev("predictedRecordsTotal", 300, "warn", 200, 400)] },
        { name: "Manager", evals: [ev("deltaSyncP95Sec", 50, "fail", 20, 40), ev("dbSizeP95Gb", 1, "pass", 2, 4)] },
      ])
    );
    expect(s.worst).toEqual({ persona: "Manager", metric: "deltaSyncP95Sec", status: "fail", value: 50 });
  });

  it("breaks ties by how close each value is to its limit", () => {
    const s = runSummary(
      result([{ name: "Rep", evals: [ev("predictedRecordsTotal", 100, "pass", 200, 400), ev("dbSizeP95Gb", 3, "pass", undefined, 4)] }])
    );
    expect(s.worst?.metric).toBe("dbSizeP95Gb");
  });

  it("has no worst metric when nothing has a target", () => {
    const s = runSummary(result([{ name: "Rep", evals: [ev("predictedRecordsTotal", 100, "no-threshold"), ev("deltaSyncP95Sec", undefined, "no-data")] }]));
    expect(s.worst).toBeUndefined();
  });
});

describe("asRunSummary", () => {
  it("accepts summaries and rejects old or malformed values", () => {
    expect(asRunSummary(null)).toBeNull();
    expect(asRunSummary({})).toBeNull();
    expect(asRunSummary({ personas: [] })).toEqual({ personas: [] });
  });
});

describe("trendRows", () => {
  const run = (value: number | undefined) => ({
    summary: runSummary(result([{ name: "Rep", evals: [ev("predictedRecordsTotal", value, value === undefined ? "no-data" : "pass", 200, 400)] }])),
  });

  it("orders values oldest first from newest-first runs and skips runs without summaries", () => {
    const rows = trendRows([run(30), { summary: null }, run(20), run(10)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ persona: "Rep", metric: "predictedRecordsTotal", values: [10, 20, 30] });
    expect(rows[0].latest.value).toBe(30);
  });

  it("limits to the newest runs", () => {
    const rows = trendRows([run(5), run(4), run(3), run(2), run(1)], 3);
    expect(rows[0].values).toEqual([3, 4, 5]);
  });

  it("needs at least two values to show a trend", () => {
    expect(trendRows([run(1)])).toEqual([]);
    expect(trendRows([run(1), run(undefined)])).toEqual([]);
  });

  it("matches personas by name regardless of case", () => {
    const renamed = { summary: { personas: [{ name: "rep", metrics: { predictedRecordsTotal: { value: 7, status: "pass" } } }] } };
    expect(trendRows([run(9), renamed])[0].values).toEqual([7, 9]);
  });
});

describe("sparkPoints", () => {
  it("scales values into the box with the highest at the top", () => {
    expect(sparkPoints([0, 10], 40, 10)).toBe("0.0,10.0 40.0,0.0");
  });

  it("skips gaps and draws a flat line for equal values", () => {
    expect(sparkPoints([5, undefined, 5], 20, 10)).toBe("0.0,10.0 20.0,10.0");
    expect(sparkPoints([undefined], 20, 10)).toBe("");
  });
});
