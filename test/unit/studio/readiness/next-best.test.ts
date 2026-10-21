import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));
// Who's in scope is its own module (scope.ts); it fails by default, so the older population reads run.
vi.mock("../../../../src/studio/scope.js", () => ({ ipadProfiles: vi.fn(), territoryProfiles: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const scope = await import("../../../../src/studio/scope.js");
/** The scope's iPad profiles are these. */
const ipad = (...names: string[]) =>
  vi.mocked(scope.ipadProfiles).mockResolvedValue(names.map((name, i) => ({ id: `00e${i}`, name, users: 1, licensed: 1, group: "ipad", reason: "", detected: "ipad", overridden: false, territory: true, unsure: false })));
const { default: mod } = await import("../../../../src/studio/readiness/features/next-best.js");

type Row = Record<string, unknown>;
/** Rows (and optional COUNT override) returned per outer FROM-object; an Error makes that query fail, a function answers by the SOQL. */
let org: Record<string, Row[] | number | Error | ((soql: string) => Row[])>;
let handlers: Row[];
let schema: ConfigRecord[];

function respond(soql: string) {
  let outer = soql;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1] ?? "";
  const entry = org[from] ?? [];
  const v = typeof entry === "function" ? entry(soql) : entry;
  if (v instanceof Error) return Promise.resolve({ success: false, error: v.message });
  const rows = typeof v === "number" ? [] : v;
  const total = typeof v === "number" ? v : rows.length;
  return Promise.resolve({ success: true, data: { totalSize: total, done: true, records: rows } });
}

const schemaRec = (sobject: string, isActive = true): ConfigRecord =>
  ({ category: "DbSchema", developerName: "db_" + sobject, label: sobject, isActive, isOrgLevel: false, fields: { SObject: sobject }, fieldTypes: {}, assignments: [{ name: "Rep", level: "Profile" }] }) as ConfigRecord;
const handler = (developerName: string, IsActive: boolean) => ({ DeveloperName: developerName, MasterLabel: developerName, IsActive });

beforeEach(() => {
  vi.mocked(scope.ipadProfiles).mockRejectedValue(new Error("no scope"));
  vi.mocked(scope.territoryProfiles).mockRejectedValue(new Error("no scope"));
  org = {};
  handlers = [];
  schema = [];
  vi.mocked(runSoqlQuery).mockClear();
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => (/FROM\s+LifeScienceTriggerHandler/i.test(q) ? Promise.resolve({ success: true, data: { totalSize: handlers.length, done: true, records: handlers } }) : respond(q))) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => schema) as never);
});

const run = async () => Object.fromEntries((await mod.checks!("test-org")).map((c) => [c.id, c]));
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const score = (Id: string, extra: Row = {}): Row => ({ Id, Name: Id, Account: { Name: "Dr " + Id }, LastModifiedDate: ago(1), TotalScore: 10, Rank: 1, TerritoryId: "T1", ...extra });
const queries = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));

