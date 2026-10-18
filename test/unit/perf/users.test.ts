import { describe, it, expect } from "vitest";
import type { CliResult, SoqlQueryResult } from "../../../src/salesforce/cli.js";
import type { OrgQuerier } from "../../../src/perf/sync-volume.js";
import {
  checkPlan,
  findHeaviestUsers,
  lookupUsers,
  personaTerritories,
  recentSyncCounts,
  resolvePersonaUsers,
} from "../../../src/perf/users.js";

function ok(records: Record<string, unknown>[]): CliResult<SoqlQueryResult> {
  return { success: true, data: { totalSize: records.length, done: true, records } };
}

/** Querier that answers each query with the first matching handler. */
function mockOrg(handlers: Array<[RegExp, (q: string) => CliResult<SoqlQueryResult>]>): OrgQuerier & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    soql: async (q) => {
      log.push(q);
      const h = handlers.find(([re]) => re.test(q));
      if (!h) throw new Error(`unexpected query: ${q}`);
      return h[1](q);
    },
    tooling: async (q) => {
      throw new Error(`unexpected tooling query: ${q}`);
    },
  };
}

const userRow = (id: string, username: string, name: string, profile = "Field Sales", active = true) => ({
  Id: id,
  Username: username,
  Name: name,
  IsActive: active,
  Profile: { Name: profile },
});

describe("findHeaviestUsers", () => {
  it("ranks a profile's users across all territory assignments, then fills with users without territories", async () => {
    const org = mockOrg([
      [/FROM UserTerritory2Association .*GROUP BY UserId ORDER BY COUNT\(Id\) DESC LIMIT 25$/, () => ok([{ UserId: "005B", cnt: 6 }, { UserId: "005A", expr0: 2 }])],
      [/FROM User WHERE Id IN \('005B','005A'\)$/, () => ok([userRow("005A", "a@x", "Alice"), userRow("005B", "b@x", "Bob")])],
      [/FROM User WHERE .* AND Id NOT IN \('005B','005A'\) ORDER BY Name LIMIT 1$/, () => ok([userRow("005C", "c@x", "Cy")])],
    ]);

    const users = await findHeaviestUsers(org, { profile: "Field Sales", limit: 3 });

    expect(org.log[0]).toContain("User.Profile.Name = 'Field Sales' AND User.IsActive = true AND User.UserType = 'Standard'");
    expect(org.log[0]).toContain("Territory2.Territory2Model.State = 'Active'");
    expect(users.map((u) => [u.username, u.territories])).toEqual([
      ["b@x", 6],
      ["a@x", 2],
      ["c@x", 0],
    ]);
  });

  it("doesn't fill when the ranking already has enough users", async () => {
    const org = mockOrg([
      [/GROUP BY UserId ORDER BY COUNT\(Id\) DESC LIMIT 25$/, () => ok([{ UserId: "005B", cnt: 6 }])],
      [/FROM User WHERE Id IN/, () => ok([userRow("005B", "b@x", "Bob")])],
    ]);
    expect((await findHeaviestUsers(org, { profile: "Field Sales", limit: 1 })).map((u) => u.username)).toEqual(["b@x"]);
    expect(org.log.some((q) => /NOT IN/.test(q) && /FROM User WHERE/.test(q))).toBe(false);
  });

  it("escapes the profile name", async () => {
    const org = mockOrg([
      [/GROUP BY UserId/, () => ok([])],
      [/FROM User WHERE/, () => ok([])],
    ]);
    await findHeaviestUsers(org, { profile: "O'Brien\\Reps", limit: 2 });
    expect(org.log[0]).toContain("User.Profile.Name = 'O\\'Brien\\\\Reps'");
    expect(org.log[1]).toContain("Profile.Name = 'O\\'Brien\\\\Reps'");
  });

  it("throws when a query fails", async () => {
    const org = mockOrg([[/GROUP BY UserId/, () => ({ success: false, error: "INVALID_FIELD" })]]);
    await expect(findHeaviestUsers(org, { profile: "Field Sales", limit: 2 })).rejects.toThrow("INVALID_FIELD");
  });
});

