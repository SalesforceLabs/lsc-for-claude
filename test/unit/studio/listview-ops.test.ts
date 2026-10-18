import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseXml, serializeXml } from "../../../src/studio/metadata/xml.js";
import {
  applyListViewOp,
  applyListViewOps,
  listBooleanFilter,
  listColumns,
  listFilters,
  listFilterScope,
  MAX_LIST_COLUMNS,
  StaleListViewError,
  validBooleanFilter,
} from "../../../src/studio/metadata/listview-ops.js";
import { isManagedListView, liveListViewOf } from "../../../src/studio/metadata/live.js";
import type { ListViewOp } from "../../../src/studio/types.js";

const load = (name: string) => fs.readFileSync(path.join(__dirname, `../../fixtures/metadata/${name}.listView-meta.xml`), "utf-8").trimEnd() + "\n";
const visits = load("Visit.My_Next_Visits");
const shared = load("Account.Shared_Reps");
const mine = load("Account.MyAccounts");
const root = (xml: string) => parseXml(xml);

describe("list view xml", () => {
  it("round-trips the fixtures byte for byte", () => {
    for (const xml of [visits, shared, mine, load("Account.HCP_Accounts")]) expect(serializeXml(parseXml(xml))).toBe(xml);
  });

  it("reads columns, filters, scope and logic", () => {
    const r = root(shared);
    expect(listColumns(r)).toEqual(["Name", "Phone", "Industry"]);
    expect(listFilters(r)).toHaveLength(3);
    expect(listFilterScope(r)).toBe("Everything");
    expect(listBooleanFilter(r)).toBe("1 AND (2 OR 3)");
    expect(listColumns(root(mine))).toEqual([]);
    expect(listFilterScope(root(mine))).toBe("Mine");
  });

  it("reads who the view is shared with, and all users when it isn't", () => {
    expect(liveListViewOf("Account.Shared_Reps", root(shared)).sharedTo).toEqual([
      { kind: "group", name: "Field_Reps" },
      { kind: "role", name: "East_Reps" },
    ]);
    expect(liveListViewOf("Visit.My_Next_Visits", root(visits)).sharedTo).toBeNull();
  });

  it("knows a namespaced view is managed", () => {
    expect(isManagedListView("FSL__X__c.FSL__All")).toBe(true);
    expect(isManagedListView("Account.AllAccounts")).toBe(false);
    expect(isManagedListView("Visit.My_Next_Visits")).toBe(false);
  });
});

