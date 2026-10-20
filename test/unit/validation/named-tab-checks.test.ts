import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../src/config/types.js";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
}));
vi.mock("../../../src/studio/collectors/shared.js", async (importActual) => ({
  ...(await importActual<typeof import("../../../src/studio/collectors/shared.js")>()),
  fetchCategories: vi.fn(),
}));

const { runSoqlQuery, runToolingQuery } = await import("../../../src/salesforce/cli.js");
const { fetchCategories } = await import("../../../src/studio/collectors/shared.js");
const { executeCheck } = await import("../../../src/validation/rules-executor.js");
const { tabNameIn } = await import("../../../src/validation/builtin-checks.js");

type Row = Record<string, unknown>;
const ok = (records: Row[]) => Promise.resolve({ success: true, data: { totalSize: records.length, done: true, records } });

let tabs: Row[];
let uiSchema: ConfigRecord[];
let synced: string[];

const navTab = (name: string, isActive: boolean, profiles: string[]): ConfigRecord => ({
  category: "UISchema",
  developerName: name,
  label: name,
  isActive,
  isOrgLevel: false,
  fields: { Type: "TAB", TabName: name },
  fieldTypes: {},
  assignments: profiles.map((p) => ({ name: p, level: "Profile" })),
});

beforeEach(() => {
  tabs = [];
  uiSchema = [];
  synced = [];
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => {
    const like = /LIKE '%(.*)%'/.exec(q)?.[1]?.toLowerCase() ?? "";
    const field = /WHERE (\w+) LIKE/.exec(q)?.[1] ?? "Label";
    return ok(tabs.filter((t) => String(t[field]).toLowerCase().includes(like)));
  }) as never);
  vi.mocked(runToolingQuery).mockImplementation((() => ok(synced.map((o) => ({ ObjectValue: o })))) as never);
  vi.mocked(fetchCategories).mockImplementation((async () => uiSchema) as never);
});

const run = (name: string, symptom: string) => executeCheck({ type: "builtin", name, expect: "none" } as never, "org", { symptom });

describe("tabNameIn", () => {
  it.each([
    ["Reps can't see the Samples tab on the iPad", "Samples"],
    ["Samples tab missing", "Samples"],
    ["the Sample Inventory Management tab is gone", "Sample Inventory Management"],
    ['the "Orders" tab', "Orders"],
    ["Reps can't see the tab", null],
    ["the iPad tab bar is empty", null],
    ["sync fails", null],
  ])("%s → %s", (symptom, name) => expect(tabNameIn(symptom)).toBe(name));
});

describe("named-tab", () => {
  it("can't check without a tab name", async () => {
    expect((await run("named-tab", "sync fails")).unavailable).toBe(true);
  });

  it("finds a Samples Management tab, which the iPad always drops", async () => {
    tabs = [{ Name: "LSC_Samples_Management", Label: "Samples Management", SobjectName: "0M0000000000001" }];
    const r = await run("named-tab", "Reps can't see the Samples tab on the iPad");
    expect(r.passed).toBe(false);
    expect(JSON.stringify(r.details)).toMatch(/never shows tabs named \*samples_management\*/);
  });

  it("finds an inactive or unassigned UI Settings tab", async () => {
    uiSchema = [navTab("Orders", false, ["Rep"]), navTab("OrdersHistory", true, [])];
    const r = await run("named-tab", "the Orders tab is missing");
    expect(r.passed).toBe(false);
    expect(JSON.stringify(r.details)).toMatch(/inactive/);
    expect(JSON.stringify(r.details)).toMatch(/assigned to no profile/);
  });

  it("says when the org has no such tab", async () => {
    const r = await run("named-tab", "the Widgets tab is missing");
    expect(r).toMatchObject({ passed: false, message: expect.stringMatching(/no tab named like "Widgets"/) });
  });

  it("passes for an ordinary tab the org has", async () => {
    tabs = [{ Name: "standard-ProductDisbursement", Label: "Samples", SobjectName: "ProductDisbursement" }];
    const r = await run("named-tab", "Reps can't see the Samples tab on the iPad");
    expect(r).toMatchObject({ passed: true, message: expect.stringMatching(/Samples \(standard-ProductDisbursement, ProductDisbursement\)/) });
  });
});

describe("named-tab-object", () => {
  it("fails for an object tab whose object no DB Schema record syncs", async () => {
    tabs = [{ Name: "standard-ProductDisbursement", Label: "Samples", SobjectName: "ProductDisbursement" }];
    synced = ["account"];
    const r = await run("named-tab-object", "Reps can't see the Samples tab on the iPad");
    expect(r.passed).toBe(false);
    expect(JSON.stringify(r.details)).toMatch(/ProductDisbursement isn't synced/);
  });

  it("passes when the object syncs, and ignores Lightning page tabs", async () => {
    tabs = [
      { Name: "standard-ProductDisbursement", Label: "Samples", SobjectName: "ProductDisbursement" },
      { Name: "lsc4ce__SampleManagementLandingPage", Label: "Sample Inventory Management", SobjectName: "0M0Hn000000FUDZ" },
    ];
    synced = ["productdisbursement"];
    expect((await run("named-tab-object", "Reps can't see the Samples tab on the iPad")).passed).toBe(true);
  });
});
