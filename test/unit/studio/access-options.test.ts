import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  createRecord: vi.fn(),
  deleteRecord: vi.fn(),
}));

const { runSoqlQuery } = await import("../../../src/salesforce/cli.js");
const { accessOptions } = await import("../../../src/studio/access.js");

type Row = Record<string, unknown>;
let org: Record<string, Row[]>;
let totals: Record<string, number>;

const from = (q: string) => /FROM\s+(\w+)/i.exec(q)?.[1] ?? "";

beforeEach(() => {
  org = {};
  totals = {};
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => {
    if (/^SELECT COUNT\(\)/.test(q)) return Promise.resolve({ success: true, data: { totalSize: totals[from(q)] ?? 0, done: true, records: [] } });
    const rows = org[from(q)] ?? [];
    return Promise.resolve({ success: true, data: { totalSize: rows.length, done: true, records: rows } });
  }) as never);
});

const queries = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));

describe("accessOptions", () => {
  it("has no truncated field when every list fits", async () => {
    org.PermissionSet = [{ Id: "0PS1", Label: "A" }];
    const o = await accessOptions("org");
    expect(o.permissionSets).toHaveLength(1);
    expect(o.truncated).toBeUndefined();
  });

  it("lists the first 2,000 and reports how many match when a list is cut off", async () => {
    org.Territory2 = Array.from({ length: 2001 }, (_, i) => ({ Id: `T${i}`, Name: `Territory ${i}`, Territory2Model: { Name: "M", State: "Active" } }));
    totals.Territory2 = 5400;
    const o = await accessOptions("org");
    expect(o.territories).toHaveLength(2000);
    expect(o.truncated).toEqual({ territories: { listed: 2000, total: 5400 } });
  });

  it("filters on the server by name, escaping the term", async () => {
    await accessOptions("org", "o'brien_%");
    const asked = queries();
    expect(asked.find((q) => q.includes("FROM PermissionSet WHERE"))).toContain("Label LIKE '%o\\'brien\\_\\%%'");
    expect(asked.find((q) => q.includes("FROM PermissionSetGroup"))).toContain("MasterLabel LIKE");
    expect(asked.find((q) => q.includes("FROM Territory2"))).toContain("Name LIKE");
  });
});
