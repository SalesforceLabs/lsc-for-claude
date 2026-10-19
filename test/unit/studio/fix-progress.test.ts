import { describe, expect, it } from "vitest";
import { FixTracker, fixProgress, startFixChange, statusDetail, step } from "../../../src/studio/fix-progress.js";
import type { StudioFix } from "../../../src/studio/types.js";
import {
  acceptProgress,
  barPercent,
  batchSummary,
  changeViews,
  formatStepTime,
  hasSteps,
  headline,
  overallFraction,
  stepsFraction,
  type FixProgress,
  type FixStep,
} from "../../../src-renderer/components/studio/review-progress-logic";

const fix = (label: string): StudioFix =>
  ({ kind: "setActive", label, record: { category: "x", developerName: "y" }, from: false, to: true }) as unknown as StudioFix;

const s = (state: FixStep["state"], detail?: string, key = "k"): FixStep => ({ key, label: `Step ${key}`, state, detail });

describe("FixTracker", () => {
  it("tracks steps for each change under one batch id", async () => {
    const id = `t-${Math.random()}`;
    const a = startFixChange({ id, index: 0, total: 2 }, fix("A"), "preview");
    const first = fixProgress(id)!;
    expect(first.changes).toHaveLength(1);
    expect(first.changes[0].steps.length).toBeGreaterThan(0);
    expect(first.changes[0].steps.every((x) => x.state === "waiting")).toBe(true);

    const key = first.changes[0].steps[0].key;
    await step(a, key, async () => 1);
    expect(fixProgress(id)!.changes[0].steps[0].state).toBe("done");
    a.finish();
    expect(fixProgress(id)!.finishedAt).toBeUndefined(); // one of two changes

    const b = startFixChange({ id, index: 1, total: 2 }, fix("B"), "preview");
    b.finish();
    const done = fixProgress(id)!;
    expect(done.changes.map((c) => c.index)).toEqual([0, 1]);
    expect(done.finishedAt).toBeDefined();
    // Waiting steps a change never needed are dropped.
    expect(done.changes[1].steps.every((x) => x.state !== "waiting")).toBe(true);
  });

  it("marks a step failed when its work throws, and returns null for unknown ids", async () => {
    const id = `t-${Math.random()}`;
    const t = startFixChange({ id, index: 0, total: 1 }, fix("A"), "preview");
    const key = fixProgress(id)!.changes[0].steps[0].key;
    await expect(
      step(t, key, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(fixProgress(id)!.changes[0].steps[0].state).toBe("failed");
    expect(fixProgress("nope")).toBeNull();
  });

  it("runs work untracked without a tracker and reports metadata status as a detail", async () => {
    expect(await step(undefined, "read", async () => 7)).toBe(7);
    expect(statusDetail({ operation: "deploy", status: "InProgress", componentsDone: 2, componentsTotal: 5 })).toBe(
      "2 of 5 components · Salesforce: in progress"
    );
    expect(statusDetail({ operation: "retrieve" })).toBe("");
  });

  it("exports the class for callers that build their own", () => {
    expect(typeof FixTracker).toBe("function");
  });
});

describe("review progress logic", () => {
  it("counts finished steps and the running step's own count, short of a whole step", () => {
    expect(stepsFraction([])).toBe(0);
    expect(stepsFraction([s("done"), s("waiting")])).toBe(0.5);
    expect(stepsFraction([s("done"), s("running", "1 of 4 components")])).toBeCloseTo((1 + 0.25) / 2);
    expect(stepsFraction([s("running", "5 of 5 components")])).toBeCloseTo(0.95);
  });

  const progress = (finishedAt?: number): FixProgress => ({
    id: "b",
    startedAt: 1,
    changes: [
      { index: 0, total: 3, label: "A", phase: "preview", startedAt: 1, finishedAt, steps: [s("done", undefined, "a"), s("running", undefined, "b")] },
    ],
  });

  it("shows changes the server hasn't reported as waiting, and finished ones as done", () => {
    const views = changeViews(["A", "B", "C"], progress(), [false, false, true]);
    expect(views.map((v) => v.state)).toEqual(["running", "waiting", "done"]);
    expect(overallFraction(views)).toBeCloseTo((0.5 + 0 + 1) / 3);
    expect(changeViews(["A"], progress(5))[0].state).toBe("done");
  });

  it("falls back to the plain verb before any step has begun", () => {
    const none = changeViews(["A", "B"], null);
    expect(hasSteps(none)).toBe(false);
    expect(headline(none, "preview")).toBe("Checking the org…");
    expect(headline(none, "apply")).toBe("Applying…");
    expect(batchSummary(none, "preview")).toBe("0 of 2 changes checked");
    expect(batchSummary(changeViews(["A"], null), "apply")).toBeNull();
  });

  it("names the running step in the heading", () => {
    const views = changeViews(["A", "B", "C"], progress());
    expect(headline(views, "preview")).toBe("Change 1 of 3 · Step b");
    expect(headline(changeViews(["A"], progress()), "preview")).toBe("Step b");
  });

  it("formats times and bar widths", () => {
    expect(formatStepTime(340)).toBe("340 ms");
    expect(formatStepTime(2400)).toBe("2.4s");
    expect(formatStepTime(14000)).toBe("14s");
    expect(barPercent(0)).toBe(4);
    expect(barPercent(2)).toBe(100);
  });

  it("ignores poll results for another batch", () => {
    const cur = progress();
    expect(acceptProgress(cur, null, "b")).toBe(cur);
    expect(acceptProgress(cur, { ...progress(), id: "other" }, "b")).toBe(cur);
    const next = progress(9);
    expect(acceptProgress(cur, next, "b")).toBe(next);
  });
});
