import { describe, it, expect } from "vitest";
import type { ApplicableTable, DbSchemaEntry, TableVolume } from "../../../src/perf/sync-volume.js";
import { affectedProfiles, applyChanges, changedSobjects, diffVolumes, planRecount } from "../../../src/perf/what-if.js";

const entry = (developerName: string, sobject: string, over: Partial<DbSchemaEntry> = {}): DbSchemaEntry => ({
  developerName,
  sobject,
  type: "Object",
  whereSoql: null,
  profileIds: new Set(),
  profileNames: new Set(["Field Rep"]),
  permissionSets: new Set(),
  ...over,
});
const tbl = (e: DbSchemaEntry): ApplicableTable => ({ entry: e, matchedBy: "profile" });
const vol = (sobject: string, records: number, over: Partial<TableVolume> = {}): TableVolume => ({
  sobject,
  developerName: sobject,
  matchedBy: "profile",
  status: "counted",
  records,
  deviceRequests: 1,
  ...over,
});

const base = [entry("Visit", "Visit"), entry("Call", "Call2__c", { whereSoql: "OwnerId = '{USER.ID}'" })];

describe("applyChanges", () => {
  it("edits WhereSoql without mutating the input", () => {
    const r = applyChanges(base, [{ kind: "setConfigField", category: "DbSchema", developerName: "Visit", field: "WhereSoql", from: null, to: "Status = 'X'" }]);
    expect(r.entries.find((e) => e.developerName === "Visit")!.whereSoql).toBe("Status = 'X'");
    expect(base[0].whereSoql).toBeNull();
    expect(r.touched).toEqual(["Visit"]);
  });

  it("reports fields that don't change volume as unmodeled", () => {
    const r = applyChanges(base, [{ kind: "setConfigField", category: "DbSchema", developerName: "Visit", field: "OneWaySync", to: true, label: "one way" }]);
    expect(r.touched).toEqual([]);
    expect(r.unmodeled[0].label).toBe("one way");
  });

  it("deactivates, deletes and refuses to activate unknown records", () => {
    const r = applyChanges(base, [
      { kind: "setActive", record: { type: "config", category: "DbSchema", developerName: "Visit", label: "v" }, from: true, to: false },
      { kind: "deleteConfigRecord", category: "DbSchema", developerName: "Call" },
      { kind: "setActive", record: { type: "config", category: "DbSchema", developerName: "Old", label: "o" }, from: false, to: true },
    ]);
    expect(r.entries).toEqual([]);
    expect(r.unmodeled).toHaveLength(1);
  });

  it("replaces profile assignments by name", () => {
    const e = [entry("Visit", "Visit", { profileIds: new Set(["00e000000000001"]) })];
    const r = applyChanges(e, [{ kind: "setProfileAssignments", category: "DbSchema", developerName: "Visit", to: ["Manager"] }]);
    expect([...r.entries[0].profileNames]).toEqual(["Manager"]);
    expect(r.entries[0].profileIds.size).toBe(0);
    const a = affectedProfiles(e, r.entries, r.touched);
    expect([...a.names].sort()).toEqual(["Field Rep", "Manager"]);
    expect([...a.ids]).toEqual(["00e000000000001"]);
  });

  it("creates a record, copying from another and overriding fields", () => {
    const r = applyChanges(base, [
      {
        kind: "createConfigRecord",
        category: "DbSchema",
        developerName: "Call2",
        copyFrom: "Call",
        fields: [{ name: "WhereSoql", value: "Active__c = true" }],
        profiles: ["Manager"],
        active: true,
      },
      { kind: "createConfigRecord", category: "DbSchema", developerName: "Off", fields: [{ name: "SObject", value: "Lead" }], profiles: [], active: false },
    ]);
    const c = r.entries.find((e) => e.developerName === "Call2")!;
    expect(c.sobject).toBe("Call2__c");
    expect(c.whereSoql).toBe("Active__c = true");
    expect([...c.profileNames]).toEqual(["Manager"]);
    expect(r.unmodeled).toHaveLength(1);
  });

  it("ignores other categories and kinds", () => {
    const r = applyChanges(base, [
      { kind: "setConfigField", category: "Actions", developerName: "Visit", field: "WhereSoql", to: "x" },
      { kind: "assignPsl" },
    ]);
    expect(r.touched).toEqual([]);
    expect(r.unmodeled).toEqual([]);
  });
});

