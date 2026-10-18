import { describe, it, expect } from "vitest";
import type { FeatureMap, StudioItem, StudioSurface } from "../../../src-renderer/components/studio/types.js";
import { checklist, checklistSteps, copyChanges, copySources } from "../../../src-renderer/components/studio/checklist.js";
import { queueChange } from "../../../src-renderer/components/studio/changes.js";

const care = { profile: "PSP Care Manager" };

function schema(id: string, profiles: string[], active = true): StudioItem {
  return {
    id,
    label: id,
    active,
    properties: {},
    findings: [],
    audience: { profiles, permissionSets: [] },
    edit: {
      record: { type: "config", category: "DbSchema", developerName: id, label: id },
      active,
      profiles: { source: "assignments", names: profiles },
    },
  };
}

function surface(id: string, items: StudioItem[], extra: Partial<StudioSurface> = {}): StudioSurface {
  return { id, title: id, lane: "l", description: "", items, findings: [], ...extra };
}

const rep = "LS MT Field Sales Rep";
const synced = surface("syncedObjects", [schema("Account", [rep]), schema("Visit", [rep, "Manager"]), schema("Order", ["Manager"])]);
const profiles = surface("mobileProfiles", [
  { id: "p:rep", label: rep, sublabel: "2 objects · 0 tabs", properties: {}, findings: [], audience: { profiles: [rep], permissionSets: [] } },
]);
const sync = surface("syncSettings", [{ id: "log", label: "Log level", properties: {}, findings: [] }]);

const map: FeatureMap = {
  featureId: "mobileSync",
  title: "Mobile Sync",
  org: "org",
  collectedAt: "",
  objects: [],
  summary: "",
  lanes: [{ id: "l", title: "L" }],
  surfaces: [synced, profiles, sync],
  checklist: [
    { surface: "mobileProfiles", label: "Mobile access", missing: "Not one of the {total} mobile profiles" },
    { surface: "syncedObjects", label: "Synced objects" },
    { surface: "gone", label: "Not in this map" },
    { surface: "syncSettings", label: "Sync" },
  ],
};

describe("View as checklist", () => {
  it("uses the feature's steps, skipping surfaces the map doesn't have", () => {
    expect(checklistSteps(map).map((s) => s.label)).toEqual(["Mobile access", "Synced objects", "Sync"]);
    expect(checklistSteps({ ...map, checklist: undefined }).map((s) => s.surface)).toEqual(["syncedObjects", "mobileProfiles", "syncSettings"]);
  });

  it("flags what a profile gets none of, and leaves org-wide surfaces neutral", () => {
    const [access, objects, settings] = checklist(map, care);
    expect(access).toMatchObject({ status: "missing", detail: "Not one of the 1 mobile profiles", scoped: true });
    expect(objects).toMatchObject({ status: "missing", detail: "None of the 3 apply to this profile" });
    expect(settings).toMatchObject({ status: "everyone", detail: "1 record", scoped: false });
  });

  it("doesn't treat a surface of inactive records as a check", () => {
    const disabled = surface("disabledObjects", [schema("Order", ["Manager"], false), schema("Case", [rep], false)]);
    const [row] = checklist({ ...map, surfaces: [disabled], checklist: undefined }, care);
    expect(row).toMatchObject({ status: "everyone", detail: "2 inactive", scoped: false });
  });

  it("describes what the profile gets without repeating its own name", () => {
    const [access, objects] = checklist(map, { profile: rep });
    expect(access).toMatchObject({ status: "ok", detail: "2 objects · 0 tabs" });
    expect(objects).toMatchObject({ status: "ok", detail: "Account, Visit" });
  });

  it("ranks profiles to copy from and queues one change per record", () => {
    expect(copySources([synced], care)).toEqual([
      { profile: rep, count: 2 },
      { profile: "Manager", count: 2 },
    ]);
    const { matched, changes } = copyChanges([synced], care, rep, []);
    expect(matched).toBe(2);
    expect(changes.map((c) => c.fix)).toMatchObject([
      { kind: "setProfileAssignments", developerName: "Account", from: [rep], to: [rep, care.profile], label: `Show Account to ${care.profile}` },
      { kind: "setProfileAssignments", developerName: "Visit", from: [rep, "Manager"], to: [rep, "Manager", care.profile] },
    ]);
    expect(changes[0].affects).toEqual([rep, care.profile]);
  });

  it("skips inactive records and ones already given in the tray", () => {
    const withInactive = surface("s", [schema("Account", [rep]), schema("Old", [rep], false)]);
    const first = copyChanges([withInactive], care, rep, []);
    expect(first.changes).toHaveLength(1);
    const pending = queueChange([], first.changes[0]);
    expect(copyChanges([withInactive], care, rep, pending)).toEqual({ matched: 1, changes: [] });
  });
});
