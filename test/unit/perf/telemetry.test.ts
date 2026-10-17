import { describe, it, expect } from "vitest";
import { buildTelemetryQuery, percentile, summarize, toSyncSample } from "../../../src/perf/telemetry.js";

const base = {
  Id: "0X1",
  CreatedDate: "2026-10-01T10:00:00.000+0000",
  CreatedBy: { Username: "rep@example.com" },
  Type: "data",
  CompletionStatus: "Finished",
  Network: "WiFi",
  AppVersion: "266.1",
};

describe("toSyncSample", () => {
  it("computes total, phase durations, freeze-time exclusion and DB size", () => {
    const s = toSyncSample({
      ...base,
      SyncTrigger: "Initial",
      UploadStart: "2026-10-01T10:00:00.000Z",
      UploadEnd: "2026-10-01T10:00:10.000Z",
      DownloadStart: "2026-10-01T10:00:20.000Z",
      DownloadEnd: "2026-10-01T10:02:20.000Z",
      DownloadFreezeTime: 20000,
      SyncEndDate: "2026-10-01T10:02:30.000Z",
      MetadataDownloadDuration: 3500,
      DownloadedRecords: 1234,
      SyncSummaryData: JSON.stringify({ DBSize: "1.25" }),
    });
    expect(s).toMatchObject({
      kind: "initial",
      failed: false,
      totalSec: 130, // 150s wall clock - 20s frozen
      downloadSec: 100,
      uploadSec: 10,
      metadataSec: 3.5,
      downloadedRecords: 1234,
      dbSizeGb: 1.25,
      user: "rep@example.com",
    });
  });

  it("skips CLM rows and flags failures by status or error code", () => {
    expect(toSyncSample({ ...base, Type: "clm" })).toBeNull();
    expect(toSyncSample({ ...base, CompletionStatus: "Failed" })?.failed).toBe(true);
    expect(toSyncSample({ ...base, ErrorCode: "E42" })?.failed).toBe(true);
    expect(toSyncSample({ ...base, SyncTrigger: "Manual" })?.kind).toBe("delta");
  });

  it("tolerates missing and malformed fields", () => {
    const s = toSyncSample({ ...base, SyncSummaryData: "{not json" });
    expect(s).toMatchObject({ totalSec: undefined, downloadSec: undefined, dbSizeGb: undefined });
  });
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    const v = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(10);
    expect(percentile(v, 95)).toBe(19);
    expect(percentile(v, 100)).toBe(20);
    expect(percentile([], 95)).toBeUndefined();
  });
});

describe("summarize", () => {
  it("excludes failed syncs from duration stats but counts them in the failure rate", () => {
    const mk = (id: string, totalSec: number, failed = false) => ({
      id,
      createdDate: "",
      user: "u",
      kind: "delta" as const,
      failed,
      totalSec,
      downloadSec: undefined,
      uploadSec: undefined,
      metadataSec: undefined,
      downloadedRecords: undefined,
      dbSizeGb: undefined,
      network: "WiFi",
      appVersion: "1",
    });
    const summary = summarize([mk("a", 10), mk("b", 20), mk("c", 30), mk("d", 999, true)]);
    expect(summary.failureRatePct).toBe(25);
    expect(summary.delta.total).toMatchObject({ n: 3, max: 30 });
    expect(summary.slowest.map((s) => s.id)).toEqual(["c", "b", "a"]);
    expect(summary.byAppVersion[0]).toMatchObject({ key: "1", n: 4, failureRatePct: 25 });
  });
});

describe("buildTelemetryQuery", () => {
  it("selects only fields the org exposes and escapes filters", () => {
    const q = buildTelemetryQuery(new Set(["Id", "createddate", "SyncTrigger"]), {
      days: 14,
      usernames: ["o'brien@example.com"],
      profileName: "Field Sales",
    });
    expect(q).toBe(
      "SELECT Id, CreatedDate, SyncTrigger, CreatedBy.Username FROM DeviceSyncSummary WHERE CreatedDate = LAST_N_DAYS:14 AND CreatedBy.Username IN ('o\\'brien@example.com') AND CreatedBy.Profile.Name = 'Field Sales' ORDER BY CreatedDate DESC LIMIT 10000"
    );
  });
});
