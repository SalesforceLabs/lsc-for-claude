import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
}));

const { runSoqlQuery, runToolingQuery } = await import("../../../src/salesforce/cli.js");
const { queryFieldValues, FIELD_VALUE_CHUNK_SIZE } = await import("../../../src/tools/helpers.js");
const { recentChanges } = await import("../../../src/studio/drift-recent.js");
const { invalidateSharedReads } = await import("../../../src/config/read-cache.js");

beforeEach(() => {
  vi.mocked(runSoqlQuery).mockReset();
  vi.mocked(runToolingQuery).mockReset();
  invalidateSharedReads();
});

describe("queryFieldValues", () => {
  it("splits parents into chunks that run side by side and still groups values by parent", async () => {
    const ids = Array.from({ length: FIELD_VALUE_CHUNK_SIZE * 2 + 1 }, (_, i) => `a${i}`);
    vi.mocked(runToolingQuery).mockImplementation((async (q: string) => {
      const parents = [...q.matchAll(/'(a\d+)'/g)].map((m) => m[1]);
      return {
        success: true,
        data: { totalSize: parents.length, done: true, records: parents.map((p) => ({ Id: `v${p}`, FieldName: "F", LifeSciConfigRecordId: p })) },
      };
    }) as never);
    const { fieldValuesByRecord, queryError } = await queryFieldValues(ids, "org", true);
    expect(queryError).toBeUndefined();
    expect(vi.mocked(runToolingQuery)).toHaveBeenCalledTimes(3);
    expect(fieldValuesByRecord.size).toBe(ids.length);
    const last = ids[ids.length - 2];
    expect(fieldValuesByRecord.get(last)?.[0].Id).toBe(`v${last}`);
  });
});

describe("recent flow changes from the shared flow list", () => {
  it("lists record-triggered flows changed in the window, newest first, from one read", async () => {
    const day = 86_400_000;
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString().replace("Z", "+0000");
    const flows = [
      { ApiName: "Old", Label: "Old", TriggerObjectOrEventLabel: "Visit", LastModifiedDate: at(60) },
      { ApiName: "A", Label: "Flow A", TriggerObjectOrEventLabel: "Visit", LastModifiedDate: at(5) },
      { ApiName: "B", Label: "Flow B", TriggerObjectOrEventLabel: "Account", LastModifiedDate: at(1) },
    ];
    vi.mocked(runSoqlQuery).mockImplementation((async (q: string) => ({
      success: true,
      data: { totalSize: q.includes("FlowDefinitionView") ? flows.length : 0, done: true, records: q.includes("FlowDefinitionView") ? flows : [] },
    })) as never);
    vi.mocked(runToolingQuery).mockResolvedValue({ success: true, data: { totalSize: 0, done: true, records: [] } } as never);

    const result = await recentChanges("org", 14);
    const names = result.changes.filter((c) => c.kind === "flow").map((c) => c.name);
    expect(names).toEqual(["Flow B", "Flow A"]);
    const flowQueries = vi.mocked(runSoqlQuery).mock.calls.filter(([q]) => String(q).includes("FlowDefinitionView"));
    expect(flowQueries).toHaveLength(1);
  });
});
