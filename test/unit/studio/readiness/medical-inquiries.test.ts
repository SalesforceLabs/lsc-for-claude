import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: mod } = await import("../../../../src/studio/readiness/features/medical-inquiries.js");

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

describe("medical-inquiries readiness", () => {
  it("skips everything when Inquiry is not in the org", async () => {
    org.Inquiry = new Error("sObject type 'Inquiry' is not supported");
    expect((await run())["medical-inquiries.data.record-types-match"].status).toBe("skipped");
  });

  it("fails Inquiry record types with no Case record type of the same name", async () => {
    org.Inquiry = [{ Id: "1" }];
    org.RecordType = [
      { SobjectType: "Inquiry", Name: "Medical Inquiry" },
      { SobjectType: "Inquiry", Name: "General" },
      { SobjectType: "Case", Name: "Medical Inquiry" },
    ];
    const c = (await run())["medical-inquiries.data.record-types-match"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["General"]);
  });

  it("passes when the names match", async () => {
    org.Inquiry = [{ Id: "1" }];
    org.RecordType = [
      { SobjectType: "Inquiry", Name: "General" },
      { SobjectType: "Case", Name: "General" },
    ];
    expect((await run())["medical-inquiries.data.record-types-match"].status).toBe("pass");
  });

  it("reports a missing queue", async () => {
    org.Inquiry = [{ Id: "1" }];
    org.Group = [{ DeveloperName: "Medical_Affairs" }];
    const c = (await run())["medical-inquiries.config.queues"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Pharmacovigilance"]);
  });

  it("fails the stage path check when none is active", async () => {
    org.Inquiry = [{ Id: "1" }];
    org.LifeSciStagePath = [{ Name: "Inquiry", Status: "Inactive" }];
    expect((await run())["medical-inquiries.config.stage-path"].status).toBe("fail");
  });
});
