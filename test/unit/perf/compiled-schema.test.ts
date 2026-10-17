import { describe, it, expect, vi } from "vitest";
import type { CliResult, SoqlQueryResult } from "../../../src/salesforce/cli.js";
import type { OrgQuerier } from "../../../src/perf/sync-volume.js";
import { profileUsers, renderVolumes } from "../../../src/perf/assessment.js";
import {
  type CompiledSchemaSource,
  createCompiledSchemaSource,
  diffTables,
  loadObjectAccess,
  tablesFromArchive,
} from "../../../src/perf/compiled-schema.js";

function ok(records: Record<string, unknown>[], totalSize = records.length): CliResult<SoqlQueryResult> {
  return { success: true, data: { totalSize, done: true, records } };
}

function mockOrg(handlers: Array<[RegExp, (q: string) => CliResult<SoqlQueryResult>]>, tooling: typeof handlers = []): OrgQuerier & { log: string[] } {
  const log: string[] = [];
  const answer = (list: typeof handlers, q: string) => {
    const h = list.find(([re]) => re.test(q));
    if (!h) throw new Error(`unexpected query: ${q}`);
    return h[1](q);
  };
  return {
    log,
    soql: async (q) => {
      log.push(q);
      return answer(handlers, q);
    },
    tooling: async (q) => answer(tooling, q),
  };
}

const files = {
  db: {
    Account: { SObject: "Account", DeveloperName: "DbSchema_Account", WhereSoql: "OwnerId = '{USER.ID}'" },
    Event: { SObject: "Event", DeveloperName: "DbSchema_Event" },
    Secret__c: { SObject: "Secret__c", DeveloperName: "DbSchema_Secret" },
    Config__c: { SObject: "Config__c", DeveloperName: "DbSchema_Config" },
    Off__c: { SObject: "Off__c", DeveloperName: "DbSchema_Off", IsActive: false },
  },
  dbPs: {
    Visit__c: { SObject: "Visit__c", DeveloperName: "DbSchemaPs_Visit", PermissionSets: "LSC_Rep;Other" },
    Skip__c: { SObject: "Skip__c", DeveloperName: "DbSchemaPs_Skip", PermissionSets: "Unassigned" },
    Account: { SObject: "Account", DeveloperName: "DbSchemaPs_Account", WhereSoql: "Id != null", PermissionSets: "LSC_Rep" },
  },
  config: { Config__c: {} },
};
const user = { permissionSets: new Set(["lsc_rep"]) };

describe("tablesFromArchive", () => {
  it("excludes config tables and inactive entries, merges permission-set tables, and prefers the profile entry", () => {
    const tables = tablesFromArchive(files, user);
    expect(tables.map((t) => [t.entry.sobject, t.matchedBy])).toEqual([
      ["Account", "profile"],
      ["Event", "profile"],
      ["Secret__c", "profile"],
      ["Visit__c", "permissionSet"],
    ]);
    expect(tables[0].entry.whereSoql).toBe("OwnerId = '{USER.ID}'");
    expect(tables[1].entry.whereSoql).toBeNull();
  });

  it("drops only permission-controlled objects the user cannot read", () => {
    const access = { governed: new Set(["account", "secret__c"]), readable: new Set(["account"]) };
    const names = tablesFromArchive(files, user, access).map((t) => t.entry.sobject);
    expect(names).toEqual(["Account", "Event", "Visit__c"]);
  });
});

describe("diffTables", () => {
  it("reports differing WhereSoql ignoring whitespace, and one-sided tables", () => {
    const t = (sobject: string, whereSoql: string | null) => ({
      matchedBy: "profile" as const,
      entry: { developerName: sobject, sobject, type: "", whereSoql, profileIds: new Set<string>(), profileNames: new Set<string>(), permissionSets: new Set<string>() },
    });
    const diff = diffTables(
      [t("Account", "A = 1\n AND B = 2"), t("Event", "X = 1"), t("New__c", null)],
      [t("Account", "A = 1 AND B = 2"), t("Event", "X = 2"), t("Old__c", null)]
    );
    expect(diff).toEqual({ differing: ["Event"], onlyCompiled: ["New__c"], onlyDbSchema: ["Old__c"] });
  });
});

describe("loadObjectAccess", () => {
  it("scopes both lookups to the given objects and returns null when nothing is found or a query fails", async () => {
    const org = mockOrg([
      [/WHERE PermissionsRead = true/, () => ok([{ SobjectType: "Account" }])],
      [/GROUP BY SobjectType/, () => ok([{ SobjectType: "Account" }, { SobjectType: "Secret__c" }])],
    ]);
    const access = await loadObjectAccess(org, "005X", ["Account", "Secret__c"]);
    expect([...(access?.governed ?? [])]).toEqual(["account", "secret__c"]);
    expect([...(access?.readable ?? [])]).toEqual(["account"]);
    expect(org.log.every((q) => q.includes("SobjectType IN ('Account','Secret__c')"))).toBe(true);

    expect(await loadObjectAccess(org, "005X", [])).toBeNull();
    const failing = mockOrg([[/ObjectPermissions/, () => ({ success: false, error: "nope" })]]);
    expect(await loadObjectAccess(failing, "005X", ["Account"])).toBeNull();
  });
});

