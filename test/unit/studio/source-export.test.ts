import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const retrieveMetadata = vi.fn();
const query = vi.fn();
const appsReferencingPage = vi.fn();
vi.mock("../../../src/salesforce/cli.js", () => ({ retrieveMetadata: (...a: unknown[]) => retrieveMetadata(...a) }));
vi.mock("../../../src/studio/helpers.js", async (orig) => ({
  ...(await orig<typeof import("../../../src/studio/helpers.js")>()),
  query: (...a: unknown[]) => query(...a),
}));
vi.mock("../../../src/studio/metadata/live.js", () => ({ appsReferencingPage: (...a: unknown[]) => appsReferencingPage(...a) }));

import {
  buildPackageXml,
  exportSource,
  mergeProfileAssignments,
  orgOnlyReason,
  packageRoot,
  planSourceExport,
  sourcePathFor,
} from "../../../src/studio/source-export.js";
import { orgOnlyReason as rendererOrgOnlyReason, savedSummary } from "../../../src-renderer/components/studio/source-control.js";
import type { StudioFix } from "../../../src/studio/types.js";

const fix = (f: Record<string, unknown>) => ({ label: String(f.kind), ...f }) as unknown as StudioFix;

const FIXES: StudioFix[] = [
  fix({ kind: "assignPsl", userId: "005", userName: "Carmen", pslId: "0PL", pslLabel: "LSC" }),
  fix({ kind: "removePsl", userId: "005", userName: "Carmen", pslId: "0PL", pslLabel: "LSC" }),
  fix({ kind: "assignAccess", userId: "005", userName: "Carmen", access: {} }),
  fix({ kind: "removeAccess", userId: "005", userName: "Carmen", access: {}, assignmentId: "0Pa" }),
  fix({ kind: "setCustomScriptCode", scriptId: "1", scriptName: "Check" }),
  fix({ kind: "setActive", record: { type: "triggerHandler", developerName: "DCR", label: "DCR" }, from: false, to: true }),
  fix({ kind: "setActive", record: { type: "config", category: "DbSchema", developerName: "DbSchema_Visit", label: "Visit" } }),
  fix({ kind: "setActive", record: { type: "validationRule", id: "03d000000000001", label: "Rule" } }),
  fix({ kind: "setConfigField", category: "DbSchema", developerName: "DbSchema_Account" }),
  fix({ kind: "setProfileAssignments", category: "UISchema", developerName: "Tab_Home" }),
  fix({ kind: "createConfigRecord", category: "DbSchema", developerName: "DbSchema_New" }),
  fix({ kind: "deleteConfigRecord", category: "DbSchema", developerName: "DbSchema_Old" }),
  fix({ kind: "setLayoutRelatedList", layoutName: "Visit-Visit Layout" }),
  fix({ kind: "editMetadata", doc: { type: "CompactLayout", fullName: "Account.HCP_Compact", label: "HCP" }, ops: [] }),
  fix({ kind: "editMetadata", doc: { type: "ListView", fullName: "Account.My_HCPs", label: "My HCPs" }, ops: [] }),
  fix({ kind: "editMetadata", doc: { type: "Layout", fullName: "Visit-Visit Layout", label: "Visit" }, ops: [] }),
];

