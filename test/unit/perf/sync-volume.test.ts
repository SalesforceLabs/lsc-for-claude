import { describe, it, expect } from "vitest";
import type { CliResult, SoqlQueryResult } from "../../../src/salesforce/cli.js";
import {
  type DbSchemaEntry,
  type OrgQuerier,
  type UserContext,
  estimateDeviceRequests,
  loadDbSchemaEntries,
  profileTerritory,
  resolveScalarTags,
  selectApplicableTables,
  substituteIdTag,
} from "../../../src/perf/sync-volume.js";

function ok(records: Record<string, unknown>[], totalSize = records.length): CliResult<SoqlQueryResult> {
  return { success: true, data: { totalSize, done: true, records } };
}

/** Querier that answers each query with the first matching handler. */
function mockOrg(
  handlers: Array<[RegExp, (q: string) => CliResult<SoqlQueryResult>]>,
  tooling: Array<[RegExp, (q: string) => CliResult<SoqlQueryResult>]> = []
): OrgQuerier & { soqlLog: string[] } {
  const soqlLog: string[] = [];
  const answer = (list: typeof handlers, q: string) => {
    const h = list.find(([re]) => re.test(q));
    if (!h) throw new Error(`unexpected query: ${q}`);
    return h[1](q);
  };
  return {
    soqlLog,
    soql: async (q) => {
      soqlLog.push(q);
      return answer(handlers, q);
    },
    tooling: async (q) => answer(tooling, q),
  };
}

function entry(partial: Partial<DbSchemaEntry> & { sobject: string }): DbSchemaEntry {
  return {
    developerName: partial.sobject,
    type: "data",
    whereSoql: null,
    profileIds: new Set(),
    profileNames: new Set(),
    permissionSets: new Set(),
    ...partial,
  };
}

const user: UserContext = {
  id: "005000000000001AAA",
  username: "rep@example.com",
  name: "Rep",
  profileId: "00e000000000001AAA",
  profileName: "Field Sales",
  permissionSets: new Set(["LSC_Rep"]),
  territories: [{ id: "0MI000000000001AAA", name: "T-01" }],
};

describe("resolveScalarTags", () => {
  it("substitutes user and territory tags case-insensitively and flattens newlines", () => {
    const out = resolveScalarTags(
      "OwnerId = '{USER.ID}'\nAND Territory__c = '{user.territory}' AND T2 = '{USER.TERRITORYID}' AND Team IN ({USER.TEAMS}) AND X IN ({USER.ACCESS.ENTITIES})",
      { userId: "U1", territoryName: "T-01", territoryId: "0MI1" }
    );
    expect(out).toBe(
      "OwnerId = 'U1' AND Territory__c = 'T-01' AND T2 = '0MI1' AND Team IN ('') AND X IN ('*')"
    );
  });

  it("does not interpret $ sequences in substituted values", () => {
    expect(resolveScalarTags("A = '{USER.TERRITORY}'", { userId: "", territoryName: "$&x", territoryId: "" })).toBe(
      "A = '$&x'"
    );
  });
});

describe("substituteIdTag", () => {
  it("handles bare and quoted tag forms", () => {
    expect(substituteIdTag("AccountId IN ({ACCOUNT.IDS})", "{ACCOUNT.IDS}", ["a", "b"])).toBe(
      "AccountId IN ('a','b')"
    );
    expect(substituteIdTag("AccountId IN ('{ACCOUNT.IDS}')", "{ACCOUNT.IDS}", ["a", "b"])).toBe(
      "AccountId IN ('a','b')"
    );
  });
});

describe("estimateDeviceRequests", () => {
  it("matches the app's chunking formula", () => {
    const cond = "AccountId IN ({ACCOUNT.IDS})";
    // where-limit: 4000 - 28 - 200 = 3772 → 3772 / 22 = 171 ids per request
    expect(estimateDeviceRequests("Contact", cond, "{ACCOUNT.IDS}", 171)).toBe(1);
    expect(estimateDeviceRequests("Contact", cond, "{ACCOUNT.IDS}", 172)).toBe(2);
    expect(estimateDeviceRequests("Contact", cond, "{ACCOUNT.IDS}", 1000)).toBe(6);
  });

  it("divides the chunk by the number of tag occurrences", () => {
    const cond = "AccountId IN ({ACCOUNT.IDS}) OR Other__c IN ({ACCOUNT.IDS})";
    // (4000 - 59 - 200) / 22 = 170 → / 2 = 85
    expect(estimateDeviceRequests("Contact", cond, "{ACCOUNT.IDS}", 85)).toBe(1);
    expect(estimateDeviceRequests("Contact", cond, "{ACCOUNT.IDS}", 86)).toBe(2);
  });

  it("returns null when the filter leaves no room for ids", () => {
    expect(estimateDeviceRequests("Contact", "x".repeat(3900) + " {ACCOUNT.IDS}", "{ACCOUNT.IDS}", 10)).toBeNull();
  });
});

