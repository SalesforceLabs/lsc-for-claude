import { beforeEach, describe, expect, it, vi } from "vitest";

type Rows = Array<Record<string, unknown>>;
const state = vi.hoisted(() => ({
  handler: (_soql: string, _tooling: boolean): { rows?: Array<Record<string, unknown>>; error?: string } => ({ rows: [] }),
}));

vi.mock("../../../src/salesforce/cli.js", () => {
  const run = (tooling: boolean) => async (soql: string) => {
    const r = state.handler(soql, tooling);
    if (r.error) return { success: false, error: r.error };
    return { success: true, data: { records: r.rows ?? [], totalSize: (r.rows ?? []).length, done: true } };
  };
  class QueryTruncatedError extends Error {}
  return { runSoqlQuery: run(false), runToolingQuery: run(true), QueryTruncatedError };
});

import { collectUnpublished } from "../../../src/studio/unpublished.js";
import { configItems, isAfter, normalizeName, nameIndex, resolveName, soqlTime, sortItems } from "../../../src/studio/unpublished-logic.js";

const CACHE_START = "2026-10-10T10:00:00.000Z";
const CACHE_DONE = "2026-10-10T10:02:00.000Z";
const BEFORE = "2026-10-10T09:59:59.000Z";
const AFTER = "2026-10-10T10:00:01.000Z";
const by = (name: string) => ({ Name: name });

/** An org that answers by the FROM clause; `over` replaces an object's rows (or makes it fail). */
function org(over: Record<string, Rows | Error> = {}) {
  const queries: string[] = [];
  state.handler = (soql, tooling) => {
    queries.push(`${tooling ? "T" : "S"}:${soql.replace(/\s+/g, " ")}`);
    const from = /FROM (\w+)/.exec(soql)?.[1] ?? "";
    if (over[from] instanceof Error) return { error: (over[from] as Error).message };
    if (over[from]) return { rows: over[from] as Rows };
    if (from === "Profile") return { rows: [{ Id: "00eP", Name: "Rep" }] };
    if (from === "LifeSciMobileMetadataRecord") return { rows: [{ Id: "1KA", CreatedDate: CACHE_START, LastModifiedDate: CACHE_DONE }] };
    return { rows: [] };
  };
  return queries;
}

beforeEach(() => org());

