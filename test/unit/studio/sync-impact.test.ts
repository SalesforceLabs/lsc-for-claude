import { describe, it, expect } from "vitest";
import type { CliResult, SoqlQueryResult } from "../../../src/salesforce/cli.js";
import type { OrgQuerier } from "../../../src/perf/sync-volume.js";
import { syncImpact } from "../../../src/studio/sync-impact.js";

const ok = (records: Record<string, unknown>[]): CliResult<SoqlQueryResult> => ({ success: true, data: { totalSize: records.length, done: true, records } });

function fakeOrg(visitWhere: string[]): OrgQuerier & { log: string[] } {
  const log: string[] = [];
  const handle = (q: string): CliResult<SoqlQueryResult> => {
    log.push(q);
    if (/FROM LifeSciConfigCategory/.test(q)) return ok([{ Id: "cat" }]);
    if (/FROM LifeSciConfigRecord /.test(q)) return ok([{ Id: "r1", DeveloperName: "Visit" }]);
    if (/FROM LifeSciConfigFieldValue/.test(q)) {
      return ok([
        { LifeSciConfigRecordId: "r1", FieldName: "SObject", DataType: "TEXT", TextValue: "Visit" },
        { LifeSciConfigRecordId: "r1", FieldName: "Type", DataType: "TEXT", TextValue: "Object" },
        { LifeSciConfigRecordId: "r1", FieldName: "Profiles", DataType: "TEXT", TextValue: "Field Rep" },
      ]);
    }
    if (/FROM LifeSciConfigAssignment/.test(q)) return ok([]);
    if (/FROM User WHERE/.test(q) && /Profile\.Name/.test(q) && !/Username|Id = /.test(q.split("WHERE")[1] ?? "")) return ok([{ Id: "005000000000001", Username: "jane@x", Name: "Jane", Profile: { Name: "Field Rep" } }]);
    if (/FROM User WHERE/.test(q)) return ok([{ Id: "005000000000001", Username: "jane@x", Name: "Jane", ProfileId: "00e1", Profile: { Name: "Field Rep" } }]);
    if (/FROM UserTerritory2Association/.test(q)) return ok([{ Territory2Id: "0MI1", Territory2: { Name: "T-East" }, UserId: "005000000000001", cnt: 1 }]);
    if (/FROM PermissionSetAssignment/.test(q)) return ok([]);
    if (/COUNT\(\) FROM Visit/i.test(q) || /FROM Visit/.test(q)) {
      if (/Bad/.test(q)) return { success: false, error: "no such column Bad" } as CliResult<SoqlQueryResult>;
      return { success: true, data: { totalSize: /Status/.test(q) ? visitWhere.length : 100, done: true, records: [] } };
    }
    return ok([]);
  };
  return { log, soql: async (q) => handle(q), tooling: async (q) => handle(q) };
}

describe("syncImpact", () => {
  it("ignores changes that don't touch DB Schema", async () => {
    const r = await syncImpact("o", { changes: [{ kind: "assignPsl" }] }, { querier: () => fakeOrg([]) });
    expect(r.profiles).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/No pending DB Schema/);
  });

  it("reports before and after for an affected profile and flags a failing filter", async () => {
    const org = fakeOrg(["a", "b"]);
    const change = { kind: "setConfigField", category: "DbSchema", developerName: "Visit", field: "WhereSoql", from: null, to: "Status = 'X'" };
    const r = await syncImpact("o", { changes: [change] }, { querier: () => org });
    expect(r.profiles).toHaveLength(1);
    const p = r.profiles[0];
    expect(p.profile).toBe("Field Rep");
    expect(p.territory).toBe("T-East");
    expect(p.totalBefore).toBe(100);
    expect(p.totalAfter).toBe(2);
    expect(p.tables[0].sobject).toBe("Visit");
    expect(r.queries).toBeGreaterThan(0);

    const bad = await syncImpact("o", { changes: [{ ...change, to: "Bad = 1" }] }, { querier: () => fakeOrg([]) });
    expect(bad.profiles[0].failing[0].message).toMatch(/Bad/);
  });

  it("asks the org each distinct query once, and counts only the changed table after the change", async () => {
    const org = fakeOrg(["a", "b"]);
    const change = { kind: "setConfigField", category: "DbSchema", developerName: "Visit", field: "WhereSoql", from: null, to: "Status = 'X'" };
    const r = await syncImpact("o", { changes: [change] }, { querier: () => org });
    expect(new Set(org.log).size).toBe(org.log.length);
    expect(r.queries).toBe(org.log.length);
    expect(org.log.filter((q) => /COUNT\(\) FROM Visit/i.test(q) && /Status = 'X'/.test(q))).toHaveLength(1);
  });
});
