import { describe, it, expect } from "vitest";
import type { ConfigRecord } from "../../../src/config/types.js";
import { findDuplicates } from "../../../src/studio/collectors/mobile-sync.js";
import { sampleFilter, toRow } from "../../../src/studio/object-sync.js";
import type { PendingChange } from "../../../src-renderer/components/studio/changes";
import type { ObjectSyncRow } from "../../../src-renderer/components/studio/object-sync-types";
import {
  activeChanges,
  deleteChanges,
  dropCreates,
  dropDelete,
  duplicateDraft,
  fieldChange,
  filterRows,
  NO_FILTERS,
  profileChanges,
  statusPill,
  typeCounts,
  viewRows,
} from "../../../src-renderer/components/studio/object-sync-logic";

function record(developerName: string, over: Partial<ConfigRecord> = {}, fields: Record<string, unknown> = {}): ConfigRecord {
  return {
    category: "DbSchema",
    developerName,
    label: developerName.replace(/^DbSchema_/, ""),
    isActive: true,
    isOrgLevel: false,
    fields: { SObject: developerName.replace(/^DbSchema_/, ""), Type: "DATA", WhereSoql: "", OneWaySync: false, ...fields },
    fieldTypes: { SObject: "OBJECT", Type: "PICKLIST", WhereSoql: "LONGTEXT", OneWaySync: "BOOLEAN" },
    assignments: [{ level: "Profile", name: "Field Sales" }],
    ...over,
  } as ConfigRecord;
}

const rowsOf = (records: ConfigRecord[]): ObjectSyncRow[] => {
  const dupes = findDuplicates(records);
  return records.map((r) => toRow(r, dupes)) as unknown as ObjectSyncRow[];
};

describe("object sync rows", () => {
  it("flags missing objects, unassigned active records, duplicates and invalid status", () => {
    const rows = rowsOf([
      record("DbSchema_Account", {}, { Status: "INVALID" }),
      record("DbSchema_Account2", {}, { SObject: "Account" }),
      record("DbSchema_Nothing", {}, { SObject: "" }),
      record("DbSchema_Orphan", { assignments: [] }),
      record("DbSchema_Config", { isOrgLevel: true, assignments: [] }, { Type: "CONFIGURATION", SObject: "" }),
    ]);
    const titles = (dev: string) => rows.find((r) => r.developerName === dev)!.findings.map((f) => f.title);
    expect(titles("DbSchema_Account")).toEqual(expect.arrayContaining(["Marked invalid", "Duplicate for Field Sales"]));
    expect(titles("DbSchema_Account2")).toEqual(["Duplicate for Field Sales"]);
    expect(titles("DbSchema_Nothing")).toContain("No object");
    expect(titles("DbSchema_Orphan")).toEqual(["Not assigned to anyone"]);
    expect(titles("DbSchema_Config")).toEqual([]);
  });
});

describe("sampleFilter", () => {
  it("fills user and territory tags raw and id lists with a sample id", () => {
    const { soql, tags } = sampleFilter("OwnerId = '{USER.ID}' AND AccountId IN ('{ACCOUNT.IDS}')\nAND Territory2Id IN ({OT2A.OBJ.IDS})");
    expect(soql).toBe("OwnerId = '005000000000000AAA' AND AccountId IN ('000000000000000AAA') AND Territory2Id IN ('000000000000000AAA')");
    expect(tags).toEqual(["{USER.ID}", "{ACCOUNT.IDS}", "{OT2A.OBJ.IDS}"]);
  });

  it("leaves a filter missing its quotes broken, as the app would send it", () => {
    expect(sampleFilter("OwnerId = {USER.ID}").soql).toBe("OwnerId = 005000000000000AAA");
  });
});

