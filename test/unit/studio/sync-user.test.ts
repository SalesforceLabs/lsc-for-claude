import { describe, it, expect } from "vitest";
import type { CliResult, SoqlQueryResult } from "../../../src/salesforce/cli.js";
import type { OrgQuerier } from "../../../src/perf/sync-volume.js";
import { matchSchemaRecord, syncUserDetail, type SchemaRecordRef, type SyncUserDeps } from "../../../src/studio/sync-user.js";

function ok(records: Record<string, unknown>[], totalSize = records.length): CliResult<SoqlQueryResult> {
  return { success: true, data: { totalSize, done: true, records } };
}

const USER = "005000000000001AAA";

function ref(developerName: string, sobject: string, over: Partial<SchemaRecordRef["fields"]> = {}, profiles = ["Field Sales"], permissionSets: string[] = []): SchemaRecordRef {
  return {
    category: "DbSchema",
    developerName,
    recordId: `a0${developerName}`,
    itemId: `DbSchema:${developerName}`,
    active: true,
    fields: { SObject: sobject, Type: "OBJECT", WhereSoql: null, OneWaySync: false, AttachmentsSupport: null, DeltaDateField: "LastModifiedDate", ...over },
    profiles,
    permissionSets,
    fieldRows: ["WhereSoql", "AttachmentsSupport", "DeltaDateField"],
  };
}

function deps(counts: Record<string, number>, records: SchemaRecordRef[], telemetry = true): SyncUserDeps {
  const querier: OrgQuerier = {
    soql: async (q) => {
      if (/FROM User WHERE/.test(q)) return ok([{ Id: USER, Username: "rep@x", Name: "Rep", ProfileId: "00e1", Profile: { Name: "Field Sales" } }]);
      if (/FROM PermissionSetAssignment/.test(q)) return ok([]);
      if (/FROM UserTerritory2Association/.test(q)) {
        return ok([
          { Territory2Id: "0MI1", Territory2: { Name: "T-01" } },
          { Territory2Id: "0MI2", Territory2: { Name: "T-02" } },
        ]);
      }
      if (/FROM EntityDefinition/.test(q)) return ok([{ QualifiedApiName: "Task", InternalSharingModel: "Private" }]);
      if (/FROM DeviceSyncSummary/.test(q)) {
        return ok([{ Id: "a1", CreatedDate: "2026-10-01T00:00:00Z", SyncTrigger: "Delta", CompletionStatus: "Finished", CreatedBy: { Username: "rep@x" } }]);
      }
      const m = /SELECT COUNT\(\) FROM (\w+)/.exec(q);
      if (m) return ok([], counts[m[1]] ?? 0);
      throw new Error(`unexpected soql: ${q}`);
    },
    tooling: async (q) => {
      if (/FROM LifeSciConfigCategory/.test(q)) return ok([{ Id: "cat1" }]);
      if (/Id, DeveloperName FROM LifeSciConfigRecord/.test(q)) {
        return ok([{ Id: "r1", DeveloperName: "Task_DB" }, { Id: "r2", DeveloperName: "Account_DB" }]);
      }
      if (/FROM LifeSciConfigFieldValue/.test(q)) {
        return ok([
          { LifeSciConfigRecordId: "r1", FieldName: "SObject", DataType: "OBJECT", ObjectValue: "Task" },
          { LifeSciConfigRecordId: "r1", FieldName: "Type", DataType: "PICKLIST", PicklistValue: "OBJECT" },
          { LifeSciConfigRecordId: "r2", FieldName: "SObject", DataType: "OBJECT", ObjectValue: "Account" },
          { LifeSciConfigRecordId: "r2", FieldName: "Type", DataType: "PICKLIST", PicklistValue: "OBJECT" },
          { LifeSciConfigRecordId: "r2", FieldName: "WhereSoql", DataType: "LONGTEXT", LongTextValue: "OwnerId = '{USER.ID}'" },
        ]);
      }
      if (/FROM LifeSciConfigAssignment/.test(q)) {
        return ok([
          { LifeSciConfigRecordId: "r1", AssignedToId: "00e1", AssignmentLevel: "Profile" },
          { LifeSciConfigRecordId: "r2", AssignedToId: "00e1", AssignmentLevel: "Profile" },
        ]);
      }
      if (/FROM LifeSciConfigRecord/.test(q)) return ok([{ Id: "r1", DeveloperName: "Task_DB" }, { Id: "r2", DeveloperName: "Account_DB" }]);
      throw new Error(`unexpected tooling: ${q}`);
    },
  };
  return {
    querier: () => querier,
    telemetryFields: () => async () => new Set(telemetry ? ["Id", "CreatedDate", "SyncTrigger", "CompletionStatus"] : []),
    dbSchemaRecords: async () => records,
  };
}

