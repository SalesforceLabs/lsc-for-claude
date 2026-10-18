import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StudioFix } from "../../../src/studio/types.js";

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
const { startPublish, publishStatus } = await import("../../../src/studio/publish.js");
const { closestName } = await import("../../../src/studio/collectors/actions-home.js");

type Row = Record<string, unknown>;
/** Rows per object, or a function of the query for objects tests filter on. */
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
const PSL = "0PL000000000001";

const PROFILES = [
  { Id: "00e000000000001", Name: "System Administrator" },
  { Id: "00e000000000002", Name: "LS MT Field Sales Representative" },
];

const assign: StudioFix = {
  kind: "assignPsl",
  label: "Assign Life Science Commercial",
  userId: USER,
  userName: "ES Rep",
  pslId: PSL,
  pslLabel: "Life Science Commercial",
};

const setProfiles: StudioFix = {
  kind: "setConfigField",
  label: 'Replace with "LS MT Field Sales Representative"',
  category: "QuickAction",
  developerName: "New_Visit",
  recordLabel: "New Visit",
  field: "Profiles",
  from: "System Administrator;LS MedTech Field Sales Representative",
  to: "System Administrator;LS MT Field Sales Representative",
};

beforeEach(() => {
  vi.clearAllMocks();
  org = {
    User: (q) =>
      /GROUP BY/i.test(q)
        ? [
            { pn: "LS MT Field Sales Representative", cnt: 14 },
            { pn: "System Administrator", cnt: 2 },
          ]
        : [{ Id: USER, IsActive: true }],
    Profile: (q) => PROFILES.filter((p) => q.includes(`'${p.Id}'`) || q.includes(`'${p.Name}'`)),
    PermissionSetLicense: [{ Id: PSL, MasterLabel: "Life Science Commercial", UsedLicenses: 3, TotalLicenses: 10 }],
    PermissionSetLicenseAssign: [],
    LifeSciConfigRecord: [{ Id: "1LR000000000001" }],
    LifeSciConfigFieldValue: [
      { Id: "1LF000000000001", FieldName: "Profiles", DataType: "TEXT", TextValue: setProfiles.from },
    ],
  };
  vi.mocked(cli.runSoqlQuery).mockImplementation(respond as never);
  vi.mocked(cli.runToolingQuery).mockImplementation(respond as never);
  vi.mocked(cli.createRecord).mockResolvedValue({ success: true, data: { id: "0PA000000000001" } });
  vi.mocked(cli.deleteRecord).mockResolvedValue({ success: true, data: { id: "0PA000000000001" } });
  vi.mocked(cli.updateToolingRecord).mockResolvedValue({ success: true });
  vi.mocked(cli.updateRecord).mockResolvedValue({ success: true });
  vi.mocked(cli.createToolingRecord).mockResolvedValue({ success: true, data: { id: "1LA000000000099" } });
  vi.mocked(cli.deleteToolingRecord).mockResolvedValue({ success: true });
});

describe("assignPsl", () => {
  it("previews remaining capacity and applies with an undo", async () => {
    const preview = await previewFix(assign, "org");
    expect(preview.blocked).toBeUndefined();
    expect(preview.warnings).toEqual(["Uses 1 of 7 remaining Life Science Commercial licenses."]);

    const result = await applyFix(assign, "org");
    expect(cli.createRecord).toHaveBeenCalledWith(
      "PermissionSetLicenseAssign",
      { AssigneeId: USER, PermissionSetLicenseId: PSL },
      "org"
    );
    expect(result).toMatchObject({ ok: true, undo: { kind: "removePsl", assignmentId: "0PA000000000001" } });
  });

  it("refuses when no licenses are left or the user already has one", async () => {
    (org.PermissionSetLicense as Row[])[0].UsedLicenses = 10;
    expect((await previewFix(assign, "org")).blocked).toBe("No Life Science Commercial licenses left (10 of 10 used).");

    org.PermissionSetLicenseAssign = [{ Id: "0PA000000000009" }];
    const result = await applyFix(assign, "org");
    expect(result.ok).toBe(false);
    expect(cli.createRecord).not.toHaveBeenCalled();
  });

  it("rejects malformed Ids before querying", async () => {
    await expect(previewFix({ ...assign, userId: "x' OR Id != '" }, "org")).rejects.toThrow("Invalid record Id");
    expect(cli.runSoqlQuery).not.toHaveBeenCalled();
  });
});

