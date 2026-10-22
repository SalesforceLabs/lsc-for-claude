import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import {
  applyBaseline,
  hasCustomerTargets,
  deltaKey,
  emptyPlan,
  formatValue,
  inheritedThreshold,
  metricDeltas,
  normalizePlan,
  planFileName,
  planChanges,
  planToYaml,
  remediationPrompt,
  validatePlan,
  planIssues,
} from "../../../src-renderer/components/studio/perf-plan.js";
import type { AssessmentResult, PerfPlan, PersonaResult } from "../../../src-renderer/components/studio/perf-types.js";
import { METRICS as SERVER_METRICS, DEFAULT_THRESHOLDS as SERVER_DEFAULTS, parseNfrProfile } from "../../../src/perf/nfr.js";
import { METRICS, DEFAULT_THRESHOLDS, mayOvercount } from "../../../src-renderer/components/studio/perf-plan.js";
import { mayOvercount as serverMayOvercount, type TableVolume } from "../../../src/perf/sync-volume.js";

const plan = (over: Partial<PerfPlan> = {}): PerfPlan => ({
  name: "Plan",
  personas: [{ name: "Rep", users: ["rep@example.com"] }],
  ...over,
});

describe("renderer metric copy", () => {
  it("matches the server's metrics and defaults", () => {
    expect(Object.fromEntries(METRICS.map((m) => [m.key, { label: m.label, unit: m.unit }]))).toEqual(
      Object.fromEntries(Object.entries(SERVER_METRICS).map(([k, v]) => [k, { label: v.label, unit: v.unit }]))
    );
    expect(DEFAULT_THRESHOLDS).toEqual(SERVER_DEFAULTS);
  });

  it("flags the same tables as the server's mayOvercount", () => {
    const base: TableVolume = { sobject: "X", developerName: "X", matchedBy: "profile", status: "counted", records: 5, deviceRequests: 1 };
    const cases: TableVolume[] = [];
    for (const scope of ["user", "org-wide", undefined] as const)
      for (const sharingModel of ["Private", "Read", "ReadWrite", "ReadWriteTransfer", "FullAccess", "ControlledByParent", undefined])
        for (const records of [0, 5])
          for (const status of ["counted", "error"] as const) cases.push({ ...base, scope, sharingModel, records, status });
    for (const c of cases) expect(mayOvercount(c), JSON.stringify(c)).toBe(serverMayOvercount(c));
  });
});

describe("normalizePlan", () => {
  it("keeps preferSynced only when it's on, and the server parses it back", () => {
    const on = plan({ personas: [{ name: "Reps", users: [], select: { profile: "Field Sales", preferSynced: true } }] });
    const off = plan({ personas: [{ name: "Reps", users: [], select: { profile: "Field Sales", preferSynced: false } }] });
    expect(normalizePlan(on).personas[0].select).toEqual({ profile: "Field Sales", preferSynced: true });
    expect(normalizePlan(off).personas[0].select).toEqual({ profile: "Field Sales" });
    expect(parseNfrProfile(planToYaml(on)).personas[0].select).toEqual({ profile: "Field Sales", preferSynced: true });
  });

  it("trims, de-duplicates users, and drops empty thresholds and territory", () => {
    const out = normalizePlan(
      plan({
        name: "  Q3 load  ",
        thresholds: { deltaSyncP95Sec: {}, initialSyncP95Sec: { warn: 300, fail: Number.NaN } },
        telemetry: { days: 14.7 },
        personas: [{ name: " Rep ", users: ["a@x", " a@x ", "", "b@x"], territory: "  ", thresholds: { dbSizeP95Gb: {} } }],
      })
    );
    expect(out).toEqual({
      name: "Q3 load",
      thresholds: { initialSyncP95Sec: { warn: 300 } },
      telemetry: { days: 14 },
      personas: [{ name: "Rep", users: ["a@x", "b@x"] }],
    });
  });

  it("produces YAML the server parses back to the same profile", () => {
    const p = plan({ thresholds: { predictedRecordsTotal: { warn: 500000, fail: 1000000 } }, telemetry: { days: 30 } });
    const yaml = planToYaml(p);
    expect(parseNfrProfile(yaml)).toEqual(normalizePlan(p));
    expect(parse(yaml)).toEqual(normalizePlan(p));
  });

  it("keeps a profile selection only when a profile is chosen", () => {
    const out = normalizePlan(
      plan({
        personas: [
          { name: "A", users: [], select: { profile: "  Field Rep ", count: 4.6 } },
          { name: "B", users: ["b@x"], select: { profile: " " } },
          { name: "C", users: [], select: { profile: "KAM" } },
        ],
      })
    );
    expect(out.personas).toEqual([
      { name: "A", users: [], select: { profile: "Field Rep", count: 4 } },
      { name: "B", users: ["b@x"] },
      { name: "C", users: [], select: { profile: "KAM" } },
    ]);
  });

  it("round-trips profile personas through the server's YAML parser", () => {
    const p = plan({
      personas: [
        { name: "Reps", users: [], select: { profile: "Field Rep", count: 5 } },
        { name: "Both", users: ["kam@x"], select: { profile: "KAM" }, territory: "T-01" },
      ],
    });
    expect(parseNfrProfile(planToYaml(p))).toEqual(normalizePlan(p));
  });
});

