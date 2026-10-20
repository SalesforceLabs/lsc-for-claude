import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  describeSObject: vi.fn(),
}));

const { runSoqlQuery, runToolingQuery, describeSObject } = await import("../../../src/salesforce/cli.js");
const { collectSetupOverview } = await import("../../../src/studio/overview.js");
const { cachesByProfile, unpublishedChanges } = await import("../../../src/studio/overview-logic.js");

type Row = Record<string, unknown>;
let soql: Record<string, Row[] | Error>;
let tooling: Record<string, Row[]>;

const reply = (rows: Row[] | Error) =>
  rows instanceof Error
    ? Promise.resolve({ success: false, error: rows.message })
    : Promise.resolve({ success: true, data: { totalSize: rows.length, done: true, records: rows } });

/** Which fixture a query hits: its FROM object, with the profile-user grouping told apart. */
function key(q: string): string {
  const from = /FROM\s+(\w+)/i.exec(q)?.[1] ?? "";
  if (from === "PermissionSet" && /IsCustom = true/.test(q)) return "Clones";
  if (from === "PermissionSetAssignment" && /AssigneeId IN/.test(q)) return "Covered";
  return from === "User" && /GROUP BY/i.test(q) ? "UserGroups" : from;
}

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

beforeEach(() => {
  soql = {
    PermissionSetLicense: [{ MasterLabel: "LSC4CE", DeveloperName: "IndustriesLSC4CEPsl", TotalLicenses: 50, UsedLicenses: 50 }],
    PackageLicense: [],
    Territory2Model: [{ Id: "m1", Name: "Model", State: "Active" }],
    User: [{ Name: "Alex" }],
    UserGroups: [
      { pn: "Rep", pid: "p1", cnt: 3 },
      { pn: "Medical", pid: "p2", cnt: 1 },
    ],
    LifeSciMobileMetadataRecord: [{ Status: "Active", ProfileId: "p1", LastModifiedDate: iso(10) }],
  };
  tooling = {
    LifeSciConfigRecord: [{ Id: "r1", DeveloperName: "dbSchema_Visit", IsOrgLevel: false, LastModifiedDate: iso(2), LifeSciConfigCategory: { Category: "DbSchema" } }],
    LifeSciConfigAssignment: [{ LifeSciConfigRecordId: "r1", AssignedToId: "p1", AssignmentLevel: "Profile", LastModifiedDate: iso(30) }],
  };
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => reply(soql[key(q)] ?? [])) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => reply(tooling[key(q)] ?? [])) as never);
  vi.mocked(describeSObject).mockResolvedValue({ success: true, data: { fields: [{ name: "PermissionsIndustriesLSC4CEUser" }, { name: "PermissionsUseLifeSciSampleLimits" }, { name: "PermissionsApiEnabled" }] } } as never);
});

describe("collectSetupOverview", () => {
  it("flags a full license, an unpublished profile, and unpublished changes", async () => {
    const o = await collectSetupOverview("org");
    const by = Object.fromEntries(o.checks.map((c) => [c.id, c]));
    expect(by["overview.access.psl-full"].status).toBe("fail");
    expect(by["overview.access.psl-full"].examples).toEqual(["LSC4CE (50/50)"]);
    expect(by["overview.data.territory-model"].status).toBe("pass");
    expect(by["overview.data.users-without-territory"].status).toBe("fail");
    // Medical has users but no cache; Rep's cache predates the DbSchema edit.
    expect(by["overview.mobile.cache-missing"].examples).toEqual(["Medical (1 user)"]);
    expect(by["overview.mobile.unpublished"].status).toBe("fail");
    expect(o.unpublishedProfiles).toEqual(["Rep"]);
    expect(o.unpublishedChanges).toBe(1);
  });

  it("makes a failing query unknown rather than failing the check", async () => {
    soql.Territory2Model = new Error("INVALID_TYPE");
    const o = await collectSetupOverview("org");
    expect(o.checks.find((c) => c.id === "overview.data.territory-model")?.status).toBe("unknown");
  });

  it("counts a setting value edited after the publish", async () => {
    tooling.LifeSciConfigRecord = [{ Id: "r1", DeveloperName: "appSettings_Rep", IsOrgLevel: false, LastModifiedDate: iso(30), LifeSciConfigCategory: { Category: "DbSchema" } }];
    tooling.LifeSciConfigFieldValue = [{ LifeSciConfigRecordId: "r1", LastModifiedDate: iso(2) }];
    const o = await collectSetupOverview("org");
    expect(o.unpublishedProfiles).toEqual(["Rep"]);
  });

  it("is quiet when the cache is newer than every change", async () => {
    soql.LifeSciMobileMetadataRecord = [
      { Status: "Active", ProfileId: "p1", LastModifiedDate: iso(0) },
      { Status: "Active", ProfileId: "p2", LastModifiedDate: iso(0) },
    ];
    const o = await collectSetupOverview("org");
    expect(o.checks.find((c) => c.id === "overview.mobile.unpublished")?.status).toBe("pass");
    expect(o.unpublishedProfiles).toEqual([]);
  });

  it("reads caches only for the LSC profiles, with no row cap", async () => {
    await collectSetupOverview("org");
    const q = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0])).find((x) => x.includes("FROM LifeSciMobileMetadataRecord"))!;
    expect(q).toContain("ProfileId IN ('p1','p2')");
    expect(q).not.toContain("LIMIT");
  });

  it("counts users without a territory instead of using the 200-name sample", async () => {
    vi.mocked(runSoqlQuery).mockImplementation(((q: string) =>
      /^SELECT COUNT\(\) FROM User/.test(q)
        ? Promise.resolve({ success: true, data: { totalSize: 900, done: true, records: [] } })
        : reply(soql[key(q)] ?? [])) as never);
    const o = await collectSetupOverview("org");
    expect(o.checks.find((c) => c.id === "overview.data.users-without-territory")?.detail).toContain("900 users");
  });

  it("says when the change search was limited to the lookback window", async () => {
    soql.LifeSciMobileMetadataRecord = [{ Status: "Active", ProfileId: "p1", LastModifiedDate: iso(400) }];
    const o = await collectSetupOverview("org");
    expect(o.checks.find((c) => c.id === "overview.mobile.unpublished")?.detail).toContain("Looked back 180 days only");
    const since = vi.mocked(runToolingQuery).mock.calls.map((c) => String(c[0])).find((x) => x.includes("FROM LifeSciConfigRecord WHERE LastModifiedDate >"))!;
    expect(Date.parse(/> (\S+)/.exec(since)![1])).toBeGreaterThan(Date.now() - 181 * DAY);
  });

  it("flags a copied LSC permission set only for holders who don't get the missing permission elsewhere", async () => {
    soql.PermissionSet = [{ Id: "ps1", Name: "LifeSciencesFieldSalesRepresentative", Label: "Field Sales", LicenseId: "lic", PermissionsIndustriesLSC4CEUser: true, PermissionsUseLifeSciSampleLimits: true }];
    soql.Clones = [{ Id: "c1", Name: "Rep_Copy", Label: "Rep copy", PermissionsIndustriesLSC4CEUser: true, PermissionsUseLifeSciSampleLimits: false }];
    soql.PermissionSetAssignment = [{ AssigneeId: "u1" }, { AssigneeId: "u2" }];
    soql.Covered = [{ AssigneeId: "u1" }];
    const check = async () => (await collectSetupOverview("org")).checks.find((c) => c.id === "overview.access.cloned-permission-sets")!;
    const c = await check();
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Rep copy (like Field Sales, 1 user): lacks UseLifeSciSampleLimits"]);
    soql.Covered = [{ AssigneeId: "u1" }, { AssigneeId: "u2" }];
    expect((await check()).status).toBe("pass");
    soql.Clones = [];
    expect((await check()).status).toBe("skipped");
  });
});

