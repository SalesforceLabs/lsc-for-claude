import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateConfigFix, StudioFix } from "../../../src/studio/types.js";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  cachedToolingQuery: vi.fn(),
  createRecord: vi.fn(),
  deleteRecord: vi.fn(),
  updateRecord: vi.fn(),
  updateToolingRecord: vi.fn(),
  createToolingRecord: vi.fn(),
  deleteToolingRecord: vi.fn(),
  generateMobileMetadataCache: vi.fn(),
}));

const cli = await import("../../../src/salesforce/cli.js");
const { previewFix, applyFix } = await import("../../../src/studio/fixes.js");

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

const USER = "005000000000001";
const PROFILES = [
  { Id: "00e000000000001", Name: "System Administrator" },
  { Id: "00e000000000002", Name: "LS Field Rep" },
];
/** Existing config records, matched on the DeveloperName in the query. */
let records: Row[];

const newAction: CreateConfigFix = {
  kind: "createConfigRecord",
  label: "New custom action: Search Google",
  category: "CustomAction",
  developerName: "CustomAction_Search_Google",
  recordLabel: "Search Google",
  fields: [
    { name: "EntityType", value: "SObject" },
    { name: "EntityName", value: "Account" },
    { name: "ActionType", value: "URL" },
    { name: "ActionTarget", value: "https://www.google.com/search" },
    { name: "Profiles", value: "LS Field Rep" },
  ],
  profiles: [],
  active: true,
};

let nextId = 0;

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 0;
  records = [];
  org = {
    User: (q) => (/GROUP BY/i.test(q) ? [{ pn: "LS Field Rep", cnt: 4 }] : [{ Id: USER, IsActive: true }]),
    Profile: (q) => PROFILES.filter((p) => q.includes(`'${p.Id}'`) || q.includes(`'${p.Name}'`)),
    PermissionSet: [],
    LifeSciConfigCategory: [{ Id: "1LC000000000001" }],
    LifeSciConfigRecord: (q) => records.filter((r) => q.includes(`'${r.DeveloperName}'`)),
    LifeSciConfigFieldValue: [],
    LifeSciConfigAssignment: [],
    EntityDefinition: (q) => (q.includes("'Visit'") ? [{ QualifiedApiName: "Visit" }] : []),
  };
  vi.mocked(cli.runSoqlQuery).mockImplementation(respond as never);
  vi.mocked(cli.runToolingQuery).mockImplementation(respond as never);
  vi.mocked(cli.createToolingRecord).mockImplementation((async () => ({ success: true, data: { id: `1LX00000000${String(++nextId).padStart(4, "0")}` } })) as never);
  vi.mocked(cli.updateToolingRecord).mockResolvedValue({ success: true });
  vi.mocked(cli.deleteToolingRecord).mockResolvedValue({ success: true });
  vi.mocked(cli.createRecord).mockResolvedValue({ success: true, data: { id: "0R5000000000001" } });
  vi.mocked(cli.deleteRecord).mockResolvedValue({ success: true });
});

