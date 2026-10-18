import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../src/salesforce/cli.js");
const { attachModifiers, recentChanges } = await import("../../../src/studio/drift-recent.js");

type Row = Record<string, unknown>;
let tooling: Record<string, Row[]>;
const reply = (rows: Row[]) => Promise.resolve({ success: true, data: { totalSize: rows.length, done: true, records: rows } });
const from = (q: string) => /FROM\s+(\w+)/i.exec(q)?.[1] ?? "";

const rec = { DeveloperName: "dbSchema_Visit", MasterLabel: "Visit", LifeSciConfigCategoryId: "c1" };

beforeEach(() => {
  tooling = { LifeSciConfigCategory: [{ Id: "c1", Category: "DbSchema" }] };
  vi.mocked(runSoqlQuery).mockImplementation((() => reply([])) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => reply(tooling[from(q)] ?? [])) as never);
});

describe("recentChanges", () => {
  it("lists a record whose only change was a field value, stamped by that edit", async () => {
    tooling.LifeSciConfigFieldValue = [
      { LifeSciConfigRecordId: "r1", LifeSciConfigRecord: rec, LastModifiedDate: "2026-10-10T00:00:00.000+0000", LastModifiedBy: { Name: "Pat" } },
    ];
    const { changes } = await recentChanges("org");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "config", name: "Visit", detail: "DbSchema", modifiedBy: "Pat" });
  });

  it("lists a record once, with its newest change", async () => {
    tooling.LifeSciConfigRecord = [{ Id: "r1", ...rec, LastModifiedDate: "2026-10-01T00:00:00.000+0000", LastModifiedBy: { Name: "Old" } }];
    tooling.LifeSciConfigAssignment = [
      { LifeSciConfigRecordId: "r1", LifeSciConfigRecord: rec, LastModifiedDate: "2026-10-12T00:00:00.000+0000", LastModifiedBy: { Name: "New" } },
    ];
    const { changes } = await recentChanges("org");
    expect(changes.map((c) => c.modifiedBy)).toEqual(["New"]);
  });
});

describe("attachModifiers", () => {
  it("takes the newest of the record and its field values", async () => {
    tooling.LifeSciConfigRecord = [{ Id: "r1", DeveloperName: "dbSchema_Visit", LastModifiedDate: "2026-10-01T00:00:00.000+0000", LastModifiedBy: { Name: "Old" } }];
    tooling.LifeSciConfigFieldValue = [{ LifeSciConfigRecordId: "r1", LastModifiedDate: "2026-10-12T00:00:00.000+0000", LastModifiedBy: { Name: "New" } }];
    const change = { kind: "changed", category: "DbSchema", developerName: "dbSchema_Visit" } as never as Parameters<typeof attachModifiers>[0][number];
    await attachModifiers([change], "org");
    expect(change).toMatchObject({ modifiedBy: "New", modifiedAt: "2026-10-12T00:00:00.000+0000" });
  });
});