describe("sync counts", () => {
  it("counts each user's DeviceSyncSummary rows in the window, matching 15- and 18-character ids", async () => {
    const org = mockOrg([
      [/FROM DeviceSyncSummary WHERE CreatedById IN \('005A00000000001AAA','005B'\) AND CreatedDate = LAST_N_DAYS:14 GROUP BY CreatedById$/, () =>
        ok([{ CreatedById: "005A00000000001", cnt: 9 }])],
    ]);
    const counts = await recentSyncCounts(org, ["005A00000000001AAA", "005B"], 14);
    expect(counts?.get("005A00000000001")).toBe(9);
    expect(counts?.has("005B")).toBe(false);
  });

  it("returns null when sync telemetry can't be read", async () => {
    const org = mockOrg([[/DeviceSyncSummary/, () => ({ success: false, error: "sObject type 'DeviceSyncSummary' is not supported." })]]);
    expect(await recentSyncCounts(org, ["005A"], 30)).toBeNull();
  });

  it("annotates search results with sync counts when given a window, and leaves them off when telemetry is unreadable", async () => {
    const handlers: Array<[RegExp, (q: string) => CliResult<SoqlQueryResult>]> = [
      [/FROM User WHERE .*LIKE/, () => ok([userRow("005A", "a@x", "Alice"), userRow("005B", "b@x", "Bob")])],
      [/FROM UserTerritory2Association WHERE UserId IN/, () => ok([])],
    ];
    const withTelemetry = mockOrg([...handlers, [/DeviceSyncSummary/, () => ok([{ CreatedById: "005B", cnt: 4 }])]]);
    const users = await findHeaviestUsers(withTelemetry, { search: "x", limit: 5, days: 30 });
    expect(users.map((u) => [u.username, u.syncs])).toEqual([
      ["a@x", 0],
      ["b@x", 4],
    ]);

    const without = mockOrg([...handlers, [/DeviceSyncSummary/, () => ({ success: false, error: "no access" })]]);
    const plain = await findHeaviestUsers(without, { search: "x", limit: 5, days: 30 });
    expect(plain.every((u) => u.syncs === undefined)).toBe(true);
  });

  it("puts a profile's users who synced first when preferSynced, most territories first, then fills with the heaviest of the rest", async () => {
    const org = mockOrg([
      [/FROM DeviceSyncSummary WHERE CreatedBy.Profile.Name = 'Field Sales' .*LAST_N_DAYS:7 GROUP BY CreatedById ORDER BY COUNT\(Id\) DESC LIMIT 200$/, () =>
        ok([{ CreatedById: "005A", cnt: 50 }, { CreatedById: "005B", cnt: 2 }])],
      [/FROM User WHERE Id IN \('005A','005B'\)$/, () => ok([userRow("005A", "a@x", "Alice"), userRow("005B", "b@x", "Bob")])],
      [/FROM UserTerritory2Association WHERE UserId IN \('005A','005B'\) .*GROUP BY UserId$/, () => ok([{ UserId: "005B", cnt: 5 }])],
      [/FROM UserTerritory2Association .*UserId NOT IN \('005B','005A'\) GROUP BY UserId ORDER BY COUNT\(Id\) DESC LIMIT 25$/, () =>
        ok([{ UserId: "005C", cnt: 9 }])],
      [/FROM User WHERE Id IN \('005C'\)$/, () => ok([userRow("005C", "c@x", "Cy")])],
      [/FROM DeviceSyncSummary WHERE CreatedById IN \('005C'\)/, () => ok([])],
    ]);

    const users = await findHeaviestUsers(org, { profile: "Field Sales", limit: 3, days: 7, preferSynced: true });

    expect(users.map((u) => [u.username, u.territories, u.syncs])).toEqual([
      ["b@x", 5, 2],
      ["a@x", 0, 50],
      ["c@x", 9, 0],
    ]);
  });

  it("falls back to the territory ranking when preferSynced but sync telemetry is unreadable", async () => {
    const org = mockOrg([
      [/DeviceSyncSummary/, () => ({ success: false, error: "no access" })],
      [/FROM UserTerritory2Association .*GROUP BY UserId ORDER BY COUNT\(Id\) DESC LIMIT 25$/, () => ok([{ UserId: "005C", cnt: 9 }])],
      [/FROM User WHERE Id IN \('005C'\)$/, () => ok([userRow("005C", "c@x", "Cy")])],
    ]);
    const users = await findHeaviestUsers(org, { profile: "Field Sales", limit: 1, preferSynced: true });
    expect(users.map((u) => [u.username, u.syncs])).toEqual([["c@x", undefined]]);
  });
});

