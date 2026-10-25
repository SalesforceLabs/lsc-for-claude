import { describe, it, expect } from "vitest";
import { mergeDaily, totalsFromAggregates, dailyTrend, orgVerdict, rankUsersAtRisk, schemaRisks, territoryReason } from "../../../src/perf/overview.js";
import { summarize, type SyncSample } from "../../../src/perf/telemetry.js";
import type { DbSchemaEntry } from "../../../src/perf/sync-volume.js";

let n = 0;
function sample(over: Partial<SyncSample>): SyncSample {
  return {
    id: `s${n++}`,
    createdDate: "2026-10-01T10:00:00.000Z",
    user: "a@x.com",
    kind: "delta",
    outcome: "completed",
    failed: false,
    totalSec: 10,
    downloadSec: 5,
    uploadSec: 1,
    metadataSec: 1,
    downloadedRecords: 100,
    dbSizeGb: 1,
    network: "WiFi",
    appVersion: "266.1",
    ...over,
  };
}

const many = (count: number, over: Partial<SyncSample>) => Array.from({ length: count }, () => sample(over));

describe("rankUsersAtRisk", () => {
  const samples = [
    ...many(10, { user: "ok1@x.com" }),
    ...many(10, { user: "ok2@x.com" }),
    ...many(10, { user: "ok3@x.com" }),
    ...many(3, { user: "slow@x.com", totalSec: 45 }),
    ...many(9, { user: "flaky@x.com" }),
    sample({ user: "flaky@x.com", outcome: "failed", failed: true, totalSec: undefined }),
    sample({ user: "flaky@x.com", outcome: "failed", failed: true, totalSec: undefined }),
    sample({ user: "flaky@x.com", outcome: "failed", failed: true, totalSec: undefined }),
  ];
  const { ranked, reps, needAttention } = rankUsersAtRisk(samples, summarize(samples));

  it("lists only reps with a reason and counts everyone who synced", () => {
    expect(reps).toBe(5);
    expect(ranked.map((u) => u.username).sort()).toEqual(["flaky@x.com", "slow@x.com"]);
    expect(needAttention).toBe(2);
  });

  it("explains slow delta syncs and failures in plain language", () => {
    const slow = ranked.find((u) => u.username === "slow@x.com")!;
    expect(slow.reasons[0]).toMatch(/^Delta syncs take \d+\.\d× the org median$/);
    const flaky = ranked.find((u) => u.username === "flaky@x.com")!;
    expect(flaky.reasons).toContain("3 of 12 syncs failed");
    expect(flaky.failedSyncs).toBe(3);
  });

  it("orders by score and honours the limit", () => {
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    expect(rankUsersAtRisk(samples, summarize(samples), 1).ranked).toHaveLength(1);
  });

  it("doesn't flag a rep from a single slow sync", () => {
    const one = [...many(10, {}), sample({ user: "once@x.com", totalSec: 200 })];
    expect(rankUsersAtRisk(one, summarize(one)).ranked).toEqual([]);
  });
});