describe("recount planning", () => {
  it("finds changed, added and removed tables", () => {
    const b = [tbl(base[0]), tbl(base[1])];
    const a = [tbl({ ...base[0], whereSoql: "X = 1" }), tbl(entry("Lead", "Lead"))];
    expect([...changedSobjects(b, a)].sort()).toEqual(["call2__c", "lead", "visit"]);
  });

  it("recounts everything when an id source changes, else only the changed tables plus sources", () => {
    const acct = tbl(entry("Account", "Account"));
    const dep = tbl(entry("Dep", "Dep__c", { whereSoql: "AccountId IN {ACCOUNT.IDS}" }));
    const other = tbl(entry("Other", "Other__c"));
    expect(planRecount([acct, dep, other], new Set(["account"])).full).toBe(true);
    const p = planRecount([acct, dep, other], new Set(["dep__c"]));
    expect(p.full).toBe(false);
    expect(p.after.map((t) => t.entry.sobject)).toEqual(["Account", "Dep__c"]);
    expect(planRecount([acct, dep, other], new Set(["other__c"])).after.map((t) => t.entry.sobject)).toEqual(["Other__c"]);
  });
});

describe("diffVolumes", () => {
  it("carries unchanged tables over when only changed ones were recounted", () => {
    const before = [vol("Visit", 100), vol("Call2__c", 50)];
    const d = diffVolumes(before, [vol("Visit", 40)], new Set(["visit"]), false);
    expect(d.totalBefore).toBe(150);
    expect(d.totalAfter).toBe(90);
    expect(d.delta).toBe(-60);
    expect(d.pct).toBe(-40);
    expect(d.tables).toEqual([{ sobject: "Visit", before: 100, after: 40, delta: -60 }]);
  });

  it("counts a removed table as zero after", () => {
    const d = diffVolumes([vol("Visit", 100)], [], new Set(["visit"]), false);
    expect(d.totalAfter).toBe(0);
    expect(d.tables[0]).toMatchObject({ before: 100, after: null, delta: -100 });
  });

  it("flags a filter that newly fails", () => {
    const d = diffVolumes([vol("Visit", 100)], [vol("Visit", 0, { status: "error", note: "unexpected token" })], new Set(["visit"]), false);
    expect(d.failing).toEqual([{ sobject: "Visit", developerName: "Visit", message: "unexpected token" }]);
  });

  it("does not flag a filter that already failed", () => {
    const bad = vol("Visit", 0, { status: "error", note: "x" });
    expect(diffVolumes([bad], [bad], new Set(["visit"]), false).failing).toEqual([]);
  });

  it("diffs full recounts and returns null pct from an empty start", () => {
    const d = diffVolumes([vol("Account", 10), vol("Dep__c", 5)], [vol("Account", 20), vol("Dep__c", 5)], new Set(["account"]), true);
    expect(d.totalAfter).toBe(25);
    expect(d.tables.map((t) => t.sobject)).toEqual(["Account"]);
    expect(diffVolumes([], [vol("Lead", 3)], new Set(["lead"]), false).pct).toBeNull();
  });
});

describe("applyChanges: field edits", () => {
  const edit = (field: string, to: string | number | null) => ({ kind: "setConfigField", category: "DbSchema", developerName: "Visit", field, from: null, to });

  it("matches field names case-insensitively", () => {
    expect(applyChanges(base, [edit("SObject", "Lead")]).entries.find((e) => e.developerName === "Visit")!.sobject).toBe("Lead");
    expect(applyChanges(base, [edit("WhereSoql", "A = 1")]).entries.find((e) => e.developerName === "Visit")!.whereSoql).toBe("A = 1");
  });

  it("rewrites field-sourced Profiles and PermissionSets and reports both sides as affected", () => {
    const r = applyChanges(base, [edit("Profiles", "Manager, Admin"), edit("PermissionSets", "PS_A;PS_B")]);
    const v = r.entries.find((e) => e.developerName === "Visit")!;
    expect([...v.profileNames].sort()).toEqual(["Admin", "Manager"]);
    expect([...v.permissionSets]).toEqual(["PS_A", "PS_B"]);
    expect(r.unmodeled).toEqual([]);
    expect([...affectedProfiles(base, r.entries, r.touched).names].sort()).toEqual(["Admin", "Field Rep", "Manager"]);
  });

  it("drops a record whose Type becomes Configuration", () => {
    expect(applyChanges(base, [edit("Type", "Configuration")]).entries.map((e) => e.developerName)).toEqual(["Call"]);
  });

  it("keeps the Profiles field names when the last assignment is removed", () => {
    const e = [entry("Visit", "Visit", { profileIds: new Set(["00e000000000001"]), profileNames: new Set(["Field Rep"]) })];
    const r = applyChanges(e, [{ kind: "setProfileAssignments", category: "DbSchema", developerName: "Visit", to: [] }]);
    expect([...r.entries[0].profileNames]).toEqual(["Field Rep"]);
    expect(r.entries[0].profileIds.size).toBe(0);
  });
});
