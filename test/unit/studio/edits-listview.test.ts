import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { StudioFix } from "../../../src/studio/types.js";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  cachedDescribeSObject: vi.fn(),
  describeSObject: vi.fn(),
  apiRequest: vi.fn(),
  updateToolingRecord: vi.fn(),
  retrieveMetadata: vi.fn(),
  deployMetadata: vi.fn(),
}));

const cli = await import("../../../src/salesforce/cli.js");
const { previewFix, applyFix } = await import("../../../src/studio/fixes.js");
const { readLiveListView } = await import("../../../src/studio/metadata/live.js");
const { listColumns } = await import("../../../src/studio/metadata/listview-ops.js");
const { parseXml } = await import("../../../src/studio/metadata/xml.js");
const draft = await import("../../../src-renderer/components/studio/listview-draft.js");
const { listViewOpsChange } = await import("../../../src-renderer/components/studio/changes.js");

type Row = Record<string, unknown>;
let org: Record<string, Row[]>;

function respond(query: string) {
  const from = /FROM\s+(\w+)/i.exec(query)?.[1] ?? "";
  const rows = org[from] ?? [];
  return Promise.resolve({ success: true, data: { totalSize: rows.length, done: true, records: rows } });
}

const load = (name: string) => fs.readFileSync(path.join(__dirname, `../../fixtures/metadata/${name}.listView-meta.xml`), "utf-8");
const FULL_NAME = "Account.Shared_Reps";
let xml = load(FULL_NAME);
const fields = [
  { name: "Name", label: "Account Name", type: "string", filterable: true },
  { name: "Phone", label: "Phone", type: "phone", filterable: true },
  { name: "Industry", label: "Industry", type: "picklist", filterable: true },
  { name: "Type", label: "Type", type: "picklist", filterable: true },
  { name: "Website", label: "Website", type: "url", filterable: true },
];

describe("editMetadata (list views)", () => {
  let dir: string;
  let deployed: string | null;
  let n = 0;
  let target: string;

  beforeEach(() => {
    vi.clearAllMocks();
    target = `lvorg${++n}`;
    xml = load(FULL_NAME);
    org = { Organization: [{ IsSandbox: true }] };
    vi.mocked(cli.runSoqlQuery).mockImplementation(respond as never);
    vi.mocked(cli.runToolingQuery).mockImplementation(respond as never);
    vi.mocked(cli.cachedDescribeSObject).mockResolvedValue({ success: true, data: { name: "Account", fields } } as never);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-lv-"));
    deployed = null;
    vi.mocked(cli.retrieveMetadata).mockImplementation(async () => {
      const out = fs.mkdtempSync(path.join(dir, "out-"));
      fs.mkdirSync(path.join(out, "listViews"));
      fs.writeFileSync(path.join(out, "listViews", "Account.Shared_Reps.listView-meta.xml"), xml);
      return { success: true, data: { outputDir: out } };
    });
    vi.mocked(cli.deployMetadata).mockImplementation(async (source) => {
      deployed = fs.readFileSync(source, "utf-8");
      return { success: true };
    });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const fixOf = (ops: Parameters<typeof listViewOpsChange>[2]) => listViewOpsChange(FULL_NAME, "Shared Reps", ops) as StudioFix;

  it("deploys the list view the renderer drew, and returns the undo", async () => {
    const live = await readLiveListView(FULL_NAME, target);
    expect(live.sharedTo).toEqual([
      { kind: "group", name: "Field_Reps" },
      { kind: "role", name: "East_Reps" },
    ]);
    expect(live.available.map((a) => a.name)).toContain("Website");

    const d: import("../../../src-renderer/components/studio/listview-draft.js").ListViewDraft = {
      fullName: FULL_NAME,
      label: live.label,
      live,
      base: draft.modelOf(live),
      target: draft.modelOf(live),
      shown: live.columns,
      legacy: false,
    };
    let q = d.base && draft.listColumnVerbs(d, "Phone", "Phone").find((v) => v.id === "up")!.run!([]);
    const d2 = { ...d, target: draft.listViewTargetOf(FULL_NAME, d.base, q) };
    q = draft.listViewVerbs(d2)[0].pick!.run("Website", q);
    const drawn = draft.listViewTargetOf(FULL_NAME, d.base, q).columns;
    const fix = q[0].fix;

    const preview = await previewFix(fix, target);
    expect(preview.blocked).toBeUndefined();
    expect(preview.changes.length).toBeGreaterThan(0);
    expect(preview.warnings.join(" ")).toMatch(/shared with group Field_Reps, role East_Reps/);
    expect(preview.warnings.join(" ")).toMatch(/no publish to iPad is needed/);
    expect(fs.readdirSync(dir)).toEqual([]);

    const result = await applyFix(fix, target);
    expect(result.ok).toBe(true);
    expect(listColumns(parseXml(deployed!))).toEqual(drawn);
    expect(cli.deployMetadata).toHaveBeenCalledWith(expect.stringMatching(/listView-meta\.xml$/), target);
    expect(result.undo).toMatchObject({ kind: "editMetadata", doc: { type: "ListView", fullName: FULL_NAME } });
  });

  it("changes the scope and filters and keeps the rest of the file", async () => {
    const live = await readLiveListView(FULL_NAME, target);
    const m = draft.modelOf(live);
    const fix = fixOf(
      draft.diffListViewOps(m, { ...m, scope: "Mine", filters: m.filters.slice(0, 1), logic: null })
    );
    const result = await applyFix(fix, target);
    expect(result.ok).toBe(true);
    expect(deployed).toContain("<filterScope>Mine</filterScope>");
    expect(deployed).not.toContain("<booleanFilter>");
    expect(deployed).toContain("<sharedTo>");
  });

  it("flags production", async () => {
    org.Organization = [{ IsSandbox: false }];
    const preview = await previewFix(fixOf([{ op: "removeListColumn", column: "Phone" }]), target);
    expect(preview.production).toBe(true);
  });

  it("refuses when the list view changed since the preview was loaded, at preview and at apply", async () => {
    const stale = fixOf([{ op: "removeListColumn", column: "Fax" }]);
    expect((await previewFix(stale, target)).blocked).toMatch(/Shared Reps changed since the preview was loaded: Fax isn't a column/);
    expect((await applyFix(stale, target)).ok).toBe(false);
    expect(cli.deployMetadata).not.toHaveBeenCalled();
  });

  it("refuses a managed list view", async () => {
    xml = xml.replace("<fullName>Shared_Reps</fullName>", "<fullName>FSL__All</fullName>");
    const managed = listViewOpsChange("Account.FSL__All", "All", [{ op: "removeListColumn", column: "Phone" }]) as StudioFix;
    expect((await previewFix(managed, target)).blocked).toMatch(/managed package/);
    expect((await applyFix(managed, target)).ok).toBe(false);
    expect(cli.deployMetadata).not.toHaveBeenCalled();
  });

  it("refuses layout ops on a list view", async () => {
    const mixed = { ...fixOf([]), ops: [{ op: "removeField", field: "Name" }] } as unknown as StudioFix;
    expect((await previewFix(mixed, target)).blocked).toBeTruthy();
  });
});
