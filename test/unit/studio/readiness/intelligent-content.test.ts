import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: feature } = await import("../../../../src/studio/readiness/features/intelligent-content.js");

type Row = Record<string, unknown>;
/** Rows (or a COUNT override) returned per outer FROM-object. */
let org: Record<string, Row[] | number | ((soql: string) => Row[])>;
let handlers: Row[];
let schema: ConfigRecord[];

function respond(soql: string) {
  let outer = soql;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1] ?? "";
  const entry = org[from] ?? [];
  const v = typeof entry === "function" ? entry(soql) : entry;
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

const queries = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));

describe("intelligent content readiness", () => {
  it("samples active presentations and looks up their shares and pages by id, never with an anti-join", async () => {
    org.Presentation = [{ Id: "p1", Name: "Shared" }, { Id: "p2", Name: "Private" }];
    org.PresentationShare = [{ ParentId: "p1", cnt: 3 }];
    org.PresentationLinkedPage = (q) => (q.includes("COUNT(Id)") ? [{ PresentationId: "p1", cnt: 4 }, { PresentationId: "p2", cnt: 1 }] : []);
    const r = await run();
    expect(queries().some((q) => q.includes("NOT IN"))).toBe(false);
    expect(queries().find((q) => q.startsWith("SELECT Id, Name FROM Presentation WHERE Status = 'Active'"))).toMatch(/LIMIT 500$/);
    expect(queries().find((q) => q.includes("FROM PresentationShare"))).toContain("ParentId IN ('p1','p2')");
    expect(queries().find((q) => q.includes("PresentationPage.Status != 'Active'"))).toContain("PresentationId IN ('p1','p2')");
    const shared = r["intelligent-content.access.shared"];
    expect(shared.status).toBe("fail");
    expect(shared.detail).toBe("1 of 2 isn't distributed. Checked all 2 active presentations.");
    expect(shared.examples).toEqual(["Private"]);
    expect(r["intelligent-content.data.empty"].detail).toBe("Every one has pages. Checked all 2 active presentations.");
    expect(r["intelligent-content.data.inactive-pages"].detail).toBe("No active presentation includes an inactive page. Checked all 2 active presentations.");
  });

  it("says the presentation checks cover a sample when there are more active presentations than it reads", async () => {
    org.Presentation = Array.from({ length: 500 }, (_, i) => ({ Id: `p${i}`, Name: `Deck ${i}` }));
    org.PresentationShare = org.Presentation.map((p) => ({ ParentId: p.Id, cnt: 1 }));
    const c = (await run())["intelligent-content.access.shared"];
    expect(c.status).toBe("pass");
    expect(c.detail).toBe("Every one is distributed. Checked a sample of 500 active presentations, not every one in the org.");
  });

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
    org.Presentation = [{ Id: "p1", Name: "Deck" }];
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

  it("holds profiles that sync presentations to the click stream, even with one object to check", async () => {
    schema = [schemaRec("Presentation"), { ...schemaRec("Presentation", "Manager"), developerName: "db_p2" }, schemaRec("PresentationClickStrmEntry")];
    const c = (await run())["intelligent-content.mobile.tracking-objects"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["PresentationClickStrmEntry: missing for Manager"]);
  });

  it("doesn't hold a profile to content objects when it doesn't sync presentations", async () => {
    // "Other" syncs Topic for another feature only.
    schema = [...["Presentation", "PresentationPage", "PresentationLinkedPage", "PresentationPageProduct", "Topic", "TopicAssignment"].map((o) => schemaRec(o)), { ...schemaRec("Topic", "Other"), developerName: "db_t2" }];
    expect((await run())["intelligent-content.mobile.content-objects"].status).toBe("pass");
  });
});
