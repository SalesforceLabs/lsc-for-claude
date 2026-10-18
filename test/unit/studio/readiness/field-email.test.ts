import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: feature } = await import("../../../../src/studio/readiness/features/field-email.js");

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

describe("field email readiness", () => {
  it("fails templates with no consent subscription", async () => {
    org.LifeSciEmailTemplate = [{ Id: "t1", Name: "Codine Template" }];
    const c = (await run())["field-email.config.template-consent"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Codine Template"]);
  });

  it("skips template checks when there are no active templates", async () => {
    org.LifeSciEmailTemplate = 0;
    const r = await run();
    expect(r["field-email.config.template-consent"].status).toBe("skipped");
    expect(r["field-email.access.template-sharing"].status).toBe("skipped");
  });

  it("flags a status job that isn't scheduled", async () => {
    org.AsyncApexJob = 0;
    expect((await run())["field-email.enabled.status-job"].status).toBe("fail");
    org.AsyncApexJob = 1;
    expect((await run())["field-email.enabled.status-job"].status).toBe("pass");
  });

  it("names the missing send job when emails are stuck", async () => {
    org.LifeScienceEmail = 4;
    org.AsyncApexJob = 0;
    const c = (await run())["field-email.data.queue-stuck"];
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("Send Email job isn't scheduled");
  });

  it("offers a new DB Schema record for the email queue when no profile syncs it", async () => {
    schema = ["LifeSciEmailTemplate", "LifeSciEmailTmplFragment"].map((o) => schemaRec(o));
    const c = (await run())["field-email.mobile.queue-objects"];
    expect(c.status).toBe("fail");
    expect(c.examples).toContain("LifeScienceEmail: not synced");
  });
});
