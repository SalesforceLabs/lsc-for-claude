import { describe, it, expect } from "vitest";
import { detectGroup, groupProfiles, type ScopeFacts } from "../../../src/studio/scope.js";
import { pickerProfiles, profileLabel, type ReadinessProfile } from "../../../src-renderer/components/studio/readiness-profile.js";

const facts = (name: string, o: Partial<ScopeFacts> = {}): ScopeFacts => ({
  id: `id-${name}`, name, users: 1, licensed: 0, admin: false, appSettings: false, dbSchema: false, cache: false, ...o,
});

describe("detectGroup", () => {
  it("puts a profile with any iPad setup on the iPad, saying what it found", () => {
    expect(detectGroup(facts("Rep", { appSettings: true, dbSchema: true }))).toEqual({ group: "ipad", reason: "Has LSC Mobile app settings and DB Schema records" });
    expect(detectGroup(facts("Rep", { cache: true }))).toEqual({ group: "ipad", reason: "Has an iPad metadata cache" });
  });
  it("makes a licensed profile without iPad setup web-only", () => {
    expect(detectGroup(facts("Medical", { licensed: 2 })).group).toBe("web");
  });
  it("gives setup named for a profile to the licensed one when two share the name", () => {
    expect(detectGroup(facts("System Administrator", { sharedName: true, dbSchema: true })).group).toBe("out");
    expect(detectGroup(facts("Rep", { sharedName: true, dbSchema: true, licensed: 1 })).group).toBe("ipad");
    expect(detectGroup(facts("Rep", { sharedName: true, cache: true })).group).toBe("ipad");
  });
  it("never counts admins and integration users as reps", () => {
    expect(detectGroup(facts("System Administrator", { admin: true, licensed: 1, appSettings: true })).group).toBe("admin");
    expect(detectGroup(facts("Chatter Free", { admin: true })).group).toBe("out");
    expect(detectGroup(facts("Marketing")).group).toBe("out");
  });
});

describe("groupProfiles", () => {
  const list = [facts("Rep", { users: 9, appSettings: true }), facts("Medical", { users: 3, licensed: 3 }), facts("Ops", { users: 5 })];

  it("groups each profile and lists the biggest first", () => {
    const grouped = groupProfiles(list);
    expect(grouped.map((p) => [p.name, p.group])).toEqual([["Rep", "ipad"], ["Ops", "out"], ["Medical", "web"]]);
    expect(grouped[0]).toEqual({ id: "id-Rep", name: "Rep", users: 9, licensed: 0, group: "ipad", reason: "Has LSC Mobile app settings" });
  });
});

describe("readiness picker", () => {
  const p = (name: string, group: ReadinessProfile["group"], users: number): ReadinessProfile => ({ name, group, users });

  it("offers iPad profiles first, then web-only, never admins or profiles without LSC", () => {
    const list = pickerProfiles([p("Medical", "web", 30), p("Admin", "admin", 2), p("Rep B", "ipad", 4), p("Rep A", "ipad", 9), p("Ops", "out", 50)]);
    expect(list.map((x) => x.name)).toEqual(["Rep A", "Rep B", "Medical"]);
  });

  it("labels each with its users", () => {
    expect(profileLabel(p("Rep", "ipad", 1))).toBe("Rep · 1 user");
    expect(profileLabel(p("Medical", "web", 3))).toBe("Medical · 3 users (web only)");
  });
});
