import { describe, it, expect, vi, beforeEach } from "vitest";

const directQuery = vi.fn();

vi.mock("../../../src/salesforce/direct.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/salesforce/direct.js")>();
  return { ...actual, directQuery: (...args: unknown[]) => directQuery(...args), directEnabled: () => true };
});

const { runSoqlQuery, runToolingQuery } = await import("../../../src/salesforce/cli.js");
const { withSharedReads, invalidateSharedReads, refreshSharedReads } = await import("../../../src/config/read-cache.js");

const rows = (n: number) => ({ ok: true, data: { totalSize: n, done: true, records: Array.from({ length: n }, (_, i) => ({ Id: `00${i}` })) } });

beforeEach(() => {
  directQuery.mockReset();
  invalidateSharedReads();
});

describe("shared reads scope", () => {
  it("does not share anything outside a scope", async () => {
    directQuery.mockResolvedValue(rows(1));
    await runSoqlQuery("SELECT Id FROM Account", "o1");
    await runSoqlQuery("SELECT Id FROM Account", "o1");
    expect(directQuery).toHaveBeenCalledTimes(2);
  });

  it("shares identical queries inside a scope, concurrent or later", async () => {
    directQuery.mockResolvedValue(rows(2));
    const [a, b] = await withSharedReads(() =>
      Promise.all([runSoqlQuery("SELECT Id FROM Account", "o1"), runSoqlQuery("SELECT Id FROM Account", "o1")])
    );
    const c = await withSharedReads(() => runSoqlQuery("SELECT Id FROM Account", "o1"));
    expect(directQuery).toHaveBeenCalledTimes(1);
    expect(a.data?.records).toHaveLength(2);
    expect(c.data?.records).toEqual(a.data?.records);
    // Each caller gets its own copy, so one cannot change what another sees.
    (a.data!.records[0] as Record<string, unknown>).Id = "changed";
    expect((b.data!.records[0] as Record<string, unknown>).Id).toBe("000");
  });

  it("keeps different orgs, APIs and query texts apart", async () => {
    directQuery.mockResolvedValue(rows(1));
    await withSharedReads(async () => {
      await runSoqlQuery("SELECT Id FROM Account", "o1");
      await runSoqlQuery("SELECT Id FROM Account", "o2");
      await runToolingQuery("SELECT Id FROM Account", "o1");
      await runSoqlQuery("SELECT Id FROM Contact", "o1");
    });
    expect(directQuery).toHaveBeenCalledTimes(4);
  });

  it("never keeps a failure or a result cut short", async () => {
    directQuery.mockResolvedValueOnce({ ok: false, error: "boom" }).mockResolvedValue(rows(1));
    const first = await withSharedReads(() => runSoqlQuery("SELECT Id FROM Account", "o1"));
    expect(first.success).toBe(false);
    expect(first.error).toBe("boom");
    const second = await withSharedReads(() => runSoqlQuery("SELECT Id FROM Account", "o1"));
    expect(second.success).toBe(true);

    directQuery.mockReset();
    directQuery.mockResolvedValue({ ok: true, data: { totalSize: 9, done: true, records: [{ Id: "1" }], truncated: true } });
    const cut = await withSharedReads(() => runSoqlQuery("SELECT Id FROM Contact", "o1"));
    expect(cut.data?.truncated).toBe(true);
    await withSharedReads(() => runSoqlQuery("SELECT Id FROM Contact", "o1"));
    expect(directQuery).toHaveBeenCalledTimes(2);
  });

  it("reads again after the org is invalidated, and on a refresh", async () => {
    directQuery.mockResolvedValue(rows(1));
    await withSharedReads(() => runSoqlQuery("SELECT Id FROM Account", "o1"));
    invalidateSharedReads("o1");
    await withSharedReads(() => runSoqlQuery("SELECT Id FROM Account", "o1"));
    expect(directQuery).toHaveBeenCalledTimes(2);

    refreshSharedReads("o1", 0);
    await withSharedReads(() => runSoqlQuery("SELECT Id FROM Account", "o1"));
    expect(directQuery).toHaveBeenCalledTimes(3);
  });

  it("a refresh right after another refresh keeps what that one read", async () => {
    directQuery.mockResolvedValue(rows(1));
    refreshSharedReads("o3");
    await withSharedReads(() => runSoqlQuery("SELECT Id FROM Account", "o3"));
    refreshSharedReads("o3");
    await withSharedReads(() => runSoqlQuery("SELECT Id FROM Account", "o3"));
    expect(directQuery).toHaveBeenCalledTimes(1);
  });
});
