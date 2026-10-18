import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: accounts } = await import("../../../../src/studio/readiness/features/accounts.js");

type Row = Record<string, unknown>;
/** Rows (and optional COUNT override) returned per outer FROM-object. */
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

const schemaRec = (sobject: string, isActive = true): ConfigRecord =>
  ({ category: "DbSchema", developerName: "db_" + sobject, label: sobject, isActive, isOrgLevel: false, fields: { SObject: sobject }, fieldTypes: {}, assignments: [{ name: "Rep", level: "Profile" }] }) as ConfigRecord;

beforeEach(() => {
  org = {};
  handlers = [];
  schema = [];
  vi.mocked(runSoqlQuery).mockImplementation(((q: string) => respond(q)) as never);
  vi.mocked(runToolingQuery).mockImplementation(((q: string) => (/FROM\s+LifeScienceTriggerHandler/i.test(q) ? Promise.resolve({ success: true, data: { totalSize: handlers.length, done: true, records: handlers } }) : respond(q))) as never);
  vi.mocked(collectCategoryRecords).mockImplementation((async () => schema) as never);
});

const run = async () => Object.fromEntries((await accounts.checks!("test-org")).map((c) => [c.id, c]));
const handler = (developerName: string, IsActive: boolean) => ({ DeveloperName: developerName, MasterLabel: developerName, IsActive });

describe("accounts readiness", () => {
  it("skips the license and DCR checks when the org doesn't use them", async () => {
    const r = await run();
    expect(r["accounts.data.licenses-current"].status).toBe("skipped");
    expect(r["accounts.data.dcr-not-stuck"].status).toBe("skipped");
  });

  it("fails when person accounts have no address", async () => {
    org.Account = [{ Name: "Dr A" }];
    const c = (await run())["accounts.data.hcps-have-address"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Dr A"]);
  });

  it("flags expired active licenses", async () => {
    org.BusinessLicense = [{ Name: "DEA", LicenseNumber: "X1", PeriodEnd: "2026-01-01" }];
    const c = (await run())["accounts.data.licenses-current"];
    expect(c.status).toBe("fail");
    expect(c.examples![0]).toContain("2026-01-01");
  });

  it("fails when the address formula field is not set", async () => {
    schema = [{ category: "AddressSettings", developerName: "a", isActive: true, fields: {}, fieldTypes: {}, assignments: [] } as unknown as ConfigRecord];
    expect((await run())["accounts.config.address-formula-field"].status).toBe("fail");
  });

  it("skips the formula check when there are no address settings", async () => {
    schema = [];
    expect((await run())["accounts.config.address-formula-field"].status).toBe("skipped");
  });

  it("fails when the formula field doesn't exist on Contact Point Address", async () => {
    schema = [{ category: "AddressSettings", developerName: "a", isActive: true, fields: { ContactPointAddressFormulaField: "Gone__c" }, fieldTypes: {}, assignments: [] } as unknown as ConfigRecord];
    expect((await run())["accounts.config.address-formula-field"].status).toBe("fail");
    org.FieldDefinition = [{ QualifiedApiName: "Gone__c" }];
    expect((await run())["accounts.config.address-formula-field"].status).toBe("pass");
  });

  it("reports an object synced through two active records for one profile", async () => {
    schema = [schemaRec("Account"), { ...schemaRec("Account"), developerName: "db_Account_2" }];
    const c = (await run())["accounts.mobile.one-sync-per-object"];
    expect(c.status).toBe("fail");
    expect(c.examples![0]).toContain("Account for Rep");
  });
});
