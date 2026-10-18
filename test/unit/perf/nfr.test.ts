import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  effectiveThresholds,
  evaluateMetric,
  overallStatus,
  parseNfrProfile,
} from "../../../src/perf/nfr.js";
import { evaluatePersona, renderAssessment, runAssessment } from "../../../src/perf/assessment.js";
import { summarize } from "../../../src/perf/telemetry.js";

const EXAMPLE = join(__dirname, "..", "..", "..", "docs", "perf-nfr-profile.example.yaml");

describe("parseNfrProfile", () => {
  it("parses the shipped example profile", () => {
    const profile = parseNfrProfile(readFileSync(EXAMPLE, "utf-8"));
    expect(profile.personas.length).toBeGreaterThan(0);
  });

  it("rejects unknown metrics and empty thresholds with readable issues", () => {
    expect(() =>
      parseNfrProfile(`name: x\npersonas:\n  - name: p\n    users: [u]\nthresholds:\n  madeUpMetric: { fail: 1 }\n`)
    ).toThrow(/thresholds/);
    expect(() =>
      parseNfrProfile(`name: x\npersonas:\n  - name: p\n    users: [u]\nthresholds:\n  deltaSyncP95Sec: {}\n`)
    ).toThrow(/at least one of warn\/fail/);
    expect(() => parseNfrProfile(`name: x\npersonas: []\n`)).toThrow(/personas/);
  });
});

describe("thresholds", () => {
  it("layers defaults < profile < persona", () => {
    const profile = parseNfrProfile(
      `name: x\nthresholds:\n  deltaSyncP95Sec: { fail: 100 }\npersonas:\n  - name: p\n    users: [u]\n    thresholds:\n      deltaSyncP95Sec: { fail: 50 }\n`
    );
    const t = effectiveThresholds(profile, profile.personas[0]);
    expect(t.deltaSyncP95Sec).toEqual({ fail: 50 });
    expect(t.metadataDownloadP95Sec).toEqual({ warn: 5, fail: 10 });
  });

  it("evaluates lower-is-better with strict comparisons", () => {
    const th = { warn: 5, fail: 10 };
    expect(evaluateMetric("deltaSyncP95Sec", 5, th).status).toBe("pass");
    expect(evaluateMetric("deltaSyncP95Sec", 6, th).status).toBe("warn");
    expect(evaluateMetric("deltaSyncP95Sec", 11, th).status).toBe("fail");
    expect(evaluateMetric("deltaSyncP95Sec", undefined, th).status).toBe("no-data");
    expect(evaluateMetric("deltaSyncP95Sec", 3, undefined).status).toBe("no-threshold");
  });

  it("never fails an assessment on missing data or thresholds", () => {
    expect(
      overallStatus([evaluateMetric("deltaSyncP95Sec", undefined, { fail: 1 }), evaluateMetric("dbSizeP95Gb", 9, undefined)])
    ).toBe("pass");
  });
});

describe("evaluatePersona", () => {
  it("attributes volume metrics to the worst user and territory", () => {
    const profile = parseNfrProfile(
      `name: x\npersonas:\n  - name: Rep\n    users: [a, b]\n    thresholds:\n      predictedRecordsTotal: { warn: 100, fail: 1000 }\n`
    );
    const terr = (name: string, total: number) => ({
      territory: { id: name, name },
      tables: [],
      totalRecords: total,
      largestTable: { sobject: "Contact", developerName: "Contact", matchedBy: "profile" as const, status: "counted" as const, records: total, deviceRequests: 1 },
      totalDeviceRequests: 2,
    });
    const vol = (username: string, territories: ReturnType<typeof terr>[]) => ({
      user: { id: "", username, name: username, profileId: "", profileName: "", territories: [], permissionSetCount: 0 },
      tableCount: 1,
      territories,
    });
    const evals = evaluatePersona(profile, profile.personas[0], [vol("a", [terr("T1", 50)]), vol("b", [terr("T2", 20), terr("T3", 500)])], summarize([]));
    const total = evals.find((e) => e.metric === "predictedRecordsTotal");
    expect(total).toMatchObject({ value: 500, status: "warn", detail: "b / T3" });
    expect(evals.find((e) => e.metric === "deltaSyncP95Sec")?.status).toBe("no-data");

    const md = renderAssessment(
      { profile: "x", org: "o", generatedAt: "now", status: "warn", personas: [{ persona: profile.personas[0], volumes: [], evaluations: evals, status: "warn" }] },
      30
    );
    expect(md).toContain("Persona: Rep");
    expect(md).toContain("b / T3");
  });
});

