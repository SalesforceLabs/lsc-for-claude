import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: feature } = await import("../../../../src/studio/readiness/features/intelligent-content.js");

type Row = Record<string, unknown>;
/** Rows (or a COUNT override) returned per outer FROM-object. */
let org: Record<string, Row[] | number>;
let handlers: Row[];
let schema: ConfigRecord[];

function respond(soql: string) {
  let outer = soql;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1] ?? "";
  const v = org[from] ?? [];
  const rows = typeof v === "number" ? [] : v;
  const total = typeof v === "number" ? v : rows.length;
  return Promise.resolve({ success: true, data: { totalSize: total, done: true, records: rows } });
}

const schemaRec = (sobject: string, profile = "Rep", isActive = true): ConfigRecord =>
  ({ category: "DbSchema", developerName: "db_" + sobject, label: sobject, isActive, isOrgLevel: false, fields: { SObject: sobject }, fieldTypes: {}, assignments: [{ name: profile, level: "Profile" }] }) as ConfigRecord;
const handler = (developerName: string, IsActive: boolean) => ({ DeveloperName: developerName, MasterLabel: developerName, IsActive });

beforeEach(() => {
  org = {};
  handlers = [];
  schema = [];
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => (/FROM\s+LifeScienceTriggerHandler/i.test(q) ? Promise.resolve({ success: true, data: { totalSize: handlers.length, done: true, records: handlers } }) : respond(q))) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => schema) as never);
});

const run = async () => Object.fromEntries((await feature.checks!("test-org")).map((c) => [c.id, c]));

describe("intelligent content readiness", () => {
  it("fails active presentations with no page", async () => {
    org.Presentation = [{ Id: "p1", Name: "Cordim deck" }];
    const c = (await run())["intelligent-content.data.empty"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Cordim deck"]);
  });

  it("skips presentation checks when none are active", async () => {
    org.Presentation = 0;
    const r = await run();
    expect(r["intelligent-content.access.shared"].status).toBe("skipped");
    expect(r["intelligent-content.data.empty"].status).toBe("skipped");
  });

  it("reports inactive pages inside active presentations", async () => {
    org.PresentationLinkedPage = [{ Presentation: { Name: "Deck" }, PresentationPage: { Name: "Slide 3" } }];
    const c = (await run())["intelligent-content.data.inactive-pages"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Deck → Slide 3"]);
  });

  it("proposes switching on an inactive DB Schema record for a content object", async () => {
    schema = [schemaRec("Presentation"), schemaRec("PresentationPage"), schemaRec("PresentationLinkedPage"), schemaRec("PresentationPageProduct"), schemaRec("Topic"), schemaRec("TopicAssignment", "Rep", false)];
    const c = (await run())["intelligent-content.mobile.content-objects"];
    expect(c.status).toBe("fail");
    expect(c.fixes![0]).toMatchObject({ kind: "setActive", record: { type: "config", category: "DbSchema", developerName: "db_TopicAssignment" }, to: true });
  });

  it("passes when every content object syncs to the profile", async () => {
    schema = ["Presentation", "PresentationPage", "PresentationLinkedPage", "PresentationPageProduct", "Topic", "TopicAssignment"].map((o) => schemaRec(o));
    expect((await run())["intelligent-content.mobile.content-objects"].status).toBe("pass");
  });
});
