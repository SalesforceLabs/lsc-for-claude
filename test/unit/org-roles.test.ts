import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi } from "vitest";
import { OrgRoles, parseRoleResult, roleQuery, type OrgRole } from "../../src-electron/org-roles.js";

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
    const run = vi.fn(async (u: string) => answers[u.toLowerCase()]);
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
    expect(changed).toHaveBeenLastCalledWith({ "admin@x": "admin", "rep@x": "user" });

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
    const run = vi.fn(async (): Promise<OrgRole | undefined> => "admin");
    const roles = new OrgRoles(tmpFile(), vi.fn(), run);
    roles.check([{ username: "a@x", connected: true }]);
    await settle();
    run.mockImplementation(async () => undefined);
    roles.check([{ username: "a@x", connected: true }], { force: true });
    await settle();
    expect(roles.get("a@x")).toBe("admin");
  });
});
