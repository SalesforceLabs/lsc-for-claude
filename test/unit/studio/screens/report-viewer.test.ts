import { describe, expect, it } from "vitest";
import { buildReportData } from "../../../../src/studio/screens/report-data.js";

const summary = {
  reportMetadata: {
    reportFormat: "SUMMARY",
    hasDetailRows: true,
    showGrandTotal: true,
    detailColumns: ["OPPORTUNITY_NAME", "AMOUNT"],
    aggregates: ["s!AMOUNT", "a!PROBABILITY", "RowCount"],
    groupingsDown: [{ name: "STAGE_NAME" }],
  },
  reportExtendedMetadata: {
    detailColumnInfo: { OPPORTUNITY_NAME: { label: "Opportunity Name", dataType: "string" }, AMOUNT: { label: "Amount", dataType: "currency" } },
    groupingColumnInfo: { STAGE_NAME: { label: "Stage", dataType: "picklist", groupingLevel: 0 } },
    aggregateColumnInfo: { "s!AMOUNT": { label: "Sum of Amount", dataType: "currency" }, "a!PROBABILITY": { label: "Avg Probability", dataType: "percent" }, RowCount: { label: "Record Count", dataType: "int" } },
  },
  groupingsDown: { groupings: [{ key: "0", label: "Closed Won", groupings: [] }] },
  factMap: {
    "0!T": { aggregates: [{ label: "USD 40,000.00", value: 40000 }, { label: "100%", value: 100 }, { label: "1", value: 1 }], rows: [{ dataCells: [{ label: "Omega", value: "006x" }, { label: "USD 40,000.00", value: 40000 }] }] },
    "T!T": { aggregates: [{ label: "USD 40,000.00", value: 40000 }, { label: "100%", value: 100 }, { label: "1", value: 1 }] },
  },
};

describe("report viewer model", () => {
  it("builds a summary grid with the subtotal above its rows and a grand total", () => {
    const data = buildReportData(summary);
    expect(data?.format).toBe("summary");
    expect(data?.columns).toEqual(["Opportunity Name", "Amount", "Avg Probability"]);
    expect(data?.groupHeader).toBe("Stage");
    expect(data?.entries).toEqual([
      { kind: "subtotal", level: 0, title: "Stage: Closed Won", cells: ["", "USD 40,000.00", "100%"] },
      { kind: "row", cells: [{ label: "Omega" }, { label: "USD 40,000.00" }, { label: "" }] },
    ]);
    expect(data?.grandTotal).toEqual({ label: "Grand Total: 1", cells: ["", "USD 40,000.00", "100%"] });
  });
  it("marks lookup cells with a value as links and booleans as checks", () => {
    const tabular = {
      reportMetadata: { reportFormat: "TABULAR", detailColumns: ["ACCOUNT", "ACTIVE"] },
      reportExtendedMetadata: { detailColumnInfo: { ACCOUNT: { label: "Account", dataType: "string", isLookup: true }, ACTIVE: { label: "Active", dataType: "boolean" } } },
      factMap: { "T!T": { rows: [{ dataCells: [{ label: "Acme", value: "001x" }, { label: "Yes", value: true }] }, { dataCells: [{ label: "-", value: null }, { label: "No", value: false }] }] } },
    };
    const data = buildReportData(tabular);
    expect(data?.entries).toEqual([
      { kind: "row", cells: [{ label: "Acme", link: true }, { label: "Yes", bool: true }] },
      { kind: "row", cells: [{ label: "-" }, { label: "No", bool: false }] },
    ]);
  });
  it("has no rows for an empty report and nothing for formats the app opens on the web", () => {
    expect(buildReportData({ reportMetadata: { reportFormat: "TABULAR", detailColumns: [] }, factMap: { "T!T": { rows: [] } } })?.entries).toEqual([]);
    expect(buildReportData({ reportMetadata: { reportFormat: "MATRIX" } })).toBeUndefined();
  });
  it("caps rows", () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ dataCells: [{ label: String(i), value: null }] }));
    const data = buildReportData({ reportMetadata: { reportFormat: "TABULAR", detailColumns: ["A"] }, reportExtendedMetadata: { detailColumnInfo: { A: { label: "A", dataType: "string" } } }, factMap: { "T!T": { rows } } });
    expect(data?.entries.length).toBe(150);
    expect(data?.truncated).toBe(true);
  });
});
