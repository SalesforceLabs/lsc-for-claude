import { describe, expect, it } from "vitest";
import { lazyFromResponse } from "../../../src-renderer/components/studio/useLazyStudio.js";
import { pickReportData, reportViewState } from "../../../src-renderer/components/studio/ReportViewer.js";
import { isCacheable } from "../../../src-electron/engine/studio-cache-policy.js";
import { runReport } from "../../../src/studio/screens/report-data.js";
import * as published from "../../../src/studio/published.js";
import { loadProgress, LoadTracker } from "../../../src/studio/published-progress.js";

const data = { format: "tabular" as const, columns: ["A"], entries: [{ kind: "row" as const, cells: [{ label: "x" }] }] };
const native = { kind: "report" as const, title: "R", native: true, id: "00Oxx0000000001", children: [] };

describe("report results are read when a report opens", () => {
  it("shows a wait while the result loads, the grid when it is in, and the failure with its message", () => {
    expect(reportViewState(native, { status: "loading" })).toEqual({ kind: "loading" });
    expect(reportViewState(native, { status: "ready", data })).toEqual({ kind: "table", data });
    expect(reportViewState(native, { status: "ready", data: { ...data, entries: [] } })).toEqual({ kind: "empty" });
    expect(reportViewState(native, { status: "error", message: "boom" })).toEqual({ kind: "error", message: "boom" });
  });
  it("opens web-format reports and the id-less Sales Chart without running anything", () => {
    expect(reportViewState({ ...native, native: false })).toEqual({ kind: "web" });
    expect(reportViewState({ ...native, id: undefined })).toEqual({ kind: "unavailable" });
    expect(reportViewState(native)).toEqual({ kind: "unavailable" });
  });
  it("treats a report the org could not run as an error the rep can retry", () => {
    const failed = lazyFromResponse({ data: { id: native.id, data: null } }, pickReportData);
    expect(failed.status).toBe("error");
    expect(lazyFromResponse({ data: { id: native.id, data } }, pickReportData)).toEqual({ status: "ready", data });
  });
  it("turns IPC and tool errors into the error state", () => {
    expect(lazyFromResponse({ error: "Engine not started" }, (d) => d)).toEqual({ status: "error", message: "Engine not started" });
    expect(lazyFromResponse({ data: { error: "No Salesforce org connected." } }, (d) => d)).toEqual({ status: "error", message: "No Salesforce org connected." });
    expect(lazyFromResponse(null, (d) => d).status).toBe("error");
  });
});

describe("the preview load no longer reads reports", () => {
  it("has no report step and no report runner exported", () => {
    const track = new LoadTracker("Lazy Reports Profile");
    track.plan(["lists", "screens", "records"]);
    expect(loadProgress("Lazy Reports Profile")?.steps.map((s) => s.key)).not.toContain("reports");
    expect((published as Record<string, unknown>).attachReportData).toBeUndefined();
    expect(typeof published.loadIpadReports).toBe("function");
  });
  it("refuses to read the Reports tab without a user and to run a malformed report id", async () => {
    await expect(published.loadIpadReports("nope", "no-such-org")).rejects.toThrow(/user Id/);
    expect(await runReport("not-a-report", "no-such-org")).toBeUndefined();
  });
});

describe("studio cache policy for the report tree", () => {
  it("keeps a complete tree and drops one cut at the row cap", () => {
    expect(isCacheable("studio_ipad_reports", { settings: { reports: { salesChart: false, salesforceReports: true } }, reports: [] })).toBe(true);
    expect(isCacheable("studio_ipad_reports", { settings: {}, reports: [], dataNotes: ["Reports tab: read the first 10,000 of 12,000 reports by name; the rest aren't shown."] })).toBe(false);
  });
});
