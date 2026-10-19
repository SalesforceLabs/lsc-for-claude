import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyAppOps as applyServerOps, appFixedTabs, appTabs } from "../../../src/studio/metadata/app-ops.js";
import { parseXml } from "../../../src/studio/metadata/xml.js";
import {
  alignAppNav,
  appFixedTabVerbs,
  appTabVerbs,
  appTargetOf,
  applyAppOps,
  buildAppBar,
  diffAppOps,
  draftAppBar,
  isAppTab,
  moveAppTabTo,
  reorderedAppNav,
  type AppDraft,
  type AppMatchState,
  type LiveAppState,
} from "../../../src-renderer/components/studio/app-nav-draft.js";
import type { PendingChange } from "../../../src-renderer/components/studio/changes.js";
import type { DraftTab } from "../../../src-renderer/components/studio/edit-draft.js";
import type { PublishedTab } from "../../../src-renderer/components/studio/published-types.js";
import type { AppOp, LiveApp } from "../../../src-renderer/components/studio/types.js";

const FULL_NAME = "lsc4ce__lifeSciencesCommercial";
const xml = readFileSync(join(__dirname, `../../fixtures/metadata/${FULL_NAME}.app-meta.xml`), "utf8");
const root = parseXml(xml);

/** What studio_metadata_doc reads (src/studio/metadata/live-app.ts). */
const live: LiveApp = {
  type: "CustomApplication",
  fullName: FULL_NAME,
  label: "Life Sciences Commercial",
  installed: true,
  tabs: appTabs(root, FULL_NAME),
  fixedTabs: appFixedTabs(root, FULL_NAME),
  available: [
    { name: "standard-Account", label: "Accounts", kind: "object" },
    { name: "standard-Case", label: "Cases", kind: "object" },
    { name: "standard-Visit", label: "Visits", kind: "object" },
    { name: "Pat_Sim", label: "Pat Sim", kind: "page" },
  ],
  profiles: ["LS PH Field Sales Representative"],
  production: false,
};
const base = live.tabs;

const tab = (fullName: string, kind: PublishedTab["kind"] = "object"): PublishedTab => ({ fullName, label: fullName, kind });
/** The bar the cache drew: the package's tabs, some of the subscriber's (the rest hidden for the profile), then Recent. */
const drawnNames = ["lsc4ce__Planner", "lsc4ce__IntelligentContent", "standard-Visit", "standard-Order", "Pat_Sim"];
const bar: DraftTab[] = [...live.fixedTabs, ...drawnNames].map((n) => ({ tab: tab(n), state: "same" as const }));
bar.push({ tab: tab("RecentItems", "recent"), state: "same" });
const hidden = new Set(base.filter((t) => !drawnNames.includes(t)));
const names = (b: DraftTab[]) => b.map((d) => d.tab.fullName);

function draftOf(pending: PendingChange[]): AppDraft {
  const target = appTargetOf(FULL_NAME, live, pending);
  const drawn = draftAppBar(bar, live, base, target, hidden);
  return { fullName: FULL_NAME, label: live.label, live, base, target, shown: drawn.filter((d) => d.state !== "removed" && target.includes(d.tab.fullName)).map((d) => d.tab.fullName) };
}
const opsOf = (pending: PendingChange[]): AppOp[] => {
  const fix = pending[0]?.fix;
  return fix?.kind === "editMetadata" ? (fix.ops as AppOp[]) : [];
};
const run = (d: AppDraft, name: string, id: string, pending: PendingChange[]) => {
  const v = appTabVerbs(d, name, name).find((x) => x.id === id)!;
  expect(v.run).toBeDefined();
  return v.run!(pending);
};

/** The renderer's ops, applied by the server to the retrieved XML, give the drawn target. */
function serverAgrees(pending: PendingChange[], target: string[]) {
  expect(appTabs(applyServerOps(root, FULL_NAME, opsOf(pending)).root, FULL_NAME)).toEqual(target);
}

