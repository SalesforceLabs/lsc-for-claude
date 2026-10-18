import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { downloadTimeoutMs, pruneCache, runPool, withTimeout } from "../../../src/studio/published.js";

describe("downloadTimeoutMs", () => {
  it("grows with size and is capped", () => {
    expect(downloadTimeoutMs(0)).toBe(300_000);
    expect(downloadTimeoutMs(100 * 1024 * 1024)).toBeGreaterThan(downloadTimeoutMs(1024 * 1024));
    expect(downloadTimeoutMs(1e15)).toBe(30 * 60_000);
  });
});

describe("pruneCache", () => {
  const make = (root: string, name: string, age: number, bytes = 10) => {
    const d = path.join(root, name);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "f"), Buffer.alloc(bytes));
    const t = new Date(Date.now() - age * 1000);
    fs.utimesSync(d, t, t);
    return d;
  };

  it("keeps the newest and protected directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prune-"));
    const oldest = make(root, "a", 300);
    make(root, "b", 200);
    make(root, "c", 100);
    const removed = pruneCache(root, { keep: 2, maxBytes: 1000, protect: [oldest] });
    expect(removed.map((r) => path.basename(r))).toEqual(["b"]);
    expect(fs.existsSync(oldest)).toBe(true);
    fs.rmSync(root, { recursive: true });
  });

  it("enforces the size cap", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prune-"));
    make(root, "a", 200, 100);
    make(root, "b", 100, 100);
    const removed = pruneCache(root, { keep: 10, maxBytes: 150 });
    expect(removed.map((r) => path.basename(r))).toEqual(["a"]);
    fs.rmSync(root, { recursive: true });
  });
});

describe("withTimeout and runPool", () => {
  it("rejects a slow promise", async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, "Reading")).rejects.toThrow(/Reading took longer/);
  });

  it("limits concurrency", async () => {
    let live = 0;
    let peak = 0;
    await runPool([1, 2, 3, 4, 5, 6], 2, async () => {
      peak = Math.max(peak, ++live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
    });
    expect(peak).toBe(2);
  });
});