describe("dailyTrend", () => {
  it("groups by day, oldest first, with failures and p90s", () => {
    const samples = [
      sample({ createdDate: "2026-10-02T09:00:00Z", totalSec: 20 }),
      sample({ createdDate: "2026-10-01T09:00:00Z", totalSec: 10 }),
      sample({ createdDate: "2026-10-01T11:00:00Z", outcome: "failed", failed: true, totalSec: undefined }),
      sample({ createdDate: "2026-10-01T12:00:00Z", kind: "initial", totalSec: 300 }),
    ];
    const trend = dailyTrend(samples);
    expect(trend.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(trend[0]).toMatchObject({ syncs: 3, failures: 1, deltaP90: 10, initialP90: 300 });
    expect(trend[1]).toMatchObject({ syncs: 1, failures: 0, deltaP90: 20, initialP90: undefined });
  });
});

describe("orgVerdict", () => {
  it("reports no data, healthy, struggling and failing", () => {
    expect(orgVerdict(summarize([]), 0, 0).status).toBe("no-data");
    const ok = summarize(many(20, {}));
    expect(orgVerdict(ok, 10, 0).status).toBe("healthy");
    expect(orgVerdict(ok, 10, 2).status).toBe("struggling");
    const failing = summarize([...many(8, {}), ...many(2, { outcome: "failed", failed: true })]);
    expect(orgVerdict(failing, 10, 0).status).toBe("failing");
    const slowMetadata = summarize(many(20, { metadataSec: 7 }));
    expect(orgVerdict(slowMetadata, 10, 0).status).toBe("struggling");
  });
});

describe("schemaRisks", () => {
  const entry = (developerName: string, sobject: string, whereSoql: string | null): DbSchemaEntry => ({
    developerName,
    sobject,
    type: "OBJECT",
    whereSoql,
    profileIds: new Set(),
    profileNames: new Set(),
    permissionSets: new Set(),
  });

  it("flags missing filters and attachments, attachments first, with the Mobile Sync item id", () => {
    const risks = schemaRisks(
      [entry("Z_Visit", "Visit", null), entry("A_Acc", "Account", "Id != null"), entry("B_Doc", "Attachment", "Id != null")],
      new Set(["B_Doc"])
    );
    expect(risks.map((r) => [r.sobject, r.severity])).toEqual([
      ["Attachment", "warning"],
      ["Visit", "info"],
    ]);
    expect(risks[0].itemId).toBe("DbSchema:B_Doc");
  });

  it("doesn't warn about attachments on objects that are files by design", () => {
    const risks = schemaRisks(
      [
        entry("A_CV", "ContentVersion", "Id != null"),
        entry("B_CD", "ContentDocument", "Id != null"),
        entry("C_Tmpl", "LifeSciEmailTemplate", "Id != null"),
        entry("D_Acc", "Account", "Id != null"),
      ],
      new Set(["A_CV", "B_CD", "C_Tmpl", "D_Acc"])
    );
    expect(risks.map((r) => [r.sobject, r.severity])).toEqual([["Account", "warning"]]);
  });
});

describe("territoryReason", () => {
  it("mentions only many territories", () => {
    expect(territoryReason(3)).toBeUndefined();
    expect(territoryReason(14)).toBe("In 14 territories");
  });
});

describe("single failures and aggregates", () => {
  it("doesn't flood the list with a rep whose only sync failed", () => {
    const s = [...many(10, {}), sample({ user: "new@x.com", outcome: "failed", failed: true, totalSec: undefined })];
    const r = rankUsersAtRisk(s, summarize(s)).ranked.find((u) => u.username === "new@x.com");
    expect(r?.score).toBeLessThan(20);
  });

  it("totals and merges whole-window aggregates", () => {
    const aggs = [
      { day: "2026-10-01", status: "Finished", count: 90 },
      { day: "2026-10-01", status: "Failed", count: 10 },
      { day: "2026-10-02", status: "Finished", count: 50 },
    ];
    expect(totalsFromAggregates(aggs)).toMatchObject({ syncs: 150, failed: 10 });
    const merged = mergeDaily([{ day: "2026-10-02", syncs: 1, failures: 0, deltaP90: 7, initialP90: undefined }], aggs);
    expect(merged).toEqual([
      { day: "2026-10-01", syncs: 100, failures: 10, deltaP90: undefined, initialP90: undefined },
      { day: "2026-10-02", syncs: 50, failures: 0, deltaP90: 7, initialP90: undefined },
    ]);
  });

  it("names the failing metric in the headline", () => {
    const v = orgVerdict(summarize(many(20, { metadataSec: 12 })), 10, 0);
    expect(v.status).toBe("failing");
    expect(v.headline).toMatch(/App setup download time/);
  });
});
