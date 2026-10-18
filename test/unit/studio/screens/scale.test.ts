import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const handlers: { match: RegExp; answer: (soql: string) => unknown }[] = [];

function answer(soql: string): unknown {
  calls.push(soql);
  const h = handlers.find((x) => x.match.test(soql));
  if (!h) throw new Error(`unexpected query: ${soql}`);
  return h.answer(soql);
}

vi.mock("../../../../src/studio/helpers.js", async (orig) => {
  const real = await orig<typeof import("../../../../src/studio/helpers.js")>();
  return {
    ...real,
    query: vi.fn(async (soql: string) => answer(soql)),
    count: vi.fn(async (soql: string) => answer(soql)),
    queryResult: vi.fn(async (soql: string) => answer(soql)),
  };
});

const { heldMembers, membersDetail, MEMBER_IDS } = await import("../../../../src/studio/screens/accounts.js");
const { isScaleError, softFail } = await import("../../../../src/studio/screens/context.js");
import type { ScreenContext } from "../../../../src/studio/screens/context.js";

function ctx(notes: string[]): ScreenContext {
  return { org: "o", userId: "005U", territories: [], note: (m: string) => notes.push(m) } as unknown as ScreenContext;
}
const from = (extra?: string) => `FROM Account WHERE IsDeleted = false${extra ? ` AND ${extra}` : ""}`;

beforeEach(() => {
  calls.length = 0;
  handlers.length = 0;
});

describe("heldMembers", () => {
  it("counts on the server with a semi-join", async () => {
    handlers.push({ match: /^SELECT COUNT\(\)/, answer: () => 12_345 });
    handlers.push({ match: /^SELECT Id FROM Account/, answer: () => [{ Id: "001A" }, { Id: "001B" }] });
    const notes: string[] = [];
    const m = await heldMembers(ctx(notes), from, "TerritoryAccountScore", "Rank != null", "NBC");
    expect(m).toEqual({ ids: ["001A", "001B"], count: 12_345 });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("Id IN (SELECT AccountId FROM TerritoryAccountScore WHERE Rank != null)");
    expect(calls[1]).toContain(`LIMIT ${MEMBER_IDS}`);
    expect(notes).toEqual([]);
  });

  it("reads membership rows when the filter has its own semi-join, and flags a cut-short read", async () => {
    handlers.push({
      match: /^SELECT AccountId FROM/,
      answer: () => ({ records: [{ AccountId: "001B" }, { AccountId: "001A" }, { AccountId: "001B" }, { AccountId: "001X" }], totalSize: 30_000, truncated: true }),
    });
    handlers.push({ match: /^SELECT Id, Name FROM Account/, answer: () => [{ Id: "001B", Name: "beta" }, { Id: "001A", Name: "Alpha" }] });
    const notes: string[] = [];
    const m = await heldMembers(ctx(notes), from, "ProviderActivityGoal", "Id IN (SELECT ProviderActivityGoalId FROM X)", "Activity Plans filter");
    expect(m).toEqual({ ids: ["001A", "001B"], count: 2, atLeast: true });
    expect(calls.some((c) => c.startsWith("SELECT COUNT()"))).toBe(false);
    expect(notes[0]).toContain("read 4 of 30,000 rows");
    expect(membersDetail(m)).toBe("2+ Accounts");
  });

  it("falls back when the org refuses the semi-join, but not when it is too slow", async () => {
    handlers.push({ match: /^SELECT COUNT\(\)/, answer: () => Promise.reject(new Error("INVALID_TYPE: Entity is not supported for semi join")) });
    handlers.push({ match: /^SELECT Id FROM Account/, answer: () => [] });
    handlers.push({ match: /^SELECT AccountId FROM/, answer: () => ({ records: [{ AccountId: "001A" }], totalSize: 1, truncated: false }) });
    handlers.push({ match: /^SELECT Id, Name FROM Account/, answer: () => [{ Id: "001A", Name: "A" }] });
    expect(await heldMembers(ctx([]), from, "Obj", "X = 1", "List")).toEqual({ ids: ["001A"], count: 1 });

    handlers.length = 0;
    handlers.push({ match: /^SELECT COUNT\(\)/, answer: () => Promise.reject(new Error("QUERY_TIMEOUT: Your query request was running for too long.")) });
    handlers.push({ match: /^SELECT Id FROM Account/, answer: () => [] });
    await expect(heldMembers(ctx([]), from, "Obj", "X = 1", "List")).rejects.toThrow(/QUERY_TIMEOUT/);
  });
});

describe("membersDetail", () => {
  it("words counts", () => {
    expect(membersDetail(null)).toBe("Not counted");
    expect(membersDetail({ ids: [], count: 1 })).toBe("1 Account");
    expect(membersDetail({ ids: [], count: 12_345 })).toBe("12,345 Accounts");
  });
});

describe("softFail", () => {
  it("notes scale failures and stays silent for missing objects", () => {
    const notes: string[] = [];
    const c = { note: (m: string) => notes.push(m) };
    expect(softFail(c, "Home", [])(new Error("Only 50,000 of 80,000 matching records could be read — too many for one query."))).toEqual([]);
    expect(softFail(c, "Home", [])(new Error("INVALID_TYPE: sObject type 'Visit' is not supported."))).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^Home: Only 50,000/);
  });

  it("knows scale errors", () => {
    expect(isScaleError(new Error("Reading the Home screen took longer than 90 seconds"))).toBe(true);
    expect(isScaleError(new Error("HTTP 503"))).toBe(true);
    expect(isScaleError(new Error("No such column 'Foo__c'"))).toBe(false);
  });
});
