import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
}));

const { runSoqlQuery, runToolingQuery } = await import("../../../src/salesforce/cli.js");
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

  it("is quiet when the cache is newer than every change", async () => {
    soql.LifeSciMobileMetadataRecord = [
      { Status: "Active", ProfileId: "p1", LastModifiedDate: iso(0) },
      { Status: "Active", ProfileId: "p2", LastModifiedDate: iso(0) },
    ];
    const o = await collectSetupOverview("org");
    expect(o.checks.find((c) => c.id === "overview.mobile.unpublished")?.status).toBe("pass");
    expect(o.unpublishedProfiles).toEqual([]);
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
  it("applies org-level changes to every live profile", () => {
    const caches = cachesByProfile([{ Status: "Active", ProfileId: "a", LastModifiedDate: iso(5) }]);
    const out = unpublishedChanges(caches, [{ label: "x", at: Date.now(), profileIds: [], allProfiles: true }]);
    expect(out).toHaveLength(1);
  });
});