describe("persona users and select", () => {
  const plan = (persona: string) => `name: x\npersonas:\n  - name: p\n${persona}`;

  it("accepts a profile selection instead of users, defaulting users to []", () => {
    const p = parseNfrProfile(plan(`    select: { profile: Field Sales, count: 5 }\n`)).personas[0];
    expect(p.users).toEqual([]);
    expect(p.select).toEqual({ profile: "Field Sales", count: 5 });
  });

  it("rejects a persona with neither users nor a selection", () => {
    expect(() => parseNfrProfile(plan(`    territory: North\n`))).toThrow(/needs users or a select/);
    expect(() => parseNfrProfile(plan(`    users: ["  "]\n`))).toThrow(/needs users or a select/);
  });

  it("bounds the selection count to 1–10 and requires a profile", () => {
    expect(() => parseNfrProfile(plan(`    select: { profile: Field Sales, count: 0 }\n`))).toThrow();
    expect(() => parseNfrProfile(plan(`    select: { profile: Field Sales, count: 11 }\n`))).toThrow();
    expect(() => parseNfrProfile(plan(`    select: { profile: "" }\n`))).toThrow();
    expect(parseNfrProfile(plan(`    select: { profile: Field Sales, count: 10 }\n`)).personas[0].select?.count).toBe(10);
  });

  it("ships an example with a select persona", () => {
    const profile = parseNfrProfile(readFileSync(EXAMPLE, "utf-8"));
    expect(profile.personas.some((p) => p.select)).toBe(true);
  });
});

describe("runAssessment with a profile selection", () => {
  const failing = {
    soql: async () => {
      throw new Error("INVALID_TYPE");
    },
    tooling: async () => {
      throw new Error("unexpected tooling query");
    },
  };

  it("reports a failed selection as a user error, skips telemetry, and tags steps with persona progress", async () => {
    const profile = parseNfrProfile(`name: x\npersonas:\n  - name: Reps\n    select: { profile: Field Sales }\n`);
    const steps: Array<[string, unknown]> = [];
    const result = await runAssessment(profile, "my-org", failing, failing, async () => new Set(), {
      onStep: (step, progress) => steps.push([step, progress]),
    });

    const p = result.personas[0];
    expect(p.users).toEqual([]);
    expect(p.volumes).toHaveLength(1);
    expect(p.volumes[0]).toMatchObject({ user: { username: "", profileName: "Field Sales" } });
    expect(p.volumes[0].error).toContain("Couldn't select Field Sales users: INVALID_TYPE");
    expect(p.telemetryError).toBe("No users to read telemetry for.");
    expect(steps).toEqual([["Reps (1/1): Selecting the heaviest Field Sales users", { persona: 1, personas: 1 }]]);

    const md = renderAssessment(result, 30);
    expect(md).toContain("**Users:** the 3 heaviest active users with the profile Field Sales — none found");
  });
});

describe("renderAssessment users line", () => {
  it("names the selected users and counts the listed ones", () => {
    const md = renderAssessment(
      {
        profile: "x",
        org: "o",
        generatedAt: "2026-10-17T00:00:00Z",
        status: "pass",
        personas: [
          {
            persona: { name: "Reps", users: ["Own@x"], select: { profile: "Field Sales", count: 2 } },
            users: ["Own@x", "a@x", "b@x"],
            volumes: [],
            evaluations: [],
            status: "pass",
          },
        ],
      },
      30
    );
    expect(md).toContain("**Users:** the 2 heaviest active users with the profile Field Sales — a@x, b@x, plus 1 listed in the plan");
  });
});
