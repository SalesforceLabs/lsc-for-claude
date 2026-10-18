import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: mod } = await import("../../../../src/studio/readiness/features/briefings.js");

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

describe("briefings readiness", () => {
  it("skips the pipeline checks when the toggle is off", async () => {
    org.PresentationContent = new Error("sObject type 'PresentationContent' is not supported");
    const r = await run();
    expect(r["briefings.data.briefings-current"].status).toBe("skipped");
    expect(r["briefings.mobile.db-schema-profiles"].status).toBe("skipped");
  });

  it("fails when briefings are older than the stale window", async () => {
    org.PresentationContent = [{ latest: ago(30), cnt: 5 }];
    const c = (await run())["briefings.data.briefings-current"];
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("30 days ago");
  });

  it("passes when briefings are recent", async () => {
    org.PresentationContent = [{ latest: ago(1), cnt: 5 }];
    expect((await run())["briefings.data.briefings-current"].status).toBe("pass");
  });

  it("fails licenses that are missing from the org", async () => {
    org.PresentationContent = [{ cnt: 1 }];
    const c = (await run())["briefings.access.licenses"];
    expect(c.status).toBe("fail");
    expect(c.examples?.[0]).toContain("not in this org");
  });

  it("fails when no schedule flow is active", async () => {
    org.PresentationContent = [{ cnt: 1 }];
    org.FlowDefinitionView = [{ Label: "Briefings: Schedule Daily Briefings of Provider Accounts", ApiName: "ScheduleDailyBriefings", ActiveVersionId: null }];
    expect((await run())["briefings.config.scheduled-flow"].status).toBe("fail");
  });
});