describe("matchSchemaRecord", () => {
  const user = { profileName: "Field Sales", permissionSets: new Set(["Med_Reps"]) };
  const records = [ref("A", "Task", {}, ["Other"]), ref("B", "Task"), ref("C", "Event", {}, [], ["Med_Reps"])];
  it("prefers the exact developer name among records that reach the user", () => {
    expect(matchSchemaRecord({ developerName: "B", sobject: "Task" }, records, user)?.developerName).toBe("B");
  });
  it("falls back to an active record for the object that reaches the user", () => {
    expect(matchSchemaRecord({ developerName: "zz", sobject: "task" }, records, user)?.developerName).toBe("B");
    expect(matchSchemaRecord({ developerName: "zz", sobject: "Event" }, records, user)?.developerName).toBe("C");
  });
  it("never picks another profile's record", () => {
    expect(matchSchemaRecord({ developerName: "A", sobject: "Task" }, [records[0]], user)).toBeNull();
    expect(matchSchemaRecord({ developerName: "zz", sobject: "Nope" }, records, user)).toBeNull();
  });
});

describe("syncUserDetail", () => {
  const records = [ref("Task_DB", "Task"), ref("Account_DB", "Account", { WhereSoql: "OwnerId = '{USER.ID}'" })];

  it("profiles every territory, ties tables to their records, and adds hints", async () => {
    const out = await syncUserDetail("org", { userId: USER }, deps({ Task: 30_000, Account: 500 }, records));

    expect(out.user).toMatchObject({ username: "rep@x", profileName: "Field Sales", territories: [{ id: "0MI1", name: "T-01" }, { id: "0MI2", name: "T-02" }] });
    expect(out.schemaSource).toBe("db-schema");
    expect(out.territories.map((t) => t.territory?.name)).toEqual(["T-01", "T-02"]);

    const first = out.territories[0];
    expect(first.totalRecords).toBe(30_500);
    const [task, account] = first.tables;
    expect(task).toMatchObject({ sobject: "Task", records: 30_000, mayOvercount: true, schema: { itemId: "DbSchema:Task_DB", recordId: "a0Task_DB" } });
    expect(task.sharePct).toBeCloseTo(98.36, 1);
    expect(task.hints.map((h) => h.id)).toContain("no-filter");
    expect(task.hints.find((h) => h.id === "no-filter")?.suggestion?.field).toBe("WhereSoql");
    expect(account.hints).toEqual([]);
    expect(first.upperBoundRecords).toBe(30_000);
    expect(out.telemetry?.recent).toHaveLength(1);
  });

  it("caps territories and reports missing telemetry without failing", async () => {
    const out = await syncUserDetail("org", { userId: USER, maxTerritories: 1 }, deps({}, records, false));
    expect(out.territories).toHaveLength(1);
    expect(out.user.territories).toHaveLength(2);
    expect(out.telemetry).toBeUndefined();
    expect(out.telemetryError).toMatch(/DeviceSyncSummary/);
  });

  it("uses the compiled schema when available and notes the fallback otherwise", async () => {
    const d = deps({ Task: 5 }, records);
    const fallback = await syncUserDetail("org", { userId: USER }, { ...d, compiledSchema: () => ({ tablesFor: async () => ({ fallbackReason: "no archive" }) }) });
    expect(fallback.schemaSource).toBe("db-schema");
    expect(fallback.schemaNotes[0]).toContain("no archive");
  });
});
