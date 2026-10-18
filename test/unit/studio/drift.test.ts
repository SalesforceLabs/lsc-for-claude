import { describe, expect, it, vi } from "vitest";
import type { ConfigRecord, ConfigSnapshot } from "../../../src/config/types.js";
import type { SnapshotMeta } from "../../../src/studio/drift-types.js";

vi.mock("../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));

const { diffSnapshots, featureForRecord } = await import("../../../src/studio/drift-diff.js");

const meta: SnapshotMeta = {
  id: "2026-01-01T00-00-00-000Z",
  label: "baseline",
  org: "o",
  createdAt: "2026-01-01T00:00:00.000Z",
  counts: { triggerHandlers: 0, adminSettings: 0, dbSchema: 0, actions: 0 },
};

const rec = (over: Partial<ConfigRecord>): ConfigRecord => ({
  category: "DbSchema",
  developerName: "DbSchema_Visit",
  isActive: true,
  fields: { SObject: "Visit", WhereSoql: "A = 1" },
  fieldTypes: {},
  assignments: [],
  ...over,
});
const snap = (over: Partial<ConfigSnapshot>): ConfigSnapshot => ({ exportedAt: "", sourceOrg: "o", version: "1.1", ...over });

describe("diffSnapshots", () => {
  it("reports nothing for identical snapshots", () => {
    const s = snap({ dbSchema: [rec({})], triggerHandlers: [{ developerName: "VisitTH", isActive: true }] });
    expect(diffSnapshots(s, s, meta).changes).toEqual([]);
  });

  it("reports added, removed and changed records with field before and after", () => {
    const before = snap({
      dbSchema: [rec({}), rec({ developerName: "DbSchema_Account", fields: { SObject: "Account" } })],
      triggerHandlers: [{ developerName: "VisitTH", label: "Visit TH", isActive: true }],
    });
    const after = snap({
      dbSchema: [
        rec({ fields: { SObject: "Visit", WhereSoql: "A = 2" }, assignments: [{ name: "Rep", level: "Profile" }] }),
        rec({ developerName: "DbSchema_Product2", fields: { SObject: "Product2" } }),
      ],
      triggerHandlers: [{ developerName: "VisitTH", label: "Visit TH", isActive: false }],
    });
    const diff = diffSnapshots(before, after, meta);
    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 2 });
    const visit = diff.changes.find((c) => c.developerName === "DbSchema_Visit")!;
    expect(visit.fields).toEqual([{ name: "WhereSoql", before: "A = 1", after: "A = 2" }]);
    expect(visit.assignmentsAdded).toEqual(["Profile: Rep"]);
    expect(visit.featureId).toBe("visit");
    const th = diff.changes.find((c) => c.developerName === "VisitTH")!;
    expect(th.active).toEqual({ before: true, after: false });
    expect(diff.changes.find((c) => c.developerName === "DbSchema_Account")!.kind).toBe("removed");
    expect(diff.changes.find((c) => c.developerName === "DbSchema_Product2")!.kind).toBe("added");
  });

  it("treats null and empty values as equal and notices cleared values", () => {
    const before = snap({ dbSchema: [rec({ fields: { SObject: "Visit", WhereSoql: "A = 1", Note: null } })] });
    const after = snap({ dbSchema: [rec({ fields: { SObject: "Visit", WhereSoql: "", Note: "" } })] });
    const [c] = diffSnapshots(before, after, meta).changes;
    expect(c.fields).toEqual([{ name: "WhereSoql", before: "A = 1", after: "" }]);
  });
});

describe("featureForRecord", () => {
  const base = { label: "", fields: {} };
  it("maps DB Schema to the feature owning the object, else Mobile Sync", () => {
    expect(featureForRecord({ ...base, kind: "record", category: "DbSchema", developerName: "DbSchema_ProductItem", fields: { SObject: "ProductItem" } })).toBe("samples");
    expect(featureForRecord({ ...base, kind: "record", category: "DbSchema", developerName: "DbSchema_Nope", fields: { SObject: "Nope__c" } })).toBe("mobile-sync");
  });
  it("maps trigger handlers by keyword and unmatched actions to Actions & Home Page", () => {
    expect(featureForRecord({ ...base, kind: "triggerHandler", category: "TriggerHandler", developerName: "SampleLimitTH" })).toBe("samples");
    expect(featureForRecord({ ...base, kind: "record", category: "QuickAction", developerName: "zzz" })).toBe("actions-home");
  });
});
