import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: mod } = await import("../../../../src/studio/readiness/features/next-best.js");

type Row = Record<string, unknown>;
/** Rows (and optional COUNT override) returned per outer FROM-object; an Error makes that query fail. */
let org: Record<string, Row[] | number | Error>;
let handlers: Row[];
let schema: ConfigRecord[];

function respond(soql: string) {
  let outer = soql;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1] ?? "";
  const v = org[from] ?? [];
  if (v instanceof Error) return Promise.resolve({ success: false, error: v.message });
  const rows = typeof v === "number" ? [] : v;
  const total = typeof v === "number" ? v : rows.length;
  return Promise.resolve({ success: true, data: { totalSize: total, done: true, records: rows } });
}

const schemaRec = (sobject: string, isActive = true): ConfigRecord =>
  ({ category: "DbSchema", developerName: "db_" + sobject, label: sobject, isActive, isOrgLevel: false, fields: { SObject: sobject }, fieldTypes: {}, assignments: [{ name: "Rep", level: "Profile" }] }) as ConfigRecord;
const handler = (developerName: string, IsActive: boolean) => ({ DeveloperName: developerName, MasterLabel: developerName, IsActive });

beforeEach(() => {
  org = {};
  handlers = [];
  schema = [];
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => (/FROM\s+LifeScienceTriggerHandler/i.test(q) ? Promise.resolve({ success: true, data: { totalSize: handlers.length, done: true, records: handlers } }) : respond(q))) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => schema) as never);
});

const run = async () => Object.fromEntries((await mod.checks!("test-org")).map((c) => [c.id, c]));
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

describe("next-best readiness", () => {
  it("skips the data checks when no scores exist", async () => {
    const r = await run();
    expect(r["next-best.data.scores-current"].status).toBe("skipped");
    expect(r["next-best.mobile.db-schema"].status).toBe("skipped");
  });

  it("fails when the newest score is old", async () => {
    org.TerritoryAccountScore = [{ latest: ago(60), cnt: 3 }];
    const c = (await run())["next-best.data.scores-current"];
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("60 days ago");
  });

  it("passes when scores are recent", async () => {
    org.TerritoryAccountScore = [{ latest: ago(2), cnt: 3 }];
    expect((await run())["next-best.data.scores-current"].status).toBe("pass");
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
    org.TerritoryAccountScore = [{ latest: ago(1), cnt: 1 }];
    org.TerritoryAcctRcmdAction = 4;
    expect((await run())["next-best.data.actions-not-overdue"].status).toBe("fail");
  });
});
