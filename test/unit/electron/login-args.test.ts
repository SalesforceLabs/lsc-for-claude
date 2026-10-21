import { describe, expect, it } from "vitest";
import { loginArgsProblem } from "../../../src-electron/orgs.js";

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