describe("validatePlan", () => {
  it("accepts a runnable plan", () => {
    expect(validatePlan(plan())).toEqual([]);
  });

  it("flags missing personas, empty personas, and duplicate names", () => {
    expect(validatePlan(plan({ personas: [] }))).toEqual(["Add at least one persona."]);
    const issues = validatePlan(
      plan({ personas: [{ name: "Rep", users: [] }, { name: "rep", users: ["x"] }] })
    );
    expect(issues).toContain("Rep: choose a profile or add at least one user.");
    expect(issues.some((i) => i.includes("Two personas are named"))).toBe(true);
  });

  it("flags inverted and negative thresholds and a bad telemetry window", () => {
    const issues = validatePlan(
      plan({
        thresholds: { deltaSyncP95Sec: { warn: 90, fail: 60 } },
        telemetry: { days: 0 },
        personas: [{ name: "Rep", users: ["x"], thresholds: { dbSizeP95Gb: { warn: -1 } } }],
      })
    );
    expect(issues).toEqual([
      "Delta sync p95: warn (90) is above fail (60).",
      "Rep — Device DB size p95: thresholds can't be negative.",
      "Telemetry window must be between 1 and 365 days.",
    ]);
  });

  it("the empty plan needs a profile or a user before it can run", () => {
    expect(validatePlan(emptyPlan())).toEqual(["Persona 1: choose a profile or add at least one user."]);
  });

  it("accepts a profile persona with no users and checks its user count", () => {
    expect(validatePlan(plan({ personas: [{ name: "Rep", users: [], select: { profile: "Field Rep" } }] }))).toEqual([]);
    for (const count of [0, 11, 2.5]) {
      expect(validatePlan(plan({ personas: [{ name: "Rep", users: [], select: { profile: "Field Rep", count } }] }))).toEqual([
        "Rep: the number of users to test must be a whole number from 1 to 10.",
      ]);
    }
  });
});

describe("inheritedThreshold", () => {
  it("prefers the plan target over the built-in default", () => {
    expect(inheritedThreshold(plan(), "metadataDownloadP95Sec")).toEqual({ warn: 5, fail: 10 });
    expect(inheritedThreshold(plan({ thresholds: { metadataDownloadP95Sec: { fail: 20 } } }), "metadataDownloadP95Sec")).toEqual({ fail: 20 });
    expect(inheritedThreshold(plan(), "deltaSyncP95Sec")).toBeUndefined();
  });
});

describe("planFileName", () => {
  it("slugs the plan name", () => {
    expect(planFileName(plan({ name: "Q3 Load — Reps!" }), "yaml")).toBe("q3-load-reps.yaml");
    expect(planFileName(plan({ name: "  " }), "json")).toBe("test-plan.json");
  });
});

function persona(name: string, values: Record<string, number | undefined>, status: PersonaResult["status"] = "pass"): PersonaResult {
  return {
    persona: { name, users: ["x"] },
    users: ["x"],
    volumes: [],
    status,
    evaluations: Object.entries(values).map(([metric, value]) => ({
      metric: metric as never,
      value,
      threshold: { warn: 100, fail: 200 },
      status: value === undefined ? "no-data" : value > 200 ? "fail" : value > 100 ? "warn" : "pass",
    })),
  };
}