describe("selectApplicableTables", () => {
  it("matches by profile assignment, falling back to profile names when unassigned", () => {
    const tables = selectApplicableTables(
      [
        entry({ sobject: "Account", profileIds: new Set([user.profileId]) }),
        entry({ sobject: "Contact", profileNames: new Set(["Field Sales"]) }),
        // Assigned to another profile: the Profiles field is ignored.
        entry({ sobject: "Case", profileIds: new Set(["00eOTHER"]), profileNames: new Set(["Field Sales"]) }),
      ],
      user
    );
    expect(tables.map((t) => t.entry.sobject)).toEqual(["Account", "Contact"]);
  });

  it("keeps the first record per SObject, but prefers a profile match over a permission-set match", () => {
    const tables = selectApplicableTables(
      [
        entry({ sobject: "Visit", developerName: "A_Visit", permissionSets: new Set(["LSC_Rep"]) }),
        entry({ sobject: "Visit", developerName: "B_Visit", profileIds: new Set([user.profileId]) }),
        entry({ sobject: "Visit", developerName: "C_Visit", profileIds: new Set([user.profileId]) }),
      ],
      user
    );
    expect(tables).toHaveLength(1);
    expect(tables[0].entry.developerName).toBe("B_Visit");
    expect(tables[0].matchedBy).toBe("profile");
  });
});

describe("loadDbSchemaEntries", () => {
  it("assembles entries and skips configuration and non-data records", async () => {
    const org = mockOrg(
      [],
      [
        [/FROM LifeSciConfigCategory/, () => ok([{ Id: "CAT" }])],
        [
          /FROM LifeSciConfigRecord /,
          () => ok([{ Id: "R1", DeveloperName: "Account" }, { Id: "R2", DeveloperName: "Config" }, { Id: "R3", DeveloperName: "Meta" }]),
        ],
        [
          /FROM LifeSciConfigFieldValue/,
          () =>
            ok([
              { LifeSciConfigRecordId: "R1", FieldName: "SObject", DataType: "TEXT", TextValue: "Account" },
              { LifeSciConfigRecordId: "R1", FieldName: "WhereSoql", DataType: "LONGTEXT", LongTextValue: "IsActive = true" },
              { LifeSciConfigRecordId: "R1", FieldName: "PermissionSets", DataType: "TEXT", TextValue: "PS_A; PS_B" },
              { LifeSciConfigRecordId: "R2", FieldName: "SObject", DataType: "TEXT", TextValue: "Foo__c" },
              { LifeSciConfigRecordId: "R2", FieldName: "Type", DataType: "TEXT", TextValue: "Configuration" },
              { LifeSciConfigRecordId: "R3", FieldName: "SObject", DataType: "TEXT", TextValue: "LifeSciMetadataRecord" },
            ]),
        ],
        [
          /FROM LifeSciConfigAssignment/,
          () =>
            ok([
              { LifeSciConfigRecordId: "R1", AssignedToId: "00eP", AssignmentLevel: "Profile" },
              { LifeSciConfigRecordId: "R1", AssignedToId: "005U", AssignmentLevel: "User" },
            ]),
        ],
      ]
    );
    const entries = await loadDbSchemaEntries(org);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sobject: "Account", whereSoql: "IsActive = true" });
    expect([...entries[0].profileIds]).toEqual(["00eP"]);
    expect([...entries[0].permissionSets]).toEqual(["PS_A", "PS_B"]);
  });
});

