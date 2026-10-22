import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../src/config/types.js";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
}));
vi.mock("../../../src/config/collect.js", () => ({
  collectCategoryRecords: vi.fn(),
}));

const { runSoqlQuery } = await import("../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../src/config/collect.js");
const { collectBriefings } = await import("../../../src/studio/collectors/briefings.js");

type Row = Record<string, unknown>;

/** Rows per query, matched by a distinctive substring of the SOQL; an Error value makes it fail. */
let responses: [string, Row[] | Error][];
let dbSchema: ConfigRecord[];

function respond(soql: string) {
  const hit = responses.find(([needle]) => soql.includes(needle));
  const rows = hit?.[1] ?? [];
  if (rows instanceof Error) return Promise.resolve({ success: false, error: rows.message });
  return Promise.resolve({ success: true, data: { totalSize: rows.length, done: true, records: rows } });
}

function dbRec(object: string, active = true, profiles = ["Rep"]): ConfigRecord {
  return {
    category: "DbSchema",
    developerName: `DbSchema_${object}`,
    label: `DbSchema ${object}`,
    isActive: active,
    isOrgLevel: false,
    fields: { SObject: object, Type: "DATA" },
    fieldTypes: {},
    assignments: profiles.map((name) => ({ name, level: "Profile" })),
  } as ConfigRecord;
}

const NOT_SUPPORTED = new Error("sObject type 'PresentationContent' is not supported.");

const STANDARD = ["HealthCloudStarter", "EinsteinGPTPromptTemplateManager", "EinsteinGPTPromptTemplateUser", "AccsAgtfrceForLifeSciCustEngmt"];

/** A healthy org: toggle on, one definition assigned to "Rep", content, flows, permissions, sync, cache. */
function healthy(): [string, Row[] | Error][] {
  return [
    ["FROM PermissionSetLicense", [
      ...[
        ["IndustriesLSC4CEPsl", "Life Science Commercial"],
        ["HealthCloudStarter", "Health Cloud Starter"],
        ["SiteMgmtSiteSelAssistanceAgentPsl", "Agentforce for Life Sciences Cloud Feature Access"],
        ["EinsteinGPTPromptTemplatesPsl", "Einstein Prompt Templates"],
      ].map(([DeveloperName, MasterLabel], i) => ({ Id: `0PL${i}`, DeveloperName, MasterLabel, TotalLicenses: 10, UsedLicenses: 2 })),
    ]],
    ["FROM PrstContentDefinition", [{ Id: "1fa1", DeveloperName: "Def", MasterLabel: "Daily", IsActive: true, ContentType: "Podcast" }]],
    ["FROM PrstCntntDefAssignment", [{ Id: "1fb1", IsActive: true, AssignedToId: "00e1", AssignedTo: { Name: "Rep" }, PrstContentDefinition: { MasterLabel: "Daily" } }]],
    ["MAX(CreatedDate)", [{ pn: "Rep", cnt: 5, latest: new Date().toISOString() }]],
    ["LIKE '%Briefing%'", [
      { Label: "Briefings: Generate Daily Briefings Text", ApiName: "GenDailyBriefingsText", ActiveVersionId: "v1", ProcessType: "AutoLaunchedFlow" },
      { Label: "Briefings: Schedule Daily Briefings of Provider Accounts", ApiName: "SchdDlyBriefingsOfPrvdAcct", ActiveVersionId: null, ProcessType: "AutoLaunchedFlow" },
      { Label: "My Daily Schedule", ApiName: "My_Briefings_Schedule", ActiveVersionId: "v2", ProcessType: "AutoLaunchedFlow" },
    ]],
    ["Generate Provider Account Territory Summary", [{ Label: "Generate Provider Account Territory Summary", ApiName: "Sum", ActiveVersionId: "v3", ProcessType: "AutoLaunchedFlow" }]],
    ["FROM PrvdAccountTerritorySummary", [{ expr0: 4 }]],
    ["FROM PermissionSet WHERE (", [
      { Id: "0PS1", Label: "Use Briefings", Name: "UseB", PermissionsStoriesAdmin: false, PermissionsStoriesUser: true },
      { Id: "0PS2", Label: "Manage Briefings", Name: "ManB", PermissionsStoriesAdmin: true, PermissionsStoriesUser: false },
    ]],
    ["GROUP BY PermissionSet.Label", [{ lbl: "Use Briefings", cnt: 3 }, { lbl: "Manage Briefings", cnt: 1 }]],
    ["FROM PermissionSet WHERE Name IN", STANDARD.map((Name, i) => ({ Id: `0PSS${i}`, Name }))],
    ["GROUP BY PermissionSetId", STANDARD.map((_, i) => ({ psid: `0PSS${i}`, cnt: 1 }))],
    ["FROM ObjectPermissions", [{ ParentId: "0PS1" }]],
    ["GROUP BY Assignee.Profile.Name", [{ pn: "Rep", cnt: 3 }]],
    ["FROM LifeSciMobileMetadataRecord", [{ Id: "m1", Name: "Cache", Status: "Active", IntegrationStatus: "Success", LastModifiedDate: "2026-06-01", ProfileId: "00e1" }]],
    ["FROM Profile WHERE Id IN", [{ Id: "00e1", Name: "Rep" }]],
    ["ORDER BY CreatedDate DESC LIMIT 1", [{ CreatedDate: new Date().toISOString() }]],
    // One row of PresentationContent (the toggle probe)
    ["SELECT Id FROM PresentationContent LIMIT 1", [{ Id: "0pc1" }]],
  ];
}

