import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { invalidateSharedReads } = await import("../../../../src/config/read-cache.js");
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
  invalidateSharedReads();
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

  it("looks for HCPs among person accounts with a provider record or territory info, not every person account", async () => {
    org.Account = [{ Name: "Dr A" }];
    await run();
    const queries = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));
    const address = queries.find((q) => q.includes("NOT IN (SELECT ParentId FROM ContactPointAddress)"));
    expect(address).toContain("Id IN (SELECT AccountId FROM HealthcareProvider)");
    const provider = queries.find((q) => q.includes("NOT IN (SELECT AccountId FROM HealthcareProvider)"));
    expect(provider).toContain("Id IN (SELECT AccountId FROM ProviderAcctTerritoryInfo WHERE IsActive = true)");
    expect((await run())["accounts.data.hcps-have-address"].detail).toContain("with a Healthcare Provider record");
  });

  it("splits missing preferred addresses into accounts with no address and ones with none preferred", async () => {
    vi.mocked(runSoqlQuery).mockImplementation(((q: string) => {
      if (/FROM ProviderAcctTerritoryInfo/.test(q)) {
        const n = q.includes("IN (SELECT ParentId FROM ContactPointAddress)") ? 3 : q.includes("PreferredAddressId = null") ? 21 : 400;
        return Promise.resolve({ success: true, data: { totalSize: n, done: true, records: [] } });
      }
      return respond(q);
    }) as never);
    const c = (await run())["accounts.data.preferred-address"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("21 of 400 have no preferred address: 3 are for accounts with addresses but none preferred, 18 are for accounts with no address at all.");
  });

  it("samples anti-join accounts instead of counting them", async () => {
    org.Account = [{ Name: "A" }, { Name: "B" }, { Name: "C" }, { Name: "D" }, { Name: "E" }];
    await run();
    const queries = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));
    const antiJoins = queries.filter((q) => q.includes("NOT IN (SELECT"));
    expect(antiJoins).toHaveLength(3);
    for (const q of antiJoins) {
      expect(q).toMatch(/^SELECT Name FROM Account/);
      expect(q).toMatch(/LIMIT 5$/);
    }
    const c = (await run())["accounts.data.hcps-have-address"];
    expect(c.detail).toContain("5 or more");
    expect(c.detail).toContain("not a full count");
  });

  it("shows a timed-out check as couldn't check, not failed", async () => {
    vi.mocked(runSoqlQuery).mockImplementation(((q: string) =>
      q.includes("NOT IN (SELECT ParentId FROM ContactPointAddress)")
        ? Promise.resolve({ success: false, error: "Query timed out after 120s" })
        : respond(q)) as never);
    org.Account = [{ Name: "Dr A" }];
    const c = (await run())["accounts.data.hcps-have-address"];
    expect(c.status).toBe("unknown");
    expect(c.detail).toContain("timed out");
  });

  it("counts aligned accounts per territory of the active model, not with a model join", async () => {
    org.Territory2Model = [{ Id: "0MA1", Name: "Live", State: "Active" }];
    org.Territory2 = [{ Id: "T1", Name: "North" }];
    org.ObjectTerritory2Association = [{ Territory2Id: "T1", cnt: 10 }];
    org.ProviderAcctTerritoryInfo = 10;
    const r = await run();
    expect(r["accounts.data.territory-info-coverage"].status).toBe("pass");
    const queries = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));
    expect(queries.some((q) => q.includes("FROM ObjectTerritory2Association") && q.includes("Territory2Model.State"))).toBe(false);
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