describe("profileTerritory", () => {
  const territory = user.territories[0];
  const table = (sobject: string, whereSoql: string | null) => ({
    entry: entry({ sobject, whereSoql }),
    matchedBy: "profile" as const,
  });

  it("resolves OT2A → Account → dependent tables in order and sums chunked counts", async () => {
    const accountIds = ["A1", "A2", "A3"];
    const org = mockOrg([
      [/^SELECT ObjectId FROM ObjectTerritory2Association/, () => ok(accountIds.map((id) => ({ ObjectId: id })))],
      [/^SELECT COUNT\(\) FROM ObjectTerritory2Association/, () => ok([], 3)],
      [/^SELECT Id FROM Account WHERE Id IN \('A1','A2'\)/, () => ok([{ Id: "A1" }, { Id: "A2" }])],
      [/^SELECT Id FROM Account WHERE Id IN \('A3'\)/, () => ok([{ Id: "A3" }])],
      [/^SELECT COUNT\(\) FROM Contact WHERE AccountId IN \('A1','A2'\)/, () => ok([], 10)],
      [/^SELECT COUNT\(\) FROM Contact WHERE AccountId IN \('A3'\)/, () => ok([], 5)],
      [/^SELECT COUNT\(\) FROM Product2$/, () => ok([], 7)],
    ]);
    const result = await profileTerritory(
      org,
      user,
      territory,
      [
        table("Contact", "AccountId IN ({ACCOUNT.IDS})"),
        table("Account", "Id IN ({OT2A.OBJ.IDS})"),
        table("ObjectTerritory2Association", "Territory2Id = '{USER.TERRITORYID}'"),
        table("Product2", null),
      ],
      { idsPerQuery: 2, concurrency: 2 }
    );

    expect(org.soqlLog[0]).toBe(
      "SELECT ObjectId FROM ObjectTerritory2Association WHERE Territory2Id = '0MI000000000001AAA'"
    );
    const bySobject = Object.fromEntries(result.tables.map((t) => [t.sobject, t]));
    expect(bySobject.Contact).toMatchObject({ status: "counted", records: 15, idTag: "{ACCOUNT.IDS}", deviceRequests: 1 });
    expect(bySobject.Account).toMatchObject({ status: "counted", records: 3 });
    expect(bySobject.ObjectTerritory2Association.records).toBe(3);
    expect(result.totalRecords).toBe(15 + 3 + 3 + 7);
    expect(result.largestTable?.sobject).toBe("Contact");
  });

  it("reports content, STI and combined id-tag filters as not-estimated and SOQL failures as errors", async () => {
    const org = mockOrg([
      [/FROM Bad__c/, () => ({ success: false, error: "No such column 'Nope__c'" })],
    ]);
    const result = await profileTerritory(org, user, territory, [
      table("ContentDocumentLink", "LinkedEntityId IN ({related.entities})"),
      table("Stuff__c", "Id IN ({STI.OBJ.IDS})"),
      table("Mixed__c", "A IN ({ACCOUNT.IDS}) OR B IN ({OT2A.OBJ.IDS})"),
      table("Bad__c", "Nope__c = true"),
    ]);
    const statuses = Object.fromEntries(result.tables.map((t) => [t.sobject, t.status]));
    expect(statuses).toEqual({
      ContentDocumentLink: "not-estimated",
      "Stuff__c": "not-estimated",
      "Mixed__c": "not-estimated",
      "Bad__c": "error",
    });
    expect(result.tables.find((t) => t.sobject === "Bad__c")?.note).toContain("Nope__c");
    expect(result.totalRecords).toBe(0);
    expect(result.largestTable).toBeNull();
  });

  it("predicts zero rows when an id tag's source table is not synced", async () => {
    const org = mockOrg([]);
    const result = await profileTerritory(org, user, territory, [table("Contact", "AccountId IN ({ACCOUNT.IDS})")]);
    expect(result.tables[0]).toMatchObject({ status: "counted", records: 0, deviceRequests: 0 });
    expect(org.soqlLog).toEqual([]);
  });

  it("marks dependent tables not-estimated when the source table query fails", async () => {
    const org = mockOrg([[/FROM Account/, () => ({ success: false, error: "boom" })]]);
    const result = await profileTerritory(org, user, territory, [
      table("Account", "IsActive = true"),
      table("Contact", "AccountId IN ({ACCOUNT.IDS})"),
    ]);
    const bySobject = Object.fromEntries(result.tables.map((t) => [t.sobject, t.status]));
    expect(bySobject).toEqual({ Account: "error", Contact: "not-estimated" });
  });
});
