import { describe, it, expect } from "vitest";
import { reachOfFix, withReach } from "../../../src/studio/reach.js";
import { PUBLISH_WARNING } from "../../../src/studio/change-helpers.js";
import { configItems, listViewItems, layoutItems } from "../../../src/studio/unpublished-logic.js";
import type { FixPreview, StudioFix } from "../../../src/studio/types.js";

const doc = (type: string, fullName = "Account-Account Layout") => ({ type, fullName, label: fullName }) as never;
const metadata = (type: string): StudioFix => ({ kind: "editMetadata", label: "x", doc: doc(type), ops: [] }) as never;

describe("reachOfFix", () => {
  it("sends documents to desktop now and to iPads on publish", () => {
    for (const type of ["Layout", "CompactLayout", "FlexiPage", "CustomApplication"]) {
      expect(reachOfFix(metadata(type))).toEqual({ desktop: "now", ipad: "publish" });
    }
    expect(reachOfFix(metadata("Layout"), ["Rep", "rep", "MSL"])).toEqual({ desktop: "now", ipad: "publish", profiles: ["Rep", "MSL"] });
  });

  it("makes list views live on the iPad", () => {
    expect(reachOfFix(metadata("ListView"), ["Rep"])).toEqual({ desktop: "now", ipad: "live" });
  });

  it("names the one profile a copy is made for", () => {
    const fix = { kind: "copyForProfile", label: "x", doc: doc("Layout"), copy: { fullName: "c", label: "c" }, profile: "LS Rep" } as StudioFix;
    expect(reachOfFix(fix)).toEqual({ desktop: "now", ipad: "publish", profiles: ["LS Rep"] });
  });

  it("puts mobile Admin Console records on iPads only, after a publish, with the profiles they name", () => {
    const assign: StudioFix = { kind: "setProfileAssignments", label: "x", category: "DbSchema", developerName: "d", recordLabel: "d", from: ["A"], to: ["A", "B"] };
    expect(reachOfFix(assign)).toEqual({ desktop: "none", ipad: "publish", profiles: ["A", "B"] });
    const field: StudioFix = { kind: "setConfigField", label: "x", category: "QuickAction", developerName: "d", recordLabel: "d", field: "Profiles", from: "A", to: "A,C" };
    expect(reachOfFix(field)).toEqual({ desktop: "none", ipad: "publish", profiles: ["A", "C"] });
    const value: StudioFix = { ...field, field: "Label", from: "Old", to: "New" };
    expect(reachOfFix(value)).toEqual({ desktop: "none", ipad: "publish" });
    const create = { kind: "createConfigRecord", label: "x", category: "ApplicationSettings", developerName: "d", recordLabel: "d", fields: [], profiles: ["Rep"], active: true } as StudioFix;
    expect(reachOfFix(create)).toEqual({ desktop: "none", ipad: "publish", profiles: ["Rep"] });
    const active: StudioFix = { kind: "setActive", label: "x", record: { type: "config", category: "UISchema", developerName: "t", label: "t" }, from: false, to: true };
    expect(reachOfFix(active).ipad).toBe("publish");
  });

  it("leaves other Admin Console categories off the iPad", () => {
    const fix: StudioFix = { kind: "setConfigField", label: "x", category: "TerritoryAlignment", developerName: "d", recordLabel: "d", field: "F", from: 1, to: 2 };
    expect(reachOfFix(fix)).toEqual({ desktop: "now", ipad: "none" });
  });

  it("delivers access and server logic on the rep's next sync", () => {
    const psl: StudioFix = { kind: "assignPsl", label: "x", userId: "u", userName: "U", pslId: "p", pslLabel: "P" };
    const handler: StudioFix = { kind: "setActive", label: "x", record: { type: "triggerHandler", developerName: "h", label: "h" }, from: true, to: false };
    const rule: StudioFix = { kind: "setActive", label: "x", record: { type: "validationRule", id: "v", label: "v" }, from: true, to: false };
    for (const fix of [psl, handler, rule]) expect(reachOfFix(fix)).toEqual({ desktop: "now", ipad: "nextSync" });
  });

  it("needs a publish for custom script code (the iPad reads it from the cache)", () => {
    const fix: StudioFix = { kind: "setCustomScriptCode", label: "x", scriptId: "s", scriptName: "s", from: "a", to: "b" };
    expect(reachOfFix(fix).ipad).toBe("publish");
  });
});

describe("withReach", () => {
  const preview = (warnings: string[]): FixPreview => ({ org: "o", title: "t", changes: [], warnings });

  it("drops the publish warning when no publish is needed", () => {
    const out = withReach(preview(["Deploys it.", PUBLISH_WARNING]), metadata("ListView"));
    expect(out.warnings).toEqual(["Deploys it."]);
    expect(out.reach?.ipad).toBe("live");
  });

  it("keeps the warning and a reach the preview worked out itself", () => {
    const own = { desktop: "now" as const, ipad: "publish" as const, profiles: ["Rep"] };
    const out = withReach({ ...preview([PUBLISH_WARNING]), reach: own }, metadata("FlexiPage"));
    expect(out.warnings).toEqual([PUBLISH_WARNING]);
    expect(out.reach).toBe(own);
  });
});

describe("unpublished items' reach", () => {
  const row = { LastModifiedDate: new Date().toISOString(), LastModifiedBy: { Name: "A" } };

  it("is live for list views and publish for documents", () => {
    expect(listViewItems([{ ...row, Id: "1", DeveloperName: "Mine", Name: "Mine", SobjectType: "Account" }], undefined)[0].reach).toEqual({ desktop: "now", ipad: "live" });
    expect(layoutItems([{ ...row, Id: "1", Name: "Account Layout", TableEnumOrId: "Account" }], undefined)[0].reach).toEqual({ desktop: "now", ipad: "publish" });
  });

  it("is iPad-only, after a publish, for Admin Console records", () => {
    const base = { recordId: "r", category: "DbSchema", developerName: "d", at: Date.now(), by: null, allProfiles: true, profileIds: [] };
    expect(configItems([{ ...base, changedFields: ["WhereSoql"] }], "p", 0)[0].reach).toEqual({ desktop: "none", ipad: "publish" });
  });
});
