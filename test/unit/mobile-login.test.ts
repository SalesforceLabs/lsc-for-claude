import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {}, app: { getPath: () => "/tmp" } }));
const loadSettings = vi.fn();
vi.mock("../../src-electron/settings.js", () => ({ loadSettings: () => loadSettings() }));
// The keychain, in memory.
const secrets = new Map<string, string>();
vi.mock("../../src-electron/secrets.js", () => ({
  getSecret: (name: string) => secrets.get(name),
  setSecret: (name: string, value: string) => void secrets.set(name, value),
  deleteSecret: (name: string) => void secrets.delete(name),
}));

import { mobileClientId } from "../../src-electron/mobile-login.js";

describe("mobileClientId", () => {
  const saved = process.env.LSC_MOBILE_CLIENT_ID;
  beforeEach(() => {
    delete process.env.LSC_MOBILE_CLIENT_ID;
    loadSettings.mockReturnValue({});
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.LSC_MOBILE_CLIENT_ID;
    else process.env.LSC_MOBILE_CLIENT_ID = saved;
  });

  it("prefers the saved setting over the env var, trimmed", () => {
    loadSettings.mockReturnValue({ mobileClientId: "  setting-key  " });
    process.env.LSC_MOBILE_CLIENT_ID = "env-key";
    expect(mobileClientId()).toBe("setting-key");
  });

  it("falls back to the env var when the setting is blank", () => {
    loadSettings.mockReturnValue({ mobileClientId: "   " });
    process.env.LSC_MOBILE_CLIENT_ID = " env-key ";
    expect(mobileClientId()).toBe("env-key");
  });

  it("points at Settings when nothing is configured", () => {
    expect(() => mobileClientId()).toThrow(/Settings/);
  });

  it("reads settings on every call", () => {
    loadSettings.mockReturnValue({ mobileClientId: "a" });
    expect(mobileClientId()).toBe("a");
    loadSettings.mockReturnValue({ mobileClientId: "b" });
    expect(mobileClientId()).toBe("b");
  });
});

describe("remembered mobile logins", () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    id: "l1",
    username: "carmen@acme.com",
    userId: "005000000000001AAA",
    displayName: "Carmen Central",
    orgId: "00D000000000001AAA",
    instanceUrl: "https://acme.my.salesforce.com",
    loginUrl: "https://acme.my.salesforce.com",
    accessToken: "old-token",
    refreshToken: "refresh-1",
    issuedAt: 0,
    ...over,
  });
  // Module state (the loaded logins) starts fresh in each test.
  const load = async () => {
    vi.resetModules();
    return import("../../src-electron/mobile-login.js");
  };
  const tokenReply = (status: number, body: Record<string, unknown>) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

  beforeEach(() => {
    secrets.clear();
    loadSettings.mockReturnValue({ mobileClientId: "key" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads them from the keychain, skipping any without a refresh token or outside Salesforce", async () => {
    secrets.set(
      "mobile-logins",
      JSON.stringify([stored(), stored({ id: "l2", refreshToken: undefined }), stored({ id: "l3", instanceUrl: "https://evil.example.com" })])
    );
    const m = await load();
    expect(m.listMobileLogins()).toEqual([
      {
        id: "l1",
        username: "carmen@acme.com",
        userId: "005000000000001AAA",
        displayName: "Carmen Central",
        orgId: "00D000000000001AAA",
        instanceUrl: "https://acme.my.salesforce.com",
        status: "signedIn",
        remembered: true,
      },
    ]);
  });

  it("marks a login expired when Salesforce turns its refresh token down, and says so", async () => {
    secrets.set("mobile-logins", JSON.stringify([stored()]));
    vi.stubGlobal("fetch", tokenReply(400, { error: "invalid_grant", error_description: "expired access/refresh token" }));
    const m = await load();
    const seen = vi.fn();
    m.onMobileLoginsChanged(seen);
    const [login] = await m.checkMobileLogins();
    expect(login.status).toBe("expired");
    expect(seen).toHaveBeenCalledOnce();
    expect(JSON.parse(secrets.get("mobile-logins")!)[0].expired).toBe(true);
    await expect(m.mobileLoginCredentials("l1")).rejects.toThrow(/Carmen Central's login has expired/);
  });

  it("keeps the login when Salesforce can't be reached or has trouble", async () => {
    secrets.set("mobile-logins", JSON.stringify([stored()]));
    vi.stubGlobal("fetch", tokenReply(503, { error: "unavailable" }));
    const m = await load();
    expect((await m.checkMobileLogins())[0].status).toBe("signedIn");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect((await m.checkMobileLogins())[0].status).toBe("signedIn");
  });

  it("signs an expired login back in when a refresh works again, and saves the new token", async () => {
    secrets.set("mobile-logins", JSON.stringify([stored({ expired: true })]));
    vi.stubGlobal("fetch", tokenReply(200, { access_token: "new-token", instance_url: "https://acme.my.salesforce.com" }));
    const m = await load();
    expect((await m.checkMobileLogins())[0].status).toBe("signedIn");
    expect(JSON.parse(secrets.get("mobile-logins")!)[0]).toMatchObject({ accessToken: "new-token", expired: false });
    expect(await m.mobileLoginCredentials("l1")).toMatchObject({ accessToken: "new-token", username: "carmen@acme.com" });
  });

  it("forgets a removed login, and clears the keychain entry with the last one", async () => {
    secrets.set("mobile-logins", JSON.stringify([stored()]));
    const m = await load();
    m.removeMobileLogin("l1");
    expect(m.listMobileLogins()).toEqual([]);
    expect(secrets.has("mobile-logins")).toBe(false);
    await expect(m.mobileLoginCredentials("l1")).rejects.toThrow(/forgotten/);
  });
});
