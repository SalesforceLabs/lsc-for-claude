import { describe, expect, it } from "vitest";
import { loginArgsProblem, parseLoginResult, withKnownStatus, type SfOrg } from "../../../src-electron/orgs.js";

describe("loginArgsProblem", () => {
  it("allows aliases, usernames and https login hosts", () => {
    expect(loginArgsProblem(undefined, undefined)).toBeNull();
    expect(loginArgsProblem("", "")).toBeNull();
    expect(loginArgsProblem("peter-lsc-260-trial", "https://test.salesforce.com")).toBeNull();
    expect(loginArgsProblem("admin@acme.com.uat", "https://acme--uat.sandbox.my.salesforce.com")).toBeNull();
    expect(loginArgsProblem(undefined, "https://login.acme.com")).toBeNull();
  });

  it("refuses flags, odd aliases and non-https URLs", () => {
    expect(loginArgsProblem("--client-id", undefined)).toMatch(/dash/);
    expect(loginArgsProblem("a b", undefined)).toMatch(/spaces/);
    expect(loginArgsProblem(42, undefined)).toMatch(/alias/);
    expect(loginArgsProblem(undefined, "http://login.salesforce.com")).toMatch(/https/);
    expect(loginArgsProblem(undefined, "https://me:pw@login.salesforce.com")).toMatch(/https/);
    expect(loginArgsProblem(undefined, "--instance-url")).toMatch(/isn't a URL/);
  });
});

describe("parseLoginResult", () => {
  it("reads the username a login finished as", () => {
    expect(parseLoginResult(JSON.stringify({ status: 0, result: { username: "admin@acme.com", orgId: "00D" } }))).toEqual({
      username: "admin@acme.com",
    });
  });

  it("reports why a login failed", () => {
    const busy = { status: 1, name: "PortInUse", message: "Cannot start the OAuth redirect server on port 1717.\nTry this." };
    expect(parseLoginResult(JSON.stringify(busy))).toEqual({ error: "Cannot start the OAuth redirect server on port 1717." });
    expect(parseLoginResult("")).toEqual({ error: "The sf CLI didn't finish the login." });
    expect(parseLoginResult("not json")).toEqual({ error: "not json" });
  });
});

describe("withKnownStatus", () => {
  const org = (username: string, connected = true, status?: string): SfOrg => ({
    username,
    orgId: "00D",
    instanceUrl: "https://acme.my.salesforce.com",
    kind: "production",
    connected,
    status,
  });

  it("keeps known statuses, marks the new login connected, and adds new connections", () => {
    const known = [org("a@x.com"), org("b@x.com", false, "Expired"), org("c@x.com", false, "Expired")];
    const quick = [org("a@x.com"), org("b@x.com"), org("C@x.com"), org("new@x.com")];
    expect(withKnownStatus(quick, known, "c@X.com").map((o) => [o.username, o.connected, o.status])).toEqual([
      ["a@x.com", true, undefined],
      ["b@x.com", false, "Expired"],
      ["C@x.com", true, undefined],
      ["new@x.com", true, undefined],
    ]);
  });
});
