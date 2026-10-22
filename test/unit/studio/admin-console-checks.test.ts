import { describe, it, expect } from "vitest";
import type { ConfigRecord } from "../../../src/config/types.js";
import {
  cloneGaps,
  duplicateLine,
  duplicateSettings,
  emptySettings,
  isLscPermission,
  overrideLine,
  settingOverrides,
  type PermSet,
} from "../../../src/studio/admin-console-checks.js";

const rec = (category: string, developerName: string, fields: Record<string, unknown>, assigned: string[] = [], extra: Partial<ConfigRecord> = {}): ConfigRecord => ({
  category,
  developerName,
  isActive: true,
  isOrgLevel: assigned.length === 0,
  fields,
  fieldTypes: {},
  assignments: assigned.map((name) => ({ name, level: "Profile" })),
  ...extra,
});

describe("settingOverrides()", () => {
  it("lists profile records whose values differ from the single org-level record", () => {
    const list = settingOverrides([
      rec("ProfileBasedAppSettings", "org", { MinuteInterval: 5, BulkActionUser: true, Profiles: "" }),
      rec("ProfileBasedAppSettings", "rep", { MinuteInterval: 30, BulkActionUser: "true", Profiles: "Rep" }, ["Rep"]),
      rec("ProfileBasedAppSettings", "same", { MinuteInterval: "5" }, ["Medical"]),
    ]);
    expect(list).toEqual([{ category: "ProfileBasedAppSettings", record: "rep", targets: ["Profile Rep"], differences: ["MinuteInterval: 5 → 30"] }]);
    expect(overrideLine(list[0])).toBe("ProfileBasedAppSettings › rep (Profile Rep): MinuteInterval: 5 → 30");
  });

  it("ignores list categories with several org-level records, inactive records and fields the org record lacks", () => {
    expect(
      settingOverrides([
        rec("CalendarEvent", "a", { Color: "red" }),
        rec("CalendarEvent", "b", { Color: "blue" }),
        rec("CalendarEvent", "c", { Color: "green" }, ["Rep"]),
        rec("DEASettings", "org", { IsDEALicensingEnabled: false }),
        rec("DEASettings", "off", { IsDEALicensingEnabled: true }, ["Rep"], { isActive: false }),
        rec("DEASettings", "extra", { DEAValidationFormulaField: "X__c" }, ["Rep"]),
      ])
    ).toEqual([]);
  });

  it("cuts long lists of differences", () => {
    const fields = { A: 1, B: 1, C: 1, D: 1, E: 1 };
    const [o] = settingOverrides([rec("XSettings", "org", fields), rec("XSettings", "p", { A: 2, B: 2, C: 2, D: 2, E: 2 }, ["Rep"])]);
    expect(overrideLine(o)).toMatch(/and 2 more$/);
  });
});

describe("duplicateSettings()", () => {
  it("finds two active records for one profile, and two org-level records, in settings categories", () => {
    const list = duplicateSettings([
      rec("ProfileBasedAppSettings", "a", { X: 1 }, ["Rep"]),
      rec("ProfileBasedAppSettings", "b", { X: 2 }, ["Rep", "Medical"]),
      rec("ProfileBasedAppSettings", "c", { X: 3 }, ["Medical"], { isActive: false }),
      rec("PlannerAdministration", "o1", { X: 1 }),
      rec("PlannerAdministration", "o2", { X: 1 }),
    ]);
    expect(list.map(duplicateLine)).toEqual([
      "ProfileBasedAppSettings: a, b all apply to Profile Rep",
      "PlannerAdministration: o1, o2 all apply to org level",
    ]);
  });

  it("finds a record assigned to the same profile twice", () => {
    const list = duplicateSettings([rec("DEASettings", "a", { X: 1 }, ["Rep", "Rep"])]);
    expect(list.map(duplicateLine)).toEqual(["DEASettings › a is assigned to Profile Rep twice"]);
  });

  it("leaves list categories alone", () => {
    expect(duplicateSettings([rec("CalendarEvent", "a", {}), rec("CalendarEvent", "b", {}), rec("TimelineActivitySetting", "c", {}), rec("TimelineActivitySetting", "d", {})])).toEqual([]);
  });
});

describe("emptySettings()", () => {
  it("flags an active record with no values when others in its category have them", () => {
    const empty = rec("ProfileBasedAppSettings", "bare", { Profiles: "Rep" }, ["Rep"]);
    expect(emptySettings([rec("ProfileBasedAppSettings", "org", { MinuteInterval: 5 }), empty, { ...empty, developerName: "off", isActive: false }])).toEqual([empty]);
  });

  it("flags lone empty records only in categories that need values", () => {
    expect(emptySettings([rec("TerritoryManagement", "org", {})])).toEqual([]);
    expect(emptySettings([rec("PlannerAdministration", "org", {})]).map((r) => r.developerName)).toEqual(["org"]);
  });
});

describe("cloneGaps()", () => {
  const set = (name: string, ...perms: string[]): PermSet => ({ id: name, name, label: name, perms: new Set(perms) });
  const rep = set("Rep", "PermissionsIndustriesLSC4CEUser", "PermissionsLifeSciencesInquiryManagementUser", "PermissionsUseLifeSciSampleLimits");
  const medical = set("Medical", "PermissionsIndustriesLSC4CEUser");
  const admin = set("Admin", "PermissionsIndustriesLSC4CEUser", "PermissionsLifeSciencesInquiryManagementUser", "PermissionsUseLifeSciSampleLimits", "PermissionsManageLifeSciSettings");

  it("compares a copy with the standard set it shares the most with and lists what it lacks", () => {
    const copy = set("Rep copy", "PermissionsIndustriesLSC4CEUser", "PermissionsLifeSciencesInquiryManagementUser");
    const [g] = cloneGaps([admin, rep, medical], [copy]);
    expect(g.source.name).toBe("Rep");
    expect(g.missing).toEqual(["PermissionsUseLifeSciSampleLimits"]);
  });

  it("passes copies that match or add to their source, and sets with no LSC permissions", () => {
    expect(cloneGaps([rep, medical], [set("Medical plus", "PermissionsIndustriesLSC4CEUser", "PermissionsUseLifeSciKeyAccountMgmt"), set("Other")])).toEqual([]);
  });

  it("recognises LSC system permissions by name", () => {
    expect(isLscPermission("PermissionsUseLifeSciSampleLimits")).toBe(true);
    expect(isLscPermission("PermissionsManageIndustriesVisit")).toBe(true);
    expect(isLscPermission("PermissionsApiEnabled")).toBe(false);
  });
});