describe("setConfigField", () => {
  it("writes the typed value column and returns the inverse as undo", async () => {
    const result = await applyFix(setProfiles, "org");
    expect(cli.updateToolingRecord).toHaveBeenCalledWith(
      "LifeSciConfigFieldValue",
      "1LF000000000001",
      { TextValue: setProfiles.to },
      "org"
    );
    expect(result.undo).toMatchObject({ kind: "setConfigField", from: setProfiles.to, to: setProfiles.from });
  });

  it("refuses to write when the org changed since the map was loaded", async () => {
    (org.LifeSciConfigFieldValue as Row[])[0].TextValue = "System Administrator";
    const result = await applyFix(setProfiles, "org");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("changed since the map was loaded");
    expect(cli.updateToolingRecord).not.toHaveBeenCalled();
  });

  it("rejects record references that aren't plain API names", async () => {
    await expect(previewFix({ ...setProfiles, developerName: "x' OR Id != '" }, "org")).rejects.toThrow(
      "Invalid config record reference"
    );
  });
});

describe("setConfigField on Profiles", () => {
  it("says who gains access and reminds to publish", async () => {
    const preview = await previewFix(setProfiles, "org");
    expect(preview.blocked).toBeUndefined();
    expect(preview.warnings).toEqual([
      "Gives access to 14 active users (LS MT Field Sales Representative).",
      "Publish to iPad afterwards so reps get the change.",
    ]);
  });

  it("warns about a profile name that isn't in the org instead of letting a typo through silently", async () => {
    const typo = { ...setProfiles, to: "System Administrator;LS MT Feild Sales Representative" };
    const preview = await previewFix(typo, "org");
    expect(preview.blocked).toBeUndefined();
    expect(preview.warnings).toContain("Not a profile in this org: LS MT Feild Sales Representative.");
  });
});

describe("setActive", () => {
  const tab: StudioFix = {
    kind: "setActive",
    label: "Deactivate Visit",
    record: { type: "config", category: "DbSchema", developerName: "Visit", label: "Visit" },
    from: true,
    to: false,
  };
  const handler: StudioFix = {
    kind: "setActive",
    label: "Deactivate DCR",
    record: { type: "triggerHandler", developerName: "DataChangeRequest", label: "DCR" },
    from: true,
    to: false,
  };

  beforeEach(() => {
    org.LifeSciConfigRecord = [{ Id: "1LR000000000001", IsActive: true }];
    org.LifeScienceTriggerHandler = [{ Id: "a0X000000000001", IsActive: true }];
  });

  it("deactivates a DB Schema record with a sync warning and an undo", async () => {
    const preview = await previewFix(tab, "org");
    expect(preview.warnings).toEqual([
      "These records stop syncing to the iPad.",
      "Publish to iPad afterwards so reps get the change.",
    ]);
    const result = await applyFix(tab, "org");
    expect(cli.updateToolingRecord).toHaveBeenCalledWith("LifeSciConfigRecord", "1LR000000000001", { IsActive: false }, "org");
    expect(result.undo).toMatchObject({ kind: "setActive", from: false, to: true, label: "Activate Visit" });
  });

  it("warns that trigger handlers are org-wide and writes through the Tooling API", async () => {
    const preview = await previewFix(handler, "org");
    expect(preview.warnings[0]).toContain("for the whole org");
    await applyFix(handler, "org");
    expect(cli.runSoqlQuery).not.toHaveBeenCalled();
    expect(cli.updateToolingRecord).toHaveBeenCalledWith("LifeScienceTriggerHandler", "a0X000000000001", { IsActive: false }, "org");
  });

  it("refuses when the record is already in that state or gone", async () => {
    org.LifeScienceTriggerHandler = [{ Id: "a0X000000000001", IsActive: false }];
    expect((await previewFix(handler, "org")).blocked).toBe("Already inactive. Refresh the map.");
    org.LifeSciConfigRecord = [];
    const result = await applyFix(tab, "org");
    expect(result).toMatchObject({ ok: false, message: "Visit no longer exists." });
    expect(cli.updateToolingRecord).not.toHaveBeenCalled();
  });
});

