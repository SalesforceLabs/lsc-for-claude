import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aheadDocuments,
  buildOrgAhead,
  groupItems,
  indicatorFor,
  indicatorLabel,
  inspectorNote,
  knownDocuments,
  movedKeys,
  orgAheadFor,
  orgAheadTab,
  ORG_AHEAD_CLASS,
  ORG_AHEAD_MOVED,
  ORG_AHEAD_TAG,
  orgAheadTag,
  revealPlan,
  timeAgo,
  whoWhen,
  type UnpublishedItem,
  type UnpublishedResult,
} from "../../../src-renderer/components/studio/org-ahead";
import type { PublishedIpad } from "../../../src-renderer/components/studio/published-types";

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const item = (kind: UnpublishedItem["kind"], name: string, at: string, extra: Partial<UnpublishedItem> = {}): UnpublishedItem => ({
  id: `${kind}:${name}`,
  kind,
  name,
  label: name,
  lastModifiedAt: at,
  lastModifiedBy: "Ann",
  target: `metadata:x:${name}`,
  ...extra,
});
const result = (over: Partial<UnpublishedResult> = {}): UnpublishedResult => ({
  profile: "Rep",
  cacheAt: "2026-10-15T12:00:00.000Z",
  cacheStartedAt: "2026-10-15T11:58:00.000Z",
  checkedAt: "2026-10-18T12:00:00.000Z",
  noCache: false,
  items: [],
  errors: [],
  scoped: true,
  ...over,
});

describe("indicator", () => {
  it("is loading until there is an answer", () => {
    expect(indicatorFor(undefined).kind).toBe("loading");
    expect(indicatorFor({ status: "loading" }).kind).toBe("loading");
  });

  it("says up to date only when nothing is waiting and every kind was read", () => {
    const i = indicatorFor({ status: "ready", result: result() });
    expect(i.kind).toBe("upToDate");
    expect(indicatorLabel(i, NOW)).toBe("iPads up to date · published 3 days ago");
  });

  it("never says up to date when part of the check failed", () => {
    const i = indicatorFor({ status: "ready", result: result({ errors: [{ kind: "Layouts", message: "boom" }] }) });
    expect(i.kind).toBe("partial");
    expect(indicatorLabel(i)).toBe("Couldn't check for unpublished changes");
    expect(indicatorFor({ status: "error", error: "x" }).kind).toBe("error");
  });

  it("counts changes that need a publish and leaves live list views out", () => {
    const items = [item("layout", "A", "2026-10-17T00:00:00.000Z"), item("listView", "Account.Mine", "2026-10-17T00:00:00.000Z", { live: true })];
    const i = indicatorFor({ status: "ready", result: result({ items }) });
    expect(i).toMatchObject({ kind: "changes", count: 1 });
    expect(indicatorLabel(i)).toBe("1 change not on iPads yet");
    expect(indicatorLabel({ kind: "changes", count: 3, incomplete: false, publishedAt: null })).toBe("3 changes not on iPads yet");
  });

  it("only live changes means up to date", () => {
    const items = [item("listView", "Account.Mine", "2026-10-17T00:00:00.000Z", { live: true })];
    expect(indicatorFor({ status: "ready", result: result({ items }) }).kind).toBe("upToDate");
  });

  it("keeps showing changes when part of the check failed, and flags it", () => {
    const items = [item("layout", "A", "2026-10-17T00:00:00.000Z")];
    expect(indicatorFor({ status: "ready", result: result({ items, errors: [{ kind: "Tabs", message: "x" }] }) })).toMatchObject({ kind: "changes", incomplete: true });
  });

  it("a profile that was never published is its own state", () => {
    expect(indicatorFor({ status: "ready", result: result({ noCache: true, cacheAt: null }) }).kind).toBe("neverPublished");
  });
});

describe("timeAgo", () => {
  it("reads naturally", () => {
    const ago = (ms: number) => timeAgo(new Date(NOW - ms).toISOString(), NOW);
    expect(ago(10_000)).toBe("just now");
    expect(ago(12 * 60_000)).toBe("12 min ago");
    expect(ago(60 * 60_000)).toBe("1 hour ago");
    expect(ago(3 * 3600_000)).toBe("3 hours ago");
    expect(ago(30 * 3600_000)).toBe("yesterday");
    expect(ago(5 * 86400_000)).toBe("5 days ago");
    expect(timeAgo("nonsense", NOW)).toBe("");
  });

  it("names who when it knows", () => {
    expect(whoWhen(item("layout", "A", new Date(NOW - 3600_000).toISOString()), NOW)).toBe("Ann · 1 hour ago");
    expect(whoWhen(item("flexiPage", "P", new Date(NOW - 3600_000).toISOString(), { lastModifiedBy: null }), NOW)).toBe("1 hour ago");
  });
});

