import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  cachedToolingQuery: vi.fn(),
}));

const cli = await import("../../../src/salesforce/cli.js");
const { collectCategoryRecords, collectCategoryRecordsWhere } = await import("../../../src/config/collect.js");
const { invalidateSharedReads } = await import("../../../src/config/read-cache.js");

const objects = ["Account", "Visit", "Task", "Visit", "Contact"];
const records = objects.map((o, i) => ({ Id: `r${i}`, DeveloperName: `DbSchema_${o}${i}`, MasterLabel: `L${i}`, IsActive: i % 2 === 0, IsOrgLevel: false, LifeSciConfigCategoryId: "c1" }));

/** A tiny Tooling API: one DbSchema category, five records, SObject + Type values, a profile assignment each. */
function fakeOrg(q: string) {
  const ids = [...q.matchAll(/'((?:r|c|00e)\w*)'/g)].map((m) => m[1]);
  const ok = (rows: unknown[]) => ({ success: true, data: { totalSize: rows.length, done: true, records: rows } });
  if (q.includes("FROM LifeSciConfigCategory")) return ok([{ Id: "c1", DeveloperName: "DbSchema", Category: "DbSchema", MasterLabel: "x" }]);
  if (q.includes("FROM LifeSciConfigRecord")) return ok(records.filter(() => true));
  if (q.includes("FROM LifeSciConfigFieldValue")) {
    const only = /FieldName = '(\w+)'/.exec(q)?.[1];
    const rows = ids.flatMap((id) => {
      const i = Number(id.slice(1));
      return [
        { Id: `${id}s`, FieldName: "SObject", DataType: "OBJECT", ObjectValue: objects[i], LifeSciConfigRecordId: id },
        { Id: `${id}t`, FieldName: "Type", DataType: "PICKLIST", PicklistValue: "DATA", LifeSciConfigRecordId: id },
      ].filter((f) => !only || f.FieldName === only);
    });
    return ok(rows);
  }
  if (q.includes("FROM LifeSciConfigAssignment")) return ok(ids.map((id) => ({ Id: `${id}a`, LifeSciConfigRecordId: id, AssignedToId: "00e1", AssignmentLevel: "Profile" })));
  return ok([]);
}

beforeEach(() => {
  invalidateSharedReads();
  vi.mocked(cli.runToolingQuery).mockReset();
  vi.mocked(cli.runToolingQuery).mockImplementation((async (q: string) => fakeOrg(q)) as never);
  vi.mocked(cli.cachedToolingQuery).mockReset();
  vi.mocked(cli.cachedToolingQuery).mockImplementation((async () => ({ success: true, data: { records: [{ Id: "00e1", Name: "Rep" }] } })) as never);
});

const CAT = `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category = 'DbSchema'`;

describe("collectCategoryRecordsWhere", () => {
  it("returns the same records as reading everything and filtering, but hydrates only the matches", async () => {
    const keep = (v: unknown) => ["visit", "account"].includes(String(v).toLowerCase());
    const full = (await collectCategoryRecords("org", CAT, { strict: true })).filter((r) => keep(r.fields.SObject));
    invalidateSharedReads();
    vi.mocked(cli.runToolingQuery).mockClear();
    const narrowed = await collectCategoryRecordsWhere("org", CAT, { field: "SObject", keep });
    expect(narrowed.records).toEqual(full);
    expect(narrowed.developerNames).toEqual(records.map((r) => r.DeveloperName));
    // The values of the three non-matching records were never asked for beyond the one probe.
    const valueQueries = vi.mocked(cli.runToolingQuery).mock.calls.map((c) => c[0] as string).filter((q) => q.includes("LifeSciConfigFieldValue") && !q.includes("FieldName ="));
    expect(valueQueries.join(" ")).not.toContain("'r2'");
    expect(valueQueries.join(" ")).not.toContain("'r4'");
  });

  it("throws when a read fails so the caller can fall back to the whole category", async () => {
    vi.mocked(cli.runToolingQuery).mockImplementation((async (q: string) => (q.includes("FieldName =") ? { success: false, error: "nope" } : fakeOrg(q))) as never);
    await expect(collectCategoryRecordsWhere("org", CAT, { field: "SObject", keep: () => true })).rejects.toThrow(/nope/);
  });
});