describe("app ops (renderer)", () => {
  it("diffs to the shortest edit and back", () => {
    const target = ["standard-Order", ...base.filter((t) => t !== "standard-Order" && t !== "standard-Visit"), "standard-Case"];
    const ops = diffAppOps(base, target);
    expect(applyAppOps(base, [], ops)).toEqual(target);
    expect(diffAppOps(base, base)).toEqual([]);
  });

  it("refuses package tabs and tabs that are not in the app", () => {
    expect(() => applyAppOps(base, live.fixedTabs, [{ op: "removeAppTab", tab: "standard-home" }])).toThrow();
    expect(() => applyAppOps(base, live.fixedTabs, [{ op: "addAppTab", tab: "standard-Visit", before: null }])).toThrow();
    expect(() => applyAppOps(base, live.fixedTabs, [{ op: "moveAppTab", tab: "standard-Visit", before: "nope" }])).toThrow();
  });
});

describe("app bar", () => {
  it("lines up with the org's app, or not after Setup reordered it", () => {
    expect(alignAppNav(bar, live)).toBe(true);
    expect(alignAppNav(bar, { ...live, tabs: [...base].reverse() })).toBe(false);
  });

  it("leaves the bar alone with no edits", () => {
    expect(draftAppBar(bar, live, base, base, hidden)).toEqual(bar);
  });

  it("moves a tab left and right, one drawn tab at a time", () => {
    const d = draftOf([]);
    const left = run(d, "standard-Order", "up", []);
    const dl = draftOf(left);
    expect(names(draftAppBar(bar, live, base, dl.target, hidden))).toEqual([...live.fixedTabs, "lsc4ce__Planner", "lsc4ce__IntelligentContent", "standard-Order", "standard-Visit", "Pat_Sim", "RecentItems"]);
    serverAgrees(left, dl.target);
    // moving back leaves nothing in the tray when no tabs the profile doesn't see are in the way
    const right = run(d, "lsc4ce__Planner", "down", []);
    expect(run(draftOf(right), "lsc4ce__Planner", "up", right)).toEqual([]);
    expect(appTabVerbs(d, "lsc4ce__Planner", "x").find((v) => v.id === "up")!.run).toBeUndefined();
  });

  it("draws a removed tab as a ghost where it was and restores it", () => {
    const removed = run(draftOf([]), "standard-Visit", "remove", []);
    const d = draftOf(removed);
    const drawn = draftAppBar(bar, live, base, d.target, hidden);
    expect(names(drawn)).toEqual(names(bar));
    expect(drawn.find((x) => x.tab.fullName === "standard-Visit")!.state).toBe("removed");
    serverAgrees(removed, d.target);
    expect(appTabVerbs(d, "standard-Visit", "x").map((v) => v.id)).toEqual(["restore"]);
    expect(run(d, "standard-Visit", "restore", removed)).toEqual([]);
  });

  it("adds a tab after the one it was added behind, from tabs the app does not have", () => {
    const d = draftOf([]);
    const add = appTabVerbs(d, "standard-Visit", "x").find((v) => v.id === "addTab")!;
    expect(add.pick!.options.map((o) => o.value)).toEqual(["standard-Account", "standard-Case"]);
    const queued = add.pick!.run("standard-Case", []);
    const dn = draftOf(queued);
    const drawn = draftAppBar(bar, live, base, dn.target, hidden);
    expect(names(drawn)).toEqual([...live.fixedTabs, "lsc4ce__Planner", "lsc4ce__IntelligentContent", "standard-Visit", "standard-Case", "standard-Order", "Pat_Sim", "RecentItems"]);
    expect(drawn.find((x) => x.tab.fullName === "standard-Case")!.state).toBe("added");
    serverAgrees(queued, dn.target);
    // a package tab only offers adding, first among the arranged tabs
    const first = appFixedTabVerbs(d)[0].pick!.run("standard-Account", []);
    expect(draftOf(first).target[0]).toBe("standard-Account");
    expect(appFixedTabVerbs(d).map((v) => v.id)).toEqual(["addTab"]);
  });

  it("draws tabs Setup added since the publish", () => {
    const grown = { ...live, tabs: [...base, "standard-Case"] };
    const drawn = draftAppBar(bar, grown, grown.tabs, grown.tabs, hidden);
    expect(names(drawn)).toContain("standard-Case");
    expect(drawn.find((x) => x.tab.fullName === "standard-Case")!.tab.emptyReason).toMatch(/Publish to iPad/);
  });

  it("drops a tab on another with one diffed change", () => {
    const d = draftOf([]);
    const drawn = names(bar).filter((n) => n !== "RecentItems");
    const moved = moveAppTabTo(d, "Pat_Sim", "lsc4ce__Planner", drawn, [])!;
    const dm = draftOf(moved);
    expect(dm.target.indexOf("Pat_Sim")).toBeLessThan(dm.target.indexOf("lsc4ce__Planner"));
    serverAgrees(moved, dm.target);
    expect(moveAppTabTo(d, "Pat_Sim", "Pat_Sim", drawn, [])).toEqual([]);
    expect(moveAppTabTo(d, "Pat_Sim", null, drawn, [])).toEqual([]);
    expect(moveAppTabTo(d, "Pat_Sim", "unknown", drawn, [])).toBeNull();
  });

  it("knows which tabs the app arranges", () => {
    const d = draftOf([]);
    expect(isAppTab(d, "standard-Visit")).toBe(true);
    expect(isAppTab(d, "standard-home")).toBe(false);
  });
});

