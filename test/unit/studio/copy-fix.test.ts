import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CopyForProfileFix, StudioFix } from "../../../src/studio/types.js";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  cachedDescribeSObject: vi.fn(),
  describeSObject: vi.fn(),
  apiRequest: vi.fn(),
  updateToolingRecord: vi.fn(),
  retrieveMetadata: vi.fn(),
  deployMetadata: vi.fn(),
  deleteMetadata: vi.fn(),
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

const LAYOUT = "PersonAccount-HCP Layout";
const COPY = "PersonAccount-HCP Layout - LS Rep";
const LAYOUT_XML = fs.readFileSync(path.join(__dirname, "../../fixtures/metadata/PersonAccount-HCP_Layout.layout-meta.xml"), "utf-8");
const profileXml = (layout: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <layoutAssignments>
        <layout>${layout}</layout>
        <recordType>PersonAccount.HCP</recordType>
    </layoutAssignments>
    <layoutAssignments>
        <layout>Visit-Visit Layout</layout>
    </layoutAssignments>
    <userLicense>Salesforce</userLicense>
</Profile>
`;

const PAGE = "Account_HCP_Page";
const COPY_PAGE = "Account_HCP_Page_LS_Rep";
const PAGE_XML = fs.readFileSync(path.join(__dirname, "../../fixtures/metadata/Account_LSDO_PH_FSR_KAM_MSL_HCO_HCP.flexipage-meta.xml"), "utf-8");
const appXml = (rep: string) => `<?xml version="1.0" encoding="UTF-8"?>
<CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionOverrides>
        <actionName>View</actionName>
        <content>${PAGE}</content>
        <formFactor>Large</formFactor>
        <pageOrSobjectType>Account</pageOrSobjectType>
        <type>Flexipage</type>
    </actionOverrides>
    <label>LSC Field Sales</label>
    <profileActionOverrides>
        <actionName>View</actionName>
        <content>${rep}</content>
        <formFactor>Large</formFactor>
        <pageOrSobjectType>Account</pageOrSobjectType>
        <type>Flexipage</type>
        <profile>LS%20Rep</profile>
    </profileActionOverrides>
</CustomApplication>
`;

const layoutCopy: CopyForProfileFix = {
  kind: "copyForProfile",
  label: "Make a copy of HCP Layout just for LS Rep",
  doc: { type: "Layout", fullName: LAYOUT, label: "HCP Layout" },
  copy: { fullName: COPY, label: "HCP Layout - LS Rep" },
  profile: "LS Rep",
};
const pageCopy: CopyForProfileFix = {
  kind: "copyForProfile",
  label: "Make a copy of Account HCP page just for LS Rep",
  doc: { type: "FlexiPage", fullName: PAGE, label: "Account HCP page" },
  copy: { fullName: COPY_PAGE, label: "Account HCP page (LS Rep)" },
  profile: "LS Rep",
};

describe("copyForProfile", () => {
  let dir: string;
  let deployed: { file: string; xml: string }[];
  let assigned: string; // the layout the profile has now
  let appRep: string; // the page the profile's override has now
  let failDeploy: (n: number) => boolean;
  let n = 0;
  let target: string;

  beforeEach(() => {
    vi.clearAllMocks();
    target = `copyorg${++n}`;
    org = { Organization: [{ IsSandbox: true }], Layout: [], FlexiPage: [] };
    assigned = LAYOUT;
    appRep = PAGE;
    failDeploy = () => false;
    vi.mocked(cli.runSoqlQuery).mockImplementation(respond as never);
    vi.mocked(cli.runToolingQuery).mockImplementation(respond as never);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-copy-"));
    deployed = [];
    vi.mocked(cli.retrieveMetadata).mockImplementation(async (_p, metadata) => {
      const out = fs.mkdtempSync(path.join(dir, "out-"));
      for (const m of [metadata].flat()) {
        const [type] = m.split(":");
        const write = (sub: string, name: string, xml: string) => {
          fs.mkdirSync(path.join(out, sub), { recursive: true });
          fs.writeFileSync(path.join(out, sub, name), xml);
        };
        if (type === "Layout") write("layouts", `${m.slice(7)}.layout-meta.xml`, LAYOUT_XML);
        if (type === "Profile") write("profiles", "LS Rep.profile-meta.xml", profileXml(assigned));
        if (type === "FlexiPage") write("flexipages", `${m.slice(9)}.flexipage-meta.xml`, PAGE_XML);
        if (type === "CustomApplication") write("applications", "LSC_Field_Sales.app-meta.xml", appXml(appRep));
      }
      return { success: true, data: { outputDir: out } };
    });
    vi.mocked(cli.deployMetadata).mockImplementation(async (source) => {
      deployed.push({ file: path.basename(source), xml: fs.readFileSync(source, "utf-8") });
      return failDeploy(deployed.length) ? { success: false, error: "boom" } : { success: true };
    });
    vi.mocked(cli.deleteMetadata).mockResolvedValue({ success: true } as never);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  describe("page layouts", () => {
    it("previews what is created and which assignment moves, without writing", async () => {
      const preview = await previewFix(layoutCopy, target);
      expect(preview.blocked).toBeUndefined();
      expect(preview.changes.map((c) => [c.target, c.field, c.before, c.after])).toEqual([
        ["Page layout", "New copy", "(doesn't exist yet)", "HCP Layout - LS Rep: a copy of HCP Layout"],
        ["LS Rep", "Layout · Record type HCP", "HCP Layout", "HCP Layout - LS Rep"],
      ]);
      expect(preview.warnings[0]).toContain("moves only LS Rep to it (1 assignment). Every other profile keeps “HCP Layout”.");
      expect(preview.production).toBeUndefined();
      expect(cli.deployMetadata).not.toHaveBeenCalled();
      expect(fs.readdirSync(dir)).toEqual([]);
    });

    it("flags production", async () => {
      org.Organization = [{ IsSandbox: false }];
      expect((await previewFix(layoutCopy, target)).production).toBe(true);
    });

    it("creates the copy with the queued edits, then deploys a Profile with just the moved assignment", async () => {
      const fix: StudioFix = { ...layoutCopy, ops: [{ op: "removeRelatedList", relatedList: "ContactPointEmails" }] };
      const preview = await previewFix(fix, target);
      expect(preview.changes[0].diff?.length).toBeGreaterThan(0);
      expect(preview.changes.map((c) => c.field)).toContain("Related list ContactPointEmails");

      const result = await applyFix(fix, target);
      expect(result.ok).toBe(true);
      expect(deployed.map((d) => d.file)).toEqual([`${COPY}.layout-meta.xml`, "LS Rep.profile-meta.xml"]);
      expect(deployed[0].xml).not.toContain("<relatedList>ContactPointEmails</relatedList>");
      expect(deployed[1].xml).toContain(`<layout>${COPY}</layout>`);
      expect(deployed[1].xml).toContain("<recordType>PersonAccount.HCP</recordType>");
      expect(deployed[1].xml).not.toContain("Visit-Visit Layout");
      expect(deployed[1].xml).not.toContain("userLicense");
      expect(result.undo).toMatchObject({ kind: "copyForProfile", copy: { fullName: COPY }, revert: { moves: [{ recordType: "PersonAccount.HCP" }] } });
    });

    it("removes the copy again when the reassignment fails", async () => {
      failDeploy = (count) => count === 2;
      const result = await applyFix(layoutCopy, target);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Couldn't move LS Rep to the copy: boom. The copy was removed; nothing was changed.");
      expect(cli.deleteMetadata).toHaveBeenCalledWith("Layout", COPY, target);
    });

    it("says so when the copy can't be removed after a failed reassignment", async () => {
      failDeploy = (count) => count === 2;
      vi.mocked(cli.deleteMetadata).mockResolvedValue({ success: false, error: "nope" } as never);
      expect((await applyFix(layoutCopy, target)).message).toContain("still in the org (nope); delete it in Setup");
    });

    it("changes nothing when the copy can't be created", async () => {
      failDeploy = (count) => count === 1;
      const result = await applyFix(layoutCopy, target);
      expect(result.ok).toBe(false);
      expect(deployed).toHaveLength(1);
      expect(cli.deleteMetadata).not.toHaveBeenCalled();
    });

    it("undoes: points the profile back, then deletes the copy", async () => {
      const done = await applyFix(layoutCopy, target);
      assigned = COPY;
      deployed = [];
      const undo = done.undo as CopyForProfileFix;
      const preview = await previewFix(undo, target);
      expect(preview.changes.map((c) => [c.field, c.before, c.after])).toEqual([
        ["Layout · Record type HCP", "HCP Layout - LS Rep", "HCP Layout"],
        ["Copy", "HCP Layout - LS Rep", "Deleted"],
      ]);
      const result = await applyFix(undo, target);
      expect(result.ok).toBe(true);
      expect(deployed.map((d) => d.file)).toEqual(["LS Rep.profile-meta.xml"]);
      expect(deployed[0].xml).toContain(`<layout>${LAYOUT}</layout>`);
      expect(cli.deleteMetadata).toHaveBeenCalledWith("Layout", COPY, target);
      // Redo is the original fix again.
      expect(result.undo).toMatchObject({ kind: "copyForProfile", copy: { fullName: COPY } });
      expect((result.undo as CopyForProfileFix).revert).toBeUndefined();
    });

    it("keeps the copy when the profile can't be pointed back", async () => {
      assigned = COPY;
      failDeploy = () => true;
      const result = await applyFix({ ...layoutCopy, revert: { moves: [{ recordType: "PersonAccount.HCP" }] } }, target);
      expect(result.ok).toBe(false);
      expect(cli.deleteMetadata).not.toHaveBeenCalled();
    });

    it("refuses an undo when the profile's assignments no longer match", async () => {
      assigned = "Something-Else";
      const preview = await previewFix({ ...layoutCopy, revert: { moves: [{ recordType: "PersonAccount.HCP" }] } }, target);
      expect(preview.blocked).toContain("assignments changed since the copy was made");
    });

    it("refuses when the profile isn't assigned the layout, the name is taken, or an edit no longer fits", async () => {
      assigned = "Other-Layout";
      expect((await previewFix(layoutCopy, target)).blocked).toContain("isn't assigned HCP Layout");
      assigned = LAYOUT;
      org.Layout = [{ Id: "00h000000000001" }];
      expect((await previewFix(layoutCopy, target)).blocked).toContain("already exists");
      org.Layout = [];
      const stale: StudioFix = { ...layoutCopy, ops: [{ op: "removeRelatedList", relatedList: "NotThere" }] };
      expect((await previewFix(stale, target)).blocked).toContain("changed since the preview was loaded");
      expect((await applyFix(stale, target)).ok).toBe(false);
      expect(cli.deployMetadata).not.toHaveBeenCalled();
    });

    it("refuses names that aren't for the same object", async () => {
      const bad = { ...layoutCopy, copy: { fullName: "Contact-HCP Layout - LS Rep", label: "x" } };
      expect((await previewFix(bad, target)).blocked).toBe("The copy must be for the same object.");
    });
  });

  describe("Lightning pages", () => {
    it("previews the new page and the apps that point the profile at it", async () => {
      const preview = await previewFix(pageCopy, target);
      expect(preview.blocked).toBeUndefined();
      expect(preview.changes.map((c) => [c.field, c.before, c.after])).toEqual([
        ["New copy", "(doesn't exist yet)", "Account HCP page (LS Rep): a copy of Account HCP page"],
        ["Page in LSC_Field_Sales", "Account HCP page", "Account HCP page (LS Rep)"],
      ]);
      expect(cli.deployMetadata).not.toHaveBeenCalled();
    });

    it("creates the page, then re-points only the profile's override", async () => {
      const result = await applyFix(pageCopy, target);
      expect(result.ok).toBe(true);
      expect(deployed.map((d) => d.file)).toEqual([`${COPY_PAGE}.flexipage-meta.xml`, "LSC_Field_Sales.app-meta.xml"]);
      expect(deployed[0].xml).toContain("<masterLabel>Account HCP page (LS Rep)</masterLabel>");
      expect(deployed[1].xml).toBe(appXml(COPY_PAGE));
      expect(result.undo).toMatchObject({ kind: "copyForProfile", revert: { moves: [{ app: "LSC_Field_Sales" }] } });
    });

    it("puts the apps back and removes the page when an app can't be changed", async () => {
      failDeploy = (count) => count === 2;
      const result = await applyFix(pageCopy, target);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("The copy was removed; nothing was changed.");
      expect(cli.deleteMetadata).toHaveBeenCalledWith("FlexiPage", COPY_PAGE, target);
    });

    it("undoes: restores the override, then deletes the page", async () => {
      const done = await applyFix(pageCopy, target);
      appRep = COPY_PAGE;
      deployed = [];
      const result = await applyFix(done.undo!, target);
      expect(result.ok).toBe(true);
      expect(deployed.map((d) => d.file)).toEqual(["LSC_Field_Sales.app-meta.xml"]);
      expect(deployed[0].xml).toBe(appXml(PAGE));
      expect(cli.deleteMetadata).toHaveBeenCalledWith("FlexiPage", COPY_PAGE, target);
    });

    it("refuses when no app gives the profile the page, or the name is taken", async () => {
      const other = { ...pageCopy, doc: { ...pageCopy.doc, fullName: "Another_Page" } };
      expect((await previewFix(other, target)).blocked).toContain("No app gives LS Rep Account HCP page");
      org.FlexiPage = [{ Id: "0M0000000000001" }];
      expect((await previewFix(pageCopy, target)).blocked).toContain("already exists");
    });
  });
});
