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
const { default: mod } = await import("../../../../src/studio/readiness/features/medical-inquiries.js");

type Row = Record<string, unknown>;
/** Rows (and optional COUNT override) returned per outer FROM-object; an Error makes that query fail, a function answers by the SOQL. */
let org: Record<string, Row[] | number | Error | ((soql: string) => Row[] | number)>;
let handlers: Row[];
let schema: ConfigRecord[];

function respond(soql: string) {
  let outer = soql;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1] ?? "";
  const entry = org[from] ?? [];
  const v = typeof entry === "function" ? entry(soql) : entry;
  if (v instanceof Error) return Promise.resolve({ success: false, error: v.message });
  const rows = typeof v === "number" ? [] : v;
  const total = typeof v === "number" ? v : rows.length;
  return Promise.resolve({ success: true, data: { totalSize: total, done: true, records: rows } });
}

const schemaRec = (sobject: string, isActive = true): ConfigRecord =>
  ({ category: "DbSchema", developerName: "db_" + sobject, label: sobject, isActive, isOrgLevel: false, fields: { SObject: sobject }, fieldTypes: {}, assignments: [{ name: "Rep", level: "Profile" }] }) as ConfigRecord;
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

const run = async () => Object.fromEntries((await mod.checks!("test-org")).map((c) => [c.id, c]));
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const queries = () => vi.mocked(runSoqlQuery).mock.calls.map((c) => String(c[0]));

describe("medical-inquiries readiness", () => {
  it("tells whether Inquiry exists from one row, not a count", async () => {
    org.Inquiry = [{ Id: "1" }];
    await run();
    expect(queries()).toContain("SELECT Id FROM Inquiry LIMIT 1");
    expect(queries().some((q) => q.includes("COUNT() FROM Inquiry WHERE Status != 'Draft'"))).toBe(false);
  });

  it("counts stale drafts inside a CreatedDate window and says older ones weren't counted", async () => {
    org.Inquiry = (q) => (q.includes("COUNT()") ? 3 : [{ Id: "1" }]);
    const c = (await run())["medical-inquiries.data.stale-drafts"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("3 draft inquiries created 30 to 365 days ago are still unsubmitted. Drafts created earlier weren't counted.");
    expect(queries().find((q) => q.includes("Status = 'Draft'"))).toContain("CreatedDate = LAST_N_DAYS:365 AND CreatedDate < LAST_N_DAYS:30");
  });

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

  it("fails when some field users can't read Inquiry, counted by profile", async () => {
    org.Inquiry = [{ Id: "1" }];
    org.Profile = [{ Name: "Rep" }];
    org.PermissionSetAssignment = [{ PermissionSetId: "0PS1" }];
    org.ObjectPermissions = (q) => (q.includes("ParentId IN ('0PS1')") ? [{ ParentId: "0PS1" }] : []);
    let anti = "";
    org.User = (q) => {
      if (!q.includes("NOT IN")) return [{ pn: "Rep", cnt: 5 }];
      anti = q;
      return [{ pn: "Rep", cnt: 2 }];
    };
    const c = (await run())["medical-inquiries.access.inquiry-read"];
    expect(c.status).toBe("fail");
    expect(c.detail).toBe("2 of 5 active field users can't read Inquiry.");
    expect(c.examples).toEqual(["Rep: 2 users"]);
    expect(anti).toContain("PermissionSetId IN ('0PS1')");
  });

  it("passes medical-inquiries.access.inquiry-read only when every field user can read it", async () => {
    org.Inquiry = [{ Id: "1" }];
    org.Profile = [{ Name: "Rep" }];
    org.PermissionSetAssignment = [{ PermissionSetId: "0PS1" }];
    org.ObjectPermissions = (q) => (q.includes("ParentId IN ('0PS1')") ? [{ ParentId: "0PS1" }] : []);
    org.User = (q) => (q.includes("NOT IN") ? [] : [{ pn: "Rep", cnt: 5 }]);
    expect((await run())["medical-inquiries.access.inquiry-read"].status).toBe("pass");
  });

  it("fails medical-inquiries.access.inquiry-read when nothing grants Read, even with no anti-join", async () => {
    org.Inquiry = [{ Id: "1" }];
    org.Profile = [{ Name: "Rep" }];
    org.User = [{ pn: "Rep", cnt: 3 }];
    const c = (await run())["medical-inquiries.access.inquiry-read"];
    expect(c.status).toBe("fail");
    expect(c.examples).toEqual(["Rep: 3 users"]);
  });

  it("describes old drafts as unsent and a record type mismatch as the support doc does", async () => {
    org.Inquiry = [{ Id: "1" }];
    const r = await run();
    expect(r["medical-inquiries.data.stale-drafts"].why).toContain("never submitted, so medical affairs never saw it");
    expect(r["medical-inquiries.data.stale-drafts"].why).not.toContain("waiting");
    expect(r["medical-inquiries.data.record-types-match"].why).toContain("fail without an error or leave orphaned records");
  });
});
