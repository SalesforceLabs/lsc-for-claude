import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({ session: {}, webContents: {}, app: { getPath: () => "/tmp" } }));
vi.mock("../../src-electron/settings.js", () => ({ loadSettings: () => ({}) }));

import { myDomainOf, sameOrg } from "../../src-electron/studio-browser.js";

describe("myDomainOf", () => {
  it("reads the My Domain from every Salesforce host form", () => {
    expect(myDomainOf("acme.my.salesforce.com")).toBe("acme");
    expect(myDomainOf("acme.lightning.force.com")).toBe("acme");
    expect(myDomainOf("Acme--UAT.sandbox.lightning.force.com")).toBe("acme--uat");
    expect(myDomainOf("acme.my.salesforce-setup.com")).toBe("acme");
  });

  it("is null for hosts outside Salesforce, including look-alikes", () => {
    expect(myDomainOf("example.com")).toBeNull();
    expect(myDomainOf("acme.force.com.evil.example")).toBeNull();
    expect(myDomainOf("acmeforce.com")).toBeNull();
  });
});

describe("sameOrg", () => {
  const door = new URL("https://trailsignup-1814.my.salesforce.com/secur/frontdoor.jsp?otp=x");

  it("matches a Lightning page on the frontdoor's My Domain", () => {
    expect(sameOrg(new URL("https://trailsignup-1814.lightning.force.com/tableau/dashboard/X/view"), door)).toBe(true);
  });

  it("refuses another org's pages and non-Salesforce pages", () => {
    expect(sameOrg(new URL("https://other.lightning.force.com/lightning/page/home"), door)).toBe(false);
    expect(sameOrg(new URL("https://trailsignup-1814.example.com/"), door)).toBe(false);
  });
});
