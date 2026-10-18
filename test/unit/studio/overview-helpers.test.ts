import { describe, it, expect } from "vitest";
import {
  allSettled,
  buildReport,
  groupCards,
  nextSteps,
  orgVerdict,
  pickToLoad,
  type SetupOverviewData,
} from "../../../src-renderer/components/studio/overview-helpers";
import type { FeatureSummary, ReadinessCheck } from "../../../src-renderer/components/studio/types";
import type { ReadinessState } from "../../../src-renderer/components/studio/readiness";

const feature = (id: string, available = true): FeatureSummary => ({ id, title: id.toUpperCase(), description: "", available });
const check = (id: string, status: ReadinessCheck["status"], severity: ReadinessCheck["severity"] = "error"): ReadinessCheck => ({
  id,
  stage: "config",
  title: `Title ${id}`,
  status,
  severity,
  source: "studio",
});
const ready = (checks: ReadinessCheck[]): ReadinessState => ({ status: "ready", readiness: { featureId: "x", title: "X", org: "o", collectedAt: "", checks } });

const features = [feature("a"), feature("b"), feature("c"), feature("d"), feature("soon", false)];

describe("pickToLoad", () => {
  it("fills free slots with unrequested features in order", () => {
    expect(pickToLoad(["a", "b", "c", "d"], {})).toEqual(["a", "b", "c"]);
  });
  it("counts in-flight loads against the limit and skips loaded ones", () => {
    const r: Record<string, ReadinessState> = { a: { status: "loading" }, b: ready([]) };
    expect(pickToLoad(["a", "b", "c", "d", "e", "f"], r)).toEqual(["c", "d"]);
  });
  it("reloads marked features once they are not loading", () => {
    const r: Record<string, ReadinessState> = { a: ready([]), b: { status: "loading" } };
    expect(pickToLoad(["a", "b"], r, new Set(["a", "b"]))).toEqual(["a"]);
  });
  it("starts nothing when full", () => {
    const r: Record<string, ReadinessState> = { a: { status: "loading" }, b: { status: "loading" }, c: { status: "loading" } };
    expect(pickToLoad(["a", "b", "c", "d"], r)).toEqual([]);
  });
});

describe("groupCards", () => {
  it("puts blocked features first, most blocking first, and drops unavailable ones", () => {
    const readiness: Record<string, ReadinessState> = {
      a: ready([check("1", "pass")]),
      b: ready([check("2", "fail", "warning")]),
      c: ready([check("3", "fail"), check("4", "fail")]),
      d: { status: "error", error: "boom" },
    };
    const groups = groupCards(features, readiness);
    expect(groups.map((g) => g.id)).toEqual(["attention", "unchecked", "ready"]);
    expect(groups[0].cards.map((c) => c.feature.id)).toEqual(["c", "b"]);
    expect(groups.flatMap((g) => g.cards).some((c) => c.feature.id === "soon")).toBe(false);
  });
  it("treats unrequested and loading features as loading", () => {
    const groups = groupCards(features, { a: { status: "loading" } });
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("loading");
    expect(groups[0].cards).toHaveLength(4);
  });
});

describe("orgVerdict", () => {
  it("is blocked by an org-wide blocker even when all features pass", () => {
    const readiness = Object.fromEntries(["a", "b", "c", "d"].map((id) => [id, ready([check("p", "pass")])]));
    const v = orgVerdict([check("o", "fail")], features, readiness);
    expect(v.verdict).toBe("blocked");
    expect(v.featuresReady).toBe(4);
  });
  it("is ready only when everything passes", () => {
    const readiness = Object.fromEntries(["a", "b", "c", "d"].map((id) => [id, ready([check("p", "pass")])]));
    expect(orgVerdict([check("o", "pass")], features, readiness).verdict).toBe("ready");
  });
  it("is unknown before anything ran", () => {
    expect(orgVerdict([], features, {}).verdict).toBe("unknown");
  });
});

describe("nextSteps", () => {
  it("lists org blockers before feature blockers and caps the list", () => {
    const readiness: Record<string, ReadinessState> = { a: ready([check("f1", "fail")]), b: ready([check("f2", "fail", "warning")]) };
    const steps = nextSteps([check("o1", "fail"), check("o2", "fail", "warning")], features, readiness, 3);
    expect(steps.map((s) => s.key)).toEqual(["o1", "a:f1", "b:f2"]);
    expect(steps[0].featureId).toBeUndefined();
    expect(steps[1].featureId).toBe("a");
  });
});

describe("allSettled", () => {
  it("waits for loading and unrequested features", () => {
    expect(allSettled(["a", "b"], { a: ready([]), b: { status: "loading" } })).toBe(false);
    expect(allSettled(["a", "b"], { a: ready([]) })).toBe(false);
    expect(allSettled(["a", "b"], { a: ready([]), b: { status: "error", error: "x" } })).toBe(true);
  });
});

describe("buildReport", () => {
  const overview: SetupOverviewData = {
    org: "my-org",
    collectedAt: "",
    checks: [{ ...check("overview.mobile.unpublished", "fail", "warning"), stage: "mobile", detail: "3 changes", examples: ["P1"] }],
    unpublishedProfiles: ["P1"],
    unpublishedChanges: 3,
  };
  it("includes org checks, a feature table and failing details, not passing ones", () => {
    const readiness: Record<string, ReadinessState> = {
      a: ready([check("f1", "fail"), check("ok", "pass")]),
      b: ready([check("ok2", "pass")]),
      c: { status: "error", error: "boom" },
    };
    const md = buildReport(overview, features, readiness, new Date("2026-01-02T00:00:00Z"));
    expect(md).toContain("# Go-live readiness: my-org");
    expect(md).toContain("FAIL (to fix): Title overview.mobile.unpublished — 3 changes");
    expect(md).toContain("Examples: P1");
    expect(md).toContain("| A | Not ready | 1 | 0 | 1/2 |");
    expect(md).toContain("| B | Ready | 0 | 0 | 1/1 |");
    expect(md).toContain("| C | Couldn't check |");
    expect(md).toContain("### A");
    expect(md).not.toContain("### B");
    expect(md).not.toContain("SOON");
  });
});
