import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi } from "vitest";
import {
  kindFromOrganization,
  OrgRoles,
  parseOrganizationResult,
  parseRoleResult,
  roleQuery,
  type OrgRole,
  type RoleCheck,
} from "../../src-electron/org-roles.js";
import { withOrgKinds, type SfOrg } from "../../src-electron/orgs.js";

const queryOutput = (records: unknown[]) => JSON.stringify({ status: 0, result: { records, totalSize: records.length } });

describe("parseRoleResult", () => {
  it("tells an LSC admin from a rep and from an org without LSC", () => {
    expect(parseRoleResult(queryOutput([{ Id: "0PS1", Assignments: { totalSize: 1, records: [{}] } }]))).toBe("admin");
    // A user with no assignment gets null for the subquery.
    expect(parseRoleResult(queryOutput([{ Id: "0PS1", Assignments: null }]))).toBe("user");
    expect(parseRoleResult(queryOutput([]))).toBe("other");
  });

  it("reads past a warning printed before the JSON, and gives up on errors", () => {
    expect(parseRoleResult(`Warning: update available\n${queryOutput([])}`)).toBe("other");
    expect(parseRoleResult(JSON.stringify({ status: 1, name: "INVALID_SESSION_ID" }))).toBeUndefined();
    expect(parseRoleResult("")).toBeUndefined();
    expect(parseRoleResult("{not json")).toBeUndefined();
  });
});

describe("roleQuery", () => {
  it("quotes the username safely", () => {
    expect(roleQuery("o'brien@acme.com")).toContain("Assignee.Username = 'o\\'brien@acme.com'");
    expect(roleQuery("a\\b@acme.com")).toContain("'a\\\\b@acme.com'");
    expect(roleQuery("x@acme.com")).toContain("Name = 'LifeSciencesCommercialAdmin'");
  });
});

describe("OrgRoles", () => {
  const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "roles-")), "org-roles.json");
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("checks each connected login once a day, reports changes, and keeps them on disk", async () => {
    const file = tmpFile();
    const answers: Record<string, OrgRole | undefined> = { "admin@x": "admin", "rep@x": "user", "gone@x": "admin" };
    const run = vi.fn(async (u: string): Promise<RoleCheck | undefined> => {
      const role = answers[u.toLowerCase()];
      return role && { role, org: null };
    });
    const changed = vi.fn();
    const roles = new OrgRoles(file, changed, run);
    roles.check([
      { username: "Admin@x", connected: true },
      { username: "rep@x", connected: true },
      { username: "gone@x", connected: false },
    ]);
    await settle();
    expect(run.mock.calls.map((c) => c[0])).toEqual(["Admin@x", "rep@x"]);
    expect(roles.get("ADMIN@x")).toBe("admin");
    expect(roles.get("rep@x")).toBe("user");
    expect(roles.get("gone@x")).toBeUndefined();
    expect(changed).toHaveBeenLastCalledWith({ "admin@x": "admin", "rep@x": "user" }, {});

    // Fresh answers aren't asked again until forced.
    roles.check([{ username: "rep@x", connected: true }]);
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    roles.check([{ username: "rep@x", connected: true }], { force: true });
    await settle();
    expect(run).toHaveBeenCalledTimes(3);
    // Same answer: nothing to tell the renderer.
    expect(changed).toHaveBeenCalledTimes(2);

    expect(new OrgRoles(file, vi.fn(), run).get("admin@x")).toBe("admin");
  });

  it("keeps the last answer when a check fails", async () => {
    const run = vi.fn(async (): Promise<RoleCheck | undefined> => ({ role: "admin", org: { orgId: "00DA00000000001", kind: "trial" } }));
    const roles = new OrgRoles(tmpFile(), vi.fn(), run);
    roles.check([{ username: "a@x", connected: true }]);
    await settle();
    run.mockImplementation(async () => undefined);
    roles.check([{ username: "a@x", connected: true }], { force: true });
    await settle();
    expect(roles.get("a@x")).toBe("admin");
    expect(roles.kinds()).toEqual({ "00DA00000000001": "trial" });
  });

  it("keeps the org's kind by org Id, keeps the last one when it can't be read, and rechecks entries saved without one", async () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify({ "old@x": { role: "admin", checkedAt: Date.now() } }));
    const run = vi.fn(async (u: string): Promise<RoleCheck | undefined> =>
      u === "old@x" ? { role: "admin", org: { orgId: "00DB000000000020AA", kind: "trial" } } : undefined
    );
    const changed = vi.fn();
    const roles = new OrgRoles(file, changed, run);
    roles.check([{ username: "old@x", connected: true }]);
    await settle();
    // Saved before kinds were read, so checked again although its role is fresh.
    expect(run).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith({ "old@x": "admin" }, { "00DB00000000002": "trial" });

    run.mockImplementation(async () => ({ role: "admin", org: null }));
    roles.check([{ username: "old@x", connected: true }], { force: true });
    await settle();
    expect(roles.kinds()).toEqual({ "00DB00000000002": "trial" });
  });
});

describe("the org's kind from its Organization record", () => {
  const out = (records: unknown[], status = 0) => JSON.stringify({ status, result: { records } });

  it("reads sandbox, Developer Edition, trial and production as Studio does", () => {
    expect(kindFromOrganization({ IsSandbox: true, TrialExpirationDate: null })).toBe("sandbox");
    expect(kindFromOrganization({ IsSandbox: false, OrganizationType: "Developer Edition" })).toBe("developer");
    expect(kindFromOrganization({ IsSandbox: false, TrialExpirationDate: "2027-05-13T00:00:00.000+0000", OrganizationType: "Enterprise Edition" })).toBe("trial");
    expect(kindFromOrganization({ IsSandbox: false, TrialExpirationDate: null, OrganizationType: "Enterprise Edition" })).toBe("production");
  });

  it("gives up on errors and records it can't read", () => {
    expect(parseOrganizationResult(`Warning\n${out([{ Id: "00DA", IsSandbox: false, TrialExpirationDate: "2027-01-01" }])}`)).toEqual({ orgId: "00DA", kind: "trial" });
    expect(parseOrganizationResult(out([], 0))).toBeNull();
    expect(parseOrganizationResult(out([{ Id: "00DA", IsSandbox: false }], 1))).toBeNull();
    expect(parseOrganizationResult(out([{ Id: "00DA" }]))).toBeNull();
    expect(parseOrganizationResult("")).toBeNull();
  });
});

describe("withOrgKinds", () => {
  const org = (o: Partial<SfOrg>): SfOrg => ({ username: "u", orgId: "", instanceUrl: "", isDefault: false, kind: "production", connected: true, ...o });

  it("replaces the sf CLI's guess with the org's own kind, matching 15- and 18-character Ids", () => {
    const [trial, untouched, scratch, noId] = withOrgKinds(
      [
        org({ username: "a", orgId: "00DA00000000001AAA" }),
        org({ username: "b", orgId: "00DB00000000002", kind: "sandbox" }),
        org({ username: "c", orgId: "00DC00000000003", kind: "scratch" }),
        org({ username: "d" }),
      ],
      { "00DA00000000001": "trial", "00DC00000000003": "trial" }
    );
    expect(trial.kind).toBe("trial");
    expect(untouched.kind).toBe("sandbox");
    // A scratch org's record reads like a trial's; it stays scratch.
    expect(scratch.kind).toBe("scratch");
    expect(noId.kind).toBe("production");
  });
});