describe("object sync page logic", () => {
  const rows = rowsOf([
    record("DbSchema_Account", {}, { WhereSoql: "IsPersonAccount = true" }),
    record("DbSchema_Call", { isActive: false }),
    record("DbSchema_Settings", { isOrgLevel: true, assignments: [] }, { Type: "CONFIGURATION", SObject: "" }),
  ]);

  it("lays the tray over the records and appends queued creates", () => {
    const pending: PendingChange[] = [
      ...activeChanges(viewRows(rows, []), false),
      fieldChange(rows[0], "WhereSoql", "OwnerId = '{USER.ID}'")!,
      {
        fix: {
          kind: "createConfigRecord",
          label: "New",
          category: "DbSchema",
          developerName: "DbSchema_Visit",
          recordLabel: "Visit",
          fields: [{ name: "SObject", value: "Visit" }],
          profiles: ["Field Sales"],
          active: true,
        },
      },
    ];
    const view = viewRows(rows, pending);
    expect(view.map((v) => [v.row.developerName, v.active])).toEqual([
      ["DbSchema_Account", false],
      ["DbSchema_Call", false],
      ["DbSchema_Settings", false],
      ["DbSchema_Visit", true],
    ]);
    expect(view[0].whereSoql).toBe("OwnerId = '{USER.ID}'");
    expect(view[0].queued).toBe(2);
    expect(view[3].created?.developerName).toBe("DbSchema_Visit");
    // Taking the create out of the tray drops its row.
    expect(viewRows(rows, dropCreates(pending, [view[3]]))).toHaveLength(3);
  });

  it("only edits fields the record has a value for, and only queues real active changes", () => {
    expect(fieldChange(rows[0], "DeltaDateField", "LastModifiedDate")).toBeNull();
    const view = viewRows(rows, []);
    expect(activeChanges(view, true).map((c) => c.fix.label)).toEqual(["Activate Call"]);
  });

  it("adds and removes profiles, skipping org-level records and records already that way", () => {
    const view = viewRows(rows, []);
    const added = profileChanges(view, "add", ["Medical"]);
    expect(added.skipped).toBe(1);
    expect(added.changes.map((c) => c.fix.kind === "setProfileAssignments" && c.fix.to)).toEqual([
      ["Field Sales", "Medical"],
      ["Field Sales", "Medical"],
    ]);
    expect(profileChanges(view, "remove", ["Medical"]).changes).toEqual([]);
    expect(profileChanges(view, "add", ["field sales"]).changes).toEqual([]);
  });

  it("queues deletes that can be taken back", () => {
    const pending = deleteChanges(viewRows(rows, []).slice(0, 1));
    expect(viewRows(rows, pending)[0].deleting).toBe(true);
    expect(deleteChanges(viewRows(rows, pending).slice(0, 1))).toEqual([]);
    expect(viewRows(rows, dropDelete(pending, "DbSchema_Account"))[0].deleting).toBe(false);
  });

  it("filters by search, type, profile and problems", () => {
    const view = viewRows(rows, []);
    const names = (f: Partial<typeof NO_FILTERS>) => filterRows(view, { ...NO_FILTERS, ...f }, new Map()).map((v) => v.row.developerName);
    expect(names({ search: "personaccount" })).toEqual(["DbSchema_Account"]);
    expect(names({ type: "CONFIGURATION" })).toEqual(["DbSchema_Settings"]);
    expect(names({ profile: "Medical" })).toEqual(["DbSchema_Settings"]);
    expect(typeCounts(view)).toEqual({ all: 3, DATA: 2, CONFIGURATION: 1 });
    const checks = new Map([["DbSchema_Call", { developerName: "DbSchema_Call", state: "fail" as const, parts: [], checkedAt: "" }]]);
    expect(filterRows(view, { ...NO_FILTERS, problemsOnly: true }, checks).map((v) => v.row.developerName)).toEqual(["DbSchema_Call"]);
  });

  it("names a duplicate after its source and words the Admin Console status", () => {
    const draft = duplicateDraft(rows[0]);
    expect(draft.developerName).toBe("DbSchema_Account_Copy");
    expect(draft.copyFrom).toBe("DbSchema_Account");
    expect(statusPill("VALID")).toEqual({ tone: "pass", text: "Valid" });
    expect(statusPill(null).text).toBe("Not validated");
  });
});