describe("createCompiledSchemaSource", () => {
  const u = { id: "005X", profileId: "00eX", profileName: "Rep", permissionSets: new Set<string>() };

  it("falls back, and looks the archive up once per profile, when the profile has no archive", async () => {
    const org = mockOrg([[/FROM LifeSciMobileMetadataRecord/, () => ok([])]]);
    const getSession = vi.fn();
    const source = createCompiledSchemaSource({ org, getSession });
    expect(await source.tablesFor(u)).toEqual({ fallbackReason: "no active metadata archive for the profile" });
    await source.tablesFor({ ...u, id: "005Y" });
    expect(org.log).toHaveLength(1);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("falls back with the failure message when the download cannot start", async () => {
    const org = mockOrg([
      [/FROM LifeSciMobileMetadataRecord/, () => ok([{ Id: "1KA1", MetadataDocumentId: "069D" }])],
      [/FROM ContentVersion/, () => ok([{ Id: "068V", Checksum: "ABC", ContentSize: 10 }])],
    ]);
    const source = createCompiledSchemaSource({ org, getSession: async () => Promise.reject(new Error("no creds")) });
    expect(await source.tablesFor(u)).toEqual({ fallbackReason: "no creds" });
  });

  it("falls back for a user without a profile id", async () => {
    const source = createCompiledSchemaSource({ org: mockOrg([]), getSession: vi.fn() });
    expect(await source.tablesFor({ ...u, profileId: "" })).toEqual({ fallbackReason: "user has no profile id" });
  });
});

describe("profileUsers with a compiled schema", () => {
  function org() {
    return mockOrg(
      [
        [/FROM User WHERE/, () => ok([{ Id: "005000000000001AAA", Username: "rep@x", Name: "Rep", ProfileId: "00e000000000001AAA", Profile: { Name: "Rep" } }])],
        [/FROM PermissionSetAssignment/, () => ok([])],
        [/FROM UserTerritory2Association/, () => ok([])],
        [/FROM EntityDefinition/, () => ok([])],
        [/SELECT COUNT\(\) FROM Event/, () => ok([], 7)],
        [/SELECT COUNT\(\) FROM Account/, () => ok([], 3)],
      ],
      [
        [/FROM LifeSciConfigCategory/, () => ok([{ Id: "cat" }])],
        [/FROM LifeSciConfigRecord /, () => ok([{ Id: "r1", DeveloperName: "DbSchema_Account" }])],
        [/FROM LifeSciConfigFieldValue/, () => ok([{ LifeSciConfigRecordId: "r1", FieldName: "SObject", DataType: "TEXT", TextValue: "Account" }])],
        [/FROM LifeSciConfigAssignment/, () => ok([{ LifeSciConfigRecordId: "r1", AssignedToId: "00e000000000001AAA", AssignmentLevel: "Profile" }])],
      ]
    );
  }
  const entry = (sobject: string) => ({
    matchedBy: "profile" as const,
    entry: { developerName: sobject, sobject, type: "", whereSoql: null, profileIds: new Set<string>(), profileNames: new Set<string>(), permissionSets: new Set<string>() },
  });

  it("counts the compiled table list and records the source and differences", async () => {
    const compiledSchema: CompiledSchemaSource = {
      tablesFor: async () => ({ result: { tables: [entry("Event")], notes: ["approximated"] } }),
    };
    const [v] = await profileUsers(org(), org(), ["rep@x"], { compiledSchema });
    expect(v.schemaSource).toBe("compiled");
    expect(v.tableCount).toBe(1);
    expect(v.territories[0].totalRecords).toBe(7);
    expect(v.schemaNotes?.[0]).toBe("approximated");
    expect(v.schemaNotes?.[1]).toContain("1 only in the compiled schema (Event); 1 only in DB Schema records (Account)");
    const md = renderVolumes([v]);
    expect(md).toContain("**Tables synced:** 1 (from compiled metadata schema)");
    expect(md).toContain("*Schema:* approximated");
  });

  it("falls back to DB Schema records and says why", async () => {
    const compiledSchema: CompiledSchemaSource = { tablesFor: async () => ({ fallbackReason: "boom" }) };
    const [v] = await profileUsers(org(), org(), ["rep@x"], { compiledSchema });
    expect(v.schemaSource).toBe("db-schema");
    expect(v.territories[0].totalRecords).toBe(3);
    expect(v.schemaNotes).toEqual(["Used DB Schema records: compiled schema unavailable (boom)."]);
    expect(renderVolumes([v])).toContain("(from DB Schema records)");
  });

  it("omits schema fields when no compiled source is supplied", async () => {
    const [v] = await profileUsers(org(), org(), ["rep@x"]);
    expect(v.schemaSource).toBeUndefined();
    expect(v.schemaNotes).toBeUndefined();
  });
});
