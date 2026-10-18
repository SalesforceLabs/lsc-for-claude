import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyCompactOps, compactFields, MAX_COMPACT_FIELDS, StaleCompactError } from "../../../src/studio/metadata/compact-ops.js";
import { parseXml, serializeXml } from "../../../src/studio/metadata/xml.js";
import type { CompactOp } from "../../../src/studio/types.js";

const xml = readFileSync(join(__dirname, "../../fixtures/metadata/Account_Layout.compactLayout-meta.xml"), "utf8");
const root = parseXml(xml);

/** Applying the ops then their inverse gives back the retrieved file, byte for byte. */
function roundTrip(ops: CompactOp[]) {
  const forward = applyCompactOps(root, ops);
  const back = applyCompactOps(forward.root, forward.inverse);
  expect(serializeXml(back.root)).toBe(xml);
  return forward;
}

describe("compact layout ops", () => {
  it("reads the fields in order", () => {
    expect(compactFields(root)).toEqual([
      "Name",
      "AccountNumber",
      "Type",
      "Industry",
      "SDO_Sales_Closed_Won_Value__c",
      "NumberOfEmployees",
      "SDO_Days_Since_Activity__c",
    ]);
  });

  it("moves a field earlier and to the end, and back", () => {
    const { root: r, changes } = roundTrip([
      { op: "moveCompactField", field: "Industry", before: "AccountNumber" },
      { op: "moveCompactField", field: "Name", before: null },
    ]);
    expect(compactFields(r)).toEqual([
      "Industry",
      "AccountNumber",
      "Type",
      "SDO_Sales_Closed_Won_Value__c",
      "NumberOfEmployees",
      "SDO_Days_Since_Activity__c",
      "Name",
    ]);
    expect(changes[0]).toEqual({ field: "Field Industry", before: "Position 4 of 7", after: "Position 2 of 7" });
  });

  it("removes and adds fields, keeping <label> last", () => {
    const { root: r, inverse, changes } = roundTrip([
      { op: "removeCompactField", field: "Type" },
      { op: "addCompactField", field: "Phone", before: "Industry" },
      { op: "addCompactField", field: "Website", before: null },
    ]);
    expect(compactFields(r)).toEqual([
      "Name",
      "AccountNumber",
      "Phone",
      "Industry",
      "SDO_Sales_Closed_Won_Value__c",
      "NumberOfEmployees",
      "SDO_Days_Since_Activity__c",
      "Website",
    ]);
    const out = serializeXml(r);
    expect(out).toContain("    <fields>Website</fields>\n    <label>Account</label>");
    expect(inverse[0]).toEqual({ op: "removeCompactField", field: "Website" });
    expect(inverse[2]).toEqual({ op: "addCompactField", field: "Type", before: "Industry" });
    expect(changes[0]).toEqual({ field: "Field Type", before: "Position 3 of 7", after: "(removed)" });
    expect(changes[1]).toEqual({ field: "Field Phone", before: "(not on the compact layout)", after: "Position 3 of 7" });
  });

  it("refuses fields that aren't there, are already there, or don't fit", () => {
    expect(() => applyCompactOps(root, [{ op: "removeCompactField", field: "Phone" }])).toThrow(StaleCompactError);
    expect(() => applyCompactOps(root, [{ op: "moveCompactField", field: "Type", before: "Phone" }])).toThrow(StaleCompactError);
    expect(() => applyCompactOps(root, [{ op: "addCompactField", field: "Type", before: null }])).toThrow(/already on/);
    const adds = ["A__c", "B__c", "C__c"].map((field): CompactOp => ({ op: "addCompactField", field, before: null }));
    expect(compactFields(applyCompactOps(root, adds).root)).toHaveLength(MAX_COMPACT_FIELDS);
    expect(() => applyCompactOps(root, [...adds, { op: "addCompactField", field: "D__c", before: null }])).toThrow(/at most 10/);
  });

  it("refuses names that aren't API names and ops that aren't compact edits", () => {
    expect(() => applyCompactOps(root, [{ op: "addCompactField", field: "<x>", before: null }])).toThrow(/Invalid/);
    expect(() => applyCompactOps(root, [{ op: "removeField", field: "Type" } as unknown as CompactOp])).toThrow(/Not a compact layout edit/);
  });

  it("leaves the given document alone", () => {
    applyCompactOps(root, [{ op: "removeCompactField", field: "Name" }]);
    expect(serializeXml(root)).toBe(xml);
  });
});
