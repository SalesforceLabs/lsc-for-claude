import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { StudioFix } from "../../../src/studio/types.js";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  cachedDescribeSObject: vi.fn(),
  describeSObject: vi.fn(),
  apiRequest: vi.fn(),
  updateToolingRecord: vi.fn(),
  retrieveMetadata: vi.fn(),
  deployMetadata: vi.fn(),
}));

const cli = await import("../../../src/salesforce/cli.js");
const { previewFix, applyFix } = await import("../../../src/studio/fixes.js");

type Row = Record<string, unknown>;
let org: Record<string, Row[]>;

function respond(query: string) {
  const from = /FROM\s+(\w+)/i.exec(query)?.[1] ?? "";
  const rows = org[from] ?? [];
  return Promise.resolve({ success: true, data: { totalSize: rows.length, done: true, records: rows } });
}

const PAGE = "Account_LSDO_PH_FSR_KAM_MSL_HCO_HCP";
const XML = fs.readFileSync(path.join(__dirname, `../../fixtures/metadata/${PAGE}.flexipage-meta.xml`), "utf-8");
const TABS = "Facet-c9e9688e-b828-4cab-a8fa-56c617c55316";
const APP = `<?xml version="1.0" encoding="UTF-8"?>
<CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionOverrides>
        <actionName>View</actionName>
        <content>${PAGE}</content>
        <formFactor>Large</formFactor>
        <type>Flexipage</type>
        <pageOrSobjectType>Account</pageOrSobjectType>
    </actionOverrides>
    <label>LSC Field Sales</label>
    <profileActionOverrides>
        <actionName>View</actionName>
        <content>${PAGE}</content>
        <formFactor>Large</formFactor>
        <pageOrSobjectType>Account</pageOrSobjectType>
        <type>Flexipage</type>
        <profile>LS%20Rep</profile>
    </profileActionOverrides>
    <profileActionOverrides>
        <actionName>View</actionName>
        <content>${PAGE}</content>
        <formFactor>Small</formFactor>
        <pageOrSobjectType>Account</pageOrSobjectType>
        <type>Flexipage</type>
        <profile>LS%20Phone</profile>
    </profileActionOverrides>
    <profileActionOverrides>
        <actionName>View</actionName>
        <content>${PAGE}</content>
        <pageOrSobjectType>Account</pageOrSobjectType>
        <type>Flexipage</type>
        <profile>Admin</profile>
    </profileActionOverrides>
</CustomApplication>
`;

const doc = { type: "FlexiPage" as const, fullName: PAGE, label: "Account HCP page" };
const tab = (identifier: string) => ({ component: "flexipage:tab", identifier, index: 0 });
const fix: StudioFix = {
  kind: "editMetadata",
  label: "Edit Account HCP page",
  doc,
  ops: [{ op: "moveComponent", component: { region: TABS, item: tab("flexipage_tab5") }, before: tab("flexipage_tab3") }],
};

