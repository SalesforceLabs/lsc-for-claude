import { describe, it, expect, vi } from "vitest";
import { chooseAuth, loginUrlFor, partitionFor } from "../../../src-renderer/components/studio/browser-auth";

vi.mock("electron", () => ({ session: {}, webContents: {}, app: { getPath: () => "/tmp" } }));
vi.mock("../../../src-electron/settings.js", () => ({ loadSettings: () => ({}) }));
import { partitionFor as mainPartitionFor } from "../../../src-electron/studio-browser.js";

const page = "https://acme.lightning.force.com/tableau/dashboard/X/view";
const rep = { id: "mobile-1", username: "rep@acme.com", userId: "005000000000001AAA", instanceUrl: "https://acme.my.salesforce.com" };
const other = { id: "mobile-2", username: "rep2@acme.com", userId: "005000000000002AAA", instanceUrl: "https://acme.my.salesforce.com" };
const elsewhere = { id: "mobile-3", username: "rep@globex.com", userId: "005000000000001AAA", instanceUrl: "https://globex.my.salesforce.com" };

describe("chooseAuth", () => {
  it("signs in as the previewed rep when Studio holds their login, matching 15- and 18-character Ids", () => {
    expect(chooseAuth(page, [other, rep], "005000000000001", null).auth).toEqual({ loginId: "mobile-1" });
  });

  it("asks when there's no login for the rep, offering the org's other logins only", () => {
    const choice = chooseAuth(page, [other, elsewhere], "005000000000001AAA", null);
    expect(choice.auth).toBeNull();
    expect(choice.candidates.map((l) => l.id)).toEqual(["mobile-2"]);
  });

  it("keeps an earlier choice while it still applies", () => {
    expect(chooseAuth(page, [other], "005000000000001AAA", { cli: true }).auth).toEqual({ cli: true });
    expect(chooseAuth(page, [other], "005000000000001AAA", { loginId: "mobile-2" }).auth).toEqual({ loginId: "mobile-2" });
    expect(chooseAuth(page, [], "005000000000001AAA", { loginId: "mobile-2" }).auth).toBeNull();
  });

  it("prefers the rep's own login over an earlier choice", () => {
    expect(chooseAuth(page, [rep], "005000000000001AAA", { cli: true }).auth).toEqual({ loginId: "mobile-1" });
  });

  it("doesn't sign a page in with an expired login", () => {
    const choice = chooseAuth(page, [{ ...rep, status: "expired" as const }, other], rep.userId, null);
    expect(choice.auth).toBeNull();
    expect(choice.candidates.map((l) => l.id)).toEqual(["mobile-2"]);
  });

  it("loads pages outside Salesforce signed out", () => {
    expect(chooseAuth("https://example.com/x", [rep], rep.userId, null).auth).toEqual({ public: true });
  });
});

describe("loginUrlFor", () => {
  it("maps a page's host to its My Domain login, keeping sandbox and scratch parts", () => {
    expect(loginUrlFor("acme.lightning.force.com")).toBe("https://acme.my.salesforce.com");
    expect(loginUrlFor("Acme--UAT.sandbox.lightning.force.com")).toBe("https://acme--uat.sandbox.my.salesforce.com");
    expect(loginUrlFor("acme.scratch.my.salesforce-setup.com")).toBe("https://acme.scratch.my.salesforce.com");
    expect(loginUrlFor("example.com")).toBeNull();
  });
});

describe("partitionFor", () => {
  it("names the same partition as the main process, which refuses guests in any other", () => {
    for (const auth of [{ loginId: "mobile-1" }, { cli: true as const }, { public: true as const }]) {
      expect(partitionFor(auth)).toBe(mainPartitionFor(auth));
    }
  });
});
