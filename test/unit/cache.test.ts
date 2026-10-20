import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  cacheGet,
  cacheSet,
  cacheClear,
  cacheSize,
  cachePrune,
  cacheInvalidateOrg,
  queryCacheKey,
  describeCacheKey,
} from "../../src/cache.js";

beforeEach(() => {
  cacheClear();
});

describe("cache", () => {
  describe("cacheGet / cacheSet", () => {
    it("returns undefined on cache miss", () => {
      expect(cacheGet("org1", "key1")).toBeUndefined();
    });

    it("returns the cached value on hit", () => {
      cacheSet("org1", "key1", { foo: "bar" });
      expect(cacheGet("org1", "key1")).toEqual({ foo: "bar" });
    });

    it("scopes values by org", () => {
      cacheSet("org1", "key1", "value-org1");
      cacheSet("org2", "key1", "value-org2");
      expect(cacheGet("org1", "key1")).toBe("value-org1");
      expect(cacheGet("org2", "key1")).toBe("value-org2");
    });

    it("returns undefined after TTL expires", () => {
      vi.useFakeTimers();
      try {
        cacheSet("org1", "key1", "value", 1000);
        expect(cacheGet("org1", "key1")).toBe("value");

        vi.advanceTimersByTime(1001);
        expect(cacheGet("org1", "key1")).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("overwrites existing entries", () => {
      cacheSet("org1", "key1", "old");
      cacheSet("org1", "key1", "new");
      expect(cacheGet("org1", "key1")).toBe("new");
    });
  });

  describe("cacheInvalidateOrg", () => {
    it("removes all entries for the specified org", () => {
      cacheSet("org1", "a", 1);
      cacheSet("org1", "b", 2);
      cacheSet("org2", "a", 3);

      cacheInvalidateOrg("org1");

      expect(cacheGet("org1", "a")).toBeUndefined();
      expect(cacheGet("org1", "b")).toBeUndefined();
      expect(cacheGet("org2", "a")).toBe(3);
    });

    it("is a no-op for unknown orgs", () => {
      cacheSet("org1", "a", 1);
      cacheInvalidateOrg("org-unknown");
      expect(cacheGet("org1", "a")).toBe(1);
    });
  });

  describe("cacheClear", () => {
    it("removes all entries from all orgs", () => {
      cacheSet("org1", "a", 1);
      cacheSet("org2", "b", 2);
      cacheClear();
      expect(cacheSize()).toBe(0);
    });
  });

  describe("cacheSize", () => {
    it("returns 0 for empty cache", () => {
      expect(cacheSize()).toBe(0);
    });

    it("tracks the number of entries", () => {
      cacheSet("org1", "a", 1);
      cacheSet("org1", "b", 2);
      expect(cacheSize()).toBe(2);
    });
  });

  describe("queryCacheKey", () => {
    it("normalises whitespace", () => {
      const key1 = queryCacheKey("SELECT Id  FROM  Profile WHERE Name = 'Admin'");
      const key2 = queryCacheKey("SELECT Id FROM Profile WHERE Name = 'Admin'");
      expect(key1).toBe(key2);
    });

    it("distinguishes SOQL from Tooling queries", () => {
      const soql = queryCacheKey("SELECT Id FROM Profile", false);
      const tooling = queryCacheKey("SELECT Id FROM Profile", true);
      expect(soql).not.toBe(tooling);
      expect(soql).toMatch(/^soql:/);
      expect(tooling).toMatch(/^tooling:/);
    });
  });

  describe("describeCacheKey", () => {
    it("returns a prefixed key", () => {
      expect(describeCacheKey("Account")).toBe("describe:Account");
    });
  });

  describe("size bound and pruning", () => {
    it("evicts the oldest entries past the cap", () => {
      for (let i = 0; i < 520; i++) cacheSet("org", `k${i}`, i);
      expect(cacheSize()).toBe(500);
      expect(cacheGet("org", "k0")).toBeUndefined();
      expect(cacheGet("org", "k519")).toBe(519);
    });
    it("a re-set moves the entry to the newest position", () => {
      for (let i = 0; i < 500; i++) cacheSet("org", `k${i}`, i);
      cacheSet("org", "k0", "again");
      cacheSet("org", "new", 1);
      expect(cacheGet("org", "k0")).toBe("again");
      expect(cacheGet("org", "k1")).toBeUndefined();
    });
    it("cachePrune drops only expired entries", () => {
      cacheSet("org", "short", 1, 10);
      cacheSet("org", "long", 2, 100_000);
      cachePrune(Date.now() + 1000);
      expect(cacheSize()).toBe(1);
      expect(cacheGet("org", "long")).toBe(2);
    });
  });
});
