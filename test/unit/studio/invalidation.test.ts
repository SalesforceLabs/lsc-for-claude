import { describe, expect, it } from "vitest";
import {
  INVALIDATED_BY_PUBLISH,
  bumpGeneration,
  fixAffectsPublished,
  generationOf,
  toolsInvalidatedByApply,
} from "../../../src-electron/engine/studio-invalidation.js";
import { fixAffectsPublished as rendererAffectsPublished, markAllStale, needsLoad, isRevalidating } from "../../../src-renderer/components/studio/fix-effects.js";
import { pickToLoad } from "../../../src-renderer/components/studio/overview-helpers.js";
import { createInFlight } from "../../../src-electron/engine/in-flight.js";

const edit = (type: string) => ({ kind: "editMetadata", doc: { type, fullName: "X" }, ops: [] });

describe("what an applied change drops from the cache", () => {
  it("always drops maps, item details, readiness and the overview", () => {
    for (const fix of [{ kind: "setActive" }, edit("Layout"), { kind: "assignPsl" }]) {
      const dropped = toolsInvalidatedByApply(fix);
      for (const tool of ["studio_feature_map", "studio_item_detail", "studio_readiness", "studio_setup_overview"]) {
        expect(dropped).toContain(tool);
      }
    }
  });

  it("keeps the slow published iPad unless the change is read live from the org", () => {
    expect(toolsInvalidatedByApply({ kind: "setActive" })).not.toContain("studio_ipad_published");
    expect(toolsInvalidatedByApply({ kind: "setConfigField" })).not.toContain("studio_ipad_published");
    expect(toolsInvalidatedByApply(edit("Layout"))).not.toContain("studio_ipad_published");
    expect(toolsInvalidatedByApply(edit("ListView"))).toContain("studio_ipad_published");
    expect(toolsInvalidatedByApply({ kind: "copyForProfile" })).toContain("studio_ipad_published");
  });

  it("keeps the profile list and permission options", () => {
    const dropped = toolsInvalidatedByApply({ kind: "setConfigField" });
    expect(dropped).not.toContain("studio_list_profiles");
    expect(dropped).not.toContain("studio_access_options");
  });

  it("drops sync results only for changes that can alter what a rep syncs", () => {
    expect(toolsInvalidatedByApply({ kind: "setConfigField" })).toContain("studio_sync_user");
    expect(toolsInvalidatedByApply({ kind: "assignAccess" })).toContain("studio_sync_overview");
    expect(toolsInvalidatedByApply(edit("Layout"))).not.toContain("studio_sync_user");
    expect(toolsInvalidatedByApply({ kind: "setCustomScriptCode" })).not.toContain("studio_sync_user");
  });

  it("drops the published iPad after a publish", () => {
    expect(INVALIDATED_BY_PUBLISH).toContain("studio_ipad_published");
  });

  it("the renderer's copy agrees with the main process", () => {
    for (const fix of [edit("ListView"), edit("Layout"), edit("FlexiPage"), { kind: "copyForProfile" }, { kind: "setActive" }, null, undefined]) {
      expect(rendererAffectsPublished(fix)).toBe(fixAffectsPublished(fix));
    }
  });
});

describe("loads that began before a write", () => {
  it("do not share a load keyed by a newer generation", async () => {
    const inFlight = createInFlight<string>();
    const key = (gen: number) => `org|tool|{}|false|${gen}`;
    let release: (v: string) => void = () => {};
    const before = inFlight(key(generationOf("o1")), () => new Promise<string>((r) => (release = r)));
    bumpGeneration("o1");
    const after = inFlight(key(generationOf("o1")), async () => "fresh");
    expect(await after).toBe("fresh");
    release("old");
    expect(await before).toBe("old");
  });

  it("bumps per org", () => {
    const a = generationOf("orgA");
    bumpGeneration("orgB");
    expect(generationOf("orgA")).toBe(a);
  });
});

describe("stale-while-revalidate state", () => {
  const ready = (n: number) => ({ status: "ready" as const, value: n });

  it("keeps finished results (marked stale) and drops the rest", () => {
    const next = markAllStale<{ status: string; value?: number; error?: string }>({
      a: ready(1),
      b: { status: "loading" },
      c: { status: "error", error: "x" },
    });
    expect(Object.keys(next)).toEqual(["a"]);
    expect(next.a).toMatchObject({ status: "ready", value: 1, stale: true, refreshing: false });
    expect(isRevalidating(next.a)).toBe(true);
  });

  it("asks for a load when missing or stale, not while refreshing or current", () => {
    expect(needsLoad(undefined)).toBe(true);
    expect(needsLoad({ ...ready(1), stale: true })).toBe(true);
    expect(needsLoad({ ...ready(1), stale: true, refreshing: true })).toBe(false);
    expect(needsLoad(ready(1))).toBe(false);
    expect(needsLoad({ status: "loading" })).toBe(false);
    expect(needsLoad({ status: "error" })).toBe(false);
  });

  it("the Overview reloads stale features within its concurrency limit and not those already refreshing", () => {
    const readiness: Record<string, never> = {
      a: { status: "ready", readiness: {}, stale: true },
      b: { status: "ready", readiness: {}, stale: true, refreshing: true },
      c: { status: "ready", readiness: {} },
      d: { status: "ready", readiness: {}, stale: true },
    } as never;
    expect(pickToLoad(["a", "b", "c", "d"], readiness, new Set(), 3)).toEqual(["a", "d"].slice(0, 2));
    // b is in flight, so only two slots are free.
    expect(pickToLoad(["a", "b", "c", "d"], readiness, new Set(), 2)).toEqual(["a"]);
  });
});
