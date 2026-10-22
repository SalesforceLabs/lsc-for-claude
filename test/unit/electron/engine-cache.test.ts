import { describe, it, expect } from "vitest";
import { EngineCache } from "../../../src-electron/engine/engine-cache.js";

function fake(running = false) {
  return { running, aborted: false, abort() { this.aborted = true; }, isRunning() { return this.running; } };
}

describe("EngineCache", () => {
  it("drops the least recently used idle engines past the limit", () => {
    const cache = new EngineCache(2);
    const a = fake(), b = fake(), c = fake();
    cache.set("a", a);
    cache.set("b", b);
    cache.get("a"); // a is now newer than b
    cache.set("c", c);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(a);
    expect(cache.get("c")).toBe(c);
    expect(b.aborted).toBe(true);
  });

  it("never drops a running engine, and does not count it against the limit", () => {
    const cache = new EngineCache(1);
    const busy = fake(true), x = fake(), y = fake();
    cache.set("busy", busy);
    cache.set("x", x);
    cache.set("y", y);
    expect(cache.get("busy")).toBe(busy);
    expect(busy.aborted).toBe(false);
    expect(cache.get("x")).toBeUndefined();
    expect(cache.get("y")).toBe(y);
  });

  it("trims a run's engine once it goes idle", () => {
    const cache = new EngineCache(1);
    const a = fake(true), b = fake();
    cache.set("a", a);
    cache.set("b", b);
    expect(cache.size).toBe(2);
    a.running = false;
    cache.trim();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(b);
  });

  it("delete and clear remove engines", () => {
    const cache = new EngineCache(3);
    cache.set("a", fake());
    cache.set("b", fake());
    cache.delete("a");
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
