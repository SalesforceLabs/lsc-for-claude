import { describe, it, expect } from "vitest";
import { compareVolume, differs, latestSimFor, normalizeInstance, simulatedSeconds, type SimRef } from "../../../src-renderer/components/studio/perf-compare";
import type { TableVolume, UserVolume } from "../../../src-renderer/components/studio/perf-types";
import type { SimTable } from "../../../src-renderer/components/studio/sim-types";

const vol = (sobject: string, records: number, extra: Partial<TableVolume> = {}): TableVolume => ({
  sobject,
  developerName: sobject,
  matchedBy: "profile",
  status: "counted",
  records,
  deviceRequests: 1,
  ...extra,
});
const simTable = (sobject: string, records: number, extra: Partial<SimTable> = {}): SimTable => ({
  sobject,
  developerName: sobject,
  records,
  requests: 1,
  bytes: 1,
  seconds: 1,
  ...extra,
});
const user = (tables: TableVolume[], territory = "T-01"): UserVolume => ({
  user: { id: "1", username: "rep@x.com", name: "Rep", profileId: "p", profileName: "Rep", territories: [], permissionSetCount: 0 },
  tableCount: tables.length,
  territories: [{ territory: { id: "t1", name: territory }, tables, totalRecords: 0, largestTable: null, totalDeviceRequests: 0 }],
});
const sim = (tables: SimTable[], territory?: string) => ({ user: { username: "rep@x.com", id: "1", territory }, tables });

describe("differs", () => {
  it("flags gaps over 10% and ignores gaps under 5 records", () => {
    expect(differs(100, 110)).toBe(false);
    expect(differs(100, 111)).toBe(true);
    expect(differs(100, 89)).toBe(true);
    expect(differs(3, 7)).toBe(false);
    expect(differs(0, 5)).toBe(true);
    expect(differs(0, 4)).toBe(false);
  });
});

describe("compareVolume", () => {
  it("compares per table and in total, flagging differences and tables on one side only", () => {
    const c = compareVolume(
      user([vol("Account", 1000), vol("Visit__c", 500), vol("Only_Pred__c", 50)]),
      sim([simTable("account", 1005), simTable("Visit__c", 300), simTable("Only_Sim__c", 20)], "T-01")
    )!;
    const by = Object.fromEntries(c.tables.map((t) => [t.sobject, t]));
    expect(by.Account.flag).toBe("match");
    expect(by.Visit__c).toMatchObject({ flag: "differs", predicted: 500, simulated: 300, diffPct: -40 });
    expect(by.Only_Pred__c.flag).toBe("only-predicted");
    expect(by.Only_Sim__c.flag).toBe("only-simulated");
    expect(c.predictedTotal).toBe(1550);
    expect(c.simulatedTotal).toBe(1325);
    expect(c.totalDiffers).toBe(true);
    expect(c.flagged).toBe(3);
    expect(c.tables[c.tables.length - 1].sobject).toBe("Account");
    expect(c.territoryMatched).toBe(true);
  });

  it("treats uncounted, skipped, failed and truncated tables as unreliable and the totals as partial", () => {
    const c = compareVolume(
      user([vol("A", 10, { status: "not-estimated", note: "no filter" }), vol("B", 10), vol("C", 10), vol("D", 10)]),
      sim([simTable("A", 10), simTable("B", 0, { skipped: "limit" }), simTable("C", 0, { error: "boom" }), simTable("D", 4, { truncated: "cap" })])
    )!;
    expect(c.tables.every((t) => t.flag === "unreliable")).toBe(true);
    expect(c.partial).toBe(true);
    expect(c.simulatedTotal).toBe(14);
  });

  it("uses another territory's prediction when the simulation's has none, and says so", () => {
    const c = compareVolume(user([vol("A", 100)], "T-02"), sim([simTable("A", 100)], "T-09"))!;
    expect(c.territory).toBe("T-02");
    expect(c.territoryMatched).toBe(false);
  });

  it("returns null when the prediction failed", () => {
    expect(compareVolume({ ...user([]), error: "x" }, sim([]))).toBeNull();
  });
});

describe("latestSimFor", () => {
  const ref = (id: string, org: string, username: string, startedAt: string, status: SimRef["status"] = "done"): SimRef => ({
    id,
    org,
    status,
    startedAt,
    summary: { username, flow: "legacy", records: 1, seconds: 1, failed: 0, truncated: false },
  });
  const sims = [
    ref("old", "https://a.my.salesforce.com", "Rep@x.com", "2026-01-01"),
    ref("new", "https://a.my.salesforce.com/", "rep@x.com", "2026-02-01"),
    ref("other-org", "https://b.my.salesforce.com", "rep@x.com", "2026-03-01"),
    ref("cancelled", "https://a.my.salesforce.com", "rep@x.com", "2026-04-01", "cancelled"),
    ref("other-user", "https://a.my.salesforce.com", "x@x.com", "2026-05-01"),
  ];

  it("picks the newest finished run for the username and instance URL", () => {
    expect(latestSimFor(sims, "REP@x.com", "https://A.my.salesforce.com")?.id).toBe("new");
  });
  it("matches on username alone when the org's instance URL is unknown", () => {
    expect(latestSimFor(sims, "rep@x.com", null)?.id).toBe("other-org");
  });
  it("finds nothing for an unknown user", () => {
    expect(latestSimFor(sims, "nobody@x.com", "https://a.my.salesforce.com")).toBeUndefined();
  });
});

describe("helpers", () => {
  it("normalizes instance URLs and adds up network time", () => {
    expect(normalizeInstance("https://X.my.salesforce.com/")).toBe("https://x.my.salesforce.com");
    expect(simulatedSeconds({ metadata: { bytes: 0, seconds: 4, version: "v", requests: 1 }, totals: { seconds: 90 } as never })).toBe(94);
  });
});
