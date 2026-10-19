import { describe, expect, it } from "vitest";
import { isPublishWarning, reachFor, whatHappensNext } from "../../../src-renderer/components/studio/what-next";
import type { PendingChange } from "../../../src-renderer/components/studio/changes";
import type { FixPreview, StudioFix } from "../../../src-renderer/components/studio/types";

const change = (fix: Record<string, unknown>, affects?: string[]): PendingChange => ({ fix: { label: "x", ...fix } as unknown as StudioFix, ...(affects ? { affects } : {}) });
const layout = change({ kind: "editMetadata", doc: { type: "Layout", fullName: "A", label: "A" } }, ["Rep"]);
const listView = change({ kind: "editMetadata", doc: { type: "ListView", fullName: "Account.Mine", label: "Mine" } });
const psl = change({ kind: "assignPsl" });
const dbSchema = change({ kind: "setConfigField", category: "DbSchema", developerName: "D", field: "WhereSoql" }, ["Rep", "Manager"]);

describe("reachFor", () => {
  it("works out reach by kind when the preview has none", () => {
    expect(reachFor(layout)).toEqual({ desktop: "now", ipad: "publish", profiles: ["Rep"] });
    expect(reachFor(listView)).toEqual({ desktop: "now", ipad: "live" });
    expect(reachFor(psl)).toEqual({ desktop: "now", ipad: "nextSync" });
    expect(reachFor(dbSchema)).toEqual({ desktop: "none", ipad: "publish", profiles: ["Rep", "Manager"] });
  });

  it("prefers the server's reach", () => {
    const preview = { reach: { desktop: "none", ipad: "live", profiles: ["Ops"] } } as unknown as FixPreview;
    expect(reachFor(layout, preview)).toEqual({ desktop: "none", ipad: "live", profiles: ["Ops"] });
  });
});

describe("whatHappensNext", () => {
  const reaches = [layout, listView, psl, dbSchema].map((c) => reachFor(c));

  it("gives one line per way the changes travel", () => {
    expect(whatHappensNext(reaches).map((l) => l.text)).toEqual([
      "Desktop users see 3 changes as soon as you apply",
      "iPads get 2 changes after you publish to Rep, Manager",
      "1 list view change updates on iPads right away",
      "1 change reaches reps on their next sync",
    ]);
  });

  it("says the same after applying, in the past", () => {
    expect(whatHappensNext(reaches, { done: true }).map((l) => l.kind)).toEqual(whatHappensNext(reaches).map((l) => l.kind));
    expect(whatHappensNext(reaches, { done: true })[0].text).toBe("Desktop users see 3 changes now");
  });

  it("shortens long profile lists", () => {
    const r = reachFor(change({ kind: "editMetadata", doc: { type: "Layout" } }, ["A", "B", "C", "D"]));
    expect(whatHappensNext([r])[1].text).toBe("iPads get 1 change after you publish to A, B and 2 more profiles");
  });

  it("recognizes the server's publish warning", () => {
    expect(isPublishWarning("Publish to iPad afterwards so reps get the change.")).toBe(true);
    expect(isPublishWarning("This page is shared.")).toBe(false);
  });
});