describe("planSourceExport", () => {
  it("maps each change to its source document, deduplicated, and explains org-only ones", () => {
    const plan = planSourceExport(FIXES);
    expect(plan.items).toEqual([
      { type: "LifeSciConfigRecord", fullName: "DbSchema_Visit" },
      { type: "LifeSciConfigRecord", fullName: "DbSchema_Account" },
      { type: "LifeSciConfigRecord", fullName: "Tab_Home" },
      { type: "LifeSciConfigRecord", fullName: "DbSchema_New" },
      { type: "Layout", fullName: "Visit-Visit Layout" },
      { type: "CompactLayout", fullName: "Account.HCP_Compact" },
      { type: "ListView", fullName: "Account.My_HCPs" },
    ]);
    expect(plan.validationRuleIds).toEqual(["03d000000000001"]);
    expect(plan.removed).toEqual([{ type: "LifeSciConfigRecord", fullName: "DbSchema_Old" }]);
    expect(plan.orgOnly.map((o) => o.label)).toEqual([
      "assignPsl",
      "removePsl",
      "assignAccess",
      "removeAccess",
      "setCustomScriptCode",
      "setActive",
    ]);
    expect(plan.orgOnly.every((o) => o.why.length > 20)).toBe(true);
  });

  it("a layout copied for a profile saves the copy, the source and the profile's assignments", () => {
    const plan = planSourceExport([
      fix({
        kind: "copyForProfile",
        doc: { type: "Layout", fullName: "Account-HCP Layout", label: "HCP" },
        copy: { fullName: "Account-HCP Layout (Rep)", label: "HCP (Rep)" },
        profile: "System Administrator",
      }),
    ]);
    expect(plan.items).toEqual([
      { type: "Layout", fullName: "Account-HCP Layout (Rep)" },
      { type: "Layout", fullName: "Account-HCP Layout" },
      { type: "Profile", fullName: "Admin" },
    ]);
  });

  it("a page copy finds its apps at export; its undo removes the copy", () => {
    const copy = {
      kind: "copyForProfile",
      doc: { type: "FlexiPage", fullName: "HCP_Page", label: "HCP" },
      copy: { fullName: "HCP_Page_Rep", label: "HCP (Rep)" },
      profile: "Rep",
    };
    expect(planSourceExport([fix(copy)])).toMatchObject({ items: [{ type: "FlexiPage", fullName: "HCP_Page_Rep" }], pageCopies: ["HCP_Page_Rep"] });
    const undone = planSourceExport([fix(copy), fix({ ...copy, revert: { moves: [] } })]);
    expect(undone.items).toEqual([]);
    expect(undone.removed).toEqual([{ type: "FlexiPage", fullName: "HCP_Page_Rep" }]);
    expect(undone.pageCopies).toEqual(["HCP_Page_Rep", "HCP_Page"]);
  });

  it("a record created then deleted is only removed", () => {
    const plan = planSourceExport([
      fix({ kind: "createConfigRecord", developerName: "X" }),
      fix({ kind: "deleteConfigRecord", developerName: "X" }),
    ]);
    expect(plan.items).toEqual([]);
    expect(plan.removed).toEqual([{ type: "LifeSciConfigRecord", fullName: "X" }]);
  });
});

describe("renderer copy", () => {
  it("orgOnlyReason matches the server's for every kind", () => {
    for (const f of FIXES) expect(rendererOrgOnlyReason(f as never)).toBe(orgOnlyReason(f));
  });

  it("savedSummary shortens the home folder", () => {
    expect(savedSummary({ folder: "/Users/sam/proj", files: [{}, {}] } as never)).toBe("Saved 2 files to ~/proj");
  });
});

describe("sourcePathFor", () => {
  it.each([
    [{ type: "Layout", fullName: "Account-HCP Layout" }, "layouts/Account-HCP Layout.layout-meta.xml"],
    [{ type: "FlexiPage", fullName: "HCP_Page" }, "flexipages/HCP_Page.flexipage-meta.xml"],
    [{ type: "CustomApplication", fullName: "LSC_App" }, "applications/LSC_App.app-meta.xml"],
    [{ type: "Profile", fullName: "Admin" }, "profiles/Admin.profile-meta.xml"],
    [{ type: "LifeSciConfigRecord", fullName: "DbSchema_Visit" }, "lifeSciConfigRecords/DbSchema_Visit.lifeSciConfigRecord-meta.xml"],
    [{ type: "CompactLayout", fullName: "Account.HCP_Compact" }, "objects/Account/compactLayouts/HCP_Compact.compactLayout-meta.xml"],
    [{ type: "ListView", fullName: "Account.My_HCPs" }, "objects/Account/listViews/My_HCPs.listView-meta.xml"],
    [{ type: "ValidationRule", fullName: "Visit.Needs_Date" }, "objects/Visit/validationRules/Needs_Date.validationRule-meta.xml"],
  ] as const)("%o → %s", (item, expected) => {
    expect(sourcePathFor(item)).toBe(expected);
  });

  it("refuses an object-child name without its object", () => {
    expect(() => sourcePathFor({ type: "ListView", fullName: "My_HCPs" })).toThrow(/Object\.Name/);
  });
});