describe("createConfigRecord", () => {
  it("previews every value and who gains access", async () => {
    const preview = await previewFix(newAction, "org");
    expect(preview.blocked).toBeUndefined();
    expect(preview.changes.map((c) => c.field)).toEqual([
      "New record",
      "EntityType",
      "EntityName",
      "ActionType",
      "ActionTarget",
      "Profiles",
      "Status",
    ]);
    expect(preview.warnings.join(" ")).toContain("4 active users");
    expect(preview).not.toHaveProperty("plan");
  });

  it("creates inactive, adds typed values, then activates — undo deletes it", async () => {
    const result = await applyFix(newAction, "org");
    const calls = vi.mocked(cli.createToolingRecord).mock.calls;
    expect(calls[0]).toEqual([
      "LifeSciConfigRecord",
      expect.objectContaining({ DeveloperName: newAction.developerName, MasterLabel: "Search Google", IsActive: false, IsOrgLevel: false }),
      "org",
    ]);
    expect(calls.slice(1).map((c) => c[1])).toContainEqual(
      expect.objectContaining({ FieldName: "EntityType", DataType: "PICKLIST", PicklistValue: "SObject" })
    );
    expect(calls.slice(1).map((c) => c[1])).toContainEqual(
      expect.objectContaining({ FieldName: "Profiles", DataType: "TEXT", TextValue: "LS Field Rep" })
    );
    expect(cli.updateToolingRecord).toHaveBeenCalledWith("LifeSciConfigRecord", "1LX000000000001", { IsActive: true }, "org");
    expect(result).toMatchObject({ ok: true, undo: { kind: "deleteConfigRecord", developerName: newAction.developerName } });
  });

  it("refuses bad names, taken names, and missing required fields", async () => {
    expect((await previewFix({ ...newAction, developerName: "Bad Name" }, "org")).blocked).toContain("letters, numbers, and underscores");
    expect((await previewFix({ ...newAction, developerName: "Two__Underscores" }, "org")).blocked).toContain("two underscores");

    records = [{ Id: "1LR000000000009", DeveloperName: newAction.developerName }];
    expect((await previewFix(newAction, "org")).blocked).toContain("already exists");

    records = [];
    const noTarget = { ...newAction, fields: newAction.fields.filter((f) => f.name !== "ActionTarget") };
    expect((await previewFix(noTarget, "org")).blocked).toBe("Fill in ActionTarget.");
    expect((await applyFix(noTarget, "org")).ok).toBe(false);
    expect(cli.createToolingRecord).not.toHaveBeenCalled();
  });

  it("rolls back everything when a step fails", async () => {
    vi.mocked(cli.createToolingRecord).mockImplementation((async (sobject: string, values: Row) => {
      if (values.FieldName === "ActionTarget") return { success: false, error: "INVALID_VALUE" };
      return { success: true, data: { id: `1LX00000000${String(++nextId).padStart(4, "0")}` } };
    }) as never);
    const result = await applyFix(newAction, "org");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("INVALID_VALUE");
    expect(result.message).toContain("Nothing was created");
    const deleted = vi.mocked(cli.deleteToolingRecord).mock.calls.map((c) => c[0]);
    expect(deleted.filter((s) => s === "LifeSciConfigFieldValue")).toHaveLength(3);
    expect(deleted.at(-1)).toBe("LifeSciConfigRecord");
    expect(cli.updateToolingRecord).not.toHaveBeenCalled();
  });

  it("copies a record's values and types, letting the form override them", async () => {
    records = [{ Id: "1LR000000000001", DeveloperName: "DbSchema_Visit", MasterLabel: "DbSchema Visit", IsActive: true }];
    org.LifeSciConfigFieldValue = [
      { Id: "1LF000000000001", FieldName: "SObject", DataType: "OBJECT", ObjectValue: "Visit" },
      { Id: "1LF000000000002", FieldName: "WhereSoql", DataType: "LONGTEXT", LongTextValue: "(OwnerId = $User.Id)" },
      { Id: "1LF000000000003", FieldName: "Type", DataType: "PICKLIST", PicklistValue: "DATA" },
    ];
    org.LifeSciConfigAssignment = [{ Id: "1LA000000000001", AssignedToId: "00e000000000001", AssignmentLevel: "Profile" }];
    const copy: CreateConfigFix = {
      kind: "createConfigRecord",
      label: "Duplicate DbSchema_Visit",
      category: "DbSchema",
      developerName: "DbSchema_Visit_Copy",
      recordLabel: "DbSchema Visit (copy)",
      copyFrom: "DbSchema_Visit",
      fields: [{ name: "WhereSoql", value: "" }],
      profiles: ["LS Field Rep"],
      active: true,
    };
    const preview = await previewFix(copy, "org");
    expect(preview.blocked).toBeUndefined();
    const row = (field: string) => preview.changes.find((c) => c.field === field)?.after;
    expect(row("Copied from")).toBe("DbSchema_Visit");
    expect(row("SObject")).toBe("Visit");
    expect(row("WhereSoql")).toBe("(empty)");
    expect(row("Assigned profiles")).toBe("LS Field Rep");
  });

  it("refuses a DB Schema record for an object that doesn't exist", async () => {
    const fix: CreateConfigFix = {
      kind: "createConfigRecord",
      label: "Add Visitt to iPad sync",
      category: "DbSchema",
      developerName: "DbSchema_Visitt",
      recordLabel: "DbSchema Visitt",
      fields: [{ name: "SObject", value: "Visitt" }],
      profiles: [],
      active: false,
    };
    expect((await previewFix(fix, "org")).blocked).toBe("Visitt isn't an object in this org.");
  });
});