describe("editMetadata (Lightning pages)", () => {
  let dir: string;
  let deployed: string | null;
  let n = 0;
  let target: string;

  beforeEach(() => {
    vi.clearAllMocks();
    // A new org name per test, so the cached app assignments don't carry over.
    target = `org${++n}`;
    org = { Organization: [{ IsSandbox: true }], FlexiPage: [{ ManageableState: "unmanaged" }], LifeSciConfigRecord: [] };
    vi.mocked(cli.runSoqlQuery).mockImplementation(respond as never);
    vi.mocked(cli.runToolingQuery).mockImplementation(respond as never);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-doc-"));
    deployed = null;
    vi.mocked(cli.retrieveMetadata).mockImplementation(async (_p, metadata) => {
      const out = fs.mkdtempSync(path.join(dir, "out-"));
      if (metadata === "CustomApplication") {
        fs.mkdirSync(path.join(out, "applications"));
        fs.writeFileSync(path.join(out, "applications", "LSC_Field_Sales.app-meta.xml"), APP);
      } else {
        fs.mkdirSync(path.join(out, "flexipages"));
        fs.writeFileSync(path.join(out, "flexipages", `${PAGE}.flexipage-meta.xml`), XML);
      }
      return { success: true, data: { outputDir: out } };
    });
    vi.mocked(cli.deployMetadata).mockImplementation(async (source) => {
      deployed = fs.readFileSync(source, "utf-8");
      return { success: true };
    });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("previews the move with the diff and who gets the page, then deploys it and returns the undo", async () => {
    const preview = await previewFix(fix, target);
    expect(preview.blocked).toBeUndefined();
    expect(preview.changes.map((c) => [c.field, c.before, c.after])).toEqual([
      ['Tab "Insights"', "Position 3 of 10 in the record tabs", "Position 1 of 10 in the record tabs"],
    ]);
    expect(preview.changes[0].diff?.length).toBeGreaterThan(0);
    expect(preview.warnings[0]).toBe(
      "Deploys Account HCP page to the org — it's the page for 2 profiles (LS Rep, System Administrator) and the default in LSC Field Sales, and everyone who gets it gets the change."
    );
    expect(fs.readdirSync(dir)).toEqual([]);

    const result = await applyFix(fix, target);
    expect(result.ok).toBe(true);
    expect(deployed!.indexOf("flexipage_tab5")).toBeLessThan(deployed!.indexOf("flexipage_tab3"));
    expect(cli.deployMetadata).toHaveBeenCalledWith(expect.stringMatching(/flexipage-meta\.xml$/), target);
    expect(result.undo).toMatchObject({
      kind: "editMetadata",
      doc,
      ops: [{ op: "moveComponent", component: { region: TABS, item: { identifier: "flexipage_tab5", index: 0 } }, before: { identifier: "flexipage_tab" } }],
    });
  });

  it("warns about long tab titles and flags production", async () => {
    org.Organization = [{ IsSandbox: false }];
    const rename: StudioFix = {
      ...fix,
      ops: [{ op: "setComponentProperty", component: { region: TABS, item: tab("flexipage_tab5") }, property: "title", from: "Insights", to: "Insights for the territory team" }],
    };
    const preview = await previewFix(rename, target);
    expect(preview.production).toBe(true);
    expect(preview.warnings.join(" ")).toContain("over 25 characters");
  });

  it("refuses when the page changed since the preview was loaded, at preview and at apply", async () => {
    const stale: StudioFix = { ...fix, ops: [{ op: "removeComponent", component: { region: TABS, item: tab("flexipage_tab99") } }] };
    expect((await previewFix(stale, target)).blocked).toBe(
      `Account HCP page changed since the preview was loaded: flexipage_tab99 isn't in ${TABS} any more. Refresh the preview.`
    );
    expect((await applyFix(stale, target)).ok).toBe(false);
    expect(cli.deployMetadata).not.toHaveBeenCalled();
  });

  it("refuses pages from a managed package", async () => {
    org.FlexiPage = [{ ManageableState: "installed" }];
    expect((await previewFix(fix, target)).blocked).toMatch(/managed package.*Clone it in Lightning App Builder/);
    expect((await applyFix(fix, target)).ok).toBe(false);
    expect(cli.deployMetadata).not.toHaveBeenCalled();
  });

  it("refuses layout ops on a Lightning page", async () => {
    const mixed = { ...fix, ops: [{ op: "removeField", field: "Name" }] } as StudioFix;
    expect((await previewFix(mixed, target)).blocked).toMatch(/aren't FlexiPage edits/);
  });

  it("reads the live page with who gets it", async () => {
    const { readLiveFlexiPage } = await import("../../../src/studio/metadata/live.js");
    const live = await readLiveFlexiPage(PAGE, target);
    expect(live).toMatchObject({ label: "Account-LSDO-PH FSR KAM MSL-HCO-HCP", profiles: ["LS Rep", "System Administrator"], appDefaults: ["LSC Field Sales"], managed: false, production: false });
    expect(live.regions.map((r) => r.name).slice(0, 2)).toEqual(["header", "Facet-fc76644f-1710-419f-be76-404a421690a8"]);
  });

  it("answers without who gets it when reading the apps is slow, and that keeps loading", async () => {
    const { readLiveFlexiPage, flexiPageReach } = await import("../../../src/studio/metadata/live.js");
    const retrieve = vi.mocked(cli.retrieveMetadata).getMockImplementation()!;
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    vi.mocked(cli.retrieveMetadata).mockImplementation(async (p, metadata, org) => {
      if (metadata === "CustomApplication") await slow;
      return retrieve(p, metadata, org);
    });
    const live = await readLiveFlexiPage(PAGE, target, 10);
    expect(live).toMatchObject({ profiles: null, appDefaults: null, reachPending: true });
    release();
    expect(await flexiPageReach(PAGE, target)).toEqual({ profiles: ["LS Rep", "System Administrator"], appDefaults: ["LSC Field Sales"] });
    expect(vi.mocked(cli.retrieveMetadata).mock.calls.filter((c) => c[1] === "CustomApplication")).toHaveLength(1);
  });
});