describe("resolvePersonaUsers", () => {
  const org = () =>
    mockOrg([
      [/GROUP BY UserId ORDER BY COUNT/, () => ok([{ UserId: "005B", cnt: 6 }, { UserId: "005A", cnt: 2 }])],
      [/FROM User WHERE Id IN/, () => ok([userRow("005A", "a@x", "Alice"), userRow("005B", "b@x", "Bob")])],
    ]);

  it("lists the persona's own users first, then selected users not already listed", async () => {
    const { users, selected } = await resolvePersonaUsers(org(), {
      users: [" own@x ", "B@X", "own@x"],
      select: { profile: "Field Sales", count: 2 },
    });
    expect(users).toEqual(["own@x", "B@X", "a@x"]);
    expect(selected.map((s) => s.username)).toEqual(["b@x", "a@x"]);
  });

  it("doesn't query when there's no select", async () => {
    const o = org();
    expect((await resolvePersonaUsers(o, { users: ["a@x"] })).users).toEqual(["a@x"]);
    expect(o.log).toEqual([]);
  });
});

describe("lookupUsers", () => {
  it("looks users up by username and id in one query, territories in a second", async () => {
    const org = mockOrg([
      [/FROM User WHERE Username IN \('a@x','missing@x'\) OR Id IN \('005000000000002'\)$/, () =>
        ok([userRow("005000000000001AAA", "A@x", "Alice"), userRow("005000000000002AAA", "b@x", "Bob", "Field Sales", false)])],
      [/FROM UserTerritory2Association WHERE UserId IN \('005000000000001AAA','005000000000002AAA'\)/, () =>
        ok([{ UserId: "005000000000001AAA", Territory2Id: "0MI1", Territory2: { Name: "North" } }])],
    ]);

    const found = await lookupUsers(org, ["a@x", "005000000000002", "missing@x", "a@x"]);

    expect(org.log).toHaveLength(2);
    expect(found.get("a@x")).toMatchObject({ found: true, active: true, username: "A@x", territories: [{ id: "0MI1", name: "North" }] });
    expect(found.get("005000000000002")).toMatchObject({ found: true, active: false, username: "b@x", territories: [] });
    expect(found.get("missing@x")).toEqual({ ref: "missing@x", found: false, active: false, territories: [] });
  });

  it("skips the territory query when nobody is found", async () => {
    const org = mockOrg([[/FROM User WHERE/, () => ok([])]]);
    await lookupUsers(org, ["nobody@x"]);
    expect(org.log).toHaveLength(1);
  });
});

