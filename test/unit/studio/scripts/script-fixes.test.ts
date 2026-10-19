import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { StudioFix } from "../../../../src/studio/types.js";

vi.mock("../../../../src/salesforce/cli.js", () => ({
  orgApiVersion: async () => "66.0",
  dataPath: async (_org: string, rest: string) => `/services/data/v66.0${rest}`,
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  cachedDescribeSObject: vi.fn(),
  describeSObject: vi.fn(),
  apiRequest: vi.fn(),
  updateToolingRecord: vi.fn(),
  retrieveMetadata: vi.fn(),
  deployMetadata: vi.fn(),
  deleteMetadata: vi.fn(),
}));

const cli = await import("../../../../src/salesforce/cli.js");
const { previewFix, applyFix } = await import("../../../../src/studio/fixes.js");

type Row = Record<string, unknown>;
let org: Record<string, Row[]>;
let nextId = 1;
const newId = (prefix: string) => `${prefix}${String(nextId++).padStart(12, "0")}`;

function respond(query: string) {
  const from = /FROM\s+(\w+)/i.exec(query)?.[1] ?? "";
  const rows = org[from] ?? [];
  return Promise.resolve({ success: true, data: { totalSize: rows.length, done: true, records: rows } });
}

const CODE = "(() => {\n  return [];\n})();";
const STAGE = "a2C000000000009";

