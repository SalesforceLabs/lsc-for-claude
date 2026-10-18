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
const { collectItemDetail } = await import("../../../src/studio/collect.js");

type Row = Record<string, unknown>;
let org: Record<string, Row[]>;

function respond(query: string) {
  const from = /FROM\s+(\w+)/i.exec(query)?.[1] ?? "";
  const rows = org[from] ?? [];
  return Promise.resolve({ success: true, data: { totalSize: rows.length, done: true, records: rows } });
}

const SCRIPT = "a1B000000000001";
const CODE_OLD = "(() => {\n  return JSON.parse(JSON.stringify({ ok: true }));\n})();";
const CODE_NEW = "(() => {\n  return { ok: true };\n})();";

const scriptFix: StudioFix = {
  kind: "setCustomScriptCode",
  label: "Edit code of Sign Check",
  scriptId: SCRIPT,
  scriptName: "Sign Check",
  from: CODE_OLD,
  to: CODE_NEW,
};

const describeCodeText = (updateable: boolean) =>
  vi.mocked(cli.describeSObject).mockResolvedValue({
    success: true,
    data: { name: "LifeScienceCustomScript", label: "Script", fields: [{ name: "CodeText", label: "Code", type: "textarea", required: false, updateable, createable: updateable }] },
  });

beforeEach(() => {
  vi.clearAllMocks();
  org = {};
  vi.mocked(cli.runSoqlQuery).mockImplementation(respond as never);
  vi.mocked(cli.runToolingQuery).mockImplementation(respond as never);
  vi.mocked(cli.apiRequest).mockResolvedValue({ success: true });
  vi.mocked(cli.updateToolingRecord).mockResolvedValue({ success: true });
  vi.mocked(cli.deployMetadata).mockResolvedValue({ success: true });
});

describe("setCustomScriptCode", () => {
  beforeEach(() => {
    org.LifeScienceCustomScript = [{ Id: SCRIPT, CodeText: CODE_OLD }];
    describeCodeText(true);
  });

  it("previews a diff with the static checks as warnings, and applies with an undo", async () => {
    const preview = await previewFix(scriptFix, "org");
    expect(preview.blocked).toBeUndefined();
    expect(preview.changes[0].diff).toEqual(["  (() => {", "-   return JSON.parse(JSON.stringify({ ok: true }));", "+   return { ok: true };", "  })();"]);
    expect(preview.warnings.some((w) => w.startsWith("Results aren't unwrapped"))).toBe(true);
    expect(preview.warnings.some((w) => w.includes("overwrites CodeText"))).toBe(true);

    const result = await applyFix(scriptFix, "org");
    expect(cli.apiRequest).toHaveBeenCalledWith(
      `/services/data/v66.0/sobjects/LifeScienceCustomScript/${SCRIPT}`,
      "PATCH",
      { CodeText: CODE_NEW },
      "org"
    );
    expect(result.undo).toMatchObject({ kind: "setCustomScriptCode", from: CODE_NEW, to: CODE_OLD, label: "Restore code of Sign Check" });
  });

  it("flags empty code and code that isn't an IIFE", async () => {
    const empty = await previewFix({ ...scriptFix, to: "" } as StudioFix, "org");
    expect(empty.warnings[0]).toContain("CodeText is empty");
    const bare = await previewFix({ ...scriptFix, to: "JSON.parse(JSON.stringify(1))" } as StudioFix, "org");
    expect(bare.warnings[0]).toContain("Not wrapped in an IIFE");
  });

  it("refuses when the code changed since the map was loaded", async () => {
    org.LifeScienceCustomScript = [{ Id: SCRIPT, CodeText: "// edited by someone else" }];
    expect((await previewFix(scriptFix, "org")).blocked).toContain("changed since the map was loaded");
    expect((await applyFix(scriptFix, "org")).ok).toBe(false);
    expect(cli.apiRequest).not.toHaveBeenCalled();
  });

  it("refuses when already applied or gone", async () => {
    org.LifeScienceCustomScript = [{ Id: SCRIPT, CodeText: CODE_NEW }];
    expect((await previewFix(scriptFix, "org")).blocked).toContain("Already applied");
    org.LifeScienceCustomScript = [];
    expect((await previewFix(scriptFix, "org")).blocked).toContain("no longer exists");
  });

  it("is blocked, with the Refresh workaround, when the org doesn't let the API write CodeText", async () => {
    describeCodeText(false);
    const preview = await previewFix(scriptFix, "org");
    expect(preview.blocked).toContain("Refresh");
    expect((await applyFix(scriptFix, "org")).ok).toBe(false);
    expect(cli.apiRequest).not.toHaveBeenCalled();
  });

  it("rejects malformed Ids", async () => {
    await expect(previewFix({ ...scriptFix, scriptId: "x'; DROP" } as StudioFix, "org")).rejects.toThrow("Invalid record Id");
  });
});