describe("next-best readiness", () => {
  it("skips the data checks when no scores exist", async () => {
    const r = await run();
    expect(r["next-best.data.scores-current"].status).toBe("skipped");
    expect(r["next-best.mobile.db-schema"].status).toBe("skipped");
  });

  it("fails when the newest score is old", async () => {
    org.TerritoryAccountScore = [score("a", { LastModifiedDate: ago(90) }), score("b", { LastModifiedDate: ago(60) })];
    const c = (await run())["next-best.data.scores-current"];
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("60 days ago");
  });

  it("passes when scores are recent", async () => {
    org.TerritoryAccountScore = [score("a", { LastModifiedDate: ago(2) })];
    expect((await run())["next-best.data.scores-current"].status).toBe("pass");
  });

  it("reads scores newest first by the indexed SystemModstamp, with a LIMIT, never counting the whole table", async () => {
    org.TerritoryAccountScore = [score("a")];
    await run();
    const q = queries();
    // The access check's anti-join on permission set assignments is shared and bounded by field users.
    expect(q.some((x) => x.includes("NOT IN (SELECT") && !x.includes("PermissionSetAssignment"))).toBe(false);
    expect(q.some((x) => /COUNT\(|MAX\(/.test(x) && x.includes("FROM TerritoryAccountScore"))).toBe(false);
    expect(q.find((x) => x.includes("TotalScore"))).toMatch(/FROM TerritoryAccountScore ORDER BY SystemModstamp DESC LIMIT 500$/);
    expect(q).toContain("SELECT Id FROM TerritoryAccountScore LIMIT 1");
  });

  it("names the scores in the sample with no total, rank or territory, and says it checked all of them", async () => {
    org.TerritoryAccountScore = [score("a", { Rank: null }), score("b", { TerritoryId: null }), score("c")];
    const r = await run();
    expect(r["next-best.data.scores-complete"].status).toBe("fail");
    expect(r["next-best.data.scores-complete"].detail).toBe("0 scores without a total and 1 score without a rank. Checked all 3 scores.");
    expect(r["next-best.data.scores-complete"].examples).toEqual(["a (Dr a)"]);
    expect(r["next-best.data.scores-territory"].detail).toBe("1 of 3 scores has no territory. Checked all 3 scores.");
  });

  it("says a full sample of scores is a sample", async () => {
    org.TerritoryAccountScore = Array.from({ length: 500 }, (_, i) => score("s" + i));
    const c = (await run())["next-best.data.scores-territory"];
    expect(c.status).toBe("pass");
    expect(c.detail).toBe("Every score checked has a territory. Checked the 500 most recently written scores, not every one in the org.");
  });

  it("fails on explanations that are not JSON and ignores valid ones", async () => {
    org.TerritoryAccountScore = [
      { Id: "a", ScoreExplainabilityInfo: "{not json" },
      { Id: "b", ScoreExplainabilityInfo: '{"rationals":[]}' },
    ];
    const c = (await run())["next-best.data.explainability"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["a"]);
  });

  it("flags upcoming actions past their due date", async () => {
    org.TerritoryAccountScore = [score("a")];
    org.TerritoryAcctRcmdAction = [
      { Id: "r1", Name: "TARA-1", Status: "Upcoming", DueDate: ago(5).slice(0, 10), Account: { Name: "Dr A" } },
      { Id: "r2", Name: "TARA-2", Status: "Upcoming", DueDate: ago(-5).slice(0, 10) },
      { Id: "r3", Name: "TARA-3", Status: "Completed", DueDate: ago(5).slice(0, 10) },
    ];
    const c = (await run())["next-best.data.actions-not-overdue"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("1 of 3 is still Upcoming past the due date. Checked all 3 recommended actions.");
    expect(c.examples).toEqual([`TARA-1 (Dr A, due ${ago(5).slice(0, 10)})`]);
    const q = queries().find((x) => x.includes("FROM TerritoryAcctRcmdAction"))!;
    expect(q).toMatch(/LIMIT 500$/);
    expect(q).not.toMatch(/ORDER BY|COUNT|WHERE/);
  });

  it("says a full sample of actions is a sample", async () => {
    org.TerritoryAccountScore = [score("a")];
    org.TerritoryAcctRcmdAction = Array.from({ length: 500 }, (_, i) => ({ Id: "r" + i, Status: "Completed" }));
    expect((await run())["next-best.data.actions-not-overdue"].detail).toBe("None is Upcoming past its due date. Checked a sample of 500 recommended actions, not every one in the org.");
  });

  it("counts message scores of inactive guidance by guidance id, not with a join over every score", async () => {
    org.TerritoryAccountScore = [score("a")];
    org.ProductGuidance = [{ Id: "G1", Name: "Old message" }];
    org.TerritoryAcctProdMsgScore = (q) => (q.includes("GROUP BY") ? [{ ProductGuidanceId: "G1", cnt: 4 }] : [{ Id: "m1" }]);
    const c = (await run())["next-best.data.messages-active"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("4 message scores point at inactive guidance. Checked every message score against the 1 inactive guidance record.");
    expect(c.examples).toEqual(["Old message: 4 scores"]);
    expect(queries().find((x) => x.includes("GROUP BY"))).toContain("ProductGuidanceId IN ('G1')");
    expect(queries().some((x) => x.includes("ProductGuidance.IsActive"))).toBe(false);
  });

  it("passes message scores when no guidance is inactive", async () => {
    org.TerritoryAccountScore = [score("a")];
    org.TerritoryAcctProdMsgScore = [{ Id: "m1" }];
    expect((await run())["next-best.data.messages-active"].status).toBe("pass");
  });

  it("fails when some field users can't read Territory Account Score, counted by profile", async () => {
    org.TerritoryAccountScore = [{ latest: ago(1), cnt: 1 }];
    org.Profile = [{ Name: "Rep" }];
    org.PermissionSetAssignment = [{ PermissionSetId: "0PS1" }];
    org.ObjectPermissions = (q) => (q.includes("ParentId IN ('0PS1')") ? [{ ParentId: "0PS1" }] : []);
    let anti = "";
    org.User = (q) => {
      if (!q.includes("NOT IN")) return [{ pn: "Rep", cnt: 5 }];
      anti = q;
      return [{ pn: "Rep", cnt: 2 }];
    };
    const c = (await run())["next-best.access.score-read"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("2 of 5 active field users can't read Territory Account Score.");
    expect(c.examples).toEqual(["Rep: 2 users"]);
    expect(anti).toContain("PermissionSetId IN ('0PS1')");
  });

  it("passes next-best.access.score-read only when every field user can read it", async () => {
    org.TerritoryAccountScore = [{ latest: ago(1), cnt: 1 }];
    org.Profile = [{ Name: "Rep" }];
    org.PermissionSetAssignment = [{ PermissionSetId: "0PS1" }];
    org.ObjectPermissions = (q) => (q.includes("ParentId IN ('0PS1')") ? [{ ParentId: "0PS1" }] : []);
    org.User = (q) => (q.includes("NOT IN") ? [] : [{ pn: "Rep", cnt: 5 }]);
    expect((await run())["next-best.access.score-read"].status).toBe("pass");
  });

  it("fails next-best.access.score-read when nothing grants Read, even with no anti-join", async () => {
    org.TerritoryAccountScore = [{ latest: ago(1), cnt: 1 }];
    org.Profile = [{ Name: "Rep" }];
    org.User = [{ pn: "Rep", cnt: 3 }];
    const c = (await run())["next-best.access.score-read"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Rep: 3 users"]);
  });
});