describe("deleteConfigRecord", () => {
  const del: StudioFix = {
    kind: "deleteConfigRecord",
    label: "Delete Search Google",
    category: "CustomAction",
    developerName: "CustomAction_Search_Google",
    recordLabel: "Search Google",
  };

  it("deletes values, assignments, then the record — undo recreates it exactly", async () => {
    records = [{ Id: "1LR000000000001", DeveloperName: del.developerName, MasterLabel: "Search Google", IsActive: false, IsOrgLevel: false }];
    org.LifeSciConfigFieldValue = [{ Id: "1LF000000000001", FieldName: "ActionType", DataType: "PICKLIST", PicklistValue: "URL" }];
    org.LifeSciConfigAssignment = [{ Id: "1LA000000000001", AssignedToId: "00e000000000002", AssignmentLevel: "Profile" }];

    const result = await applyFix(del, "org");
    expect(vi.mocked(cli.deleteToolingRecord).mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["LifeSciConfigFieldValue", "1LF000000000001"],
      ["LifeSciConfigAssignment", "1LA000000000001"],
      ["LifeSciConfigRecord", "1LR000000000001"],
    ]);
    expect(result.undo).toMatchObject({
      kind: "createConfigRecord",
      developerName: del.developerName,
      fields: [{ name: "ActionType", dataType: "PICKLIST", value: "URL" }],
      profiles: ["LS Field Rep"],
      active: false,
    });
  });

  it("refuses records already gone and org-level defaults", async () => {
    expect((await previewFix(del, "org")).blocked).toBe("Already deleted. Refresh the map.");
    records = [{ Id: "1LR000000000001", DeveloperName: del.developerName, IsOrgLevel: true }];
    expect((await previewFix(del, "org")).blocked).toContain("Org-level");
  });
});

describe("user access", () => {
  const territory = { type: "territory" as const, id: "0MI000000000001", label: "Boston" };
  const give: StudioFix = { kind: "assignAccess", label: "Give Boston", userId: USER, userName: "Rep", access: territory };

  it("warns when the territory's model isn't active, and undo removes it", async () => {
    org.UserTerritory2Association = [];
    org.Territory2 = [{ Id: territory.id, Territory2Model: { Name: "FY27 Plan", State: "Planning" } }];
    const preview = await previewFix(give, "org");
    expect(preview.warnings[0]).toContain("isn't the active territory model");

    const result = await applyFix(give, "org");
    expect(cli.createRecord).toHaveBeenCalledWith("UserTerritory2Association", { UserId: USER, Territory2Id: territory.id }, "org");
    expect(result.undo).toMatchObject({ kind: "removeAccess", assignmentId: "0R5000000000001" });
  });

  it("refuses to give what the user already has", async () => {
    org.UserTerritory2Association = [{ Id: "0R5000000000002" }];
    expect((await previewFix(give, "org")).blocked).toContain("already has Boston");
  });

  it("removes the assignment that exists now, not the one the map saw", async () => {
    org.UserTerritory2Association = [{ Id: "0R5000000000007" }];
    const result = await applyFix({ ...give, kind: "removeAccess", assignmentId: "0R5000000000002" }, "org");
    expect(cli.deleteRecord).toHaveBeenCalledWith("UserTerritory2Association", "0R5000000000007", "org");
    expect(result.undo).toMatchObject({ kind: "assignAccess", access: territory });
  });
});
