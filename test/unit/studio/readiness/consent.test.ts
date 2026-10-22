import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const { default: feature } = await import("../../../../src/studio/readiness/features/consent.js");

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

const queries = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));

describe("consent readiness", () => {
  it("counts stale pending consents inside a CreatedDate window and says older ones weren't counted", async () => {
    org.CommSubscriptionConsent = 2;
    const c = (await run())["consent.data.pending-stale"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("2 consents created 30 to 365 days ago are still pending. Consents created earlier weren't counted.");
    expect(queries().find((q) => q.includes("OptInPending"))).toContain("CreatedDate = LAST_N_DAYS:365 AND CreatedDate < LAST_N_DAYS:30");
  });

  it("checks Opt In end dates on a sample read with LIMIT, comparing the dates here", async () => {
    org.CommSubscriptionConsent = [
      { Name: "Lapsed", EffectiveToDate: "2020-01-31" },
      { Name: "Open", EffectiveToDate: null },
      { Name: "Future", EffectiveToDate: "2999-01-01" },
    ];
    const c = (await run())["consent.data.opt-in-expired"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("1 of 3 is past the end date. Checked all 3 Opt In consents.");
    expect(c.examples).toEqual(["Lapsed (ended 2020-01-31)"]);
    const q = queries().find((q) => q.includes("PrivacyConsentStatus = 'OptIn'"))!;
    expect(q).toMatch(/LIMIT 500$/);
    expect(q).not.toContain("EffectiveToDate <");
    expect(q).not.toContain("ORDER BY");
  });

  it("says the Opt In check covers a sample when there are more consents than it reads", async () => {
    org.CommSubscriptionConsent = Array.from({ length: 500 }, (_, i) => ({ Name: `C${i}`, EffectiveToDate: null }));
    const c = (await run())["consent.data.opt-in-expired"];
    expect(c.status).toBe("pass");
    expect(c.detail).toBe("None is past its end date. Checked a sample of 500 Opt In consents, not every one in the org.");
  });

  it("offers to switch on an inactive consent handler", async () => {
    handlers = [handler("ConsentSharingHandler", false), handler("ConsentUniqueRecordHandler", true)];
    const c = (await run())["consent.enabled.handlers"];
    expect(c.status).toBe("fail");
    expect(c.fixes).toHaveLength(1);
    expect(c.fixes![0]).toMatchObject({ kind: "setActive", record: { type: "triggerHandler", developerName: "ConsentSharingHandler" }, to: true });
  });

  it("skips the handler check when the package has none of them", async () => {
    expect((await run())["consent.enabled.handlers"].status).toBe("skipped");
  });

  it("lists subscriptions that have no channel", async () => {
    org.CommSubscription = [{ Id: "1", Name: "Marketing" }];
    const c = (await run())["consent.config.subscription-channels"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Marketing"]);
  });

  it("skips subscription checks when there are none", async () => {
    org.CommSubscription = 0;
    expect((await run())["consent.config.subscription-purpose"].status).toBe("skipped");
  });

  it("fails statements with blank text", async () => {
    org.ComplianceStatementDef = [{ Name: "Terms", StatementText: " " }, { Name: "Ok", StatementText: "Agree" }];
    const c = (await run())["consent.config.compliance-text"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Terms"]);
  });

  it("flags a consent object missing for one profile and offers the exact profile fix", async () => {
    schema = [schemaRec("CommSubscriptionConsent"), schemaRec("CommSubConsentCmplSnpsht"), schemaRec("ContactPointEmail"), schemaRec("ContactPointPhone"), schemaRec("DigitalSignature", "Other")];
    const c = (await run())["consent.mobile.capture-objects"];
    expect(c.status).toBe("fail");
    expect(c.examples![0]).toContain("DigitalSignature");
  });

  it("explains the data use purpose as the subscription's product link", async () => {
    org.CommSubscription = [{ Id: "1", Name: "Marketing" }];
    const c = (await run())["consent.config.subscription-purpose"];
    expect(c.why).toContain("marketable product");
    expect(c.why).not.toMatch(/audit|Field Email/);
  });
});
