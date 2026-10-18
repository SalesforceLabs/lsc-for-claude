import { describe, it, expect } from "vitest";
import {
  actionVerbs,
  draftHomeMenu,
  draftTabs,
  effectiveField,
  moveActionTo,
  moveTabTo,
  tabVerbs,
} from "../../../src-renderer/components/studio/edit-draft.js";
import { activeChange, queueChange, type PendingChange } from "../../../src-renderer/components/studio/changes.js";
import type { PublishedTab } from "../../../src-renderer/components/studio/published-types.js";
import type { CreateConfigFix, StudioItem } from "../../../src-renderer/components/studio/types.js";

const REP = "LS Rep";

function tabItem(dev: string, tabName: string, order: number, profiles = [REP], active = true): StudioItem {
  return {
    id: `UISchema:${dev}`,
    label: dev,
    active,
    properties: { TabName: tabName, TabOrder: order },
    audience: { profiles, permissionSets: [] },
    edit: {
      record: { type: "config", category: "UISchema", developerName: dev, label: dev },
      active,
      profiles: { source: "assignments", names: profiles },
    },
    findings: [],
  };
}

function quickAction(dev: string, actionName: string, sortOrder: number, profiles = REP): StudioItem {
  return {
    id: `QuickAction:${dev}`,
    label: dev,
    active: true,
    properties: { ActionName: actionName, Location: "HomePage", SortOrder: sortOrder, Profiles: profiles },
    audience: { profiles: profiles.split(";"), permissionSets: [] },
    edit: {
      record: { type: "config", category: "QuickAction", developerName: dev, label: dev },
      active: true,
      profiles: { source: "field", raw: profiles },
    },
    findings: [],
  };
}

const tab = (fullName: string, label = fullName): PublishedTab => ({ fullName, label, kind: "record" as PublishedTab["kind"] });

// Home (Lightning app), then the UI Settings tabs Accounts (10) and Calendar (20).
const published = [tab("standard-home", "Home"), tab("Account", "Accounts"), tab("Calendar")];
const items = [tabItem("TAB_Accounts", "Account", 10), tabItem("TAB_Calendar", "Calendar", 20)];

const run = (pending: PendingChange[], verbs: ReturnType<typeof tabVerbs>, id: string) => {
  const v = verbs.find((x) => x.id === id);
  expect(v?.run, `verb ${id}`).toBeTypeOf("function");
  return v!.run!(pending);
};

describe("draft tab bar", () => {
  it("is the published bar when the tray is empty", () => {
    const bar = draftTabs(published, items, [], REP);
    expect(bar.map((d) => [d.tab.fullName, d.state])).toEqual([
      ["standard-home", "same"],
      ["Account", "same"],
      ["Calendar", "same"],
    ]);
    expect(bar[0].item).toBeUndefined();
    expect(bar[1].item?.id).toBe("UISchema:TAB_Accounts");
  });

  it("moves a tab by swapping TabOrder with its UI Settings neighbour; Lightning tabs keep their slot", () => {
    const bar = draftTabs(published, items, [], REP);
    const pending = run([], tabVerbs(bar, 2, [], REP), "up");
    expect(pending.map((p) => p.fix)).toMatchObject([
      { kind: "setConfigField", developerName: "TAB_Calendar", field: "TabOrder", to: 10 },
      { kind: "setConfigField", developerName: "TAB_Accounts", field: "TabOrder", to: 20 },
    ]);
    expect(effectiveField(items[1], "TabOrder", pending)).toBe(10);
    const after = draftTabs(published, items, pending, REP);
    expect(after.map((d) => [d.tab.fullName, d.state])).toEqual([
      ["standard-home", "same"],
      ["Calendar", "moved"],
      ["Account", "moved"],
    ]);
    // Nothing UI Settings sits left of Accounts: Home is from the app.
    const left = tabVerbs(bar, 1, [], REP).find((v) => v.id === "up");
    expect(left?.run).toBeUndefined();
    expect(left?.reason).toMatch(/Lightning app/);
  });

  it("offers no verbs on tabs from the Lightning app", () => {
    expect(tabVerbs(draftTabs(published, items, [], REP), 0, [], REP)).toEqual([]);
  });

  it("keeps a hidden tab as a ghost, and offers to show it again", () => {
    const bar = draftTabs(published, items, [], REP);
    const pending = run([], tabVerbs(bar, 1, [], REP), "hide");
    expect(pending[0]).toMatchObject({ fix: { kind: "setProfileAssignments", to: [] }, affects: [REP] });
    const after = draftTabs(published, items, pending, REP);
    expect(after[1].state).toBe("removed");
    const verbs = tabVerbs(after, 1, pending, REP);
    expect(verbs.map((v) => v.id)).toEqual(["show"]);
    // Showing it again undoes the queued change.
    expect(run(pending, verbs, "show")).toEqual([]);
  });

  it("turning a tab off reaches every profile it's assigned to", () => {
    const shared = [tabItem("TAB_Accounts", "Account", 10, [REP, "LS Manager"]), items[1]];
    const bar = draftTabs(published, shared, [], REP);
    const off = tabVerbs(bar, 1, [], REP).find((v) => v.id === "off")!;
    expect(off.title).toMatch(/all 2 profiles/);
    const pending = off.run!([]);
    expect(pending[0]).toMatchObject({ fix: { kind: "setActive", to: false }, affects: [REP, "LS Manager"] });
    expect(draftTabs(published, shared, pending, REP)[1].state).toBe("removed");
  });

  it("adds tabs the tray switches on, after the UI Settings tab ordered before them", () => {
    const off = tabItem("TAB_Samples", "Samples", 15, [REP], false);
    const all = [...items, off];
    const pending = queueChange([], { fix: activeChange(off.edit!, true)! });
    const bar = draftTabs(published, all, pending, REP);
    expect(bar.map((d) => [d.tab.fullName, d.state])).toEqual([
      ["standard-home", "same"],
      ["Account", "same"],
      ["Samples", "added"],
      ["Calendar", "same"],
    ]);
    expect(bar[2].tab.kind).toBe("empty");
  });

  it("adds a queued new tab record, which can only be discarded", () => {
    const create: CreateConfigFix = {
      kind: "createConfigRecord",
      label: "New tab",
      category: "UISchema",
      developerName: "TAB_Inbox",
      recordLabel: "Inbox",
      fields: [
        { name: "TabName", value: "Inbox" },
        { name: "TabOrder", value: 99 },
      ] as CreateConfigFix["fields"],
      profiles: [REP],
      active: true,
    };
    const pending: PendingChange[] = [{ fix: create }];
    const bar = draftTabs(published, items, pending, REP);
    expect(bar.at(-1)).toMatchObject({ tab: { fullName: "Inbox", label: "Inbox" }, state: "added" });
    const verbs = tabVerbs(bar, bar.length - 1, pending, REP);
    expect(verbs.map((v) => v.id)).toEqual(["discard"]);
    expect(verbs[0].run!(pending)).toEqual([]);
  });
});