describe("groupItems", () => {
  it("groups by kind in a fixed order, newest first, dropping empty groups", () => {
    const groups = groupItems([
      item("dbSchema", "DbSchema:X", "2026-10-17T00:00:00.000Z"),
      item("layout", "Old", "2026-10-10T00:00:00.000Z"),
      item("tab", "Tab", "2026-10-16T00:00:00.000Z"),
      item("layout", "New", "2026-10-17T00:00:00.000Z"),
      item("listView", "Account.Mine", "2026-10-17T00:00:00.000Z", { live: true }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(["pages", "tabs", "sync", "live"]);
    expect(groups[0].items.map((i) => i.name)).toEqual(["New", "Old"]);
    expect(groups[3].note).toMatch(/no publish/);
  });
});

describe("inspector note", () => {
  it("says what changed, who and that iPads keep the old version", () => {
    const n = inspectorNote(item("layout", "A", "2026-10-17T12:00:00.000Z"));
    expect(n).toMatch(/^Changed in the org on .* by Ann\. iPads still show this version until you publish\.$/);
  });

  it("says live items need no publish and omits an unknown editor", () => {
    const n = inspectorNote(item("listView", "A.B", "2026-10-17T12:00:00.000Z", { live: true, lastModifiedBy: null }));
    expect(n).toMatch(/reps already have it/);
    expect(n).not.toMatch(/ by /);
  });
});

const snapshot = {
  tabs: [
    { fullName: "standard-Account", label: "Accounts", kind: "object", sobject: "Account" },
    { fullName: "Home_Tab", label: "Home", kind: "home" },
  ],
  layouts: { "Account-Account Layout": { name: "Account-Account Layout", sections: [{ label: "Info", columns: [[]] }], relatedLists: [], actions: [] } },
  compactLayouts: { "Account.Compact": ["Name"] },
  pages: { Home_Rep: {} },
  home: { name: "Home_Rep" },
  objects: { Account: { name: "Account", recordTypes: [{ name: "Person", layout: "Account-Account Layout", flexiPage: null }], listViews: [{ name: "Mine" }] } },
  records: { byId: { r1: { id: "r1", object: "Account" } } },
} as unknown as PublishedIpad;

describe("scoping and markers", () => {
  it("names the documents the snapshot references", () => {
    expect(knownDocuments(snapshot)).toEqual({
      layouts: ["Account-Account Layout"],
      compactLayouts: ["Account.Compact"],
      flexiPages: ["Home_Rep"],
      recordTypes: ["Account.Person"],
      listViews: ["Account.Mine"],
      tabs: ["standard-Account", "Home_Tab"],
    });
  });

  it("indexes changes by normalized name and finds them for a selected block", () => {
    const idx = buildOrgAhead([item("layout", "account-account%20layout", "2026-10-17T00:00:00.000Z"), item("tab", "Home_Tab", "2026-10-17T00:00:00.000Z")]);
    expect(idx.count).toBe(2);
    expect(orgAheadTab(idx, "home_tab")).toBeDefined();
    expect(orgAheadFor(idx, { kind: "section", layout: "Account-Account Layout", index: 0, count: 1, label: "Info" })).toBeDefined();
    expect(orgAheadFor(idx, { kind: "tab", fullName: "standard-Account", label: "Accounts", index: 0 })).toBeUndefined();
  });
});

describe("moves in the org", () => {
  it("marks only what left the longest run kept in order", () => {
    expect([...movedKeys(["a", "b", "c", "d"], ["d", "a", "b", "c"])]).toEqual(["d"]);
    expect([...movedKeys(["a", "b", "c"], ["a", "b", "c"])]).toEqual([]);
    expect(movedKeys(["a", "b", "c"], ["c", "b", "a"]).size).toBe(2);
    // Items on one side only aren't moves.
    expect([...movedKeys(["a", "b", "c"], ["x", "b", "c", "a"])]).toEqual(["a"]);
  });

  it("tags moved blocks apart from new ones", () => {
    expect(orgAheadTag("moved")).toBe(ORG_AHEAD_MOVED);
    expect(orgAheadTag("added")).toBe(ORG_AHEAD_TAG);
  });

  it("names the changed documents Next publish reads from the org", () => {
    const idx = buildOrgAhead([item("layout", "Account-Account Layout", "2026-10-17T00:00:00.000Z"), item("listView", "Account.Mine", "2026-10-17T00:00:00.000Z")]);
    expect(aheadDocuments(idx, snapshot)).toEqual({ layouts: ["Account-Account Layout"], compacts: [], listViews: ["Account.Mine"], pages: [] });
    expect(aheadDocuments(buildOrgAhead([]), snapshot).layouts).toEqual([]);
  });
});

describe("revealPlan", () => {
  it("opens a layout on its object's tab, in a record, with the first section selected", () => {
    const plan = revealPlan(item("layout", "Account-Account Layout", "2026-10-17T00:00:00.000Z"), snapshot);
    expect(plan).toMatchObject({ kind: "preview", tab: "standard-Account", record: true, select: { kind: "section", layout: "Account-Account Layout" } });
  });

  it("opens a tab and selects it", () => {
    expect(revealPlan(item("tab", "Home_Tab", "2026-10-17T00:00:00.000Z"), snapshot)).toMatchObject({ kind: "preview", tab: "Home_Tab", record: false, select: { kind: "tab" } });
  });

  it("sends Admin Console changes to their Setup page", () => {
    expect(revealPlan(item("dbSchema", "DbSchema:DbSchema_X", "2026-10-17T00:00:00.000Z"), snapshot)).toMatchObject({ kind: "setup", feature: "mobile-sync" });
  });

  it("gives nothing for a document the snapshot doesn't have", () => {
    expect(revealPlan(item("layout", "Case-Other", "2026-10-17T00:00:00.000Z"), snapshot)).toBeNull();
  });
});

describe("draft marking constants", () => {
  it("record.css draws the class and the tag the Draft drawers and this module name", () => {
    const css = readFileSync(join(__dirname, "../../../src-renderer/components/studio/record.css"), "utf8");
    expect(css).toContain(`.${ORG_AHEAD_CLASS}`);
    expect(css).toContain(`content: "${ORG_AHEAD_TAG}"`);
  });
});
