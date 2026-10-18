import { describe, it, expect } from "vitest";
import { ACTIVITY_WINDOW_FILTER, attachmentsOn, explainTable, sharePct, type ExplainInput } from "../../../src/perf/table-hints.js";

const base: ExplainInput = {
  sobject: "Account",
  status: "counted",
  records: 500,
  deviceRequests: 1,
  mayOvercount: false,
  totalRecords: 10_000,
  schema: { type: "OBJECT", whereSoql: "OwnerId = '{USER.ID}'", attachmentsSupport: "", deltaDateField: "LastModifiedDate" },
};

const ids = (input: Partial<ExplainInput>) => explainTable({ ...base, ...input }).map((h) => h.id);

describe("explainTable", () => {
  it("has nothing to say about a small, filtered table", () => {
    expect(ids({})).toEqual([]);
  });

  it("reports a failing filter and stops there", () => {
    const hints = explainTable({ ...base, status: "error", note: "INVALID_FIELD", records: 0 });
    expect(hints.map((h) => [h.id, h.severity])).toEqual([["filter-failed", "error"]]);
    expect(hints[0].detail).toContain("INVALID_FIELD");
  });

  it("explains a table that couldn't be estimated", () => {
    expect(ids({ status: "not-estimated", records: 0, note: "Content filter" })).toEqual(["not-estimated"]);
  });

  it("flags a big unfiltered table with advice but no automatic change", () => {
    const hints = explainTable({ ...base, records: 20_000, totalRecords: 100_000, schema: { whereSoql: null, deltaDateField: "LastModifiedDate" } });
    expect(hints.map((h) => h.id)).toEqual(["no-filter"]);
    expect(hints[0].suggestion).toBeUndefined();
  });

  it("proposes a rolling window only for activity-like objects", () => {
    const hints = explainTable({ ...base, sobject: "Task", records: 20_000, totalRecords: 100_000, schema: { whereSoql: "", deltaDateField: "LastModifiedDate" } });
    expect(hints[0].suggestion).toMatchObject({ field: "WhereSoql", from: null, to: ACTIVITY_WINDOW_FILTER });
  });

  it("never proposes a filter on a table that already has one", () => {
    const hints = explainTable({ ...base, sobject: "Task", records: 20_000, totalRecords: 100_000 });
    expect(hints.find((h) => h.suggestion?.field === "WhereSoql")).toBeUndefined();
  });

  it("offers to turn off attachments once the table has volume", () => {
    expect(ids({ records: 200, schema: { ...base.schema, attachmentsSupport: "Background" } })).toEqual([]);
    const hints = explainTable({ ...base, records: 2_000, schema: { ...base.schema, attachmentsSupport: "Background" } });
    expect(hints[0].suggestion).toEqual({ field: "AttachmentsSupport", from: "Background", to: "", label: "Turn off attachments for Account" });
  });

  it("notes a missing delta date field but not on CONFIGURATION records", () => {
    expect(ids({ records: 2_000, schema: { ...base.schema, deltaDateField: null } })).toEqual(["no-delta-field"]);
    expect(ids({ records: 2_000, schema: { type: "CONFIGURATION", whereSoql: "x", deltaDateField: null } })).toEqual([]);
  });

  it("calls out large tables and dominant shares", () => {
    expect(ids({ records: 60_000, totalRecords: 70_000 })).toEqual(["large-table", "dominant-share"]);
    expect(ids({ records: 3_000, totalRecords: 10_000 })).toEqual(["dominant-share"]);
  });

  it("warns about overcounts and many requests", () => {
    expect(ids({ mayOvercount: true, deviceRequests: 80 })).toEqual(["may-overcount", "many-requests"]);
  });

  it("skips settings rules when no DB Schema record matched", () => {
    expect(ids({ schema: null, records: 20_000, totalRecords: 100_000 })).toEqual([]);
  });
});

describe("sharePct", () => {
  it("is zero for an empty total", () => {
    expect(sharePct(5, 0)).toBe(0);
    expect(sharePct(25, 100)).toBe(25);
  });
});

describe("attachmentsOn", () => {
  it("treats empty and none-like values as off", () => {
    for (const v of [null, undefined, "", "  ", "None", "false", "No"]) expect(attachmentsOn(v)).toBe(false);
    for (const v of ["Background", "CACHE"]) expect(attachmentsOn(v)).toBe(true);
  });
});

describe("suggestions need a value row", () => {
  it("becomes advice when the field has no row", () => {
    const hints = explainTable({
      ...base,
      sobject: "Task",
      records: 20_000,
      totalRecords: 100_000,
      schema: { whereSoql: null, deltaDateField: "LastModifiedDate", editable: ["AttachmentsSupport"] },
    });
    expect(hints[0].id).toBe("no-filter");
    expect(hints[0].suggestion).toBeUndefined();
    expect(hints[0].detail).toContain("set it in Setup");
  });
});
