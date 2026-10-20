import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
}));

const { runToolingQuery } = await import("../../../src/salesforce/cli.js");
const { executeCheck } = await import("../../../src/validation/rules-executor.js");

type Row = Record<string, unknown>;
const ok = (records: Row[]) => Promise.resolve({ success: true, data: { totalSize: records.length, done: true, records } });

let pages: Row[];
let metadata: Record<string, Row | Error>;
let synced: Row[] | Error;

beforeEach(() => {
  synced = new Error("not an LSC org");
  pages = [
    { Id: "0M0000000000001", DeveloperName: "Rep_Home", MasterLabel: "Rep Home", Type: "HomePage" },
    { Id: "0M0000000000002", DeveloperName: "Account_Page", MasterLabel: "Account Page", Type: "RecordPage" },
  ];
  metadata = {
    "0M0000000000001": {
      template: { name: "flexipage:defaultAppHomeTemplate" },
      flexiPageRegions: [
        { name: "header", type: "Region", itemInstances: [{ componentInstance: { componentName: "flexipage:richText" } }] },
        { name: "main", type: "Region", itemInstances: [{ componentInstance: { componentName: "flexipage:recentItems" } }] },
      ],
    },
    "0M0000000000002": {
      template: { name: "flexipage:recordHomeTemplateDesktop" },
      flexiPageRegions: [
        { name: "header", type: "Region", itemInstances: [{ componentInstance: { componentName: "force:highlightsPanel" } }] },
        { name: "main", type: "Region", itemInstances: [{ componentInstance: { componentName: "force:detailPanel" } }] },
        { name: "sidebar", type: "Region", itemInstances: [] },
      ],
    },
  };
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => {
    if (q.includes("SELECT Id, DeveloperName")) return ok(pages);
    if (q.includes("FROM LifeSciConfigFieldValue")) return synced instanceof Error ? Promise.resolve({ success: false, error: synced.message }) : ok(synced);
    const id = /Id = '(\w+)'/.exec(q)?.[1] ?? "";
    const m = metadata[id];
    if (m instanceof Error) return Promise.resolve({ success: false, error: m.message });
    return ok(m ? [{ Metadata: m }] : []);
  }) as never);
});

const check = { type: "builtin" as const, name: "ipad-pages", expect: "none" };

describe("builtin ipad-pages check", () => {
  it("fails with the pages to fix", async () => {
    const r = await executeCheck(check, "o");
    expect(r.passed).toBe(false);
    expect(r.unavailable).toBeUndefined();
    expect(r.message).toBe("1 of 2 Home and record pages draws differently on the iPad. Pages reps only open on desktop don't matter.");
    const records = (r.details as { records: Row[] }).records;
    expect(records).toHaveLength(1);
    expect(String(records[0].Name)).toMatch(/^Rep Home \(Rep_Home\): The iPad shows nothing in the Header region/);
  });

  it("passes when every page draws as built, and says what it couldn't read", async () => {
    (metadata["0M0000000000001"] as Row).flexiPageRegions = [];
    metadata["0M0000000000003"] = new Error("boom");
    pages.push({ Id: "0M0000000000003", DeveloperName: "X", MasterLabel: "X", Type: "RecordPage" });
    const r = await executeCheck(check, "o");
    expect(r).toMatchObject({ passed: true, message: "2 Home and record pages checked; none draws differently on the iPad. 1 couldn't be read." });
  });

  it("leaves out record pages of objects DB Schema doesn't sync", async () => {
    pages[1].EntityDefinition = { QualifiedApiName: "Case" };
    (metadata["0M0000000000002"] as Row).template = { name: "flexipage:recordHomeThreeColTemplateDesktop" };
    synced = [{ ObjectValue: "Account" }];
    const r = await executeCheck(check, "o");
    expect((r.details as { records: Row[] }).records.map((x) => x.Id)).toEqual(["0M0000000000001"]);
  });

  it("can't check when the page list can't be read", async () => {
    vi.mocked(runToolingQuery).mockResolvedValue({ success: false, error: "INVALID_TYPE" } as never);
    const r = await executeCheck(check, "o");
    expect(r).toMatchObject({ passed: false, unavailable: true });
  });

  it("refuses a built-in check it doesn't know", async () => {
    const r = await executeCheck({ ...check, name: "nope" }, "o");
    expect(r).toMatchObject({ passed: false, unavailable: true, message: "Unknown built-in check: nope" });
  });
});