describe("column ops", () => {
  it("moves a column before another and the inverse puts it back", () => {
    const r = root(visits);
    const { inverse, change } = applyListViewOp(r, { op: "moveListColumn", column: "Status", before: "Account" });
    expect(listColumns(r)).toEqual(["Name", "Status", "Account", "PlannedVisitStartTime", "Owner"]);
    expect(change).toEqual({ field: "Column Status", before: "Position 4 of 5", after: "Position 2 of 5" });
    applyListViewOp(r, inverse);
    expect(serializeXml(r)).toBe(visits);
  });

  it("moves a column to the end with before = null", () => {
    const r = root(visits);
    applyListViewOp(r, { op: "moveListColumn", column: "Name", before: null });
    expect(listColumns(r)).toEqual(["Account", "PlannedVisitStartTime", "Status", "Owner", "Name"]);
  });

  it("removes a column and adds it back where it was", () => {
    const r = root(visits);
    const { inverse } = applyListViewOp(r, { op: "removeListColumn", column: "Account" });
    expect(listColumns(r)).toEqual(["Name", "PlannedVisitStartTime", "Status", "Owner"]);
    applyListViewOp(r, inverse);
    expect(serializeXml(r)).toBe(visits);
  });

  it("adds a column at the end, and refuses duplicates", () => {
    const r = root(visits);
    const { inverse } = applyListViewOp(r, { op: "addListColumn", column: "IsFutureVisit__c", before: null });
    expect(listColumns(r).at(-1)).toBe("IsFutureVisit__c");
    expect(() => applyListViewOp(r, { op: "addListColumn", column: "Name", before: null })).toThrow(StaleListViewError);
    applyListViewOp(r, inverse);
    expect(serializeXml(r)).toBe(visits);
  });

  it("adds a column to a view that has none, in schema order", () => {
    const r = root(mine);
    applyListViewOp(r, { op: "addListColumn", column: "Name", before: null });
    expect(serializeXml(r).indexOf("<columns>")).toBeLessThan(serializeXml(r).indexOf("<filterScope>"));
  });

  it("refuses to take the last column or go past the limit", () => {
    const one = root(`<?xml version="1.0" encoding="UTF-8"?>\n<ListView xmlns="x">\n    <columns>Name</columns>\n    <label>L</label>\n</ListView>\n`);
    expect(() => applyListViewOp(one, { op: "removeListColumn", column: "Name" })).toThrow(/at least one/);
    const full = root(visits);
    for (let i = 0; i < MAX_LIST_COLUMNS; i++) {
      try {
        applyListViewOp(full, { op: "addListColumn", column: `F${i}__c`, before: null });
      } catch (e) {
        expect(e).toBeInstanceOf(StaleListViewError);
      }
    }
    expect(listColumns(full)).toHaveLength(MAX_LIST_COLUMNS);
  });

  it("throws stale when the column isn't there", () => {
    expect(() => applyListViewOp(root(visits), { op: "removeListColumn", column: "Nope" })).toThrow(StaleListViewError);
    expect(() => applyListViewOp(root(visits), { op: "moveListColumn", column: "Name", before: "Nope" })).toThrow(StaleListViewError);
  });

  it("rejects names that aren't field ids", () => {
    expect(() => applyListViewOp(root(visits), { op: "addListColumn", column: "a</columns><x>", before: null })).toThrow(/Invalid/);
  });

  it("applies ops in order to a copy and returns the combined inverse", () => {
    const original = root(visits);
    const ops: ListViewOp[] = [
      { op: "removeListColumn", column: "Owner" },
      { op: "moveListColumn", column: "Status", before: "Name" },
      { op: "addListColumn", column: "Phone", before: "Account" },
    ];
    const r = applyListViewOps(original, ops);
    expect(serializeXml(original)).toBe(visits);
    expect(listColumns(r.root)).toEqual(["Status", "Name", "Phone", "Account", "PlannedVisitStartTime"]);
    expect(r.changes).toHaveLength(3);
    expect(serializeXml(applyListViewOps(r.root, r.inverse).root)).toBe(visits);
  });
});

describe("filter scope", () => {
  it("sets the scope and checks what it replaces", () => {
    const r = root(visits);
    const { inverse } = applyListViewOp(r, { op: "setListFilterScope", from: "Mine", to: "Everything" });
    expect(listFilterScope(r)).toBe("Everything");
    expect(() => applyListViewOp(r, { op: "setListFilterScope", from: "Mine", to: "Everything" })).toThrow(StaleListViewError);
    applyListViewOp(r, inverse);
    expect(serializeXml(r)).toBe(visits);
  });

  it("refuses a scope the API doesn't have", () => {
    expect(() => applyListViewOp(root(visits), { op: "setListFilterScope", from: "Mine", to: "Everyone" })).toThrow(/Invalid filter scope/);
  });
});