const result = (personas: PersonaResult[], status: AssessmentResult["status"] = "pass"): AssessmentResult => ({
  profile: "Plan",
  org: "qa",
  generatedAt: "2026-10-17T00:00:00.000Z",
  status,
  personas,
});

describe("metricDeltas", () => {
  it("diffs metrics by persona name, skipping values missing on either side", () => {
    const now = result([persona("Rep", { deltaSyncP95Sec: 80, initialSyncP95Sec: 300, dbSizeP95Gb: undefined }), persona("New", { deltaSyncP95Sec: 1 })]);
    const before = result([persona("rep", { deltaSyncP95Sec: 100, dbSizeP95Gb: 2 })]);
    const deltas = metricDeltas(now, before);
    expect(deltas.get(deltaKey("Rep", "deltaSyncP95Sec"))).toBe(-20);
    expect(deltas.has(deltaKey("Rep", "initialSyncP95Sec"))).toBe(false);
    expect(deltas.has(deltaKey("Rep", "dbSizeP95Gb"))).toBe(false);
    expect(deltas.has(deltaKey("New", "deltaSyncP95Sec"))).toBe(false);
    expect(metricDeltas(now, null).size).toBe(0);
  });
});

describe("formatValue", () => {
  it("adds units except for counts", () => {
    expect(formatValue({ metric: "predictedRecordsTotal", value: 1234567 })).toBe("1,234,567");
    expect(formatValue({ metric: "deltaSyncP95Sec", value: 12.345 })).toBe("12.3 s");
    expect(formatValue({ metric: "dbSizeP95Gb", value: undefined })).toBe("—");
  });
});

describe("remediationPrompt", () => {
  it("lists failing and warning metrics, the largest tables, and failing filters", () => {
    const p = persona("Rep", { deltaSyncP95Sec: 250, initialSyncP95Sec: 50 }, "fail");
    p.evaluations[0].detail = "rep@x / T-01";
    p.volumes = [
      {
        user: { id: "1", username: "rep@x", name: "Rep", profileId: "", profileName: "", territories: [], permissionSetCount: 0 },
        tableCount: 2,
        territories: [
          {
            territory: null,
            totalRecords: 5000,
            largestTable: null,
            totalDeviceRequests: 3,
            tables: [
              { sobject: "Account", developerName: "Account", matchedBy: "profile", status: "counted", records: 5000, deviceRequests: 1 },
              { sobject: "Bad__c", developerName: "Bad", matchedBy: "profile", status: "error", records: 0, deviceRequests: null, note: "No such column" },
            ],
          },
        ],
      },
    ];
    const prompt = remediationPrompt(result([p], "fail"));
    expect(prompt).toContain('run of "Plan" on qa came back FAIL');
    expect(prompt).toContain("Rep: Delta sync p95 FAIL — 250 s (warn 100, fail 200), driven by rep@x / T-01");
    expect(prompt).not.toContain("Initial sync p95");
    expect(prompt).toContain("largest tables Account 5,000");
    expect(prompt).toContain("DB Schema filters that fail to execute: Bad__c");
  });
});

describe("applyBaseline", () => {
  it("sets persona targets from measured values plus the margins, rounded by unit", () => {
    const run = result([
      persona("rep", { predictedRecordsTotal: 123456, deltaSyncP95Sec: 41.23, syncFailureRatePct: 1.234, dbSizeP95Gb: undefined }),
    ]);
    const base = plan({
      personas: [
        { name: "Rep", users: ["x"], thresholds: { dbSizeP95Gb: { fail: 2 }, deltaSyncP95Sec: { warn: 1 } } },
        { name: "Other", users: ["y"] },
      ],
    });
    const out = applyBaseline(base, run, { warnPct: 10, failPct: 25 });
    expect(out.personas[0].thresholds).toEqual({
      predictedRecordsTotal: { warn: 135802, fail: 154320 },
      deltaSyncP95Sec: { warn: 45.4, fail: 51.5 },
      syncFailureRatePct: { warn: 1.36, fail: 1.54 },
      dbSizeP95Gb: { fail: 2 },
    });
    expect(out.personas[1]).toBe(base.personas[1]);
    expect(base.personas[0].thresholds?.deltaSyncP95Sec).toEqual({ warn: 1 });
  });

  it("never sets fail below warn", () => {
    const out = applyBaseline(plan(), result([persona("Rep", { deltaSyncP95Sec: 10 })]), { warnPct: 50, failPct: 0 });
    expect(out.personas[0].thresholds?.deltaSyncP95Sec).toEqual({ warn: 15, fail: 15 });
  });

  it("produces a plan the validator accepts", () => {
    const out = applyBaseline(plan(), result([persona("Rep", { predictedRecordsTotal: 0, deltaSyncP95Sec: 3 })]), { warnPct: 10, failPct: 30 });
    expect(validatePlan(out)).toEqual([]);
  });
});