function set(needle: string, value: Row[] | Error) {
  responses = [[needle, value], ...responses];
}

const surface = (r: Awaited<ReturnType<typeof collectBriefings>>, id: string) => r.surfaces.find((s) => s.id === id)!;
const titles = (s: { findings: { title: string }[]; items: { findings: { title: string }[] }[] }) =>
  [...s.findings, ...s.items.flatMap((i) => i.findings)].map((f) => f.title);

beforeEach(() => {
  responses = healthy();
  dbSchema = ["PresentationContent", "PrstCntntUsageSummary", "PrstCntntDefAssignment", "PrstContentDefinition"].map((o) => dbRec(o));
  vi.mocked(runSoqlQuery).mockImplementation(((soql: string) => respond(soql)) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((() => Promise.resolve(dbSchema)) as never);
});

describe("collectBriefings", () => {
  it("returns every surface with no errors or serious findings for a healthy org", async () => {
    const r = await collectBriefings("org");
    expect(r.surfaces.map((s) => s.id)).toEqual([
      "toggle", "licenses", "accountSummarization", "flows", "definitions", "assignments", "generated", "permissionSets", "syncSchema", "metadataCache",
    ]);
    for (const s of r.surfaces) {
      expect(s.error).toBeUndefined();
      expect(titles(s).length === 0 || s.id === "permissionSets").toBe(true);
    }
    expect(r.summary).toBe("On · 1 assigned profile");
    expect(r.checkTitle).toBe("Briefings readiness");
    const surfaceIds = new Set(r.surfaces.map((s) => s.id));
    expect(r.checklist!.every((c) => surfaceIds.has(c.surface))).toBe(true);
  });

  it("never counts or aggregates the whole PresentationContent table", async () => {
    await collectBriefings("org");
    const content = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0])).filter((q) => q.includes("FROM PresentationContent"));
    expect(content.some((q) => q.includes("COUNT()"))).toBe(false);
    for (const q of content.filter((q) => q.includes("GROUP BY"))) expect(q).toContain("CreatedDate = LAST_N_DAYS:30");
    expect(content.filter((q) => !q.includes("GROUP BY")).every((q) => /LIMIT 1$/.test(q))).toBe(true);
  });

  it("makes assigned profiles checkable with an audience", async () => {
    const r = await collectBriefings("org");
    const rep = surface(r, "assignments").items[0];
    expect(rep.label).toBe("Rep");
    expect(rep.checkProfile).toBe("Rep");
    expect(rep.audience).toEqual({ profiles: ["Rep"], permissionSets: [] });
    expect(rep.properties["Users with Use Briefings"]).toBe(3);
    expect(surface(r, "metadataCache").items[0].audience?.profiles).toEqual(["Rep"]);
  });

  it("reports the toggle off and skips the dependent surfaces gracefully", async () => {
    for (const needle of ["SELECT Id FROM PresentationContent LIMIT 1", "FROM PrstContentDefinition", "FROM PrstCntntDefAssignment", "MAX(CreatedDate)", "ORDER BY CreatedDate DESC LIMIT 1", "FROM PrvdAccountTerritorySummary", "FROM ObjectPermissions"]) {
      set(needle, NOT_SUPPORTED);
    }
    const r = await collectBriefings("org");
    expect(r.summary).toMatch(/^Off/);
    expect(titles(surface(r, "toggle"))).toContain("Briefings toggle is off");
    expect(surface(r, "definitions").findings[0].title).toBe("Briefings is turned off");
    expect(surface(r, "assignments").error).toBeUndefined();
    expect(surface(r, "generated").error).toBeUndefined();
  });

  it("flags missing license, no definition, and no assignments", async () => {
    set("FROM PermissionSetLicense", [{ Id: "0PL1", DeveloperName: "IndustriesLSC4CEPsl", MasterLabel: "Life Science Commercial", TotalLicenses: 0, UsedLicenses: 0 }]);
    set("FROM PrstContentDefinition", []);
    set("FROM PrstCntntDefAssignment", []);
    const r = await collectBriefings("org");
    expect(titles(surface(r, "licenses"))).toEqual(expect.arrayContaining(["No licenses provisioned", "3 licenses not found"]));
    expect(surface(r, "definitions").findings[0].title).toBe("No active content definition");
    expect(surface(r, "assignments").findings[0].title).toBe("No active content definition assignments");
  });

  it("matches licenses by developer name, whatever their label", async () => {
    let soql = "";
    vi.mocked(runSoqlQuery).mockImplementation(((q: string) => {
      if (q.includes("FROM PermissionSetLicense")) soql = q;
      return respond(q);
    }) as never);
    const s = surface(await collectBriefings("org"), "licenses");
    expect(soql).toContain("DeveloperName IN ('IndustriesLSC4CEPsl','HealthCloudStarter','SiteMgmtSiteSelAssistanceAgentPsl','EinsteinGPTPromptTemplatesPsl')");
    expect(titles(s)).toEqual([]);
    expect(s.items.map((i) => i.label)).toContain("Agentforce for Life Sciences Cloud Feature Access");
  });

  it("counts standard permission set assignments by permission set id", async () => {
    set("GROUP BY PermissionSetId", [{ psid: "0PSS0", cnt: 8 }]);
    const items = surface(await collectBriefings("org"), "permissionSets").items;
    expect(items.find((i) => i.id === "standard:HealthCloudStarter")!.properties.Assignments).toBe(8);
    expect(items.find((i) => i.id === "standard:EinsteinGPTPromptTemplateUser")!.findings[0].title).toBe("No direct assignments");
  });

  it("flags missing Use / Manage Briefings permission sets", async () => {
    set("FROM PermissionSet WHERE (", []);
    const s = surface(await collectBriefings("org"), "permissionSets");
    expect(s.findings.map((f) => f.title)).toEqual(
      expect.arrayContaining(["No permission set grants Use Briefings", "No permission set grants Manage Briefings"])
    );
    expect(s.findings.find((f) => f.title.includes("Use Briefings"))!.severity).toBe("error");
  });

  it("warns on an assigned profile with no Use Briefings users", async () => {
    set("GROUP BY Assignee.Profile.Name", []);
    const rep = surface(await collectBriefings("org"), "assignments").items[0];
    expect(rep.findings.map((f) => f.title)).toContain("No users have Use Briefings");
  });

  it("warns when the schedule template is active and when no schedule is active", async () => {
    set("LIKE '%Briefing%'", [
      { Label: "Briefings: Schedule Daily Briefings of Provider Accounts", ApiName: "SchdDlyBriefingsOfPrvdAcct", ActiveVersionId: "v1", ProcessType: "AutoLaunchedFlow" },
    ]);
    let flows = surface(await collectBriefings("org"), "flows");
    expect(titles(flows)).toContain("Template flow is active");
    expect(titles(flows)).toContain("Generate Daily Briefings Text flow not found");

    set("LIKE '%Briefing%'", [
      { Label: "Briefings: Generate Daily Briefings Text", ApiName: "GenDailyBriefingsText", ActiveVersionId: null, ProcessType: "AutoLaunchedFlow" },
      { Label: "Briefings: Schedule Daily Briefings of Provider Accounts", ApiName: "SchdDlyBriefingsOfPrvdAcct", ActiveVersionId: null, ProcessType: "AutoLaunchedFlow" },
    ]);
    flows = surface(await collectBriefings("org"), "flows");
    expect(titles(flows)).toEqual(expect.arrayContaining(["Generate Daily Briefings Text flow isn't active", "No active scheduled flow"]));
  });

  it("flags empty account summarization and stale content", async () => {
    set("FROM PrvdAccountTerritorySummary", []);
    set("MAX(CreatedDate)", []);
    set("ORDER BY CreatedDate DESC LIMIT 1", [{ CreatedDate: "2026-01-01T00:00:00.000+0000" }]);
    const r = await collectBriefings("org");
    expect(titles(surface(r, "accountSummarization"))).toContain("No summary records");
    expect(titles(surface(r, "generated"))).toContain("No new briefings in 3+ days");
  });

  it("offers setActive for an inactive DB Schema record", async () => {
    dbSchema[1] = dbRec("PrstCntntUsageSummary", false);
    const s = surface(await collectBriefings("org"), "syncSchema");
    const finding = s.items.find((i) => i.label === "PrstCntntUsageSummary")!.findings[0];
    expect(finding.title).toBe("Sync is disabled");
    expect(finding.fixes).toEqual([
      expect.objectContaining({ kind: "setActive", from: false, to: true, record: expect.objectContaining({ category: "DbSchema", developerName: "DbSchema_PrstCntntUsageSummary" }) }),
    ]);
    expect(s.items[1].edit?.active).toBe(false);
  });

  it("offers to create a missing DB Schema record for the assigned profiles", async () => {
    dbSchema = dbSchema.filter((r) => r.fields.SObject !== "PresentationContent");
    const s = surface(await collectBriefings("org"), "syncSchema");
    const finding = s.findings.find((f) => f.title === "PresentationContent isn't in DB Schema")!;
    expect(finding.severity).toBe("error");
    expect(finding.fixes).toHaveLength(1);
    expect(finding.fixes![0]).toMatchObject({ kind: "createConfigRecord", category: "DbSchema", profiles: ["Rep"] });
    expect(s.creates).toHaveLength(1);
  });

  it("warns when an assigned profile has no metadata cache or sync", async () => {
    set("FROM LifeSciMobileMetadataRecord", []);
    const rep = surface(await collectBriefings("org"), "assignments").items[0];
    expect(rep.findings.map((f) => f.title)).toContain("No active metadata cache");
    dbSchema = dbSchema.map((r) => ({ ...r, assignments: [] }));
    const rep2 = surface(await collectBriefings("org"), "assignments").items[0];
    expect(rep2.findings.map((f) => f.title)).toContain("Briefings objects don't sync to this profile");
  });

  it("surfaces a cache generation failure", async () => {
    set("FROM LifeSciMobileMetadataRecord", [
      { Id: "m1", Name: "Cache", Status: "Active", IntegrationStatus: "Failed", IntegrationErrorMessage: "boom", LastModifiedDate: "2026-06-01", ProfileId: "00e1" },
    ]);
    const s = surface(await collectBriefings("org"), "metadataCache");
    expect(s.items[0].findings[0]).toMatchObject({ severity: "error", detail: "boom" });
  });

  it("keeps the rest of the map when one query fails", async () => {
    set("FROM PermissionSetLicense", new Error("boom"));
    const r = await collectBriefings("org");
    expect(surface(r, "licenses").error).toBe("boom");
    expect(surface(r, "definitions").items).toHaveLength(1);
  });
});
