import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheArgsWithRepLogins, repLoginsFor } from "../../../src-electron/engine/rep-logins.js";
import { runSoqlQuery } from "../../../src/salesforce/cli.js";
import { forgetTokenOrg, isTokenOrg, registerTokenOrg, TOKEN_ORG_NO_CLI } from "../../../src/salesforce/token-org.js";
import { openRepReads, repLoginFor, syncCondition } from "../../../src/studio/published.js";
import { syncedWhere } from "../../../src/studio/screens/record.js";

const REP = { instanceUrl: "https://acme.my.salesforce.com", accessToken: "REP-SECRET-TOKEN", username: "carmen@acme.test", userId: "005AAAAAAAAAAAAAAA" };
const territories = [{ id: "0MIx1", name: "North" }];

function fetchReturning(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; auth: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, auth: String((init.headers as Record<string, string>).Authorization) });
      return handler(url, init);
    })
  );
  return calls;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("token orgs", () => {
  it("reads with the rep's token over the instance URL, never through the CLI", async () => {
    const calls = fetchReturning(() => json({ totalSize: 1, done: true, records: [{ Id: "001" }] }));
    const org = registerTokenOrg(REP);
    expect(isTokenOrg(org)).toBe(true);
    expect(org).not.toContain("REP-SECRET-TOKEN");
    const res = await runSoqlQuery("SELECT Id FROM Account", org);
    expect(res.success).toBe(true);
    expect(calls[0].url.startsWith("https://acme.my.salesforce.com/services/data/")).toBe(true);
    expect(calls[0].auth).toBe("Bearer REP-SECRET-TOKEN");
    forgetTokenOrg(org);
  });

  it("fails rather than falling back to another login when the direct path can't serve it", async () => {
    fetchReturning(() => json([{ errorCode: "INVALID_SESSION_ID", message: "expired" }], 401));
    const org = registerTokenOrg(REP);
    const res = await runSoqlQuery("SELECT Id FROM Account", org);
    expect(res.success).toBe(false);
    expect(res.error).toBe(TOKEN_ORG_NO_CLI);
    forgetTokenOrg(org);
  });

  it("refuses a login for a host that isn't Salesforce", () => {
    expect(() => registerTokenOrg({ ...REP, instanceUrl: "https://evil.example.com" })).toThrow(/not a Salesforce/);
  });

  it("keeps two reps apart", () => {
    const a = registerTokenOrg(REP);
    const b = registerTokenOrg({ ...REP, username: "dan@acme.test" });
    expect(a).not.toBe(b);
    forgetTokenOrg(a);
    forgetTokenOrg(b);
  });
});

describe("choosing the rep's login", () => {
  it("matches the viewer by 15 or 18 character id", () => {
    expect(repLoginFor([REP], "005AAAAAAAAAAAA")).toBe(REP);
    expect(repLoginFor([REP], "005AAAAAAAAAAAAAAA")).toBe(REP);
    expect(repLoginFor([REP], "005BBBBBBBBBBBB")).toBeUndefined();
    expect(repLoginFor([REP], undefined)).toBeUndefined();
    expect(repLoginFor([{ ...REP, userId: undefined }], "005AAAAAAAAAAAA")).toBeUndefined();
  });

  it("uses the rep's token when it's accepted, and falls back to admin with a note when it isn't", async () => {
    const notes: string[] = [];
    fetchReturning(() => json({ totalSize: 1, done: true, records: [{ Id: "005AAAAAAAAAAAA" }] }));
    const ok = await openRepReads(REP, "005AAAAAAAAAAAA", (m) => notes.push(m));
    expect(ok && isTokenOrg(ok.org)).toBe(true);
    expect(notes).toEqual([]);
    if (ok) forgetTokenOrg(ok.org);

    fetchReturning(() => json([{ errorCode: "INVALID_SESSION_ID", message: "Session expired" }], 401));
    const bad = await openRepReads(REP, "005AAAAAAAAAAAA", (m) => notes.push(m));
    expect(bad).toBeUndefined();
    expect(notes.join(" ")).toMatch(/turned down.*admin login/);
    expect(notes.join(" ")).not.toContain("REP-SECRET-TOKEN");

    expect(await openRepReads({ ...REP, instanceUrl: "http://acme.my.salesforce.com" }, "005AAAAAAAAAAAA", (m) => notes.push(m))).toBeUndefined();
  });
});

describe("sync filter on record rows", () => {
  const scope = (t: string) =>
    t === "Account" ? syncCondition("OwnerId = '{USER.ID}' OR Territory2Id = '{USER.TERRITORYID}'", "005U", territories) : t === "Open" ? "" : undefined;
  it("adds the rep's substituted DB Schema filter when read as the rep", () => {
    expect(syncedWhere({ source: "rep", scope }, "Account", "Id IN ('001')")).toBe("Id IN ('001') AND (OwnerId = '005U' OR Territory2Id = '0MIx1')");
  });
  it("adds nothing for an unfiltered or unsynced table", () => {
    expect(syncedWhere({ source: "rep", scope }, "Open", "Id IN ('001')")).toBe("Id IN ('001')");
    expect(syncedWhere({ source: "rep", scope }, "Other", "Id IN ('001')")).toBe("Id IN ('001')");
  });
  it("leaves the admin path unchanged", () => {
    expect(syncedWhere({ source: "admin", scope }, "Account", "Id IN ('001')")).toBe("Id IN ('001')");
  });
});

describe("cache key and tokens", () => {
  const logins = [
    { id: "l1", userId: "005AAAAAAAAAAAAAAA", status: "signedIn" },
    { id: "l2", userId: "005BBBBBBBBBBBBBBB", status: "signedIn" },
    { id: "l3", userId: "005AAAAAAAAAAAAAAA", status: "expired" },
    { id: "l4", status: "signedIn" },
  ];
  it("offers only signed-in logins of the named viewer, or of anyone when none is named", () => {
    expect(repLoginsFor(logins, "005AAAAAAAAAAAA").map((l) => l.id)).toEqual(["l1"]);
    expect(repLoginsFor(logins).map((l) => l.id)).toEqual(["l1", "l2"]);
  });
  it("keys a rep read apart from an admin read, by login ids only", () => {
    const args = { profile: "Rep", userId: "005AAAAAAAAAAAA" };
    const admin = JSON.stringify(cacheArgsWithRepLogins(args, []));
    const rep = JSON.stringify(cacheArgsWithRepLogins(args, repLoginsFor(logins, "005AAAAAAAAAAAA")));
    expect(admin).toBe(JSON.stringify(args));
    expect(rep).not.toBe(admin);
    expect(rep).toContain("l1");
    expect(rep).not.toMatch(/token/i);
  });
  it("never puts a token in the registered org name", () => {
    const org = registerTokenOrg(REP);
    expect(JSON.stringify({ org })).not.toContain(REP.accessToken);
    forgetTokenOrg(org);
  });
});
