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
const { traceUser } = await import("../../../src/studio/user-trace.js");
const { firstProblem, traceHeadline } = await import("../../../src-renderer/components/studio/user-trace-state.js");

type Row = Record<string, unknown>;
const USER = "005000000000001AAA";

let org: Record<string, Row[] | Error>;
let config: ConfigRecord[];

function respond(q: string) {
  let outer = q;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1] ?? "";
  // Every object asked about exists unless a test lists the ones that do.
  const rows =
    from === "EntityDefinition" && !org.EntityDefinition
      ? [...q.matchAll(/'(\w+)'/g)].map((m) => ({ QualifiedApiName: m[1] }))
      : (org[from] ?? []);
  if (rows instanceof Error) return Promise.resolve({ success: false, error: rows.message });
  return Promise.resolve({ success: true, data: { totalSize: rows.length, done: true, records: rows } });
}

function dbSchema(sobject: string, profiles: string[], isActive = true): ConfigRecord {
  return {
    category: "DbSchema",
    developerName: `DbSchema_${sobject}`,
    isActive,
    isOrgLevel: false,
    fields: { SObject: sobject, Type: "DATA" },
    fieldTypes: {},
    assignments: profiles.map((name) => ({ name, level: "Profile" })),
  };
}

beforeEach(() => {
  org = {
    User: [{ Id: USER, Name: "Rae Rep", Username: "rae@x.org", IsActive: true, ProfileId: "00e000000000001", Profile: { Name: "Rep", UserLicense: { Name: "Salesforce" } } }],
    PermissionSetLicenseAssign: [{ PermissionSetLicense: { MasterLabel: "LSC", DeveloperName: "LSC4CE_Commercial" } }],
    PermissionSetLicense: [],
    PermissionSetAssignment: [{ PermissionSetId: "0PS000000000001", PermissionSet: { Label: "Visit PS", Name: "Visit_PS" } }],
    PermissionSet: [{ Id: "0PS000000000002" }],
    ObjectPermissions: [{ SobjectType: "Visit", PermissionsRead: true }],
    UserTerritory2Association: [{ Territory2: { Name: "T1", Territory2Model: { State: "Active" } } }],
    LifeSciMobileMetadataRecord: [{ Status: "Active", LastModifiedDate: "2026-01-01T00:00:00Z" }],
    DeviceSyncSummary: [{ DownloadEnd: new Date().toISOString(), CreatedDate: new Date().toISOString() }],
  };
  config = [dbSchema("Visit", ["Rep"])];
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => config) as never);
});

const byId = (checks: { id: string }[], id: string) => checks.find((c) => c.id === id) as { status: string; detail?: string; fixes?: unknown[] };

