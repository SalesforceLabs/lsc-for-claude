import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/salesforce/cli.js", () => ({
  apiRequest: vi.fn(),
  orgApiVersion: async () => "66.0",
  dataPath: async (_org: string, rest: string) => `/services/data/v66.0${rest}`,
}));

const { apiRequest } = await import("../../../src/salesforce/cli.js");
const { runReport, clearReportCache } = await import("../../../src/studio/screens/report-data.js");

const ID = "00O000000000001AAA";
const tabular = {
  reportMetadata: { reportFormat: "TABULAR", detailColumns: ["NAME"] },
  reportExtendedMetadata: { detailColumnInfo: { NAME: { label: "Name", dataType: "string" } } },
  factMap: { "T!T": { rows: [{ dataCells: [{ label: "Acme" }] }], aggregates: [] } },
};

beforeEach(() => {
  clearReportCache();
  vi.mocked(apiRequest).mockReset();
});

describe("runReport cache", () => {
  it("reuses a run within the TTL and runs again after it", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data: tabular });
    const first = await runReport(ID, "org", 0);
    expect(first).toBeDefined();
    expect(await runReport(ID, "org", 60_000)).toEqual(first);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    await runReport(ID, "org", 7 * 60 * 60 * 1000);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("keeps orgs apart", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data: tabular });
    await runReport(ID, "a", 0);
    await runReport(ID, "b", 0);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("serves the last result when a later run fails, and doesn't cache failures", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ success: true, data: tabular });
    const first = await runReport(ID, "org", 0);
    vi.mocked(apiRequest).mockResolvedValue({ success: false, error: "FORBIDDEN: limit" });
    expect(await runReport(ID, "org", 7 * 60 * 60 * 1000)).toEqual(first);
    clearReportCache();
    expect(await runReport(ID, "org", 0)).toBeUndefined();
    expect(await runReport(ID, "org", 1)).toBeUndefined();
    expect(apiRequest).toHaveBeenCalledTimes(4);
  });

  it("shares one run between concurrent callers", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true, data: tabular });
    await Promise.all([runReport(ID, "org", 0), runReport(ID, "org", 0)]);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
