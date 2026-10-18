import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: mod } = await import("../../../../src/studio/readiness/features/actions-home.js");

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

const action = (category: string, developerName: string, fields: Record<string, unknown>, assignments: ConfigRecord["assignments"] = []) =>
  ({ category, developerName, label: developerName, isActive: true, isOrgLevel: false, fields, fieldTypes: {}, assignments }) as ConfigRecord;

describe("actions-home readiness", () => {
  it("fails a URL custom action over http", async () => {
    schema = [action("CustomAction", "Plain", { ActionType: "URL", ActionTarget: "http://example.com" })];
    const c = (await run())["actions-home.config.https-urls"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Plain"]);
  });

  it("passes https URLs and skips when there are none", async () => {
    schema = [action("CustomAction", "Secure", { ActionType: "URL", ActionTarget: "https://example.com" })];
    expect((await run())["actions-home.config.https-urls"].status).toBe("pass");
    schema = [];
    expect((await run())["actions-home.config.https-urls"].status).toBe("skipped");
  });

  it("flags hardcoded org URLs", async () => {
    schema = [action("CustomAction", "Hard", { ActionType: "URL", ActionTarget: "https://acme.lightning.force.com/lightning/n/Tab" })];
    expect((await run())["actions-home.config.hardcoded-urls"].status).toBe("fail");
  });

  it("flags quick actions on objects that do not sync", async () => {
    schema = [action("QuickAction", "NewVisit", { SObject: "Visit", Location: "Record" })];
    // DB Schema is read per category; only the action category returns the action.
    vi.mocked(collectCategoryRecords).mockImplementation((async (_org: string, cats: string[]) => (cats.includes("DbSchema") ? [] : schema)) as never);
    const c = (await run())["actions-home.config.synced-objects"];
    expect(c.status).toBe("fail");
    expect(c.examples?.[0]).toContain("Visit");
  });

  it("flags two actions sharing a sort order", async () => {
    schema = [
      action("QuickAction", "A", { SObject: "Account", Location: "HomePage", SortOrder: 1 }),
      action("QuickAction", "B", { SObject: "Account", Location: "HomePage", SortOrder: 1 }),
    ];
    expect((await run())["actions-home.config.sort-order"].status).toBe("fail");
  });
});
