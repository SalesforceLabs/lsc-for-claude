import { describe, it, expect } from "vitest";
import { SmartQueue, MAX_CONCURRENT_TABLES, MAX_OPEN_QUERY_LOCATORS, schedulingNote, type SmartQueueOptions } from "../../../src/perf/device/replay.js";

/** Tasks that finish only when released, recording the order they start in. */
function harness(complexities: number[], opts: Partial<SmartQueueOptions> = {}) {
  const queue = new SmartQueue({ maxConcurrent: 4, ...opts });
  const started: number[] = [];
  const release: Array<() => void> = [];
  const tasks = complexities.map((complexity, i) => ({
    complexity,
    run: () =>
      new Promise<number>((resolve) => {
        started.push(i);
        release[i] = () => resolve(i);
      }),
  }));
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  const done = queue.run(tasks);
  return { queue, started, release, done, flush };
}

describe("SmartQueue", () => {
  it("ramps from 1, adding one slot per queue change", async () => {
    const h = harness([1, 1, 1, 1, 1, 1, 1, 1]);
    await h.flush();
    // The enqueue is one queue change: 1 -> 2.
    expect(h.started).toEqual([0, 1]);
    h.release[0]();
    await h.flush();
    // One finished (-1 running), limit 3 -> two more start.
    expect(h.queue.concurrency).toBe(3);
    expect(h.started).toEqual([0, 1, 2, 3]);
    h.release[1]();
    await h.flush();
    expect(h.queue.concurrency).toBe(4);
    expect(h.started).toEqual([0, 1, 2, 3, 4, 5]);
    for (let i = 2; i < 8; i++) {
      await h.flush();
      h.release[i]?.();
    }
    await h.flush();
    h.release.forEach((r) => r());
    await h.done;
  });

  it("never exceeds the max concurrency", async () => {
    const queue = new SmartQueue({ maxConcurrent: 3 });
    let live = 0;
    let max = 0;
    await queue.run(
      Array.from({ length: 20 }, () => ({
        complexity: 1,
        run: async () => {
          live++;
          max = Math.max(max, live);
          await new Promise((r) => setTimeout(r, 1));
          live--;
        },
      }))
    );
    expect(max).toBe(3);
    expect(queue.peakRunning).toBe(3);
    expect(queue.concurrency).toBe(3);
  });

  it("blocks a heavy table while the running tables leave too few locators", async () => {
    const h = harness([3, 3, 6, 1], { nextReady: "firstPending" });
    await h.flush();
    expect(h.started).toEqual([0, 1]);
    expect(h.queue.concurrency).toBe(2);
    h.release[0]();
    await h.flush();
    // Running 3 + heavy 6 = 9 > 7: the limit shrinks to 1 and the heavy table waits behind table 1.
    expect(h.queue.concurrency).toBe(1);
    expect(h.started).toEqual([0, 1]);
    h.release[1]();
    await h.flush();
    // Nothing running, so the heavy table fits and the limit grows again; the light table starts beside it.
    expect(h.started).toEqual([0, 1, 2, 3]);
    h.release.forEach((r) => r());
    await h.done;
  });

  it("does not grow past the first table when the next one cannot fit beside it", async () => {
    const h = harness([4, 4, 4]);
    await h.flush();
    expect(h.started).toEqual([0]);
    expect(h.queue.concurrency).toBe(1);
    h.release[0]();
    await h.flush();
    // The recompute after the finish sees nothing running, so the limit grows and the next tables start.
    expect(h.started[1]).toBe(1);
    h.release.forEach((r) => r());
    await h.flush();
    h.release.forEach((r) => r());
    await h.done;
  });

  it("starts tables first-in-first-out", async () => {
    const h = harness([1, 3, 1, 2, 1, 1, 1]);
    for (let i = 0; i < 7; i++) {
      await h.flush();
      h.release.forEach((r) => r());
    }
    await h.done;
    expect(h.started).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("keeps the learned limit between runs, as the device reuses one queue", async () => {
    const queue = new SmartQueue({ maxConcurrent: 4 });
    await queue.run(Array.from({ length: 6 }, () => ({ complexity: 1, run: async () => undefined })));
    expect(queue.concurrency).toBe(4);
    let live = 0;
    let max = 0;
    await queue.run(
      Array.from({ length: 4 }, () => ({
        complexity: 1,
        run: async () => {
          max = Math.max(max, ++live);
          await new Promise((r) => setTimeout(r, 1));
          live--;
        },
      }))
    );
    expect(max).toBe(4);
  });

  it("reads an executing operation as the next ready one by default, as the device does", async () => {
    // Oldest unfinished (running, 5) + running (5) = 10 > 7: no growth even though the pending table is light.
    const h = harness([5, 1]);
    await h.flush();
    expect(h.started).toEqual([0]);
    h.release.forEach((r) => r());
    await h.flush();
    h.release.forEach((r) => r());
    await h.done;
  });

  it("rethrows a failing task after the others finish", async () => {
    const queue = new SmartQueue({ maxConcurrent: 2 });
    let ran = 0;
    await expect(
      queue.run([
        { complexity: 1, run: async () => { ran++; throw new Error("boom"); } },
        { complexity: 1, run: async () => { ran++; } },
      ])
    ).rejects.toThrow("boom");
    expect(ran).toBe(2);
  });
});

describe("scheduling constants", () => {
  it("matches the device settings", () => {
    expect(MAX_CONCURRENT_TABLES).toEqual({ enhanced: 4, legacy: 3 });
    expect(MAX_OPEN_QUERY_LOCATORS).toBe(7);
    expect(schedulingNote("enhanced")).toMatch(/^Tables scheduled like the iOS app: /);
  });
});