describe("collectUnpublished", () => {
  it("compares against when the live cache's generation started, strictly", async () => {
    org({
      Layout: [
        { Name: "Old", TableEnumOrId: "Visit", EntityDefinition: { QualifiedApiName: "Visit" }, LastModifiedDate: BEFORE, LastModifiedBy: by("Ann") },
        { Name: "At start", TableEnumOrId: "Visit", EntityDefinition: { QualifiedApiName: "Visit" }, LastModifiedDate: CACHE_START, LastModifiedBy: by("Ann") },
        { Name: "New", TableEnumOrId: "Visit", EntityDefinition: { QualifiedApiName: "Visit" }, LastModifiedDate: AFTER, LastModifiedBy: by("Bo") },
      ],
    });
    const r = await collectUnpublished("Rep", "o");
    expect(r.items.map((i) => i.label)).toEqual(["New"]);
    expect(r.items[0]).toMatchObject({ kind: "layout", name: "Visit-New", lastModifiedBy: "Bo", target: "metadata:Layout:Visit-New", lastModifiedAt: AFTER });
    expect(r.cacheAt).toBe(CACHE_DONE);
    expect(r.cacheStartedAt).toBe(CACHE_START);
    expect(r.errors).toEqual([]);
    expect(r.noCache).toBe(false);
  });

  it("asks the org only for changes after the cache", async () => {
    const queries = org();
    await collectUnpublished("Rep", "o");
    const layoutQuery = queries.find((q) => q.includes("FROM Layout"))!;
    expect(layoutQuery).toContain("LastModifiedDate > 2026-10-10T10:00:00.000Z");
    expect(layoutQuery.startsWith("T:")).toBe(true);
    expect(queries.find((q) => q.includes("FROM ListView"))!.startsWith("S:")).toBe(true);
  });

  it("limits documents to the ones the snapshot references, spelled as the snapshot spells them", async () => {
    org({
      Layout: [
        { Name: "Visit Layout (v2)", TableEnumOrId: "Visit", EntityDefinition: { QualifiedApiName: "Visit" }, LastModifiedDate: AFTER, LastModifiedBy: by("Ann") },
        { Name: "Other profile layout", TableEnumOrId: "Case", EntityDefinition: { QualifiedApiName: "Case" }, LastModifiedDate: AFTER, LastModifiedBy: by("Ann") },
      ],
      FlexiPage: [
        { DeveloperName: "Home_Rep", MasterLabel: "Rep Home", LastModifiedDate: AFTER },
        { DeveloperName: "Home_Other", MasterLabel: "Other Home", LastModifiedDate: AFTER },
      ],
    });
    const r = await collectUnpublished("Rep", "o", { layouts: ["Visit-Visit%20Layout%20(v2)"], flexiPages: ["home_rep"], compactLayouts: [] });
    expect(r.scoped).toBe(true);
    expect(r.items.map((i) => `${i.kind}:${i.name}`).sort()).toEqual(["flexiPage:home_rep", "layout:Visit-Visit%20Layout%20(v2)"]);
    // The Tooling FlexiPage has no editor.
    expect(r.items.find((i) => i.kind === "flexiPage")!.lastModifiedBy).toBeNull();
  });

  it("marks list views as already live", async () => {
    org({ ListView: [{ DeveloperName: "Mine", Name: "Mine", SobjectType: "Account", LastModifiedDate: AFTER, LastModifiedBy: by("Ann") }] });
    const r = await collectUnpublished("Rep", "o");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ kind: "listView", live: true, name: "Account.Mine" });
  });

  it("counts Admin Console records by profile reach, using the latest editor of the record, its values or its assignments", async () => {
    org({
      LifeSciConfigRecord: [{ Id: "r1", LastModifiedDate: BEFORE, LastModifiedBy: by("Old") }],
      LifeSciConfigFieldValue: [{ LifeSciConfigRecordId: "r1", LastModifiedDate: AFTER, LastModifiedBy: by("Cy") }],
      LifeSciConfigAssignment: [],
    });
    // The details query selects the same tables with different columns; answer it from the same routing.
    state.handler = (soql) => {
      if (soql.includes("FROM Profile")) return { rows: [{ Id: "00eP", Name: "Rep" }] };
      if (soql.includes("FROM LifeSciMobileMetadataRecord")) return { rows: [{ CreatedDate: CACHE_START, LastModifiedDate: CACHE_DONE }] };
      if (soql.includes("FROM LifeSciConfigFieldValue")) return { rows: [{ LifeSciConfigRecordId: "r1", LastModifiedDate: AFTER, LastModifiedBy: by("Cy") }] };
      if (soql.includes("FROM LifeSciConfigAssignment") && soql.includes("LastModifiedDate >")) return { rows: [] };
      if (soql.includes("FROM LifeSciConfigAssignment")) return { rows: [{ LifeSciConfigRecordId: "r1", AssignedToId: "00eP", AssignmentLevel: "Profile" }] };
      if (soql.includes("FROM LifeSciConfigRecord") && soql.includes("LastModifiedDate >")) return { rows: [] };
      if (soql.includes("FROM LifeSciConfigRecord")) return { rows: [{ Id: "r1", DeveloperName: "DbSchema_Visit", IsOrgLevel: false, LifeSciConfigCategory: { Category: "DbSchema" } }] };
      return { rows: [] };
    };
    const r = await collectUnpublished("Rep", "o");
    expect(r.items).toEqual([
      { id: "dbSchema:DbSchema:DbSchema_Visit", kind: "dbSchema", name: "DbSchema:DbSchema_Visit", label: "DbSchema_Visit", lastModifiedAt: AFTER, lastModifiedBy: "Cy", target: "config:DbSchema:DbSchema_Visit" },
    ]);
  });

  it("reports a kind that couldn't be read instead of treating it as no changes", async () => {
    org({
      CompactLayout: new Error("INVALID_TYPE: sObject type 'CompactLayout' is not supported"),
      Layout: [{ Name: "New", TableEnumOrId: "Visit", EntityDefinition: { QualifiedApiName: "Visit" }, LastModifiedDate: AFTER, LastModifiedBy: by("Bo") }],
    });
    const r = await collectUnpublished("Rep", "o");
    expect(r.errors).toEqual([{ kind: "Compact layouts", message: expect.stringContaining("CompactLayout") }]);
    expect(r.items).toHaveLength(1);
  });

  it("reports every kind failing when the org is unreachable", async () => {
    org({
      Layout: new Error("boom"),
      CompactLayout: new Error("boom"),
      FlexiPage: new Error("boom"),
      RecordType: new Error("boom"),
      ListView: new Error("boom"),
      CustomTab: new Error("boom"),
      LifeSciConfigRecord: new Error("boom"),
    });
    const r = await collectUnpublished("Rep", "o");
    expect(r.items).toEqual([]);
    expect(r.errors).toHaveLength(7);
  });

  it("throws, not 'none', when the profile or the cache can't be read", async () => {
    org({ Profile: [] });
    await expect(collectUnpublished("Rep", "o")).rejects.toThrow(/Profile not found/);
    org({ LifeSciMobileMetadataRecord: new Error("no access") });
    await expect(collectUnpublished("Rep", "o")).rejects.toThrow(/no access/);
  });

  it("says so when the profile has no live cache", async () => {
    org({ LifeSciMobileMetadataRecord: [] });
    const r = await collectUnpublished("Rep", "o");
    expect(r).toMatchObject({ noCache: true, cacheAt: null, items: [], errors: [] });
  });
});