describe("checkPlan", () => {
  const org = () =>
    mockOrg([
      [/'Empty Profile'.*GROUP BY UserId ORDER BY COUNT/, () => ok([])],
      [/FROM User WHERE .*Profile.Name = 'Empty Profile'/, () => ok([])],
      [/GROUP BY UserId ORDER BY COUNT/, () => ok([{ UserId: "005S", cnt: 3 }])],
      [/FROM User WHERE Id IN \('005S'\)$/, () => ok([userRow("005S", "sel@x", "Sel")])],
      [/FROM User WHERE Username IN/, () =>
        ok([
          userRow("005S", "sel@x", "Sel"),
          userRow("005I", "inactive@x", "Ina", "Field Sales", false),
          userRow("005M", "manager@x", "Mgr", "Sales Manager"),
        ])],
      [/FROM UserTerritory2Association WHERE UserId IN/, () =>
        ok([
          { UserId: "005S", Territory2Id: "0MI1", Territory2: { Name: "North" } },
          { UserId: "005M", Territory2Id: "0MI2", Territory2: { Name: "South" } },
        ])],
    ]);

  it("reports missing and inactive users, empty selections, territory misses, and profile mismatches", async () => {
    const check = await checkPlan(org(), "my-org", {
      name: "Plan",
      personas: [
        { name: "Reps", users: ["missing@x", "inactive@x"], territory: "North" },
        { name: "Selected", users: ["manager@x"], select: { profile: "Field Sales", count: 1 }, territory: "south" },
        { name: "Nobody", users: [], select: { profile: "Empty Profile" } },
        { name: "Wrong territory", users: ["sel@x"], territory: "West" },
      ],
    });

    expect(check.org).toBe("my-org");
    expect(check.issues).toEqual([
      { persona: "Nobody", level: "error", message: "No active users have the profile “Empty Profile”." },
      { persona: "Reps", level: "error", message: "User not found: missing@x" },
      { persona: "Reps", level: "error", message: "User is inactive: inactive@x" },
      { persona: "Reps", level: "warning", message: expect.stringContaining("“North”") },
      { persona: "Selected", level: "warning", message: "manager@x has the profile “Sales Manager”, not “Field Sales”." },
      { persona: "Wrong territory", level: "warning", message: expect.stringContaining("“West”") },
    ]);
    const selected = check.personas.find((p) => p.name === "Selected");
    expect(selected?.users.map((u) => u.username)).toEqual(["manager@x", "sel@x"]);
    expect(selected?.territoryMatched).toBe(true);
    expect(check.personas.find((p) => p.name === "Nobody")).toEqual({ name: "Nobody", users: [] });
  });
});

describe("checkPlan sync warnings", () => {
  const org = (syncs: Record<string, unknown>[]) =>
    mockOrg([
      [/FROM User WHERE Username IN/, () => ok([userRow("005A", "a@x", "Alice"), userRow("005B", "b@x", "Bob")])],
      [/FROM UserTerritory2Association WHERE UserId IN/, () => ok([])],
      [/FROM DeviceSyncSummary WHERE CreatedById IN .*LAST_N_DAYS:10 /, () => ok(syncs)],
    ]);
  const plan = { name: "Plan", telemetry: { days: 10 }, personas: [{ name: "Reps", users: ["a@x", "b@x"] }] };

  it("warns when none of a persona's users synced in the telemetry window", async () => {
    const check = await checkPlan(org([]), "my-org", plan);
    expect(check.issues).toEqual([
      { persona: "Reps", level: "warning", message: expect.stringContaining("synced in the last 10 days") },
    ]);
    expect(check.personas[0].users.map((u) => u.syncs)).toEqual([0, 0]);
  });

  it("doesn't warn when any of them synced", async () => {
    const check = await checkPlan(org([{ CreatedById: "005B", cnt: 3 }]), "my-org", plan);
    expect(check.issues).toEqual([]);
    expect(check.personas[0].users.map((u) => u.syncs)).toEqual([0, 3]);
  });
});

describe("personaTerritories", () => {
  it("unions territories across listed and selected users, counting users per territory, sorted by name", async () => {
    const org = mockOrg([
      [/GROUP BY UserId ORDER BY COUNT/, () => ok([{ UserId: "005S", cnt: 2 }])],
      [/FROM User WHERE Id IN \('005S'\)$/, () => ok([userRow("005S", "sel@x", "Sel")])],
      [/FROM User WHERE Username IN \('a@x','sel@x'\)$/, () => ok([userRow("005A", "a@x", "Al"), userRow("005S", "sel@x", "Sel")])],
      [/FROM UserTerritory2Association WHERE UserId IN/, () =>
        ok([
          { UserId: "005A", Territory2Id: "0MI2", Territory2: { Name: "South" } },
          { UserId: "005S", Territory2Id: "0MI2", Territory2: { Name: "South" } },
          { UserId: "005S", Territory2Id: "0MI1", Territory2: { Name: "North" } },
        ])],
    ]);

    expect(await personaTerritories(org, { users: ["a@x"], select: { profile: "Field Sales", count: 1 } })).toEqual([
      { id: "0MI1", name: "North", users: 1 },
      { id: "0MI2", name: "South", users: 2 },
    ]);
  });
});
