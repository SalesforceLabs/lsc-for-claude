import { describe, it, expect } from "vitest";
import type { FeatureMap, StudioItem, StudioSurface } from "../../../src-renderer/components/studio/types.js";
import { buildIpadPreview, sidebarEntries } from "../../../src-renderer/components/studio/ipad.js";
import { activeChange, layoutChange, profileChange, queueChange } from "../../../src-renderer/components/studio/changes.js";

type Props = StudioItem["properties"];

function config(category: string, name: string, properties: Props, profiles: string[] | null, active = true): StudioItem {
  const isField = category === "QuickAction" || category === "CustomAction";
  return {
    id: `${category}:${name}`,
    label: name,
    active,
    properties,
    audience: profiles ? { profiles, permissionSets: [] } : undefined,
    edit: {
      record: { type: "config", category, developerName: name, label: name },
      active,
      profiles: isField ? { source: "field", raw: (profiles ?? []).join(";") } : { source: "assignments", names: profiles ?? [] },
    },
    findings: [],
  };
}

const surface = (id: string, items: StudioItem[]): StudioSurface => ({ id, title: id, lane: "l", description: "", items, findings: [] });
const map = (featureId: string, surfaces: StudioSurface[]) =>
  ({ featureId, title: featureId, org: "o", collectedAt: "", objects: [], summary: "", lanes: [], surfaces }) as FeatureMap;

const tab = (name: string, order: number, profiles: string[]) =>
  config("UISchema", name, { Type: "TAB", TabOrder: order, TabName: name }, profiles);
const quick = (name: string, location: string, sobject: string, order: number, profiles: string[] | null, active = true) =>
  config("QuickAction", name, { Kind: "Quick Action", Location: location, SObject: sobject, SortOrder: order }, profiles, active);

const tabs = surface("navigationTabs", [tab("Accounts", 2, ["Rep"]), tab("Home", 1, ["Rep"]), tab("Visits", 3, ["Manager"])]);
const actionsMap = map("actions-home", [
  surface("homeActions", [quick("Log Call", "HomePage", "", 2, null), quick("New Visit", "HomePage", "", 1, ["Rep"]), quick("Old", "HomePage", "", 0, null, false)]),
  surface("otherQuickActions", [quick("Email", "Account", "Account", 1, ["Rep"]), quick("Manager Only", "Account", "Account", 2, ["Manager"])]),
  surface("nbcActions", [quick("NBC Visit", "NextBestCustomer", "Account", 1, ["Rep"])]),
  surface("searchActions", [quick("Search Visit", "Search", "Account", 1, null)]),
  tabs,
]);
const syncMap = map("mobile-sync", [
  surface("syncedObjects", [config("DbSchema", "Visit_All", { SObject: "Visit" }, null), config("DbSchema", "Acct_Mgr", { SObject: "Account" }, ["Manager"])]),
  surface("disabledObjects", []),
  surface("navigationTabs", tabs.items),
  surface("metadataCache", [{ id: "c1", label: "Org level", active: true, properties: { "Last generated": "2026-10-01T00:00:00Z" }, findings: [] }]),
]);

const rep = { profile: "Rep" };

describe("iPad preview", () => {
  it("shows the profile's tabs in order, its home page actions by sort order, and hides the rest", () => {
    const p = buildIpadPreview(actionsMap, syncMap, rep, []);
    expect(p.tabs.map((t) => t.label)).toEqual(["Home", "Accounts"]);
    expect(p.tabs.map((t) => t.object)).toEqual([undefined, "Account"]);
    expect(p.tabs[0].isHome).toBe(true);
    expect(p.homeMissing).toBe(false);
    expect(p.homeActions.map((a) => a.label)).toEqual(["New Visit", "Log Call"]);
    // Search and Next Best Customer actions create Accounts but don't show on Account records.
    expect(p.tabs[1].recordActions.map((a) => a.label)).toEqual(["Email"]);
    expect(p.nbcActions.map((a) => a.label)).toEqual(["NBC Visit"]);
    expect(p.hidden).toEqual({ tabs: 1, actions: 1 });
  });

  it("flags object tabs that don't sync to the profile and falls back to the org-level cache", () => {
    const p = buildIpadPreview(actionsMap, syncMap, rep, []);
    expect(p.tabs.find((t) => t.label === "Accounts")!.sync).toBe("notSynced");
    expect(p.tabs.find((t) => t.label === "Home")!.sync).toBe("unknown");
    expect(p.cache).toMatchObject({ state: "orgLevel" });
    expect(buildIpadPreview(actionsMap, null, rep, []).cache.state).toBe("unknown");
  });

  it("applies queued changes", () => {
    const logCall = actionsMap.surfaces[0].items[0];
    const visitTab = tabs.items[2];
    let pending = queueChange([], { fix: activeChange(logCall.edit!, false)! });
    pending = queueChange(pending, { fix: profileChange(visitTab.edit!, ["Manager", "Rep"])! });
    const p = buildIpadPreview(actionsMap, syncMap, rep, pending);
    expect(p.homeActions.map((a) => a.label)).toEqual(["New Visit"]);
    expect(p.tabs.map((t) => [t.label, t.pending])).toEqual([["Home", false], ["Accounts", false], ["Visits", true]]);
    expect(p.tabs[2].sync).toBe("synced");
  });

  it("shows everything that's on when no profile is picked", () => {
    const p = buildIpadPreview(actionsMap, syncMap, null, []);
    expect(p.tabs).toHaveLength(3);
    expect(p.homeActions).toHaveLength(2);
  });
});

describe("Visit engagement sidebar", () => {
  const sidebar = { layoutName: "Visit-Visit Layout", relatedLists: ["ProviderVisits", "Samples"], max: 10, candidates: [] };

  it("applies queued adds and removes for the same layout only", () => {
    let pending = queueChange([], { fix: layoutChange("Visit-Visit Layout", "Visit Layout", { objectName: "Survey__c", relationshipName: "Surveys__r" }, true) });
    pending = queueChange(pending, { fix: layoutChange("Visit-Visit Layout", "Visit Layout", { objectName: "Sample", relationshipName: "Samples" }, false) });
    pending = queueChange(pending, { fix: layoutChange("Visit-Other", "Other", { objectName: "X__c", relationshipName: "X__r" }, true) });
    expect(sidebarEntries(sidebar, pending)).toEqual([
      { relationshipName: "ProviderVisits" },
      { relationshipName: "Samples", pending: "remove" },
      { relationshipName: "Surveys__r", objectName: "Survey__c", pending: "add" },
    ]);
  });
});