describe("unpublished logic", () => {
  it("treats the boundary as exclusive and bad dates as not after", () => {
    const t = Date.parse(CACHE_START);
    expect(isAfter(CACHE_START, t)).toBe(false);
    expect(isAfter(AFTER, t)).toBe(true);
    expect(isAfter(undefined, t)).toBe(false);
    expect(isAfter("nonsense", t)).toBe(false);
  });

  it("formats SOQL times without milliseconds noise", () => {
    expect(soqlTime(Date.parse("2026-10-10T10:00:00.123Z"))).toBe("2026-10-10T10:00:00.000Z");
  });

  it("names compare without encoding or case", () => {
    expect(normalizeName("Account-My%20Layout")).toBe("account-my layout");
    expect(normalizeName("100%")).toBe("100%");
    const idx = nameIndex(["Account-My%20Layout"]);
    expect(resolveName(idx, "account-my layout")).toBe("Account-My%20Layout");
    expect(resolveName(idx, "Account-Other")).toBeNull();
    expect(resolveName(undefined, "x")).toBe("x");
  });

  it("config edits reach a profile by assignment, by being org-wide, or through a non-profile assignment", () => {
    const base = { recordId: "r", category: "UISchema", developerName: "Tab_A", at: Date.parse(AFTER), by: "Ann" };
    const boundary = Date.parse(CACHE_START);
    expect(configItems([{ ...base, allProfiles: false, profileIds: ["00eP"] }], "00eP", boundary)).toHaveLength(1);
    expect(configItems([{ ...base, allProfiles: false, profileIds: ["00eQ"] }], "00eP", boundary)).toHaveLength(0);
    expect(configItems([{ ...base, allProfiles: true, profileIds: [] }], "00eP", boundary)).toHaveLength(1);
    expect(configItems([{ ...base, at: boundary, allProfiles: true, profileIds: [] }], "00eP", boundary)).toHaveLength(0);
    expect(configItems([{ ...base, category: "Unrelated", allProfiles: true, profileIds: [] }], "00eP", boundary)).toHaveLength(0);
  });

  it("sorts newest first", () => {
    const mk = (id: string, at: string) => ({ id, kind: "layout" as const, name: id, label: id, lastModifiedAt: at, lastModifiedBy: null, target: id });
    expect(sortItems([mk("a", BEFORE), mk("b", AFTER)]).map((i) => i.id)).toEqual(["b", "a"]);
  });
});