describe("planChanges", () => {
  const withPersona = (p: PersonaResult, over: Partial<PersonaResult["persona"]>, users?: string[]): PersonaResult => ({
    ...p,
    persona: { ...p.persona, ...over },
    users: users ?? p.users,
  });

  it("reports nothing when the test is the same", () => {
    const p = persona("Rep", { deltaSyncP95Sec: 10 });
    expect(planChanges(result([p]), result([withPersona(p, { name: "rep", users: [" X "] })])).size).toBe(0);
  });

  it("names what changed per persona and skips personas new in this run", () => {
    const before = persona("Rep", { deltaSyncP95Sec: 10 });
    const now = withPersona(persona("Rep", { deltaSyncP95Sec: 10 }), { users: ["y"], territory: "T-02" });
    now.evaluations[0].threshold = { warn: 5, fail: 200 };
    const changes = planChanges(result([now, persona("New", {})]), result([before]));
    expect(changes.get("rep")).toEqual(["users changed", "territory changed", "targets changed"]);
    expect(changes.has("new")).toBe(false);
  });

  it("separates a changed profile selection from different users resolved by the same one", () => {
    const sel = (count?: number) => ({ users: [], select: { profile: "Field Rep", count } });
    const base = persona("Rep", {});
    const before = withPersona(base, sel(), ["a", "b", "c"]);
    expect(planChanges(result([withPersona(base, sel(5), ["a"])]), result([before])).get("rep")).toEqual(["profile selection changed"]);
    expect(planChanges(result([withPersona(base, sel(3), ["a", "b", "c"])]), result([before])).size).toBe(0);
    expect(planChanges(result([withPersona(base, sel(), ["a", "b", "d"])]), result([before])).get("rep")).toEqual(["tested users changed"]);
  });

  it("doesn't flag tested users for runs saved before they were recorded", () => {
    const base = persona("Rep", {});
    const old = { ...base, users: undefined } as unknown as PersonaResult;
    expect(planChanges(result([base]), result([old])).size).toBe(0);
  });
});

describe("planIssues", () => {
  it("tags each problem with the editor tab that fixes it", () => {
    const plan: PerfPlan = {
      name: "P",
      telemetry: { days: 0 },
      thresholds: { predictedRecordsTotal: { warn: 10, fail: 5 } },
      personas: [{ name: "Rep", users: [], thresholds: { deltaSyncP95Sec: { warn: -1 } } }],
    };
    const areas = planIssues(plan).map((i) => i.area);
    expect(areas.filter((a) => a === "plan")).toHaveLength(1);
    expect(areas.filter((a) => a === "targets")).toHaveLength(1);
    // The missing users and the persona's own bad override both live on the Personas tab.
    expect(areas.filter((a) => a === "personas")).toHaveLength(2);
    expect(validatePlan(plan)).toEqual(planIssues(plan).map((i) => i.message));
  });
});

describe("hasCustomerTargets", () => {
  it("is false until the plan or a persona sets a target of its own", () => {
    expect(hasCustomerTargets(emptyPlan())).toBe(false);
    expect(hasCustomerTargets({ ...emptyPlan(), thresholds: {} })).toBe(false);
    expect(hasCustomerTargets({ ...emptyPlan(), thresholds: { predictedRecordsTotal: { warn: 1000 } } })).toBe(true);
    const plan = emptyPlan();
    plan.personas[0].thresholds = { initialSyncP95Sec: { fail: 600 } };
    expect(hasCustomerTargets(plan)).toBe(true);
  });
});