describe("setProfileAssignments", () => {
  const change: StudioFix = {
    kind: "setProfileAssignments",
    label: "Change who sees Accounts",
    category: "UISchema",
    developerName: "Accounts_Tab",
    recordLabel: "Accounts",
    from: ["System Administrator"],
    to: ["LS MT Field Sales Representative"],
  };

  beforeEach(() => {
    org.LifeSciConfigAssignment = [{ Id: "1LA000000000001", AssignedToId: "00e000000000001" }];
  });

  it("adds then removes assignments and returns the inverse as undo", async () => {
    const preview = await previewFix(change, "org");
    expect(preview.blocked).toBeUndefined();
    expect(preview.warnings).toContain("Gives access to 14 active users (LS MT Field Sales Representative).");
    expect(preview.warnings).toContain("Takes access away from 2 active users (System Administrator).");

    const result = await applyFix(change, "org");
    expect(cli.createToolingRecord).toHaveBeenCalledWith(
      "LifeSciConfigAssignment",
      { LifeSciConfigRecordId: "1LR000000000001", AssignedToId: "00e000000000002", AssignmentLevel: "Profile" },
      "org"
    );
    expect(cli.deleteToolingRecord).toHaveBeenCalledWith("LifeSciConfigAssignment", "1LA000000000001", "org");
    expect(result).toMatchObject({ ok: true, undo: { from: change.to, to: change.from } });
  });

  it("refuses when assignments changed since the map was loaded", async () => {
    org.LifeSciConfigAssignment = [];
    expect((await previewFix(change, "org")).blocked).toContain("changed since the map was loaded (now none)");
  });

  it("refuses unknown profiles", async () => {
    const preview = await previewFix({ ...change, to: ["Ghost Profile"] }, "org");
    expect(preview.blocked).toBe("Profile not found: Ghost Profile.");
  });

  it("rolls back created assignments when a removal fails", async () => {
    vi.mocked(cli.deleteToolingRecord).mockResolvedValueOnce({ success: false, error: "locked" });
    const result = await applyFix(change, "org");
    expect(result).toMatchObject({ ok: false, message: "Couldn't unassign System Administrator: locked. Nothing was changed." });
    // The rollback deletes the assignment it had just created.
    expect(cli.deleteToolingRecord).toHaveBeenLastCalledWith("LifeSciConfigAssignment", "1LA000000000099", "org");
  });
});

describe("publish to iPad", () => {
  it("creates the parent and per-profile records, marks them ready, then generates", async () => {
    vi.mocked(cli.createRecord)
      .mockResolvedValueOnce({ success: true, data: { id: "1MR000000000001" } })
      .mockResolvedValueOnce({ success: true, data: { id: "1MR000000000002" } });
    const status = await startPublish(["LS MT Field Sales Representative"], "org");
    expect(cli.createRecord).toHaveBeenLastCalledWith(
      "LifeSciMobileMetadataRecord",
      expect.objectContaining({ ParentMobileMetadataRecId: "1MR000000000001", ProfileId: "00e000000000002" }),
      "org"
    );
    expect(vi.mocked(cli.updateRecord).mock.calls.map((c) => c[1])).toEqual(["1MR000000000001", "1MR000000000002"]);
    expect(cli.generateMobileMetadataCache).toHaveBeenCalledWith("1MR000000000001", "65.0", "lsc4ce", "org");
    expect(status).toMatchObject({ parentId: "1MR000000000001", state: "running" });
  });

  it("refuses unknown profiles before writing anything", async () => {
    await expect(startPublish(["Ghost Profile"], "org")).rejects.toThrow("Profile not found: Ghost Profile");
    expect(cli.createRecord).not.toHaveBeenCalled();
  });

  it("reports progress from the parent record", async () => {
    org.LifeSciMobileMetadataRecord = [
      { Id: "1MR000000000001", Status: "Error", IntegrationStatus: "Error", IntegrationErrorMessage: "Boom" },
      { Id: "1MR000000000002", Profile: { Name: "LS MT Field Sales Representative" } },
    ];
    expect(await publishStatus("1MR000000000001", "org")).toMatchObject({
      state: "failed",
      error: "Boom",
      profiles: ["LS MT Field Sales Representative"],
    });
    (org.LifeSciMobileMetadataRecord as Row[])[0] = { Id: "1MR000000000001", Status: "Active" };
    expect((await publishStatus("1MR000000000001", "org")).state).toBe("done");
  });

  it("is only done once the cache is Active: Published and Loading are still running, Inactive failed", async () => {
    const at = async (Status: string) => {
      org.LifeSciMobileMetadataRecord = [{ Id: "1MR000000000001", Status }];
      return publishStatus("1MR000000000001", "org");
    };
    expect((await at("Published")).state).toBe("running");
    expect((await at("Loading")).state).toBe("running");
    expect(await at("Inactive")).toMatchObject({ state: "failed", error: expect.stringContaining("without activating it") });
  });
});

describe("closestName", () => {
  const profiles = ["LS MT Field Sales Representative", "LS PH Field Sales Representative", "System Administrator"];

  it("suggests the clearly closest existing name", () => {
    expect(closestName("LS MedTech Field Sales Representative", profiles)).toBe("LS MT Field Sales Representative");
  });

  it("makes no suggestion when nothing is close or two candidates tie", () => {
    expect(closestName("Marketing User", profiles)).toBeNull();
    expect(closestName("LS XX Field Sales Representative", profiles)).toBeNull();
  });
});
