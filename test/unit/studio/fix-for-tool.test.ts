import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  cachedToolingQuery: vi.fn(),
}));

const cli = await import("../../../src/salesforce/cli.js");
const { fixesForToolCall } = await import("../../../src/studio/fix-for-tool.js");

type Row = Record<string, unknown>;
let org: Record<string, Row[] | ((query: string) => Row[])>;

function respond(query: string) {
  let outer = query;
  while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
  const from = /FROM\s+(\w+)/i.exec(outer)?.[1] ?? "";
  const table = org[from] ?? [];
  const rows = typeof table === "function" ? table(query) : table;
  return Promise.resolve({ success: true, data: { totalSize: rows.length, done: true, records: rows } });
}

const REC = "a00000000000001";
const FV_QUERY = (rows: Row[]) => (q: string) => (q.includes(REC) ? rows : []);

beforeEach(() => {
  vi.mocked(cli.runSoqlQuery).mockImplementation(respond as never);
  vi.mocked(cli.runToolingQuery).mockImplementation(respond as never);
  org = {
    LifeSciConfigRecord: [{ Id: REC, DeveloperName: "DbSchema_Visit", MasterLabel: "Visit", IsActive: true, LifeSciConfigCategory: { Category: "DbSchema" } }],
    LifeSciConfigFieldValue: FV_QUERY([
      { Id: "fv1", FieldName: "WhereSoql", DataType: "LONGTEXT", LongTextValue: "(OwnerId = :userId)" },
      { Id: "fv2", FieldName: "OneWaySync", DataType: "BOOLEAN", HasBooleanValue: false },
    ]),
    LifeSciConfigAssignment: [{ AssignedToId: "00e000000000001" }],
    Profile: [{ Id: "00e000000000001", Name: "LS Rep" }],
  };
});