describe("buildPackageXml", () => {
  it("groups members by type, sorted, and escapes names", () => {
    expect(
      buildPackageXml([
        { type: "Layout", fullName: "Visit-Visit Layout" },
        { type: "LifeSciConfigRecord", fullName: "DbSchema_Visit" },
        { type: "Layout", fullName: "Account-R&D Layout" },
        { type: "Layout", fullName: "Visit-Visit Layout" },
      ])
    ).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>Account-R&amp;D Layout</members>
        <members>Visit-Visit Layout</members>
        <name>Layout</name>
    </types>
    <types>
        <members>DbSchema_Visit</members>
        <name>LifeSciConfigRecord</name>
    </types>
    <version>66.0</version>
</Package>
`);
  });
});

describe("packageRoot", () => {
  let dir: string;
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "src-export-"))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("uses force-app with no project file, else the default package", () => {
    expect(packageRoot(dir)).toBe(path.join(dir, "force-app", "main", "default"));
    fs.writeFileSync(
      path.join(dir, "sfdx-project.json"),
      JSON.stringify({ packageDirectories: [{ path: "core" }, { path: "lsc", default: true }] })
    );
    expect(packageRoot(dir)).toBe(path.join(dir, "lsc", "main", "default"));
  });

  it("refuses a package folder outside the project", () => {
    fs.writeFileSync(path.join(dir, "sfdx-project.json"), JSON.stringify({ packageDirectories: [{ path: "../elsewhere" }] }));
    expect(() => packageRoot(dir)).toThrow(/outside/);
  });
});

const FULL_PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <custom>false</custom>
    <layoutAssignments>
        <layout>Account-HCP Layout</layout>
        <recordType>Account.HCP</recordType>
    </layoutAssignments>
    <layoutAssignments>
        <layout>Visit-Visit Layout</layout>
    </layoutAssignments>
    <userLicense>Salesforce</userLicense>
</Profile>
`;

const RETRIEVED_PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <custom>false</custom>
    <layoutAssignments>
        <layout>Account-HCP Layout (Rep)</layout>
        <recordType>Account.HCP</recordType>
    </layoutAssignments>
    <layoutAssignments>
        <layout>Account-HCP Layout</layout>
        <recordType>Account.KOL</recordType>
    </layoutAssignments>
</Profile>
`;

describe("mergeProfileAssignments", () => {
  it("replaces only the assignments to the retrieved layouts and keeps the rest of the file", () => {
    const merged = mergeProfileAssignments(FULL_PROFILE, RETRIEVED_PROFILE);
    expect(merged).toContain("<userLicense>Salesforce</userLicense>");
    expect(merged).toContain("<layout>Visit-Visit Layout</layout>");
    expect(merged.match(/<layoutAssignments>/g)).toHaveLength(3);
    expect(merged).toContain("<recordType>Account.KOL</recordType>");
    expect(merged.indexOf("Account-HCP Layout (Rep)")).toBeLessThan(merged.indexOf("Visit-Visit Layout"));
    expect(merged.indexOf("<custom>")).toBeLessThan(merged.indexOf("<layoutAssignments>"));
  });

  it("puts assignments in tag order when the file had none", () => {
    const merged = mergeProfileAssignments(FULL_PROFILE.replace(/ {4}<layoutAssignments>[\s\S]*?<\/layoutAssignments>\n/g, ""), RETRIEVED_PROFILE);
    expect(merged.indexOf("<layoutAssignments>")).toBeGreaterThan(merged.indexOf("<custom>"));
    expect(merged.indexOf("<layoutAssignments>")).toBeLessThan(merged.indexOf("<userLicense>"));
  });
});

describe("exportSource", () => {
  let project: string;
  let out: string;
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), text);
  };

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), "src-export-proj-"));
    out = fs.mkdtempSync(path.join(os.tmpdir(), "src-export-out-"));
    retrieveMetadata.mockReset();
    query.mockReset();
    appsReferencingPage.mockReset();
  });
  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  });

  it("writes retrieved files into the package, merges the profile and writes the manifest", async () => {
    fs.mkdirSync(path.join(project, "force-app/main/default/profiles"), { recursive: true });
    fs.writeFileSync(path.join(project, "force-app/main/default/profiles/Admin.profile-meta.xml"), FULL_PROFILE);
    write("layouts/Account-HCP Layout.layout-meta.xml", "<Layout/>");
    write("layouts/Account-HCP Layout %28Rep%29.layout-meta.xml", "<Layout/>");
    write("profiles/Admin.profile-meta.xml", RETRIEVED_PROFILE);
    write("objects/Visit/validationRules/Needs_Date.validationRule-meta.xml", "<ValidationRule/>");
    retrieveMetadata.mockResolvedValue({ success: true, data: { outputDir: out } });
    query.mockResolvedValue([{ Id: "03d", ValidationName: "Needs_Date", EntityDefinition: { QualifiedApiName: "Visit" } }]);

    const result = await exportSource(
      {
        folder: project,
        changes: [
          fix({
            kind: "copyForProfile",
            doc: { type: "Layout", fullName: "Account-HCP Layout", label: "HCP" },
            copy: { fullName: "Account-HCP Layout (Rep)", label: "HCP (Rep)" },
            profile: "System Administrator",
          }),
          fix({ kind: "setActive", record: { type: "validationRule", id: "03d", label: "Rule" } }),
          fix({ kind: "assignPsl", label: "Give Carmen LSC" }),
          fix({ kind: "deleteConfigRecord", developerName: "DbSchema_Old" }),
        ],
        items: [{ type: "LifeSciConfigRecord", fullName: "Gone" }],
      },
      "org"
    );

    expect(query.mock.calls[0][0]).toContain("WHERE Id IN ('03d')");
    expect(result.packageDir).toBe("force-app/main/default");
    expect(result.files).toEqual([
      { type: "Layout", fullName: "Account-HCP Layout (Rep)", path: "force-app/main/default/layouts/Account-HCP Layout %28Rep%29.layout-meta.xml", status: "written" },
      { type: "Layout", fullName: "Account-HCP Layout", path: "force-app/main/default/layouts/Account-HCP Layout.layout-meta.xml", status: "written" },
      { type: "Profile", fullName: "Admin", path: "force-app/main/default/profiles/Admin.profile-meta.xml", status: "merged" },
      {
        type: "ValidationRule",
        fullName: "Visit.Needs_Date",
        path: "force-app/main/default/objects/Visit/validationRules/Needs_Date.validationRule-meta.xml",
        status: "written",
      },
    ]);
    expect(result.missing).toEqual([{ type: "LifeSciConfigRecord", fullName: "Gone" }]);
    expect(result.orgOnly).toEqual([{ label: "Give Carmen LSC", why: expect.stringContaining("license") }]);
    expect(result.toRemove).toEqual([
      {
        type: "LifeSciConfigRecord",
        fullName: "DbSchema_Old",
        path: "force-app/main/default/lifeSciConfigRecords/DbSchema_Old.lifeSciConfigRecord-meta.xml",
        exists: false,
      },
    ]);
    expect(result.manifest).toBe("manifest/studio-package.xml");
    const manifest = fs.readFileSync(path.join(project, "manifest/studio-package.xml"), "utf-8");
    expect(manifest).toContain("<members>Visit.Needs_Date</members>");
    expect(manifest).not.toContain("Gone");
    const profile = fs.readFileSync(path.join(project, "force-app/main/default/profiles/Admin.profile-meta.xml"), "utf-8");
    expect(profile).toContain("<userLicense>Salesforce</userLicense>");
    expect(fs.existsSync(out)).toBe(false);
  });

  it("retrieves direct-capable and CLI-only types in separate calls", async () => {
    retrieveMetadata.mockResolvedValue({ success: true, data: { outputDir: out } });
    await exportSource(
      {
        folder: project,
        items: [
          { type: "Layout", fullName: "Visit-Visit Layout" },
          { type: "LifeSciConfigRecord", fullName: "DbSchema_Visit" },
        ],
      },
      "org"
    );
    expect(retrieveMetadata.mock.calls.map((c) => c[1])).toEqual([["Layout:Visit-Visit Layout"], ["LifeSciConfigRecord:DbSchema_Visit"]]);
  });

  it("with only org-only changes, retrieves nothing and writes no manifest", async () => {
    const result = await exportSource({ folder: project, changes: [fix({ kind: "assignPsl" })] }, "org");
    expect(retrieveMetadata).not.toHaveBeenCalled();
    expect(result.manifest).toBeNull();
    expect(result.orgOnly).toHaveLength(1);
  });

  it("refuses a relative or missing folder", async () => {
    await expect(exportSource({ folder: "proj" }, "org")).rejects.toThrow(/full path/);
    await expect(exportSource({ folder: path.join(project, "nope") }, "org")).rejects.toThrow(/isn't a folder/);
  });
});
