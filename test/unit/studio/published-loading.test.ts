import { describe, expect, it } from "vitest";
import { loadFraction, type LoadStep } from "../../../src-renderer/components/studio/published-loading-logic";
import { LoadTracker, loadProgress } from "../../../src/studio/published-progress.js";

const step = (state: LoadStep["state"], detail?: string): LoadStep => ({ key: "k", label: "L", state, detail });

describe("loadFraction", () => {
  it("is zero with no steps and counts finished steps", () => {
    expect(loadFraction([])).toBe(0);
    expect(loadFraction([step("done"), step("failed"), step("waiting"), step("waiting")])).toBe(0.5);
  });

  it("adds the running step's own count, short of a whole step", () => {
    expect(loadFraction([step("done"), step("running", "10 of 40 list views")])).toBeCloseTo((1 + 0.25) / 2);
    expect(loadFraction([step("running", "1,000 of 1,000 things")])).toBeCloseTo(0.95);
    expect(loadFraction([step("running", "reading")])).toBe(0);
  });
});

describe("LoadTracker step times", () => {
  it("records when each step began and ended", async () => {
    const track = new LoadTracker("Timed");
    await track.run("cache", async () => {});
    await expect(track.run("lists", () => Promise.reject(new Error("x")))).rejects.toThrow();
    const [a, b] = loadProgress("Timed")!.steps;
    expect(a.startedAt).toBeDefined();
    expect(a.endedAt).toBeGreaterThanOrEqual(a.startedAt!);
    expect(b.endedAt).toBeDefined();
  });
});