describe("validation rule active switch", () => {
  const RULE = "03d000000000001";
  const fix: StudioFix = {
    kind: "setActive",
    label: "Deactivate Hours_Cant_be_negative",
    record: { type: "validationRule", id: RULE, label: "Hours_Cant_be_negative" },
    from: true,
    to: false,
  };
  const metadata = { active: true, description: null, errorConditionFormula: "Hours__c < 0", errorMessage: "No negatives", urls: null };

  beforeEach(() => {
    org.ValidationRule = [{ Id: RULE, Active: true, ManageableState: "unmanaged", Metadata: metadata }];
  });

  it("previews and writes the whole Metadata with active flipped, nulls dropped, and an undo", async () => {
    const preview = await previewFix(fix, "org");
    expect(preview.blocked).toBeUndefined();
    expect(preview.changes[0]).toMatchObject({ field: "Status", before: "Active", after: "Inactive" });
    expect(preview.warnings[0]).toContain("Turns this rule off");

    const result = await applyFix(fix, "org");
    expect(cli.updateToolingRecord).toHaveBeenCalledWith(
      "ValidationRule",
      RULE,
      { Metadata: { active: false, errorConditionFormula: "Hours__c < 0", errorMessage: "No negatives" } },
      "org"
    );
    expect(result.undo).toMatchObject({ kind: "setActive", from: false, to: true, label: "Activate Hours_Cant_be_negative" });
  });

  it("refuses when already in that state or gone, and warns for installed packages", async () => {
    org.ValidationRule = [{ Id: RULE, Active: false, Metadata: metadata }];
    expect((await previewFix(fix, "org")).blocked).toContain("Already inactive");
    org.ValidationRule = [];
    expect((await previewFix(fix, "org")).blocked).toContain("no longer exists");
    org.ValidationRule = [{ Id: RULE, Active: true, ManageableState: "installed", NamespacePrefix: "FSSK", Metadata: metadata }];
    expect((await previewFix(fix, "org")).warnings.join(" ")).toContain("installed package (FSSK)");
  });

  it("surfaces a failed update", async () => {
    vi.mocked(cli.updateToolingRecord).mockResolvedValue({ success: false, error: "FIELD_INTEGRITY_EXCEPTION" });
    expect(await applyFix(fix, "org")).toMatchObject({ ok: false, message: "FIELD_INTEGRITY_EXCEPTION" });
  });
});

