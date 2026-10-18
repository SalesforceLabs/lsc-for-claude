import { describe, expect, it } from "vitest";
import { STUDIO_CACHE_TTL_MS, isCacheable, isFresh } from "../../../src-electron/engine/studio-cache-policy.js";
import { createInFlight } from "../../../src-electron/engine/in-flight.js";

describe("isCacheable", () => {
  it("rejects top-level errors and generic partial markers", () => {
    expect(isCacheable("studio_feature_map", { error: "boom" })).toBe(false);
    expect(isCacheable("studio_item_detail", { errors: ["x"] })).toBe(false);
    expect(isCacheable("studio_ipad_published", { truncated: true })).toBe(false);
    expect(isCacheable("studio_ipad_published", { timedOut: true })).toBe(false);
    expect(isCacheable("studio_item_detail", { sidebar: { relatedLists: null } })).toBe(false);
  });

  it("rejects a feature map with a surface that failed transiently", () => {
    expect(isCacheable("studio_feature_map", { surfaces: [{ id: "a" }, { id: "b", error: "Query timed out after 120s" }] })).toBe(false);
    expect(isCacheable("studio_feature_map", { surfaces: [{ id: "a" }, { id: "b", error: "Only 50,000 of 80,000 matching records could be read — too many for one query." }] })).toBe(false);
    expect(isCacheable("studio_feature_map", { surfaces: [{ id: "a" }, { id: "b" }] })).toBe(true);
  });

  it("keeps a feature map whose surface fails because the org lacks the object", () => {
    const missing = { surfaces: [{ id: "a", error: "INVALID_TYPE: sObject type 'Visit' is not supported." }] };
    expect(isCacheable("studio_feature_map", missing)).toBe(true);
  });

  it("rejects readiness and overview results with checks that couldn't run for a transient reason", () => {
    const timedOut = { checks: [{ status: "pass" }, { status: "unknown", detail: "Salesforce didn't answer within 120s — the sf command was stopped." }] };
    expect(isCacheable("studio_readiness", timedOut)).toBe(false);
    expect(isCacheable("studio_setup_overview", timedOut)).toBe(false);
    expect(isCacheable("studio_readiness", { checks: [{ status: "pass" }, { status: "skipped" }] })).toBe(true);
  });

  it("keeps readiness whose unknown checks are the org's answer", () => {
    const missing = { checks: [{ status: "unknown", detail: "This org doesn't have the ProviderVisit object." }] };
    expect(isCacheable("studio_readiness", missing)).toBe(true);
  });

  it("rejects a published iPad whose live reads were cut short", () => {
    expect(isCacheable("studio_ipad_published", { dataNotes: ["Calendar accounts pane: showing the first 2,000 of 9,000 accounts by name."] })).toBe(false);
    expect(isCacheable("studio_ipad_published", { listErrors: { "Account.All": "Reading the list views took longer than the time budget" } })).toBe(false);
    expect(isCacheable("studio_ipad_published", { dashboards: { d: { title: "D", dataNote: "Query timed out after 120s" } } })).toBe(false);
  });

  it("keeps a published iPad whose gaps are the org's answer", () => {
    const answer = { dataNotes: [], listErrors: { "Account.Mine": "No such column 'Foo__c' on Account" }, dashboards: { d: { title: "D", dataNote: "No access to the report" } } };
    expect(isCacheable("studio_ipad_published", answer)).toBe(true);
  });

  it("keeps complete results", () => {
    expect(isCacheable("studio_list_profiles", { profiles: [] })).toBe(true);
  });
});

describe("isFresh", () => {
  it("expires after the TTL", () => {
    const now = Date.parse("2026-01-02T00:00:00Z");
    expect(isFresh("2026-01-01T12:00:00Z", now)).toBe(true);
    expect(isFresh(new Date(now - STUDIO_CACHE_TTL_MS - 1).toISOString(), now)).toBe(false);
    expect(isFresh("garbage", now)).toBe(false);
  });
});

describe("createInFlight", () => {
  it("shares one promise between concurrent identical calls, then starts fresh", async () => {
    const run = createInFlight<number>();
    let calls = 0;
    let release!: (n: number) => void;
    const start = () => {
      calls++;
      return new Promise<number>((r) => (release = r));
    };
    const a = run("k", start);
    const b = run("k", start);
    run("other", () => Promise.resolve(0));
    expect(calls).toBe(1);
    release(7);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    run("k", () => Promise.resolve(8));
    expect(await run("k", () => Promise.resolve(9))).toBe(8);
  });

  it("clears the entry when the call fails", async () => {
    const run = createInFlight<number>();
    await expect(run("k", () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await run("k", () => Promise.resolve(1))).toBe(1);
  });
});
