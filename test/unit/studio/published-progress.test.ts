import { describe, expect, it } from "vitest";
import { LoadTracker, loadProgress } from "../../../src/studio/published-progress.js";

describe("LoadTracker", () => {
  it("plans steps, marks them running then done, and drops skipped ones on finish", async () => {
    const track = new LoadTracker("Rep");
    track.plan(["cache", "download", "lists"]);
    expect(loadProgress("Rep")?.steps.map((s) => s.state)).toEqual(["waiting", "waiting", "waiting"]);
    let during = "";
    await track.run("cache", async () => {
      during = loadProgress("Rep")?.steps[0].state ?? "";
    });
    expect(during).toBe("running");
    await expect(track.run("lists", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    track.finish();
    const p = loadProgress("Rep");
    expect(p?.steps.map((s) => [s.key, s.state])).toEqual([
      ["cache", "done"],
      ["lists", "failed"],
    ]);
    expect(p?.finishedAt).toBeGreaterThanOrEqual(p?.startedAt ?? 0);
  });

  it("replaces the previous load of the same profile", () => {
    new LoadTracker("Other").plan(["cache"]);
    new LoadTracker("Other");
    expect(loadProgress("Other")?.steps).toEqual([]);
    expect(loadProgress("Nobody")).toBeNull();
  });
});