describe("fixesForToolCall", () => {
  it("maps update_db_schema to one setConfigField per changed field, with the live value as from", async () => {
    const res = await fixesForToolCall("update_db_schema", { name: "Visit", whereSoql: "(OwnerId != null)", oneWaySync: false }, "org");
    expect(res).toEqual({
      changes: [
        {
          fix: {
            kind: "setConfigField",
            label: "Set WhereSoql on Visit",
            category: "DbSchema",
            developerName: "DbSchema_Visit",
            recordLabel: "Visit",
            field: "WhereSoql",
            from: "(OwnerId = :userId)",
            to: "(OwnerId != null)",
          },
          affects: ["LS Rep"],
        },
      ],
    });
  });

  it("maps isActive on update_db_schema and toggle_db_schema to setActive", async () => {
    const expected = {
      fix: { kind: "setActive", label: "Deactivate Visit", record: { type: "config", category: "DbSchema", developerName: "DbSchema_Visit", label: "Visit" }, from: true, to: false },
      affects: ["LS Rep"],
    };
    expect(await fixesForToolCall("toggle_db_schema", { name: "DbSchema_Visit", active: false }, "org")).toEqual({ changes: [expected] });
    expect(await fixesForToolCall("update_db_schema", { name: "Visit", isActive: false }, "org")).toEqual({ changes: [expected] });
  });

  it("reports nothing to change when the org already has the value", async () => {
    const res = await fixesForToolCall("toggle_db_schema", { name: "Visit", active: true }, "org");
    expect(res).toEqual({ changes: [], note: "Visit is already active." });
  });

  it("is unsupported when the field has no value yet", async () => {
    const res = await fixesForToolCall("update_db_schema", { name: "Visit", deltaDateField: "LastModifiedDate" }, "org");
    expect(res).toMatchObject({ unsupported: expect.stringContaining("no DeltaDateField value") });
  });

  it("maps update_admin_setting field values and IsActive, and refuses other record fields", async () => {
    org.LifeSciConfigRecord = [{ Id: REC, DeveloperName: "Visit_Cfg", MasterLabel: "Visit settings", IsActive: false, LifeSciConfigCategory: { Category: "VisitSettings" } }];
    org.LifeSciConfigFieldValue = FV_QUERY([{ Id: "fv1", FieldName: "Days", DataType: "INTEGER", IntegerValue: 7 }]);
    const res = await fixesForToolCall(
      "update_admin_setting",
      { recordId: REC, fields: { IsActive: true }, fieldValues: [{ fieldName: "Days", value: 14 }] },
      "org"
    );
    expect(res).toMatchObject({
      changes: [
        { fix: { kind: "setActive", from: false, to: true, record: { type: "config", category: "VisitSettings" } } },
        { fix: { kind: "setConfigField", field: "Days", from: 7, to: 14 } },
      ],
    });
    // Not a mobile category: no profile list.
    expect((res as { changes: Array<{ affects?: string[] }> }).changes.every((c) => c.affects === undefined)).toBe(true);
    expect(await fixesForToolCall("update_admin_setting", { recordId: REC, fields: { MasterLabel: "x" } }, "org")).toMatchObject({ unsupported: expect.stringContaining("MasterLabel") });
  });

  it("is unsupported, not no-change, when fields or fieldValues have the wrong shape", async () => {
    org.LifeSciConfigRecord = [{ Id: REC, DeveloperName: "Visit_Cfg", MasterLabel: "Visit settings", IsActive: false, LifeSciConfigCategory: { Category: "VisitSettings" } }];
    org.LifeSciConfigFieldValue = FV_QUERY([{ Id: "fv1", FieldName: "Days", DataType: "INTEGER", IntegerValue: 7 }]);
    expect(await fixesForToolCall("update_admin_setting", { recordId: REC, fieldValues: { Days: 14 } }, "org")).toMatchObject({ unsupported: expect.any(String) });
    expect(await fixesForToolCall("update_admin_setting", { recordId: REC, fields: "IsActive=true" }, "org")).toMatchObject({ unsupported: expect.any(String) });
    expect(await fixesForToolCall("update_admin_setting", { recordId: REC, fieldValues: ["Days"] }, "org")).toMatchObject({ unsupported: expect.any(String) });
  });

  it("maps toggle_trigger_handler to setActive on a trigger handler", async () => {
    org.LifeScienceTriggerHandler = (q) => (q.includes("'DCRHandler'") ? [{ DeveloperName: "DCRHandler", MasterLabel: "DCR", IsActive: false }] : []);
    expect(await fixesForToolCall("toggle_trigger_handler", { handlerName: "DCRHandler", active: true }, "org")).toEqual({
      changes: [{ fix: { kind: "setActive", label: "Activate DCR", record: { type: "triggerHandler", developerName: "DCRHandler", label: "DCR" }, from: false, to: true } }],
    });
    expect(await fixesForToolCall("toggle_trigger_handler", { handlerName: "Nope", active: true }, "org")).toMatchObject({ unsupported: expect.any(String) });
  });

  describe("permission sets", () => {
    beforeEach(() => {
      org.PermissionSet = [{ Id: "0PS000000000001", Label: "LSC User" }];
      org.User = [
        { Id: "005000000000001", Name: "Ann Rep", Username: "ann@x.com", IsActive: true },
        { Id: "005000000000002", Name: "Bo Rep", Username: "bo@x.com", IsActive: true },
      ];
      org.PermissionSetAssignment = [{ Id: "0Pa000000000001", AssigneeId: "005000000000002" }];
    });

    it("assigns to users who don't have it and skips those who do", async () => {
      const res = await fixesForToolCall("assign_permission_set", { permissionSetName: "LSC User", usernames: ["ann@x.com", "bo@x.com"] }, "org");
      expect(res).toEqual({
        changes: [
          {
            fix: {
              kind: "assignAccess",
              label: "Give LSC User to Ann Rep",
              userId: "005000000000001",
              userName: "Ann Rep",
              access: { type: "permissionSet", id: "0PS000000000001", label: "LSC User" },
            },
          },
        ],
        note: "Bo Rep already have LSC User.",
      });
    });

    it("removes with the assignment id", async () => {
      const res = await fixesForToolCall("unassign_permission_set", { permissionSetName: "LSC User", usernames: ["bo@x.com"] }, "org");
      expect(res).toMatchObject({
        changes: [{ fix: { kind: "removeAccess", userName: "Bo Rep", assignmentId: "0Pa000000000001", access: { id: "0PS000000000001" } } }],
      });
    });

    it("is unsupported for a permission set that isn't an exact match, or an unknown user", async () => {
      org.PermissionSet = [];
      expect(await fixesForToolCall("assign_permission_set", { permissionSetName: "LSC", usernames: ["ann@x.com"] }, "org")).toMatchObject({ unsupported: expect.stringContaining("exactly") });
      org.PermissionSet = [{ Id: "0PS000000000001", Label: "LSC User" }];
      expect(await fixesForToolCall("assign_permission_set", { permissionSetName: "LSC User", usernames: ["who@x.com"] }, "org")).toMatchObject({ unsupported: expect.stringContaining("who@x.com") });
    });
  });

  it("is unsupported for tools Studio has no equivalent for, and when the org can't be read", async () => {
    expect(await fixesForToolCall("run_apex", { code: "x" }, "org")).toMatchObject({ unsupported: expect.any(String) });
    vi.mocked(cli.runToolingQuery).mockResolvedValue({ success: false, error: "boom" } as never);
    expect(await fixesForToolCall("toggle_db_schema", { name: "Visit", active: false }, "org")).toMatchObject({ unsupported: expect.stringContaining("boom") });
  });
});