describe("cachesByProfile", () => {
  it("reports a failure newer than the live cache and ignores an older one", () => {
    const at = (d: number) => iso(d);
    const caches = cachesByProfile([
      { Status: "Active", ProfileId: "a", LastModifiedDate: at(5) },
      { Status: "Inactive", ProfileId: "a", IntegrationErrorMessage: "boom", LastModifiedDate: at(1) },
      { Status: "Active", ProfileId: "b", LastModifiedDate: at(1) },
      { Status: "Inactive", ProfileId: "b", IntegrationStatus: "Error", LastModifiedDate: at(9) },
    ]);
    expect(caches.get("a")?.failed?.message).toBe("boom");
    expect(caches.get("b")?.failed).toBeUndefined();
  });
});

describe("unpublishedChanges", () => {
  const edit = (over: Record<string, unknown> = {}) => ({
    recordId: "r",
    category: "DbSchema",
    developerName: "dbSchema_Visit",
    at: Date.now(),
    by: null,
    allProfiles: true,
    profileIds: [],
    recordEdited: true,
    ...over,
  });

  it("applies org-level changes to every live profile", () => {
    const caches = cachesByProfile([{ Status: "Active", ProfileId: "a", LastModifiedDate: iso(5) }]);
    const out = unpublishedChanges(caches, [edit()]);
    expect(out).toHaveLength(1);
    expect(out[0].items[0].reach?.ipad).toBe("publish");
  });

  it("counts from when the generation started, as studio_unpublished does", () => {
    // Generated 5 days ago after starting 6 days ago: an edit 5.5 days ago may not be in the cache.
    const caches = cachesByProfile([{ Status: "Active", ProfileId: "a", CreatedDate: iso(6), LastModifiedDate: iso(5) }]);
    expect(caches.get("a")?.activeStartedAt).toBe(Date.parse(iso(6)));
    expect(unpublishedChanges(caches, [edit({ at: Date.now() - 5.5 * DAY })])).toHaveLength(1);
  });

  it("leaves out categories that never reach the iPad and edits older than the generation", () => {
    const caches = cachesByProfile([{ Status: "Active", ProfileId: "a", LastModifiedDate: iso(5) }]);
    expect(unpublishedChanges(caches, [edit({ category: "TerritoryAlignment" }), edit({ at: Date.now() - 6 * DAY })])).toEqual([]);
  });

  it("counts a profile's own assignments only for that profile", () => {
    const caches = cachesByProfile([
      { Status: "Active", ProfileId: "a", LastModifiedDate: iso(5) },
      { Status: "Active", ProfileId: "b", LastModifiedDate: iso(5) },
    ]);
    const out = unpublishedChanges(caches, [edit({ allProfiles: false, profileIds: ["b"] })]);
    expect(out.map((u) => u.profileId)).toEqual(["b"]);
  });
});