describe("Visit engagement sidebar", () => {
  let dir: string;
  const LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Layout xmlns="http://soap.sforce.com/2006/04/metadata">
    <relatedLists>
        <relatedList>Notes</relatedList>
        <fields>NAME</fields>
    </relatedLists>
    <relatedLists>
        <relatedList>Things__r</relatedList>
        <fields>NAME</fields>
        <excludeButtons>New</excludeButtons>
    </relatedLists>
</Layout>
`;
  const add: StudioFix = {
    kind: "setLayoutRelatedList",
    label: "Add Gadget__c to the sidebar of Visit Layout",
    layoutName: "Visit-Visit Layout",
    layoutLabel: "Visit Layout",
    objectName: "Gadget__c",
    relationshipName: "Gadgets__r",
    add: true,
  };

  /** Each retrieve gets a fresh copy of the layout in a temp SFDX-style folder. */
  function stubRetrieve(xml: string) {
    vi.mocked(cli.retrieveMetadata).mockImplementation(async () => {
      const out = fs.mkdtempSync(path.join(dir, "out-"));
      const layouts = path.join(out, "force-app", "main", "default", "layouts");
      fs.mkdirSync(layouts, { recursive: true });
      fs.writeFileSync(path.join(layouts, "Visit-Visit Layout.layout-meta.xml"), xml);
      return { success: true, data: { outputDir: out } };
    });
  }
  const deployedXml = () => {
    const [source] = vi.mocked(cli.deployMetadata).mock.calls[0];
    return fs.readFileSync(path.join(source as string, "Visit-Visit Layout.layout-meta.xml"), "utf-8");
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-layout-"));
    stubRetrieve(LAYOUT_XML);
    org.LifeSciConfigRecord = [{ Id: "1LR000000000001", IsActive: true }];
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("previews the block that will be inserted, then deploys it and returns a removing undo", async () => {
    const preview = await previewFix(add, "org");
    expect(preview.blocked).toBeUndefined();
    expect(preview.changes[0]).toMatchObject({ target: "Visit Layout", before: "2 of 10", after: "3 of 10" });
    expect(preview.changes[0].diff).toContain("+     <relatedList>Gadgets__r</relatedList>");
    expect(preview.warnings.join(" ")).toContain("every profile assigned this layout");

    const result = await applyFix(add, "org");
    expect(result.ok).toBe(true);
    expect(deployedXml()).toContain("<relatedList>Gadgets__r</relatedList>");
    expect(result.undo).toMatchObject({ kind: "setLayoutRelatedList", add: false, relationshipName: "Gadgets__r" });
  });

  it("removes only the named related list on undo", async () => {
    const remove = { ...add, add: false, relationshipName: "Things__r", objectName: "Thing__c" } as StudioFix;
    const result = await applyFix(remove, "org");
    expect(result.ok).toBe(true);
    const xml = deployedXml();
    expect(xml).not.toContain("Things__r");
    expect(xml).toContain("<relatedList>Notes</relatedList>");
    expect(xml.match(/<relatedLists>/g)).toHaveLength(1);
  });

  it("refuses when the list is already there, missing for a removal, or the sidebar is full", async () => {
    expect((await previewFix({ ...add, relationshipName: "Things__r" } as StudioFix, "org")).blocked).toContain("already a related list");
    expect((await previewFix({ ...add, add: false } as StudioFix, "org")).blocked).toContain("no longer a related list");
    stubRetrieve(`<Layout>${"<relatedLists><relatedList>R</relatedList></relatedLists>".repeat(10)}</Layout>`);
    expect((await previewFix(add, "org")).blocked).toContain("holds 10");
    expect(cli.deployMetadata).not.toHaveBeenCalled();
  });

  it("warns when the object has no active DB Schema record", async () => {
    org.LifeSciConfigRecord = [];
    expect((await previewFix(add, "org")).warnings.join(" ")).toContain("No DB Schema record for Gadget__c");
    org.LifeSciConfigRecord = [{ Id: "1LR000000000001", IsActive: false }];
    expect((await previewFix(add, "org")).warnings.join(" ")).toContain("switched off");
  });

  it("reports a failed deploy without claiming success", async () => {
    vi.mocked(cli.deployMetadata).mockResolvedValue({ success: false, error: "bad layout" });
    expect(await applyFix(add, "org")).toMatchObject({ ok: false });
  });

  it("rejects relationship names that aren't plain API names", async () => {
    await expect(previewFix({ ...add, relationshipName: "A</relatedList>" } as StudioFix, "org")).rejects.toThrow();
  });

  it("lists add candidates in the layout item's detail, leaving out lists already on the layout", async () => {
    org.Layout = [{ Id: "00h000000000001", Name: "Visit Layout", TableEnumOrId: "Visit" }];
    vi.mocked(cli.cachedDescribeSObject).mockResolvedValue({
      success: true,
      data: {
        name: "Visit",
        label: "Visit",
        fields: [],
        childRelationships: [
          { childSObject: "Note", relationshipName: "Notes", field: "ParentId" },
          { childSObject: "Zed", relationshipName: "Zeds", field: "VisitId" },
          { childSObject: "Gadget__c", relationshipName: "Gadgets__r", field: "Visit__c" },
          { childSObject: "Hidden", relationshipName: null, field: "VisitId" },
        ],
      },
    });
    const detail = await collectItemDetail("layout", "00h000000000001", "org");
    expect(detail.sidebar).toMatchObject({
      layoutName: "Visit-Visit Layout",
      relatedLists: ["Notes", "Things__r"],
      max: 10,
      candidates: [
        { objectName: "Gadget__c", relationshipName: "Gadgets__r" },
        { objectName: "Zed", relationshipName: "Zeds" },
      ],
    });
  });
});

describe("editMetadata (page layouts)", () => {
  let dir: string;
  let deployed: string | null;
  const XML = fs.readFileSync(path.join(__dirname, "../../fixtures/metadata/PersonAccount-HCP_Layout.layout-meta.xml"), "utf-8");
  const doc = { type: "Layout" as const, fullName: "PersonAccount-HCP Layout", label: "HCP Layout" };
  const fix: StudioFix = {
    kind: "editMetadata",
    label: "Edit HCP Layout",
    doc,
    ops: [
      { op: "moveRelatedList", relatedList: "Visits", before: "ContactPointAddresses" },
      { op: "setFieldBehavior", field: "Type", from: "Edit", to: "Required" },
    ],
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-doc-"));
    deployed = null;
    vi.mocked(cli.retrieveMetadata).mockImplementation(async () => {
      const out = fs.mkdtempSync(path.join(dir, "out-"));
      fs.mkdirSync(path.join(out, "layouts"));
      fs.writeFileSync(path.join(out, "layouts", "PersonAccount-HCP Layout.layout-meta.xml"), XML);
      return { success: true, data: { outputDir: out } };
    });
    vi.mocked(cli.deployMetadata).mockImplementation(async (source) => {
      deployed = fs.readFileSync(source, "utf-8");
      return { success: true };
    });
    org.Layout = [{ Id: "00h000000000001", TableEnumOrId: "Account" }];
    org.ProfileLayout = [{ Profile: { Name: "LS Rep" } }, { Profile: { Name: "LS Manager" } }, { Profile: { Name: "LS Rep" } }];
    org.Organization = [{ IsSandbox: true }];
    org.LifeSciConfigRecord = [];
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("previews each change in words with the XML diff and who it reaches, then deploys the one file", async () => {
    const preview = await previewFix(fix, "org");
    expect(preview.blocked).toBeUndefined();
    expect(preview.changes.map((c) => [c.field, c.before, c.after])).toEqual([
      ["Related list Visits", "Position 11 of 18", "Position 1 of 18"],
      ["Field Type", "Editable", "Required"],
    ]);
    expect(preview.changes[1].diff).toContain("+                 <behavior>Required</behavior>");
    expect(preview.warnings[0]).toBe("Deploys HCP Layout to the org — it's the layout for 2 profiles (LS Manager, LS Rep), and they all get the change.");
    expect(preview.production).toBeUndefined();
    // The retrieve folder is cleaned up.
    expect(fs.readdirSync(dir)).toEqual([]);

    const result = await applyFix(fix, "org");
    expect(result.ok).toBe(true);
    expect(deployed).toContain("<behavior>Required</behavior>\n                <field>Type</field>");
    expect(cli.deployMetadata).toHaveBeenCalledWith(expect.stringMatching(/layout-meta\.xml$/), "org");
    expect(result.undo).toMatchObject({
      kind: "editMetadata",
      ops: [
        { op: "setFieldBehavior", field: "Type", from: "Required", to: "Edit" },
        { op: "moveRelatedList", relatedList: "Visits", before: "AccountAssignedTerritory2sRelatedList" },
      ],
    });
  });

  it("reads the live layout's structure, the profiles using it and whether the org is production", async () => {
    const { readLiveLayout } = await import("../../../src/studio/metadata/live.js");
    const live = await readLiveLayout(doc.fullName, "org");
    expect(live.sections.map((s) => [s.label, s.nth, s.heading, s.columns.map((c) => c.length)])).toEqual([
      ["Account Information", 0, true, [3, 2]],
      ["Additional Information", 0, true, [2, 0]],
      ["Description Information", 0, false, [0]],
      ["Custom Links", 0, false, [0, 0, 0]],
    ]);
    expect(live.sections[0].columns[0][0]).toEqual({ field: "Name", behavior: "Required" });
    expect(live.relatedLists).toHaveLength(18);
    expect(live.profiles).toEqual(["LS Manager", "LS Rep"]);
    expect(live.production).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("flags production orgs", async () => {
    org.Organization = [{ IsSandbox: false }];
    expect((await previewFix(fix, "org")).production).toBe(true);
  });

  it("refuses when the layout changed since the preview was loaded", async () => {
    const stale: StudioFix = { ...fix, ops: [{ op: "removeField", field: "Gone__c" }] };
    const preview = await previewFix(stale, "org");
    expect(preview.blocked).toBe("HCP Layout changed since the preview was loaded: Gone__c isn't on the layout. Refresh the preview.");
    expect((await applyFix(stale, "org")).ok).toBe(false);
    expect(cli.deployMetadata).not.toHaveBeenCalled();
  });

  it("warns when an added related list's object doesn't sync", async () => {
    const addList: StudioFix = { ...fix, ops: [{ op: "addRelatedList", relatedList: "Gadgets__r", before: null, object: "Gadget__c" }] };
    const preview = await previewFix(addList, "org");
    expect(preview.warnings.join(" ")).toContain("No DB Schema record for Gadget__c");
  });

  it("caps a Visit layout's related lists at the sidebar's 10", async () => {
    const visit: StudioFix = {
      ...fix,
      doc: { ...doc, fullName: "Visit-Visit Layout" },
      ops: [{ op: "addRelatedList", relatedList: "Gadgets__r", before: null }],
    };
    expect((await previewFix(visit, "org")).blocked).toMatch(/would have 19 related lists/);
  });

  it("reports a failed deploy without claiming success", async () => {
    vi.mocked(cli.deployMetadata).mockResolvedValue({ success: false, error: "INVALID_FIELD" });
    const result = await applyFix(fix, "org");
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/INVALID_FIELD.*Nothing was changed/);
  });
});

describe("editMetadata (compact layouts)", () => {
  let dir: string;
  let deployed: string | null;
  const XML = fs.readFileSync(path.join(__dirname, "../../fixtures/metadata/Account_Layout.compactLayout-meta.xml"), "utf-8");
  const doc = { type: "CompactLayout" as const, fullName: "Account.Account_Layout", label: "Account" };
  const fix: StudioFix = {
    kind: "editMetadata",
    label: "Edit compact layout Account",
    doc,
    ops: [
      { op: "removeCompactField", field: "NumberOfEmployees" },
      { op: "addCompactField", field: "Phone", before: "AccountNumber" },
    ],
  };
  const mappings = (names: [string, string][]) => ({
    success: true,
    data: { recordTypeCompactLayoutMappings: names.map(([compactLayoutName, recordTypeName]) => ({ compactLayoutName, recordTypeName })) },
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-doc-"));
    deployed = null;
    vi.mocked(cli.retrieveMetadata).mockImplementation(async () => {
      const out = fs.mkdtempSync(path.join(dir, "out-"));
      fs.mkdirSync(path.join(out, "compactLayouts"));
      fs.writeFileSync(path.join(out, "compactLayouts", "Account.Account_Layout.compactLayout-meta.xml"), XML);
      return { success: true, data: { outputDir: out } };
    });
    vi.mocked(cli.deployMetadata).mockImplementation(async (source) => {
      deployed = fs.readFileSync(source, "utf-8");
      return { success: true };
    });
    vi.mocked(cli.apiRequest).mockResolvedValue(
      mappings([
        ["Account_Layout", "HCP"],
        ["Account_Layout", "HCO"],
        ["Other", "Master"],
      ]) as never
    );
    org.Organization = [{ IsSandbox: true }];
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("previews the field changes with the XML diff and the record types it reaches, then deploys with an undo", async () => {
    const preview = await previewFix(fix, "org");
    expect(preview.blocked).toBeUndefined();
    expect(preview.changes.map((c) => [c.field, c.before, c.after])).toEqual([
      ["Field NumberOfEmployees", "Position 6 of 7", "(removed)"],
      ["Field Phone", "(not on the compact layout)", "Position 2 of 7"],
    ]);
    expect(preview.changes[1].diff).toEqual(expect.arrayContaining(["+     <fields>Phone</fields>", "-     <fields>NumberOfEmployees</fields>"]));
    expect(preview.warnings[0]).toBe("Deploys Account to the org — it's the compact layout for 2 record types (HCO, HCP), for every profile.");
    expect(cli.apiRequest).toHaveBeenCalledWith("/services/data/v66.0/sobjects/Account/describe/compactLayouts", "GET", undefined, "org");

    const result = await applyFix(fix, "org");
    expect(result.ok).toBe(true);
    expect(deployed).toContain("<fields>Name</fields>\n    <fields>Phone</fields>\n    <fields>AccountNumber</fields>");
    expect(deployed).not.toContain("NumberOfEmployees");
    expect(cli.deployMetadata).toHaveBeenCalledWith(expect.stringMatching(/compactLayout-meta\.xml$/), "org");
    expect(result.undo).toMatchObject({
      kind: "editMetadata",
      doc,
      ops: [
        { op: "removeCompactField", field: "Phone" },
        { op: "addCompactField", field: "NumberOfEmployees", before: "SDO_Days_Since_Activity__c" },
      ],
    });
  });

  it("reads the live compact layout: fields, fields that could be added, record types, production", async () => {
    vi.mocked(cli.describeSObject).mockResolvedValue({
      success: true,
      data: {
        name: "Account",
        label: "Account",
        fields: [
          { name: "Phone", label: "Phone", type: "phone", required: false, updateable: true, createable: true },
          { name: "Description", label: "Description", type: "textarea", required: false, updateable: true, createable: true },
          { name: "Id", label: "Account ID", type: "id", required: false, updateable: false, createable: false },
        ],
      },
    });
    org.Organization = [{ IsSandbox: false }];
    const { readLiveCompactLayout } = await import("../../../src/studio/metadata/live.js");
    const live = await readLiveCompactLayout(doc.fullName, "org");
    expect(live).toMatchObject({ type: "CompactLayout", fullName: doc.fullName, label: "Account", recordTypes: ["HCO", "HCP"], production: true });
    expect(live.fields).toHaveLength(7);
    expect(live.available).toEqual([{ name: "Phone", label: "Phone", type: "phone" }]);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("says when no record type is assigned it", async () => {
    vi.mocked(cli.apiRequest).mockResolvedValue(mappings([["Other", "Master"]]) as never);
    expect((await previewFix(fix, "org")).warnings[0]).toBe("Deploys Account to the org. No record type is assigned this compact layout.");
  });

  it("refuses when the compact layout changed, page layout ops, and bad names", async () => {
    const stale: StudioFix = { ...fix, ops: [{ op: "removeCompactField", field: "Gone__c" }] };
    expect((await previewFix(stale, "org")).blocked).toBe(
      "Account changed since the preview was loaded: Gone__c isn't on the compact layout. Refresh the preview."
    );
    const wrong = { ...fix, ops: [{ op: "removeField", field: "Type" }] } as unknown as StudioFix;
    expect((await previewFix(wrong, "org")).blocked).toBe("These edits don't apply to a CompactLayout.");
    const bad: StudioFix = { ...fix, doc: { ...doc, fullName: "Account-Account Layout" } };
    expect((await previewFix(bad, "org")).blocked).toMatch(/Invalid compact layout name/);
    expect((await applyFix(stale, "org")).ok).toBe(false);
    expect(cli.deployMetadata).not.toHaveBeenCalled();
  });
});
