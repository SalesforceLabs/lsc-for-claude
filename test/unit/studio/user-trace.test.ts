import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../src/config/types.js";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
}));
vi.mock("../../../src/config/collect.js", () => ({
  collectCategoryRecords: vi.fn(),
}));
vi.mock("../../../src/studio/published.js", async (importActual) => ({
  ...(await importActual<typeof import("../../../src/studio/published.js")>()),
  loadPublishedCore: vi.fn(),
}));

const { runSoqlQuery } = await import("../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../src/config/collect.js");
const { traceUser } = await import("../../../src/studio/user-trace.js");
const { loadPublishedCore, TAB_FILTER_REASONS } = await import("../../../src/studio/published.js");
const { firstProblem, traceHeadline } = await import("../../../src-renderer/components/studio/user-trace-state.js");

type Row = Record<string, unknown>;
const USER = "005000000000001AAA";

let org: Record<string, Row[] | Error>;
let config: ConfigRecord[];
type Tab = { fullName: string; label: string; kind: string; sobject?: string };
let published: { tabs: Tab[]; hiddenTabs: { fullName: string; label: string; reason: string }[] } | null;

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

const readable = (name: string, isReadable = true): Row => ({ EntityDefinition: { QualifiedApiName: name }, IsReadable: isReadable });

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
    UserEntityAccess: [readable("Visit")],
    UserTerritory2Association: [{ Territory2Id: "0MI000000000001", Territory2: { Name: "T1", Territory2Model: { State: "Active" } } }],
    LifeSciMobileMetadataRecord: [{ Status: "Active", LastModifiedDate: "2026-01-01T00:00:00Z" }],
    DeviceSyncSummary: [{ DownloadEnd: new Date().toISOString(), CreatedDate: new Date().toISOString() }],
  };
  config = [dbSchema("Visit", ["Rep"]), dbSchema("Account", ["Rep"])];
  reach = { aligned: 3, noInfo: 0, hidden: 0, offline: 3, unaligned: 0, inactive: 0, account: 3 };
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => {
    const rows = reachRows(q);
    if (rows === undefined) return respond(q);
    if (rows instanceof Error) return Promise.resolve({ success: false, error: rows.message });
    return Promise.resolve({ success: true, data: { totalSize: rows.length, done: true, records: rows } });
  }) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => config) as never);
  published = { tabs: [{ fullName: "standard-Account", label: "Accounts", kind: "object", sobject: "Account" }], hiddenTabs: [] };
  vi.mocked(loadPublishedCore).mockImplementation((async (profile: string) =>
    published ? { ...published, profile, cache: { generatedAt: "2026-10-01T00:00:00Z" } } : { profile, missing: true }) as never);
});

const byId = (checks: { id: string }[], id: string) => checks.find((c) => c.id === id) as { status: string; detail?: string; fixes?: unknown[]; examples?: string[] };

/** Rows per question the account reach checks ask; an Error makes that query fail. */
interface Reach {
  aligned: number;
  noInfo: number;
  hidden: number;
  offline: number;
  unaligned: number;
  inactive: number | Error;
  account: number;
}
let reach: Reach;

