import fs from "fs";
import path from "path";
import { describe, it, expect, vi } from "vitest";
import { orgKind, parseOrgList, pickOrg, type SfOrg } from "../../src-electron/orgs.js";
import { orgPromptSection, orgSwitchRefusal, ORG_SWITCH_TOOLS } from "../../src-electron/engine/session-org.js";
import { McpPool } from "../../src-electron/mcp/pool.js";
import type { McpClient } from "../../src-electron/mcp/client.js";
import { KIND_LABEL, orgLabel, orgMonogram, sessionOrgView, sessionsElsewhere } from "../../src-renderer/orgs.js";

const org = (o: Partial<SfOrg> & { username: string }): SfOrg => ({
  orgId: "00D",
  instanceUrl: "https://acme.my.salesforce.com",
  kind: "production",
  connected: true,
  ...o,
});

describe("orgKind", () => {
  it("tells trial, developer, sandbox and scratch orgs from production by their host", () => {
    expect(orgKind({ instanceUrl: "https://trailsignup-18142fec8660f1.my.salesforce.com" })).toBe("trial");
    expect(orgKind({ instanceUrl: "https://acme-dev-ed.develop.my.salesforce.com" })).toBe("developer");
    expect(orgKind({ instanceUrl: "https://acme--uat.sandbox.my.salesforce.com" })).toBe("sandbox");
    expect(orgKind({ instanceUrl: "https://acme--uat.my.salesforce.com" })).toBe("sandbox");
    expect(orgKind({ instanceUrl: "https://speed-1234.scratch.my.salesforce.com" })).toBe("scratch");
    expect(orgKind({ instanceUrl: "https://acme.my.salesforce.com" })).toBe("production");
  });

  it("trusts the sf CLI's flags when the host doesn't say", () => {
    expect(orgKind({ instanceUrl: "https://acme.my.salesforce.com", isSandbox: true })).toBe("sandbox");
    expect(orgKind({ isScratch: true })).toBe("scratch");
    expect(orgKind({ instanceUrl: "not a url" })).toBe("production");
  });
});

describe("parseOrgList", () => {
  const stdout = JSON.stringify({
    result: {
      nonScratchOrgs: [
        { alias: "carmen", username: "carmen@acme.com", orgId: "00D1", instanceUrl: "https://trailsignup-1.my.salesforce.com", connectedStatus: "Connected", isDefaultUsername: true },
        { username: "old@acme.com", orgId: "00D2", instanceUrl: "https://acme.my.salesforce.com", connectedStatus: "RefreshTokenAuthError: expired\nmore detail" },
      ],
      // The same connection can appear in two categories.
      devHubs: [{ alias: "carmen", username: "Carmen@acme.com", orgId: "00D1" }],
      scratchOrgs: [{ username: "s@acme.com", orgId: "00D3", instanceUrl: "https://x.scratch.my.salesforce.com", status: "Active", isScratch: true }],
    },
  });

  it("lists each connection once, with its kind and whether it can still log in", () => {
    const orgs = parseOrgList(stdout);
    expect(orgs.map((o) => o.username)).toEqual(["carmen@acme.com", "old@acme.com", "s@acme.com"]);
    expect(orgs[0]).toMatchObject({ alias: "carmen", kind: "trial", connected: true, isDefault: true });
    expect(orgs[1]).toMatchObject({ kind: "production", connected: false, status: "RefreshTokenAuthError: expired" });
    expect(orgs[2]).toMatchObject({ kind: "scratch", connected: true });
  });

  it("picks by alias or username, else the sf default, else the only connection", () => {
    const orgs = parseOrgList(stdout);
    expect(pickOrg(orgs, "CARMEN")?.username).toBe("carmen@acme.com");
    expect(pickOrg(orgs, "old@acme.com")?.username).toBe("old@acme.com");
    expect(pickOrg(orgs, "nobody")).toBeUndefined();
    expect(pickOrg(orgs)?.username).toBe("carmen@acme.com");
    expect(pickOrg([org({ username: "only@acme.com" })])?.username).toBe("only@acme.com");
    expect(pickOrg([org({ username: "a@x" }), org({ username: "b@x" })])).toBeUndefined();
  });
});

describe("session org prompt", () => {
  const ref = { username: "admin@acme.com", label: "acme-prod", instanceUrl: "https://acme.my.salesforce.com" };

  it("names the session's org and forbids switching", () => {
    const text = orgPromptSection({ ref, kind: "sandbox" });
    expect(text).toContain('"acme-prod" (admin@acme.com, https://acme.my.salesforce.com), a sandbox');
    expect(text).toContain("Never call set_target_org");
    expect(text).not.toContain("production org");
  });

  it("says writes are reviewed, and calls out production", () => {
    expect(orgPromptSection({ ref, kind: "sandbox" })).toContain("Writes are reviewed by the user");
    expect(orgPromptSection({ ref, kind: "production" })).toContain("This is a production org");
  });

  it("says when there's no org, and refuses org switches", () => {
    expect(orgPromptSection(null)).toContain("No Salesforce org is connected");
    expect(ORG_SWITCH_TOOLS.has("set_target_org")).toBe(true);
    expect(orgSwitchRefusal({ ref })).toContain('"acme-prod"');
  });
});