describe("traceUser", () => {
  it("passes every link for a fully set up rep", async () => {
    const t = await traceUser(USER, null, "o");
    expect(t.userName).toBe("Rae Rep");
    expect(t.checks.map((c) => c.status).filter((s) => s !== "pass")).toEqual([]);
  });

  it("flags a missing LSC license and offers a PSL fix when seats are free", async () => {
    org.PermissionSetLicenseAssign = [];
    org.PermissionSetLicense = [{ Id: "0PL000000000001", MasterLabel: "LSC", DeveloperName: "LSC4CE", TotalLicenses: 5, UsedLicenses: 2, Status: "Active" }];
    const t = await traceUser(USER, null, "o");
    const c = byId(t.checks, "user.access.lsc-psl");
    expect(c.status).toBe("fail");
    expect(c.fixes).toHaveLength(1);
    expect(firstProblem(t.checks)?.id).toBe("user.access.lsc-psl");
  });

  it("names feature objects the user can't read", async () => {
    const t = await traceUser(USER, "visit", "o");
    const c = byId(t.checks, "user.access.permissions");
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("ProviderVisit");
  });

  it("passes object access for View All Data without object permission rows", async () => {
    org.PermissionSet = [{ Id: "0PS000000000001", PermissionsViewAllData: true }];
    org.ObjectPermissions = [];
    const t = await traceUser(USER, "visit", "o");
    const c = byId(t.checks, "user.access.permissions");
    expect(c.status).toBe("pass");
    expect(c.detail).toContain("View All Data");
  });

  it("reads object access through the member permission sets of an assigned group", async () => {
    org.PermissionSetAssignment = [{ PermissionSetId: "0PS000000000009", PermissionSetGroupId: "0PG000000000001", PermissionSet: { Label: "Rep Group", Name: "Rep_Group" } }];
    org.PermissionSetGroupComponent = [{ PermissionSetId: "0PS000000000077" }];
    vi.mocked(runSoqlQuery).mockImplementation(((q: string) =>
      q.includes("FROM ObjectPermissions")
        ? Promise.resolve({
            success: true,
            data: {
              totalSize: 1,
              done: true,
              // Only the group's member set grants read, on every object asked about.
              records: q.includes("'0PS000000000077'")
                ? [...(/SobjectType IN \(([^)]*)\)/.exec(q)?.[1].matchAll(/'(\w+)'/g) ?? [])].map((m) => ({ SobjectType: m[1], PermissionsRead: true }))
                : [],
            },
          })
        : respond(q)) as never);
    const t = await traceUser(USER, "visit", "o");
    expect(byId(t.checks, "user.access.permissions").status).toBe("pass");
    const asked = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));
    expect(asked.some((q) => q.includes("FROM PermissionSetGroupComponent WHERE PermissionSetGroupId IN ('0PG000000000001')"))).toBe(true);
  });

  it("leaves objects the org doesn't have out of the access and DB Schema checks", async () => {
    org.EntityDefinition = [{ QualifiedApiName: "AppAlert" }];
    org.ObjectPermissions = [{ SobjectType: "AppAlert", PermissionsRead: true }];
    config = [dbSchema("AppAlert", ["Rep"])];
    const t = await traceUser(USER, "app-alerts", "o");
    const access = byId(t.checks, "user.access.permissions");
    expect(access.status).toBe("pass");
    expect(access.detail).toContain("Not in this org: AppAlertTerritory, AppAlertUserResponse.");
    const sync = byId(t.checks, "user.mobile.db-schema");
    expect(sync.status).toBe("pass");
    expect(sync.detail).not.toContain("Not synced");
  });

  it("skips the object checks when none of the feature's objects are in the org", async () => {
    org.EntityDefinition = [];
    const t = await traceUser(USER, "app-alerts", "o");
    expect(byId(t.checks, "user.access.permissions").status).toBe("skipped");
    expect(byId(t.checks, "user.mobile.db-schema").status).toBe("skipped");
  });

  it("judges every object when the org's object list can't be read", async () => {
    org.EntityDefinition = new Error("boom");
    org.ObjectPermissions = [];
    const t = await traceUser(USER, "app-alerts", "o");
    expect(byId(t.checks, "user.access.permissions").status).toBe("fail");
  });

  it("fails DB Schema when the primary object isn't assigned to the profile", async () => {
    config = [dbSchema("Visit", ["Other"])];
    const t = await traceUser(USER, "visit", "o");
    expect(byId(t.checks, "user.mobile.db-schema").status).toBe("fail");
  });

  it("leaves content downloads (clm) out of the sync history", async () => {
    await traceUser(USER, null, "o");
    const qs = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0])).filter((q) => q.includes("FROM DeviceSyncSummary"));
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) expect(q).toContain("Type != 'clm'");
  });

  it("treats an unreadable source as unknown, not failing", async () => {
    org.DeviceSyncSummary = new Error("No such column");
    const t = await traceUser(USER, null, "o");
    expect(byId(t.checks, "user.mobile.last-sync").status).toBe("unknown");
  });

  it("reports an inactive user first", async () => {
    (org.User as Row[])[0].IsActive = false;
    const t = await traceUser(USER, null, "o");
    expect(traceHeadline(t, undefined).text).toBe("First problem: User is active");
  });
});
