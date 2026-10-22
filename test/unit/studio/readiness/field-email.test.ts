import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigRecord } from "../../../../src/config/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({ runSoqlQuery: vi.fn(), runToolingQuery: vi.fn() }));
vi.mock("../../../../src/config/collect.js", () => ({ collectCategoryRecords: vi.fn() }));
// Who's in scope is its own module (scope.ts); it fails by default, so the older population reads run.
vi.mock("../../../../src/studio/scope.js", () => ({ ipadProfiles: vi.fn(), territoryProfiles: vi.fn() }));

const { runSoqlQuery, runToolingQuery } = await import("../../../../src/salesforce/cli.js");
const { collectCategoryRecords } = await import("../../../../src/config/collect.js");
const scope = await import("../../../../src/studio/scope.js");
/** The scope's iPad profiles are these. */
const ipad = (...names: string[]) =>
  vi.mocked(scope.ipadProfiles).mockResolvedValue(names.map((name, i) => ({ id: `00e${i}`, name, users: 1, licensed: 1, group: "ipad", reason: "", detected: "ipad", overridden: false, territory: true, unsure: false })));
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
  vi.mocked(scope.ipadProfiles).mockRejectedValue(new Error("no scope"));
  vi.mocked(scope.territoryProfiles).mockRejectedValue(new Error("no scope"));
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

  it("names the Track Email Status job", async () => {
    org.AsyncApexJob = 0;
    const c = (await run())["field-email.enabled.status-job"];
    expect(c.title).toBe("The Track Email Status job is scheduled");
    expect(c.detail).toBe("No Track Email Status job is scheduled.");
  });

  /** Answers the bounced and sent COUNTs separately. */
  const emails = (bounced: number, sent: number) =>
    vi.mocked(runSoqlQuery).mockImplementation(((q: string) =>
      /IsBounced = true/.test(q) ? respond(q).then((r) => ({ ...r, data: { ...r.data, totalSize: bounced } }))
      : /Status = 'Success'/.test(q) ? respond(q).then((r) => ({ ...r, data: { ...r.data, totalSize: sent } }))
      : respond(q)) as never);

  it("passes a bounce rate under 5%", async () => {
    emails(1, 40);
    const c = (await run())["field-email.data.bounced"];
    expect(c.status).toBe("pass");
    expect(c.detail).toBe("1 of 40 emails sent in the last 90 days bounced (3%).");
  });

  it("fails a bounce rate over 5%", async () => {
    emails(3, 20);
    const c = (await run())["field-email.data.bounced"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("3 of 20 emails sent in the last 90 days bounced (15%).");
  });

  it("counts only emails created in the last 90 days", async () => {
    emails(0, 0);
    const r = await run();
    expect(r["field-email.data.bounced"].status).toBe("skipped");
    expect(r["field-email.data.bounced"].title).toBe("Fewer than 5% of emails sent in the last 90 days bounced");
    expect(r["field-email.data.queue-stuck"].detail).toBe("Nothing is stuck. Checked every email in the queue.");
    const all = vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));
    const q = all.filter((s) => s.includes("COUNT() FROM LifeScienceEmail WHERE"));
    expect(q).toHaveLength(3);
    for (const s of q) expect(s).toContain("CreatedDate = LAST_N_DAYS:90");
    expect(all).toContain("SELECT Status FROM LifeScienceEmail WHERE CreatedDate < LAST_N_DAYS:90 ORDER BY CreatedDate DESC LIMIT 500");
  });

  it("still finds a backlog left from before the window, among the newest older emails", async () => {
    org.AsyncApexJob = 1;
    vi.mocked(runSoqlQuery).mockImplementation(((q: string) =>
      q.startsWith("SELECT Status FROM LifeScienceEmail")
        ? Promise.resolve({ success: true, data: { totalSize: 500, done: true, records: [{ Status: "Retry" }, { Status: "New" }, ...Array.from({ length: 498 }, () => ({ Status: "Success" }))] } })
        : respond(q)) as never);
    const c = (await run())["field-email.data.queue-stuck"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("2 emails waiting more than a day (2 older). Checked every email from the last 90 days and the newest 500 before that, not every one in the org.");
  });

  it("reads which profiles send email from LifeScienceEmail, not shared consent objects", async () => {
    // "Manager" syncs the consent objects for another feature but never LifeScienceEmail.
    schema = [
      schemaRec("LifeScienceEmail"),
      ...["LifeSciEmailTemplate", "LifeSciEmailTmplFragment", "LifeSciEmailTmplRelaFrgmt", "CommSubscription", "CommSubscriptionConsent", "ContactPointEmail", "DataUsePurpose"].map((o) => schemaRec(o)),
      ...["CommSubscription", "CommSubscriptionConsent", "ContactPointEmail", "DataUsePurpose"].map((o) => ({ ...schemaRec(o, "Manager"), developerName: `db_${o}_mgr` })),
    ];
    expect((await run())["field-email.mobile.compose-objects"].status).toBe("pass");
  });

  it("leaves out profiles without LSC Mobile app settings", async () => {
    const appSettings = [{ ...schemaRec("x"), category: "ProfileBasedAppSettings", fields: {} } as ConfigRecord];
    vi.mocked(collectCategoryRecords).mockImplementation((async (_org: string, soql: string) => (/ProfileBasedAppSettings/.test(soql) ? appSettings : schema)) as never);
    // "System Administrator" syncs LifeScienceEmail but has no app settings, so missing templates for it isn't flagged.
    schema = [schemaRec("LifeScienceEmail"), { ...schemaRec("LifeScienceEmail", "System Administrator"), developerName: "db_lse_admin" }, schemaRec("LifeSciEmailTemplate")];
    const c = (await run())["field-email.mobile.compose-objects"];
    expect(c.examples ?? []).not.toContain("LifeSciEmailTemplate: missing for System Administrator");
  });

  it("only asks for fragment usage sync as information", async () => {
    schema = [schemaRec("LifeScienceEmail")];
    const r = await run();
    expect(r["field-email.mobile.queue-objects"].status).toBe("pass");
    expect(r["field-email.mobile.fragment-usage"].severity).toBe("info");
    expect(r["field-email.mobile.fragment-usage"].examples).toEqual(["LifeScienceEmailFragment: not synced"]);
  });
});
