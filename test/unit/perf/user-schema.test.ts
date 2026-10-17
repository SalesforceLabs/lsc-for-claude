import { describe, it, expect, vi } from "vitest";
import { createUserSchemaSource } from "../../../src/perf/user-schema.js";
import type { CompiledSchemaSource } from "../../../src/perf/compiled-schema.js";
import type { DeviceSession, TokenLogin } from "../../../src/perf/device/session.js";
import type { UserInfo } from "../../../src/perf/device/user-info.js";
import type { MetadataResult } from "../../../src/perf/device/metadata.js";

const login: TokenLogin = { instanceUrl: "https://x.my.salesforce.com", accessToken: "SECRET-TOKEN", username: "Rep@x.com" };
const user = { id: "005000000000001AAA", username: "rep@x.com", profileId: "00e1", profileName: "Rep", permissionSets: new Set<string>() };

const session = { username: "rep@x.com", instanceUrl: login.instanceUrl, apiVersion: "v67.0", http: vi.fn() } as unknown as DeviceSession;

function info(id = "005000000000001"): UserInfo {
  return {
    isOrgInMaintenance: false,
    syncSettings: {},
    accessChecks: {},
    metadataEntities: [{ id: "a00", name: "MD-1" }],
    permissionSets: [],
    territories: [],
    user: { id, isForcedFullSync: false },
  };
}

const metadata = {
  info: {
    contentVersionId: "068",
    checksum: "x",
    contentSize: 1,
    userSpecificPermissions: {
      availableFields: { Account: ["Name"], Secret__c: ["Name"] },
      fieldPermissions: [{ field: "Account.Name", readable: true }],
      objectPermissions: [{}],
    },
  },
  files: {
    db: { Account: { SObject: "Account", DeveloperName: "A", WhereSoql: "OwnerId = '{USER.ID}'" }, Secret__c: { SObject: "Secret__c", DeveloperName: "S" } },
    dbPs: {},
    sobjects: { Account: { fields: [{ fullName: "Name", type: "Text" }] }, Secret__c: { fields: [{ fullName: "Name", type: "Text" }] } },
    config: {},
    permissions: {},
  },
  bytes: 1,
  seconds: 1,
  requests: 2,
} as unknown as MetadataResult;

const base: CompiledSchemaSource = {
  tablesFor: vi.fn(async () => ({ result: { tables: [], notes: ["from archive"] } })),
};

function source(overrides: Partial<Parameters<typeof createUserSchemaSource>[0]> = {}) {
  return createUserSchemaSource({
    logins: [login],
    base,
    sessionFor: () => session,
    fetchUserInfo: async () => info(),
    downloadMetadata: async () => metadata,
    ...overrides,
  });
}

describe("createUserSchemaSource", () => {
  it("builds the table list from the user's own download, marks the source, and matches usernames case-insensitively", async () => {
    const out = await source().tablesFor(user);
    if (!("result" in out)) throw new Error(out.fallbackReason);
    expect(out.result.source).toBe("user-download");
    // Secret__c has no readable field for this user, so the device would not sync it.
    expect(out.result.tables.map((t) => t.entry.sobject)).toEqual(["Account"]);
    expect(out.result.tables[0].entry.whereSoql).toBe("OwnerId = '{USER.ID}'");
    expect(out.result.notes[0]).toMatch(/own metadata download/);
    expect(JSON.stringify(out)).not.toContain("SECRET-TOKEN");
  });

  it("uses the base source for users without a login", async () => {
    const out = await source().tablesFor({ ...user, username: "other@x.com" });
    expect(out).toEqual({ result: { tables: [], notes: ["from archive"] } });
  });

  it("falls back to the base source with the reason when the download fails, never echoing the token", async () => {
    const out = await source({
      downloadMetadata: async () => {
        throw new Error("metadata download failed (HTTP 404)");
      },
    }).tablesFor(user);
    if (!("result" in out)) throw new Error("expected fallback result");
    expect(out.result.source).toBeUndefined();
    expect(out.result.notes[0]).toMatch(/Rep@x\.com could not supply.*HTTP 404.*fell back/);
    expect(JSON.stringify(out)).not.toContain("SECRET-TOKEN");
  });

  it("reports the reason when there is no base source to fall back to", async () => {
    const out = await source({ base: undefined, fetchUserInfo: async () => ({ ...info(), metadataEntities: [] }) }).tablesFor(user);
    expect(out).toEqual({ fallbackReason: expect.stringMatching(/no metadata record.*no other schema source/) });
  });

  it("refuses a login that belongs to a different user id", async () => {
    const out = await source({ fetchUserInfo: async () => info("005000000000999") }).tablesFor(user);
    if (!("result" in out)) throw new Error("expected fallback result");
    expect(out.result.source).toBeUndefined();
    expect(out.result.notes[0]).toMatch(/different user/);
  });

  it("downloads once per login across calls", async () => {
    const download = vi.fn(async () => metadata);
    const s = source({ downloadMetadata: download });
    await s.tablesFor(user);
    await s.tablesFor(user);
    expect(download).toHaveBeenCalledTimes(1);
  });
});