function reachRows(q: string): Row[] | Error | undefined {
  let outer = q;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1];
  const pick = (key: keyof Reach) => {
    const n = reach[key];
    return n instanceof Error ? n : Array.from({ length: n }, (_, i) => ({ Object: { Name: `${key} ${i}` }, Account: { Name: `${key} ${i}` } }));
  };
  if (from === "ObjectTerritory2Association") {
    if (q.includes("NOT IN (SELECT AccountId")) return pick("noInfo");
    if (q.includes("IsActive = false")) return pick("inactive");
    return pick("aligned");
  }
  if (from === "ProviderAcctTerritoryInfo") {
    if (q.includes("IsAvailableOffline = false")) return pick("hidden");
    if (q.includes("NOT IN (SELECT ObjectId")) return pick("unaligned");
    return pick("offline");
  }
  if (from === "Account") return pick("account");
  return undefined;
}

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

  it("takes object access from UserEntityAccess, including objects with no object permission rows", async () => {
    org.UserEntityAccess = [readable("Event"), readable("Holiday"), readable("TimeSlot", false)];
    const t = await traceUser(USER, "calendar-tot", "o");
    const c = byId(t.checks, "user.access.permissions");
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("TimeSlot");
    expect(c.detail).not.toMatch(/\bEvent\b|Holiday/);
    const asked = vi.mocked(runSoqlQuery).mock.calls.map((q) => String(q[0]));
    expect(asked.some((q) => q.includes(`FROM UserEntityAccess WHERE UserId = '${USER}'`))).toBe(true);
  });

  it("lists LSC permission sets first in the detail", async () => {
    org.PermissionSetAssignment = ["Data Cloud", "Tableau", "Messaging", "Agentforce", "Remote", "Life Sciences Field Sales Representative"].map((Label, i) => ({
      PermissionSetId: `0PS00000000000${i}`,
      PermissionSet: { Label, Name: Label.replace(/ /g, "_") },
    }));
    const t = await traceUser(USER, "visit", "o");
    expect(byId(t.checks, "user.access.permissions").detail).toContain("Permission sets: Life Sciences Field Sales Representative, Data Cloud, Tableau, Messaging, Agentforce and 1 more.");
  });

  it("leaves objects the org doesn't have out of the access and DB Schema checks", async () => {
    org.EntityDefinition = [{ QualifiedApiName: "AppAlert" }];
    org.UserEntityAccess = [readable("AppAlert")];
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
    org.UserEntityAccess = [];
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

  describe("iPad tabs", () => {
    it("lists the published tabs and the ones left off when no feature is named", async () => {
      published!.hiddenTabs = [{ fullName: "Orders", label: "Orders", reason: TAB_FILTER_REASONS.notVisible }];
      const c = byId((await traceUser(USER, null, "o")).checks, "user.mobile.tabs");
      expect(c.status).toBe("pass");
      expect(c.detail).toContain("1 tab as published on 2026-10-01: Accounts.");
      expect(c.detail).toContain("Left off: Orders (Tab is hidden or default-off");
      expect(vi.mocked(loadPublishedCore)).toHaveBeenCalledWith("Rep", "o", USER);
    });

    it("passes when the feature's tab is on the bar", async () => {
      published!.tabs.push({ fullName: "standard-ProductDisbursement", label: "Samples", kind: "object", sobject: "ProductDisbursement" });
      const c = byId((await traceUser(USER, "samples", "o")).checks, "user.mobile.tabs");
      expect(c).toMatchObject({ status: "pass", detail: "On the tab bar: Samples (published 2026-10-01)." });
    });

    it("says why the feature's tab is left off, and where samples are given instead", async () => {
      published!.hiddenTabs = [{ fullName: "LSC_Samples_Management", label: "Sample Management", reason: TAB_FILTER_REASONS.samples }];
      const c = byId((await traceUser(USER, "samples", "o")).checks, "user.mobile.tabs");
      expect(c.status).toBe("fail");
      expect(c.detail).toContain("Sample Management (Samples Management tabs never show on the iPad)");
      expect(c.detail).toContain("Reps give samples from the visit");
      expect(c.examples).toEqual(["Sample Management"]);
    });

    it("skips when the profile has no tab for the feature at all", async () => {
      const c = byId((await traceUser(USER, "samples", "o")).checks, "user.mobile.tabs");
      expect(c.status).toBe("skipped");
      expect(c.detail).toContain("has no Sample Management tab. Its tabs: Accounts.");
    });

    it("fails when the profile has nothing published", async () => {
      published = null;
      const c = byId((await traceUser(USER, null, "o")).checks, "user.mobile.tabs");
      expect(c).toMatchObject({ status: "fail", detail: expect.stringContaining("Rep has no published metadata") });
    });
  });

  describe("account reach", () => {
    it("says how many accounts the Account filter downloads in the rep's territory", async () => {
      const t = await traceUser(USER, null, "o");
      const c = byId(t.checks, "user.data.accounts");
      expect(c.status).toBe("pass");
      expect(c.detail).toBe("The Account filter (DbSchema_Account) downloads 3 accounts in T1. 3 accounts aligned to T1, 3 with territory info available offline.");
      expect(byId(t.checks, "user.data.accounts-match").status).toBe("pass");
    });

    it("fails when aligned accounts have no territory info available offline", async () => {
      reach = { ...reach, offline: 0, noInfo: 3, account: 0 };
      const t = await traceUser(USER, null, "o");
      expect(byId(t.checks, "user.data.accounts")).toMatchObject({ status: "fail", detail: "3 accounts aligned to T1, 0 with territory info available offline. Run Align Account to Territory." });
      const m = byId(t.checks, "user.data.accounts-match");
      expect(m.status).toBe("fail");
      expect(m.examples?.[0]).toBe("noInfo 0 (no territory info)");
    });

    it("fails when no Account DB Schema record reaches the rep", async () => {
      config = [dbSchema("Visit", ["Rep"]), dbSchema("Account", ["Other"])];
      const t = await traceUser(USER, null, "o");
      expect(byId(t.checks, "user.data.accounts").detail).toMatch(/^No active Account DB Schema record reaches Rep/);
    });

    it("fails when the Account filter returns nothing in a territory", async () => {
      reach = { ...reach, account: 0 };
      const t = await traceUser(USER, null, "o");
      const c = byId(t.checks, "user.data.accounts");
      expect(c.status).toBe("fail");
      expect(c.examples).toEqual(["No accounts in T1"]);
    });

    it("flags accounts that show without being aligned, and inactive aligned accounts", async () => {
      reach = { ...reach, unaligned: 2, inactive: 1 };
      const t = await traceUser(USER, null, "o");
      expect(byId(t.checks, "user.data.accounts-match").detail).toBe(
        "2 territory info rows for accounts not aligned to the territory, which still show on the iPad; 1 aligned account inactive."
      );
    });

    it("doesn't count inactive accounts when the org's Account has no IsActive", async () => {
      reach = { ...reach, inactive: new Error("No such column 'IsActive' on entity 'Account'") };
      const t = await traceUser(USER, null, "o");
      expect(byId(t.checks, "user.data.accounts-match").status).toBe("pass");
    });

    it("skips both checks for a rep with no territory in the active model", async () => {
      org.UserTerritory2Association = [];
      const t = await traceUser(USER, null, "o");
      expect(byId(t.checks, "user.data.accounts").status).toBe("skipped");
      expect(byId(t.checks, "user.data.accounts-match").status).toBe("skipped");
    });
  });

  it("reports an inactive user first", async () => {
    (org.User as Row[])[0].IsActive = false;
    const t = await traceUser(USER, null, "o");
    expect(traceHeadline(t, undefined).text).toBe("First problem: User is active");
  });

  it("makes the headline amber, not red, when only warnings fail", async () => {
    reach = { ...reach, unaligned: 2 };
    const t = await traceUser(USER, null, "o");
    expect(traceHeadline(t, undefined)).toMatchObject({ ok: false, tone: "warning", text: "First problem: Their iPad accounts match the alignment" });
  });
});
