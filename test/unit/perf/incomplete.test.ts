import { describe, it, expect } from "vitest";
import type { CliResult, SoqlQueryResult } from "../../../src/salesforce/cli.js";
import {
  type DbSchemaEntry,
  type OrgQuerier,
  type TableVolume,
  type UserContext,
  incompleteTables,
  isIncomplete,
  pickLargestTerritories,
  profileTerritory,
} from "../../../src/perf/sync-volume.js";
import { evaluateMetric, markIncomplete, overallStatus } from "../../../src/perf/nfr.js";
import { explainTable } from "../../../src/perf/table-hints.js";
import { loadTelemetry, telemetryCoverageNote } from "../../../src/perf/assessment.js";
import { findHeaviestUsers } from "../../../src/perf/users.js";

type Handler = [RegExp, (q: string) => CliResult<SoqlQueryResult>];

function ok(records: Record<string, unknown>[], totalSize = records.length, truncated = false): CliResult<SoqlQueryResult> {
  return { success: true, data: { totalSize, done: true, records, ...(truncated ? { truncated } : {}) } };
}

function mockOrg(handlers: Handler[]): OrgQuerier & { log: string[] } {
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

function entry(sobject: string, whereSoql: string | null): { entry: DbSchemaEntry; matchedBy: "profile" } {
  return {
    entry: { developerName: sobject, sobject, type: "data", whereSoql, profileIds: new Set(), profileNames: new Set(), permissionSets: new Set() },
    matchedBy: "profile",
  };
}

const user: UserContext = {
  id: "005000000000001AAA",
  username: "rep@example.com",
  name: "Rep",
  profileId: "00e000000000001AAA",
  profileName: "Field Sales",
  permissionSets: new Set(),
  territories: [{ id: "0MI000000000001AAA", name: "T-01" }],
};
const territory = user.territories[0];

const ids = (n: number, prefix = "001") => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(12, "0")}`);

describe("incomplete table counts", () => {
  it("marks a timed-out COUNT as timed-out, not as a bad filter, and counts it as incomplete", async () => {
    const org = mockOrg([
      [/COUNT\(\) FROM Task/, () => ({ success: false, timedOut: true, error: "Command timed out after 60s" })],
      [/COUNT\(\) FROM Event/, () => ({ success: false, error: "INVALID_FIELD: Foo" })],
      [/COUNT\(\) FROM Product2/, () => ok([], 7)],
    ]);
    const vol = await profileTerritory(org, user, territory, [entry("Task", "OwnerId != null"), entry("Event", "Foo = 1"), entry("Product2", null)], {
      idsPerQuery: 500,
      concurrency: 2,
    });
    const by = Object.fromEntries(vol.tables.map((t) => [t.sobject, t]));
    expect(by.Task.status).toBe("timed-out");
    expect(by.Event.status).toBe("error");
    expect(by.Product2.status).toBe("counted");
    expect(incompleteTables(vol).map((t) => t.sobject).sort()).toEqual(["Event", "Task"]);
    expect(isIncomplete(by.Product2)).toBe(false);
  });

  it("flags tables filtered by a truncated id list as lower bounds, with the exact table count still taken", async () => {
    const org = mockOrg([
      [/^SELECT ObjectId FROM ObjectTerritory2Association/, () => ok(ids(3).map((id) => ({ ObjectId: id })), 3, true)],
      [/^SELECT COUNT\(\) FROM ObjectTerritory2Association/, () => ok([], 900_000)],
      [/^SELECT Id FROM Account WHERE Id IN/, () => ok(ids(3).map((id) => ({ Id: id })))],
      [/^SELECT COUNT\(\) FROM Contact WHERE AccountId/, () => ok([], 12)],
    ]);
    const vol = await profileTerritory(
      org,
      user,
      territory,
      [entry("ObjectTerritory2Association", "Territory2Id = '{USER.TERRITORYID}'"), entry("Account", "Id IN ({OT2A.OBJ.IDS})"), entry("Contact", "AccountId IN ({ACCOUNT.IDS})")],
      { idsPerQuery: 500, concurrency: 2 }
    );
    const by = Object.fromEntries(vol.tables.map((t) => [t.sobject, t])) as Record<string, TableVolume>;
    expect(by.ObjectTerritory2Association).toMatchObject({ status: "counted", records: 900_000 });
    expect(by.ObjectTerritory2Association.lowerBound).toBeUndefined();
    expect(by.Contact.lowerBound).toBe(true);
    expect(by.Contact.note).toMatch(/minimum/);
    expect(isIncomplete(by.Contact)).toBe(true);
  });

  it("marks tables whose id source failed as not counted, never as zero records", async () => {
    const org = mockOrg([[/^SELECT ObjectId FROM ObjectTerritory2Association/, () => ({ success: false, error: "boom" })]]);
    const vol = await profileTerritory(
      org,
      user,
      territory,
      [entry("ObjectTerritory2Association", "Territory2Id = '{USER.TERRITORYID}'"), entry("Account", "Id IN ({OT2A.OBJ.IDS})")],
      { idsPerQuery: 500, concurrency: 2 }
    );
    const account = vol.tables.find((t) => t.sobject === "Account");
    expect(account).toMatchObject({ status: "not-estimated", sourceFailed: true });
    expect(isIncomplete(account as TableVolume)).toBe(true);
  });

  it("reads the OT2A id list once across territories when given a shared id cache", async () => {
    const org = mockOrg([
      [/^SELECT ObjectId FROM ObjectTerritory2Association/, () => ok(ids(2).map((id) => ({ ObjectId: id })))],
      [/^SELECT COUNT\(\) FROM Account WHERE Id IN/, () => ok([], 2)],
    ]);
    const options = { idsPerQuery: 500, concurrency: 2, idCache: new Map() };
    const tables = [entry("ObjectTerritory2Association", "Territory2Id = '{USER.TERRITORYID}'"), entry("Account", "Id IN ({OT2A.OBJ.IDS})")];
    await profileTerritory(org, user, territory, tables, options);
    await profileTerritory(org, user, territory, tables, options);
    expect(org.log.filter((q) => q.startsWith("SELECT ObjectId FROM ObjectTerritory2Association"))).toHaveLength(1);
  });

  it("splits long id lists by URL budget, not just by count", async () => {
    const accountIds = ids(1500);
    const org = mockOrg([
      [/^SELECT Id FROM Account/, () => ok(accountIds.map((id) => ({ Id: id })))],
      [/^SELECT COUNT\(\) FROM Contact WHERE AccountId IN/, () => ok([], 1)],
    ]);
    await profileTerritory(org, user, territory, [entry("Account", null), entry("Contact", "AccountId IN ({ACCOUNT.IDS})")], {
      idsPerQuery: 100_000,
      concurrency: 4,
    });
    const counts = org.log.filter((q) => q.startsWith("SELECT COUNT() FROM Contact"));
    expect(counts.length).toBeGreaterThan(1);
    for (const q of counts) expect(encodeURIComponent(q).length).toBeLessThan(15_000);
    expect(counts.join("").match(/'001/g)).toHaveLength(1500);
  });
});

describe("pickLargestTerritories", () => {
  const territories = ["A", "B", "C", "D"].map((n) => ({ id: `0MI00000000000${n}`, name: n }));

  it("returns everything untouched under the cap, without querying", async () => {
    const org = mockOrg([]);
    expect(await pickLargestTerritories(org, territories, 4)).toEqual({ picked: territories });
    expect(org.log).toHaveLength(0);
  });

  it("keeps the territories with the most aligned accounts and says so", async () => {
    const org = mockOrg([
      [/GROUP BY Territory2Id/, () => ok([{ Territory2Id: "0MI00000000000A", cnt: 5 }, { Territory2Id: "0MI00000000000C", cnt: 90 }, { Territory2Id: "0MI00000000000D", cnt: 40 }])],
    ]);
    const { picked, note } = await pickLargestTerritories(org, territories, 2);
    expect(picked.map((t) => t.name)).toEqual(["C", "D"]);
    expect(note).toMatch(/2 largest of 4/);
  });

  it("falls back to name order with a note when sizes can't be read", async () => {
    const org = mockOrg([[/GROUP BY Territory2Id/, () => ({ success: false, error: "denied" })]]);
    const { picked, note } = await pickLargestTerritories(org, territories, 2);
    expect(picked.map((t) => t.name)).toEqual(["A", "B"]);
    expect(note).toMatch(/couldn't rank/);
  });
});

describe("incomplete metrics", () => {
  it("never lets an incomplete value pass, but keeps a value already over its limit failing", () => {
    const pass = markIncomplete(evaluateMetric("predictedRecordsTotal", 100, { warn: 1000, fail: 2000 }), "2 tables");
    expect(pass.status).toBe("incomplete");
    expect(pass.incomplete).toBe("2 tables");
    const fail = markIncomplete(evaluateMetric("predictedRecordsTotal", 5000, { warn: 1000, fail: 2000 }), "2 tables");
    expect(fail.status).toBe("fail");
    const noTarget = markIncomplete(evaluateMetric("predictedRecordsTotal", 100, undefined), "2 tables");
    expect(noTarget.status).toBe("incomplete");
  });

  it("rolls incomplete up to warn, never pass", () => {
    expect(overallStatus([evaluateMetric("predictedRecordsTotal", 1, { warn: 5 }), markIncomplete(evaluateMetric("predictedRecordsPerTable", 1, { warn: 5 }), "x")])).toBe("warn");
  });
});

describe("table hints for incomplete counts", () => {
  const base = { sobject: "Task", records: 0, deviceRequests: null, mayOvercount: false, totalRecords: 100 };

  it("explains a timed-out count apart from a failing filter", () => {
    const hints = explainTable({ ...base, status: "timed-out", note: "Timed out." });
    expect(hints.map((h) => h.id)).toEqual(["count-timed-out"]);
    expect(explainTable({ ...base, status: "error" })[0].id).toBe("filter-failed");
  });

  it("calls a lower-bound count a minimum", () => {
    const hints = explainTable({ ...base, status: "counted", records: 500, lowerBound: true });
    expect(hints.some((h) => h.id === "lower-bound")).toBe(true);
  });
});

describe("telemetryCoverageNote", () => {
  it("says nothing when every sync was read", () => {
    expect(telemetryCoverageNote({ mode: "all", limit: 10_000 }, 30)).toBeUndefined();
    expect(telemetryCoverageNote(undefined, 30)).toBeUndefined();
  });

  it("names the sample and the span it covers", () => {
    const note = telemetryCoverageNote({ mode: "sampled", limit: 10_000, sliceDays: 3, oldest: "2026-09-01T00:00:00Z", newest: "2026-09-30T00:00:00Z" }, 30);
    expect(note).toContain("10,000");
    expect(note).toContain("2026-09-01");
    expect(note).toContain("sample");
  });
});

describe("findHeaviestUsers by data volume", () => {
  const userRow = (id: string, name: string) => ({ Id: id, Username: `${name}@x`, Name: name, Profile: { Name: "Field Sales" } });

  it("ranks a profile's candidates by aligned accounts across their territories, not by territory count", async () => {
    const org = mockOrg([
      [/GROUP BY UserId ORDER BY COUNT\(Id\) DESC LIMIT 25$/, () => ok([{ UserId: "005A", cnt: 5 }, { UserId: "005B", cnt: 1 }])],
      [/FROM User WHERE Id IN/, () => ok([userRow("005A", "Alice"), userRow("005B", "Bob")])],
      [/^SELECT UserId, Territory2Id FROM UserTerritory2Association/, () =>
        ok([
          ...["0MIa1", "0MIa2", "0MIa3", "0MIa4", "0MIa5"].map((t) => ({ UserId: "005A", Territory2Id: t })),
          { UserId: "005B", Territory2Id: "0MIbig" },
        ])],
      [/GROUP BY Territory2Id/, () =>
        ok([{ Territory2Id: "0MIa1", cnt: 10 }, { Territory2Id: "0MIa2", cnt: 10 }, { Territory2Id: "0MIbig", cnt: 50_000 }])],
    ]);
    const users = await findHeaviestUsers(org, { profile: "Field Sales", limit: 2 });
    expect(users.map((u) => [u.name, u.accounts])).toEqual([
      ["Bob", 50_000],
      ["Alice", 20],
    ]);
  });

  it("keeps the territory-count order when the volumes can't be read", async () => {
    const org = mockOrg([
      [/GROUP BY UserId ORDER BY COUNT\(Id\) DESC LIMIT 25$/, () => ok([{ UserId: "005A", cnt: 5 }, { UserId: "005B", cnt: 1 }])],
      [/FROM User WHERE Id IN/, () => ok([userRow("005A", "Alice"), userRow("005B", "Bob")])],
      [/^SELECT UserId, Territory2Id/, () => ({ success: false, error: "denied" })],
    ]);
    const users = await findHeaviestUsers(org, { profile: "Field Sales", limit: 2 });
    expect(users.map((u) => u.name)).toEqual(["Alice", "Bob"]);
    expect(users[0].accounts).toBeUndefined();
  });
});

describe("loadTelemetry coverage", () => {
  const fields = async () => new Set(["Id", "CreatedDate", "CreatedById", "SyncTrigger"]);
  const rowsFor = (n: number, day: string) =>
    Array.from({ length: n }, (_, i) => ({ Id: `${day}-${i}`, CreatedDate: `${day}T12:00:00.000+0000`, SyncTrigger: "Delta", CreatedBy: { Username: "rep@x" } }));

  it("reads everything in one query when under the row cap and says coverage is complete", async () => {
    const org = mockOrg([[/FROM DeviceSyncSummary/, () => ok(rowsFor(5, "2026-09-01"))]]);
    const { summary } = await loadTelemetry(org, fields, { days: 30, userIds: ["005A"] });
    expect(summary.coverage?.mode).toBe("all");
    expect(org.log).toHaveLength(1);
    expect(org.log[0]).toContain("CreatedById IN ('005A')");
    expect(org.log[0]).not.toContain("CreatedBy.Username IN");
  });

  it("re-reads a capped window as slices and flags the summary as sampled", async () => {
    const org = mockOrg([
      [/CreatedDate >= /, () => ok(rowsFor(3, "2026-09-02"))],
      [/FROM DeviceSyncSummary/, () => ok(rowsFor(10_000, "2026-09-03"))],
    ]);
    const { summary } = await loadTelemetry(org, fields, { days: 30, userIds: ["005A"] });
    expect(summary.coverage).toMatchObject({ mode: "sampled", limit: 10_000 });
    expect(org.log.some((q) => /CreatedDate >= .* AND CreatedDate < /.test(q))).toBe(true);
  });
});