describe("buildAppBar", () => {
  const match: AppMatchState = { status: "ready", app: { fullName: FULL_NAME, label: live.label, installed: true } };
  const ready: Record<string, LiveAppState> = { [FULL_NAME]: { status: "ready", live } };

  it("reports each state without touching the bar", () => {
    expect(buildAppBar(bar, { status: "idle" }, {}, [], hidden)).toEqual({ bar, entry: { status: "none" } });
    expect(buildAppBar(bar, { status: "loading" }, {}, [], hidden).entry.status).toBe("loading");
    expect(buildAppBar(bar, { status: "error", error: "x" }, {}, [], hidden).entry.status).toBe("error");
    expect(buildAppBar(bar, { status: "ready", app: null, reason: "Two apps tie" }, {}, [], hidden).entry).toMatchObject({ status: "stale", note: "Two apps tie" });
    expect(buildAppBar(bar, match, {}, [], hidden).entry.status).toBe("loading");
    expect(buildAppBar(bar, match, { [FULL_NAME]: { status: "error", error: "boom" } }, [], hidden).entry.status).toBe("error");
  });

  it("is stale when the org's app no longer lines up, and when queued edits no longer fit", () => {
    const dropped = { ...live, tabs: base.filter((t) => t !== "standard-Order") };
    expect(buildAppBar(bar, match, { [FULL_NAME]: { status: "ready", live: dropped } }, [], hidden).entry.status).toBe("stale");
    const queued = run(draftOf([]), "standard-Visit", "remove", []);
    const changed = { ...live, tabs: base.filter((t) => t !== "standard-Visit") };
    expect(buildAppBar(bar, match, { [FULL_NAME]: { status: "ready", live: changed } }, queued, hidden).entry.status).toBe("stale");
  });

  it("draws a bar Setup only reordered in the org's order, marking the tabs that moved", () => {
    const tabs = ["standard-Order", ...base.filter((t) => t !== "standard-Order")];
    const reordered = { ...live, tabs };
    expect(reorderedAppNav(bar, reordered)).toBe(true);
    expect(reorderedAppNav(bar, live)).toBe(false);
    const { bar: drawn, entry } = buildAppBar(bar, match, { [FULL_NAME]: { status: "ready", live: reordered } }, [], hidden);
    expect(entry.status).toBe("ready");
    expect(drawn.filter((d) => d.ahead === "moved").map((d) => d.tab.fullName)).toEqual(["standard-Order"]);
  });

  it("draws the tray over the bar when ready", () => {
    const queued = run(draftOf([]), "standard-Visit", "remove", []);
    const { bar: drawn, entry } = buildAppBar(bar, match, ready, queued, hidden);
    expect(entry.status).toBe("ready");
    expect(drawn.find((x) => x.tab.fullName === "standard-Visit")!.state).toBe("removed");
  });
});
