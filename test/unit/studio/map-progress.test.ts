import { describe, it, expect } from "vitest";
import { countText, currentMapTracker, mapKey, mapProgress, readinessKey, trackMap } from "../../../src/studio/map-progress.js";
import { slowNote } from "../../../src-renderer/components/studio/feature-loading-logic.js";

describe("map progress tracker", () => {
  it("counts nouns", () => {
    expect(countText(1, "layout")).toBe("1 layout");
    expect(countText(1240, "flow")).toBe("1,240 flows");
    expect(countText(2, "class")).toBe("2 classes");
  });

  it("reports planned, running, done and failed steps while a load runs, and drops steps that never ran", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const load = trackMap(mapKey("t1"), "t1", "Test", async (t) => {
      t.plan([
        { key: "a", label: "A" },
        { key: "b", label: "B" },
        { key: "c", label: "C" },
      ]);
      t.start("a", "A");
      t.start("b", "B");
      t.detail("b", "3 of 8 objects described");
      expect(currentMapTracker()).toBe(t);
      await gate;
      t.end("a", { count: 12, noun: "layout" });
      t.end("b", { error: "boom" });
    });
    const mid = mapProgress("t1")!;
    expect(mid.steps.map((s) => s.state)).toEqual(["running", "running", "waiting"]);
    expect(mid.steps[1].detail).toBe("3 of 8 objects described");
    expect(mid.finishedAt).toBeUndefined();
    release();
    await load;
    const done = mapProgress("t1")!;
    expect(done.finishedAt).toBeDefined();
    expect(done.steps.map((s) => [s.key, s.state, s.detail])).toEqual([
      ["a", "done", "12 layouts"],
      ["b", "failed", "boom"],
    ]);
    expect(currentMapTracker()).toBeUndefined();
  });

  it("keeps the map and the readiness load of a feature apart, and a new load replaces the old", async () => {
    await trackMap(mapKey("t2"), "t2", "T", async (t) => t.start("x", "X"));
    await trackMap(readinessKey("t2"), "t2", "T", async (t) => t.start("y", "Y"));
    expect(mapProgress("t2")!.steps[0].key).toBe("x");
    expect(mapProgress("readiness:t2")!.steps[0].key).toBe("y");
    await trackMap(mapKey("t2"), "t2", "T", async () => undefined);
    expect(mapProgress("t2")!.steps).toEqual([]);
    expect(mapProgress("nope")).toBeNull();
  });
});

describe("slow note", () => {
  const step = (over: object) => ({ key: "flows", label: "Flows", state: "running" as const, startedAt: 1, ...over });
  it("names the slow running step with its detail", () => {
    expect(slowNote([step({ detail: "this org has 1,240" })], 20_000, 0)).toMatch(/^Flows are taking a while — this org has 1,240/);
  });
  it("is quiet for a fast load and generic for a long one", () => {
    expect(slowNote([step({})], 3000, 0)).toBeNull();
    expect(slowNote([step({ state: "done" })], 30_000, 0)).toMatch(/longer than usual/);
  });
});