const create: StudioFix = {
  kind: "createCustomScript",
  label: "Create script rozTest Check",
  name: "rozTest Check",
  componentName: "rozTestCheck",
  type: "Validation",
  objectName: "ProviderVisit",
  operationEventType: null,
  code: CODE,
  assign: [{ stageObjectId: STAGE, role: "validation" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 1;
  org = {
    LifeScienceCustomScript: [],
    LightningComponentBundle: [],
    LightningComponentResource: [],
    LifeSciStageObject: [{ Id: STAGE, Name: "Visit stage", ObjectName: "ProviderVisit", ValidationCustomScriptId: null, ChecklistCustomScriptId: null }],
  };
  vi.mocked(cli.runSoqlQuery).mockImplementation(respond as never);
  vi.mocked(cli.runToolingQuery).mockImplementation(respond as never);
  vi.mocked(cli.describeSObject).mockResolvedValue({ success: true, data: { name: "LifeScienceCustomScript", label: "Script", fields: [] } } as never);
  vi.mocked(cli.deployMetadata).mockImplementation((async (dir: string) => {
    const lwc = path.join(dir, "lwc");
    for (const name of fs.readdirSync(lwc)) {
      org.LightningComponentBundle.push({ Id: newId("0Rb"), DeveloperName: name, NamespacePrefix: null, ManageableState: "unmanaged" });
      org.LightningComponentResource.push({ Id: newId("0Rc"), FilePath: `lwc/${name}/${name}.js`, Source: fs.readFileSync(path.join(lwc, name, `${name}.js`), "utf-8") });
    }
    return { success: true };
  }) as never);
  vi.mocked(cli.deleteMetadata).mockImplementation((async () => {
    org.LightningComponentBundle = [];
    org.LightningComponentResource = [];
    return { success: true };
  }) as never);
  vi.mocked(cli.apiRequest).mockImplementation((async (url: string, method: string, body?: Row) => {
    const [, sobject, id] = /sobjects\/(\w+)(?:\/(\w+))?/.exec(url) ?? [];
    if (sobject === "LifeScienceCustomScript") {
      if (method === "POST") {
        const row = { Id: newId("a1B"), Name: body?.Name, ComponentName: body?.ComponentName, Type: body?.Type, ObjectName: body?.ObjectName ?? null, OperationEventType: body?.OperationEventType ?? null, CodeText: org.LightningComponentResource[0]?.Source ?? "" };
        org.LifeScienceCustomScript.push(row);
        return { success: true, data: { id: row.Id } };
      }
      if (method === "DELETE") org.LifeScienceCustomScript = org.LifeScienceCustomScript.filter((r) => r.Id !== id);
    }
    if (sobject === "LifeSciStageObject" && method === "PATCH") Object.assign(org.LifeSciStageObject[0], body);
    return { success: true };
  }) as never);
});

describe("createCustomScript / deleteCustomScript", () => {
  it("creates the component and the script, assigns it, and the undo removes all of it", async () => {
    const preview = await previewFix(create, "org");
    expect(preview.blocked).toBeUndefined();
    expect(preview.changes.map((c) => c.field)).toContain("Validation script");

    const result = await applyFix(create, "org");
    expect(result.ok).toBe(true);
    expect(org.LifeScienceCustomScript).toHaveLength(1);
    expect(org.LightningComponentBundle).toHaveLength(1);
    expect(org.LifeSciStageObject[0].ValidationCustomScriptId).toBe(org.LifeScienceCustomScript[0].Id);
    expect(result.undo).toMatchObject({ kind: "deleteCustomScript", deleteBundle: true });

    const undone = await applyFix(result.undo as StudioFix, "org");
    expect(undone.ok).toBe(true);
    expect(org.LifeScienceCustomScript).toHaveLength(0);
    expect(org.LightningComponentBundle).toHaveLength(0);
    expect(org.LifeSciStageObject[0].ValidationCustomScriptId).toBeNull();
    // Undoing the undo brings back the script, its code and its assignment.
    expect(undone.undo).toMatchObject({ kind: "createCustomScript", code: CODE, assign: [{ stageObjectId: STAGE, role: "validation" }] });
  });

  it("rolls back the component when the script can't be created", async () => {
    vi.mocked(cli.apiRequest).mockResolvedValue({ success: false, error: "INSUFFICIENT_ACCESS" } as never);
    const result = await applyFix(create, "org");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("INSUFFICIENT_ACCESS");
    expect(org.LightningComponentBundle).toHaveLength(0);
  });

  it("is blocked when the component name is taken", async () => {
    org.LightningComponentBundle = [{ Id: "0Rb000000000099", DeveloperName: "rozTestCheck", NamespacePrefix: null, ManageableState: "unmanaged" }];
    org.LightningComponentResource = [{ Id: "0Rc000000000099", FilePath: "lwc/rozTestCheck/rozTestCheck.js", Source: "// other" }];
    expect((await previewFix(create, "org")).blocked).toContain("already exists");
  });

  it("is blocked on a bad component name and on a role that doesn't fit the type", async () => {
    expect((await previewFix({ ...create, componentName: "Bad_Name" } as StudioFix, "org")).blocked).toBeTruthy();
    expect((await previewFix({ ...create, type: "Checklist" } as StudioFix, "org")).blocked).toContain("Only a Validation script");
  });
});

describe("assignCustomScript", () => {
  const assign = (from: string | null, to: string | null): StudioFix => ({
    kind: "assignCustomScript",
    label: "Set the validation script of Visit stage",
    stageObjectId: STAGE,
    stageObjectName: "Visit stage",
    role: "validation",
    from,
    to,
  });

  it("assigns and returns the swapped undo", async () => {
    org.LifeScienceCustomScript = [{ Id: "a1B000000000050", Name: "S", ComponentName: "s", Type: "Validation", ObjectName: null, OperationEventType: null, CodeText: CODE }];
    const result = await applyFix(assign(null, "a1B000000000050"), "org");
    expect(result.ok).toBe(true);
    expect(org.LifeSciStageObject[0].ValidationCustomScriptId).toBe("a1B000000000050");
    expect(result.undo).toMatchObject({ kind: "assignCustomScript", from: "a1B000000000050", to: null });
  });

  it("is blocked when the stage object changed since it was read", async () => {
    org.LifeSciStageObject[0].ValidationCustomScriptId = "a1B000000000077";
    expect((await previewFix(assign(null, "a1B000000000050"), "org")).blocked).toBeTruthy();
  });
});