describe("draft Home menu", () => {
  const actions = [quickAction("New_Visit", "NewVisit", 1), quickAction("Email", "Email", 2)];
  const fabs = [
    { name: "NewVisit", label: "New Visit" },
    { name: "Email", label: "Email" },
  ];

  it("reorders quick actions by swapping SortOrder", () => {
    const menu = draftHomeMenu(fabs, actions, [], REP);
    expect(menu.map((d) => [d.value.name, d.state])).toEqual([
      ["NewVisit", "same"],
      ["Email", "same"],
    ]);
    const verbs = actionVerbs(menu, 1, [], REP);
    expect(verbs.find((v) => v.id === "down")?.run).toBeUndefined();
    const pending = run([], verbs, "up");
    const after = draftHomeMenu(fabs, actions, pending, REP);
    expect(after.map((d) => [d.value.name, d.state])).toEqual([
      ["Email", "moved"],
      ["NewVisit", "moved"],
    ]);
  });

  it("keeps an action hidden for the profile as a ghost where it was", () => {
    const menu = draftHomeMenu(fabs, actions, [], REP);
    const pending = run([], actionVerbs(menu, 0, [], REP), "hide");
    expect(pending[0].fix).toMatchObject({ kind: "setConfigField", field: "Profiles", to: "" });
    const after = draftHomeMenu(fabs, actions, pending, REP);
    expect(after.map((d) => [d.value.name, d.state])).toEqual([
      ["NewVisit", "removed"],
      ["Email", "same"],
    ]);
  });

  it("leaves out quick actions Home doesn't show", () => {
    const other = quickAction("Log_Call", "LogACall", 0);
    expect(draftHomeMenu(fabs, [...actions, other], [], REP).map((d) => d.value.name)).toEqual(["NewVisit", "Email"]);
  });
});

describe("drops in the tab bar and the Home menu", () => {
  const P: PendingChange[] = [];
  const bar3 = [...published, tab("Inbox")];
  const items3 = [...items, tabItem("TAB_Inbox", "Inbox", 30)];
  const names = (pending: PendingChange[]) => draftTabs(bar3, items3, pending, REP).map((d) => d.tab.fullName);

  it("queues nothing for a drop where the tab already is", () => {
    expect(moveTabTo(bar3, items3, REP, "Account", "Calendar", P)).toBe(P);
    expect(moveTabTo(bar3, items3, REP, "Account", "Account", P)).toBe(P);
    expect(moveTabTo(bar3, items3, REP, "Inbox", null, P)).toBe(P);
  });

  it("queues the swaps Move left would, one place at a time, and dropping it back leaves nothing", () => {
    const dropped = moveTabTo(bar3, items3, REP, "Inbox", "Account", P);
    const once = run(P, tabVerbs(draftTabs(bar3, items3, P, REP), 3, P, REP), "up");
    const twice = run(once, tabVerbs(draftTabs(bar3, items3, once, REP), 2, once, REP), "up");
    expect(dropped).toEqual(twice);
    expect(names(dropped)).toEqual(["standard-home", "Inbox", "Account", "Calendar"]);
    expect(moveTabTo(bar3, items3, REP, "Inbox", null, dropped)).toEqual([]);
  });

  it("stops at a Lightning app tab, which keeps its slot", () => {
    const dropped = moveTabTo(bar3, items3, REP, "Calendar", "standard-home", P);
    expect(names(dropped)).toEqual(["standard-home", "Calendar", "Account", "Inbox"]);
    expect(moveTabTo(bar3, items3, REP, "standard-home", null, P)).toBe(P);
  });

  it("moves a quick action as Move up / down would", () => {
    const actions = [quickAction("New_Visit", "NewVisit", 1), quickAction("Email", "Email", 2)];
    const fabs = [
      { name: "NewVisit", label: "New Visit" },
      { name: "Email", label: "Email" },
    ];
    expect(moveActionTo(fabs, actions, REP, "NewVisit", "Email", P)).toBe(P);
    const dropped = moveActionTo(fabs, actions, REP, "NewVisit", null, P);
    expect(dropped).toEqual(run(P, actionVerbs(draftHomeMenu(fabs, actions, P, REP), 0, P, REP), "down"));
    expect(draftHomeMenu(fabs, actions, dropped, REP).map((d) => d.value.name)).toEqual(["Email", "NewVisit"]);
    expect(moveActionTo(fabs, actions, REP, "NewVisit", "Email", dropped)).toEqual([]);
  });
});
