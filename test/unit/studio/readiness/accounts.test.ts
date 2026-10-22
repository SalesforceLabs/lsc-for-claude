import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { invalidateSharedReads } = await import("../../../../src/config/read-cache.js");
const { default: accounts } = await import("../../../../src/studio/readiness/features/accounts.js");

type Row = Record<string, unknown>;
/** Rows (and optional COUNT override) returned per outer FROM-object, or a function of the query. */
let org: Record<string, Row[] | number | ((soql: string) => Row[] | number)>;
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
const pati = (AccountId: string, Name: string, IsPersonAccount: boolean, PreferredAddressId: string | null = null) => ({
  AccountId,
  Account: { Name, IsPersonAccount },
  Territory2Id: "T1",
  PreferredAddressId,
});
const handler = (developerName: string, IsActive: boolean) => ({ DeveloperName: developerName, MasterLabel: developerName, IsActive });

describe("accounts readiness", () => {
  it("skips the license and DCR checks when the org doesn't use them", async () => {
    const r = await run();
    expect(r["accounts.data.licenses-current"].status).toBe("skipped");
    expect(r["accounts.data.dcr-not-stuck"].status).toBe("skipped");
  });

  it("skips the account checks when no account has territory info", async () => {
    const r = await run();
    for (const id of ["preferred-address", "hcps-have-address", "primary-address", "hcps-have-provider-record"])
      expect(r[`accounts.data.${id}`].status).toBe("skipped");
  });

  it("reads a fixed-size sample of territory info and looks up related records by id, never with an anti-join", async () => {
    org.ProviderAcctTerritoryInfo = [pati("A1", "Dr A", true)];
    await run();
    const queries = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));
    expect(queries.some((q) => q.includes("NOT IN"))).toBe(false);
    expect(queries.find((q) => q.includes("FROM ProviderAcctTerritoryInfo WHERE IsActive = true"))).toMatch(/LIMIT 500$/);
    expect(queries.find((q) => q.includes("FROM ContactPointAddress"))).toContain("ParentId IN ('A1')");
    expect(queries.find((q) => q.includes("FROM HealthcareProvider"))).toContain("AccountId IN ('A1')");
  });

  it("fails when an HCP in a territory has no address", async () => {
    org.ProviderAcctTerritoryInfo = [pati("A1", "Dr A", true), pati("A2", "Dr B", true)];
    org.HealthcareProvider = [{ AccountId: "A1", cnt: 1 }, { AccountId: "A2", cnt: 1 }];
    org.ContactPointAddress = [{ ParentId: "A2", cnt: 1 }];
    const c = (await run())["accounts.data.hcps-have-address"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("1 of 2 has no address. Checked all 2 HCPs in territories.");
    expect(c.examples).toEqual(["Dr A"]);
  });

  it("says the result covers a sample when there are more territory info records than it reads", async () => {
    org.ProviderAcctTerritoryInfo = Array.from({ length: 500 }, (_, i) => pati(`A${i}`, `Dr ${i}`, true));
    org.HealthcareProvider = org.ProviderAcctTerritoryInfo.map((r) => ({ AccountId: r.AccountId, cnt: 1 }));
    org.ContactPointAddress = org.HealthcareProvider.map((r) => ({ ParentId: r.AccountId, cnt: 1 }));
    const c = (await run())["accounts.data.hcps-have-address"];
    expect(c.status).toBe("pass");
    expect(c.detail).toContain("among a sample of 500 territory info records, not every one in the org");
  });

  it("splits missing preferred addresses into accounts with no address and ones with none preferred", async () => {
    org.ProviderAcctTerritoryInfo = [pati("A1", "Dr A", true, "ADDR"), pati("A2", "Dr B", true), pati("A3", "Dr C", true), pati("A4", "Dr D", false)];
    org.ContactPointAddress = [{ ParentId: "A2", cnt: 2 }];
    const c = (await run())["accounts.data.preferred-address"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe(
      "3 of 4 territory info records have no preferred address: 1 is for accounts with addresses but none preferred, 2 are for accounts with no address at all. Checked all 4."
    );
  });

  it("shows a timed-out lookup as couldn't check, not failed", async () => {
    org.ProviderAcctTerritoryInfo = [pati("A1", "Dr A", true)];
    org.HealthcareProvider = [{ AccountId: "A1", cnt: 1 }];
    vi.mocked(runSoqlQuery).mockImplementation(((q: string) =>
      q.includes("FROM ContactPointAddress") ? Promise.resolve({ success: false, error: "Query timed out after 120s" }) : respond(q)) as never);
    const c = (await run())["accounts.data.hcps-have-address"];
    expect(c.status).toBe("unknown");
    expect(c.detail).toContain("timed out");
  });

  it("matches sampled alignments to territory info by account and territory, telling inactive records from missing ones", async () => {
    org.Territory2Model = [{ Id: "0MA1", Name: "Live", State: "Active" }];
    org.Territory2 = [{ Id: "T1", Name: "North" }];
    org.ObjectTerritory2Association = [
      { ObjectId: "A1", Territory2Id: "T1" },
      { ObjectId: "A2", Territory2Id: "T1" },
      { ObjectId: "A3", Territory2Id: "T1" },
    ];
    org.ProviderAcctTerritoryInfo = (q) =>
      q.includes("AccountId IN")
        ? [
            { AccountId: "A1", Territory2Id: "T1", IsActive: true },
            { AccountId: "A2", Territory2Id: "T1", IsActive: false },
            { AccountId: "A3", Territory2Id: "T9", IsActive: true },
          ]
        : [];
    const c = (await run())["accounts.data.territory-info-coverage"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("2 of 3 alignments have no active territory info: 1 has only inactive territory info, 1 has none. Checked all 3 account alignments.");
    const queries = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));
    expect(queries.find((q) => q.includes("FROM ObjectTerritory2Association"))).toContain("Territory2Id IN ('T1')");
  });

  it("flags expired active licenses of the sampled accounts", async () => {
    org.ProviderAcctTerritoryInfo = [pati("A1", "Dr A", true)];
    org.BusinessLicense = [{ Name: "DEA", LicenseNumber: "X1", PeriodEnd: "2026-01-01", AccountId: "A1" }];
    const c = (await run())["accounts.data.licenses-current"];
    expect(c.status).toBe("fail");
    expect(c.examples![0]).toContain("2026-01-01");
    const queries = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));
    expect(queries.find((q) => q.includes("PeriodEnd < TODAY"))).toContain("AccountId IN ('A1')");
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