describe("McpPool", () => {
  const fakeClient = () => {
    let idle = true;
    return {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      getTools: () => [{ name: "run_soql", description: "", input_schema: {} }],
      callTool: vi.fn(async () => ({ content: "ok", isError: false })),
      idleFor: () => idle,
      setIdle: (v: boolean) => (idle = v),
    };
  };

  it("keeps one server per connection, whatever the username's case", async () => {
    const made: ReturnType<typeof fakeClient>[] = [];
    const pool = new McpPool(() => {
      const c = fakeClient();
      made.push(c);
      return c as unknown as McpClient;
    });
    const a = await pool.get({ username: "A@acme.com", target: "a" });
    expect(await pool.get({ username: "a@ACME.com", target: "a" })).toBe(a);
    await pool.get({ username: "b@acme.com", target: "b" });
    expect(made).toHaveLength(2);
    expect(pool.getTools().map((t) => t.name)).toEqual(["run_soql"]);
  });

  it("stops only idle servers that aren't kept or busy, and a host restarts a stopped one", async () => {
    const made: ReturnType<typeof fakeClient>[] = [];
    const pool = new McpPool(() => {
      const c = fakeClient();
      made.push(c);
      return c as unknown as McpClient;
    });
    await pool.get({ username: "keep@x", target: "keep" });
    await pool.get({ username: "busy@x", target: "busy" });
    await pool.get({ username: "idle@x", target: "idle" });
    await pool.get({ username: "working@x", target: "working" });
    made[3].setIdle(false);

    await pool.sweep(["KEEP@x"], 1000, async (c) => c === (made[1] as unknown as McpClient));
    expect(made.map((c) => c.stop.mock.calls.length)).toEqual([0, 0, 1, 0]);
    expect(pool.running()).toHaveLength(3);

    await pool.host({ username: "idle@x", target: "idle" }).callTool("run_soql", {});
    expect(made).toHaveLength(5);
    expect(made[4].callTool).toHaveBeenCalledOnce();
  });
});

describe("renderer org helpers", () => {
  it("keeps the same org kinds as the main process", () => {
    const kinds = (file: string) =>
      fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8").match(/export type OrgKind = ([^;]+);/)?.[1];
    expect(kinds("src-renderer/orgs.ts")).toBe(kinds("src-electron/orgs.ts"));
    const role = (file: string) =>
      fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8").match(/export type OrgRole = ([^;]+);/)?.[1];
    expect(role("src-renderer/orgs.ts")).toBe(role("src-electron/org-roles.ts"));
    expect(Object.keys(KIND_LABEL).sort()).toEqual(["developer", "production", "sandbox", "scratch", "trial"]);
  });

  it("makes a two-letter monogram", () => {
    expect(orgMonogram("chiesi-794")).toBe("C7");
    expect(orgMonogram("Pfizer FDE")).toBe("PF");
    expect(orgMonogram("carmen@acme.com")).toBe("CA");
    expect(orgMonogram("x")).toBe("X");
  });

  it("names a recorded org by its connection's current alias", () => {
    const orgs = [org({ alias: "renamed", username: "admin@acme.com" })];
    expect(orgLabel({ username: "ADMIN@acme.com", label: "old" }, orgs)).toBe("renamed");
    expect(orgLabel({ username: "gone@acme.com", label: "gone" }, orgs)).toBe("gone");
  });

  it("says when a session's login has expired or its connection is gone", () => {
    const orgs = [org({ alias: "acme", username: "admin@acme.com", connected: false })];
    expect(sessionOrgView({ username: "admin@acme.com", label: "acme" }, orgs, false)).toMatchObject({
      label: "acme",
      state: "expired",
      loginAlias: "acme",
      kind: "production",
    });
    expect(sessionOrgView({ username: "gone@acme.com", label: "gone" }, orgs, false)).toMatchObject({ state: "missing", loginAlias: "gone" });
    expect(sessionOrgView({ username: "gone@acme.com", label: "gone@acme.com" }, orgs, false).loginAlias).toBeUndefined();
    // Not "missing" while the list is still loading.
    expect(sessionOrgView({ username: "gone@acme.com", label: "gone" }, [], true).state).toBe("ok");
  });
});

describe("sessionsElsewhere", () => {
  const live = (username: string, alias?: string) =>
    ({ username, alias, orgId: "", instanceUrl: "", kind: "sandbox", connected: true }) as const;
  const at = (username: string | null, updatedAt: string) => ({
    org: username ? { username, label: username } : null,
    updatedAt,
  });

  it("groups other orgs' sessions, most first, leaving out this org, unlinked ones and gone connections", () => {
    const sessions = [
      at("me@x.com", "2026-10-01"),
      at("a@x.com", "2026-09-01"),
      at("B@x.com", "2026-10-02"),
      at("b@x.com", "2026-08-01"),
      at("gone@x.com", "2026-10-03"),
      at(null, "2026-10-04"),
    ];
    const result = sessionsElsewhere(sessions, "ME@x.com", [live("me@x.com"), live("a@x.com"), live("b@x.com", "beta")]);
    expect(result.total).toBe(4);
    expect(result.orgs).toEqual([
      { key: "beta", count: 2 },
      { key: "a@x.com", count: 1 },
    ]);
  });

  it("breaks a tie by the most recent session", () => {
    const sessions = [at("a@x.com", "2026-09-01"), at("b@x.com", "2026-10-01")];
    expect(sessionsElsewhere(sessions, undefined, [live("a@x.com"), live("b@x.com")]).orgs.map((o) => o.key)).toEqual([
      "b@x.com",
      "a@x.com",
    ]);
  });
});