describe("filters", () => {
  const first = { field: "Status", operation: "equals", value: "0" };
  const second = { field: "IsFutureVisit__c", operation: "equals", value: "1" };

  it("changes one filter's value and keeps the other node as it was", () => {
    const r = root(visits);
    const { inverse, change } = applyListViewOp(r, {
      op: "setListFilters",
      from: [first, second],
      to: [first, { ...second, value: "0" }],
      fromLogic: null,
      toLogic: null,
    });
    expect(serializeXml(r)).toContain("<value>0</value>\n    </filters>\n    <label>");
    expect(change.field).toBe("Filters");
    applyListViewOp(r, inverse);
    expect(serializeXml(r)).toBe(visits);
  });

  it("adds a filter, with logic, in schema order, and removes it with the inverse", () => {
    const r = root(visits);
    const added = { field: "Owner", operation: "notEqual", value: "" };
    const { inverse } = applyListViewOp(r, {
      op: "setListFilters",
      from: [first, second],
      to: [first, second, added],
      fromLogic: null,
      toLogic: "1 AND (2 OR 3)",
    });
    const xml = serializeXml(r);
    expect(listFilters(r)).toHaveLength(3);
    expect(xml.indexOf("<booleanFilter>")).toBeLessThan(xml.indexOf("<columns>"));
    expect(xml).toContain("<field>Owner</field>\n        <operation>notEqual</operation>\n    </filters>");
    applyListViewOp(r, inverse);
    expect(serializeXml(r)).toBe(visits);
  });

  it("clears every filter and the logic", () => {
    const r = root(shared);
    const from = listFilters(r);
    applyListViewOp(r, { op: "setListFilters", from, to: [], fromLogic: "1 AND (2 OR 3)", toLogic: null });
    expect(listFilters(r)).toEqual([]);
    expect(listBooleanFilter(r)).toBeNull();
  });

  it("adds the first filter to a view without any", () => {
    const r = root(mine);
    applyListViewOp(r, { op: "setListFilters", from: [], to: [first], fromLogic: null, toLogic: null });
    const xml = serializeXml(r);
    expect(xml.indexOf("<filterScope>")).toBeLessThan(xml.indexOf("<filters>"));
    expect(xml.indexOf("<filters>")).toBeLessThan(xml.indexOf("<label>"));
  });

  it("throws stale when the filters or the logic changed since", () => {
    expect(() => applyListViewOp(root(visits), { op: "setListFilters", from: [first], to: [], fromLogic: null, toLogic: null })).toThrow(StaleListViewError);
    expect(() => applyListViewOp(root(shared), { op: "setListFilters", from: listFilters(root(shared)), to: [], fromLogic: null, toLogic: null })).toThrow(
      StaleListViewError
    );
  });

  it("refuses an unknown operation, a bad field and logic that doesn't match the rows", () => {
    const base = { op: "setListFilters" as const, from: [first, second], fromLogic: null };
    expect(() => applyListViewOp(root(visits), { ...base, to: [{ ...first, operation: "like" }, second], toLogic: null })).toThrow(/operation/);
    expect(() => applyListViewOp(root(visits), { ...base, to: [{ ...first, field: "x y" }, second], toLogic: null })).toThrow(/Invalid/);
    expect(() => applyListViewOp(root(visits), { ...base, to: [first, second], toLogic: "1 AND 3" })).toThrow(/logic/);
  });

  it("escapes values", () => {
    const r = root(visits);
    applyListViewOp(r, { op: "setListFilters", from: [first, second], to: [{ ...first, value: "A & B <x>" }, second], fromLogic: null, toLogic: null });
    expect(serializeXml(r)).toContain("<value>A &amp; B &lt;x&gt;</value>");
    expect(listFilters(r)[0].value).toBe("A & B <x>");
  });
});

describe("validBooleanFilter", () => {
  it("accepts logic that uses each row once", () => {
    expect(validBooleanFilter("1 AND (2 OR 3)", 3)).toBe(true);
    expect(validBooleanFilter("1 AND NOT 2", 2)).toBe(true);
  });
  it("rejects missing rows, strangers, and unbalanced parentheses", () => {
    expect(validBooleanFilter("1 AND 2", 3)).toBe(false);
    expect(validBooleanFilter("1 AND 4", 2)).toBe(false);
    expect(validBooleanFilter("1 XOR 2", 2)).toBe(false);
    expect(validBooleanFilter("(1 AND 2", 2)).toBe(false);
    expect(validBooleanFilter("1) AND (2", 2)).toBe(false);
  });
});
