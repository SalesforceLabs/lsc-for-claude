import { describe, it, expect } from "vitest";
import { sameOrgId, testUserFor, testUsersFor, testUserStatus } from "../../src-renderer/test-users";
import type { MobileLoginInfo } from "../../src-renderer/types";

const login = (o: Partial<MobileLoginInfo> & { id: string }): MobileLoginInfo => ({
  username: `${o.id}@acme.com`,
  instanceUrl: "https://acme.my.salesforce.com",
  orgId: "00D000000000001AAA",
  status: "signedIn",
  remembered: true,
  ...o,
});

describe("test users", () => {
  it("compares 15- and 18-character org Ids", () => {
    expect(sameOrgId("00D000000000001", "00D000000000001AAA")).toBe(true);
    expect(sameOrgId("00D000000000002AAA", "00D000000000001AAA")).toBe(false);
    expect(sameOrgId(undefined, "00D000000000001AAA")).toBe(false);
  });

  it("lists only the org's test users, signed in first, then by name", () => {
    const list = [
      login({ id: "zed", displayName: "Zed" }),
      login({ id: "old", displayName: "Amy", status: "expired" }),
      login({ id: "bob", displayName: "Bob" }),
      login({ id: "far", displayName: "Al", orgId: "00D000000000009AAA" }),
    ];
    expect(testUsersFor(list, "00D000000000001").map((l) => l.id)).toEqual(["bob", "zed", "old"]);
    expect(testUsersFor(list, undefined)).toEqual([]);
  });

  it("finds a rep's test user, preferring one that's signed in", () => {
    const list = [login({ id: "a", userId: "005000000000001AAA", status: "expired" }), login({ id: "b", userId: "005000000000001AAA" })];
    expect(testUserFor(list, "005000000000001")?.id).toBe("b");
    expect(testUserFor([list[0]], "005000000000001AAA")?.id).toBe("a");
    expect(testUserFor(list, "005000000000002AAA")).toBeUndefined();
    expect(testUserFor(list, undefined)).toBeUndefined();
  });

  it("says whether a login is remembered, ends with Roz, or expired", () => {
    expect(testUserStatus(login({ id: "a" }))).toMatchObject({ label: "Signed in", tone: "pass" });
    expect(testUserStatus(login({ id: "a", remembered: false }))).toMatchObject({ label: "Until Roz quits", tone: "info" });
    expect(testUserStatus(login({ id: "a", status: "expired" }))).toMatchObject({ label: "Expired", tone: "warning" });
  });
});
