import { describe, it, expect } from "vitest";
import {
  describeTarget,
  layoutObject,
  syncAction,
  syncFilter,
  targetKey,
  targetTag,
  type DescribeContext,
} from "../../../src-renderer/components/studio/edit-targets.js";
import type { PublishedIpad } from "../../../src-renderer/components/studio/published-types.js";
import type { CreateConfigFix, StudioItem, StudioSurface } from "../../../src-renderer/components/studio/types.js";

const REP = "LS Rep";
const snapshot = {
  tabs: [],
  objects: { Account: { hiddenListViews: ["Old"] } },
  sync: { Account: "", Visit: "OwnerId = {userId}" },
} as unknown as PublishedIpad;
const ctx: DescribeContext = { snapshot, profile: REP, pending: [], tabs: [], homeMenu: [] };

function dbSchema(dev: string, sobject: string, active: boolean, profiles: string[]): StudioItem {
  return {
    id: `DbSchema:${dev}`,
    label: dev,
    active,
    properties: { SObject: sobject },
    audience: { profiles, permissionSets: [] },
    edit: {
      record: { type: "config", category: "DbSchema", developerName: dev, label: dev },
      active,
      profiles: { source: "assignments", names: profiles },
    },
    findings: [],
  };
}

const template: CreateConfigFix = {
  kind: "createConfigRecord",
  label: "New DB Schema record",
  category: "DbSchema",
  developerName: "",
  recordLabel: "",
  fields: [
    { name: "SObject", value: "" },
    { name: "Type", value: "OBJECT" },
  ] as CreateConfigFix["fields"],
  profiles: [],
  active: true,
};
const surface = (items: StudioItem[]): StudioSurface => ({
  id: "syncedObjects",
  title: "Synced objects",
  lane: "sync",
  description: "",
  items,
  findings: [],
  creates: [template],
});

describe("edit targets", () => {
  it("names blocks for keys and hover tags", () => {
    const t = { kind: "related", object: "Contact", label: "Contacts", parent: "Account" } as const;
    expect(targetKey(t)).toBe(targetKey({ ...t }));
    expect(targetTag(t)).toBe("Related list · Contacts");
    expect(targetTag({ kind: "section", layout: "Account-HCP", index: 0, count: 2, label: "" })).toBe(
      "Layout section · Untitled section"
    );
    expect(layoutObject("PersonAccount-Person Account Layout")).toBe("Account");
  });

  it("explains a Lightning app tab with Setup steps and Open in Setup", () => {
    const info = describeTarget({ kind: "tab", fullName: "standard-home", label: "Home", index: 0 }, ctx);
    expect(info.what[0]).toBe("Lightning app navigation");
    expect(info.setup?.path).toMatch(/^\/lightning\/setup\//);
    expect(info.studio).toBeUndefined();
  });

  it("points list views at their object and the list view in Salesforce", () => {
    const info = describeTarget({ kind: "listView", object: "Account", name: "My HCPs", label: "My HCPs" }, ctx);
    expect(info.syncObject).toBe("Account");
    expect(info.setup?.path).toBe("/lightning/o/Account/list?filterName=My%20HCPs");
    expect(info.why.join(" ")).toMatch(/1 other list views/);
  });

  it("reads the profile's synced objects from the cache", () => {
    expect(syncFilter(snapshot, "account")).toBe("");
    expect(syncFilter(snapshot, "Visit")).toBe("OwnerId = {userId}");
    expect(syncFilter(snapshot, "Contact")).toBeNull();
    expect(syncFilter({ ...snapshot, sync: undefined } as PublishedIpad, "Contact")).toBeUndefined();
  });
});

describe("add to iPad sync", () => {
  it("assigns an active DB Schema record to the profile", () => {
    const a = syncAction("Contact", surface([dbSchema("DbSchema_Contact", "Contact", true, ["LS Manager"])]), REP, []);
    expect(a).toMatchObject({
      kind: "change",
      change: { fix: { kind: "setProfileAssignments", to: ["LS Manager", REP] }, affects: [REP] },
    });
  });

  it("turns on a switched-off record the profile already has", () => {
    const a = syncAction("Contact", surface([dbSchema("DbSchema_Contact", "Contact", false, [REP])]), REP, []);
    expect(a).toMatchObject({ kind: "change", change: { fix: { kind: "setActive", to: true } } });
  });

  it("prefills a new record with a free API name when there is none", () => {
    const a = syncAction("Contact", surface([dbSchema("DbSchema_Contact", "Account", true, [REP])]), REP, []);
    expect(a?.kind).toBe("create");
    if (a?.kind !== "create") return;
    expect(a.draft.developerName).toBe("DbSchema_Contact_2");
    expect(a.draft.profiles).toEqual([REP]);
    expect(a.draft.fields.find((f) => f.name === "SObject")?.value).toBe("Contact");
  });

  it("says so when the tray already adds it", () => {
    const s = surface([]);
    const first = syncAction("Contact", s, REP, []);
    if (first?.kind !== "create") throw new Error("expected a create");
    const again = syncAction("Contact", s, REP, [{ fix: first.draft }]);
    expect(again?.kind).toBe("queued");
  });
});
