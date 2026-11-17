import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/studio/helpers.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/studio/helpers.js")>()),
  query: vi.fn(),
  queryResult: vi.fn(),
}));
vi.mock("../../../../src/salesforce/cli.js", () => ({
  apiRequest: vi.fn(),
  dataPath: vi.fn(async (_o: string, rest: string) => rest),
}));
const helpers = await import("../../../../src/studio/helpers.js");
const cli = await import("../../../../src/salesforce/cli.js");
const dash = await import("../../../../src/studio/screens/manager/dashboards.js");
const logic =
  await import("../../../../src-renderer/components/studio/screens/manager/dashboards-logic.js");

beforeEach(() => {
  vi.mocked(helpers.query).mockReset();
  vi.mocked(helpers.queryResult).mockReset();
  vi.mocked(cli.apiRequest).mockReset();
});

const F = (id: string, name: string, parent = "") => ({
  Id: id,
  Name: name,
  ParentId: parent || null,
});
const D = (id: string, title: string, folder: string, folderName = "") => ({
  Id: id,
  Title: title,
  FolderId: folder,
  FolderName: folderName,
});

describe("buildDashboardTree", () => {
  it("nests subfolders, joins dashboards by folder id and sorts by title", () => {
    const tree = dash.buildDashboardTree(
      [F("f2", "Zeta"), F("f1", "Alpha"), F("f3", "Sub", "f1")],
      [D("d2", "b", "f1"), D("d1", "a", "f1"), D("d3", "c", "f3")]
    );
    expect(tree.map((s) => s.title)).toEqual(["Alpha", "Zeta"]);
    expect(tree[0].children.map((c) => `${c.kind}:${c.title}`)).toEqual([
      "folder:Sub",
      "dashboard:a",
      "dashboard:b",
    ]);
    expect(tree[0].children[0].children[0].title).toBe("c");
  });
  it("adds a Private Dashboards section for dashboards outside every folder", () => {
    const tree = dash.buildDashboardTree(
      [F("f1", "Alpha")],
      [D("d1", "Mine", "005X", "Private Dashboards")]
    );
    expect(tree.map((s) => s.title)).toEqual(["Alpha", "Private Dashboards"]);
    expect(tree[1].children[0].id).toBe("d1");
  });
});

describe("search", () => {
  it("flattens and matches case-insensitively", () => {
    const tree = dash.buildDashboardTree(
      [F("f1", "Alpha")],
      [D("d1", "Sales Overview", "f1"), D("d2", "Pipeline", "f1")]
    );
    expect(logic.searchDashboards(tree, "SALES").map((d) => d.title)).toEqual(["Sales Overview"]);
  });
  it("shows children only for open nodes", () => {
    const tree = dash.buildDashboardTree([F("f1", "Alpha")], [D("d1", "a", "f1")]);
    expect(logic.visibleRows(tree, new Set()).length).toBe(1);
    const key = logic.visibleRows(tree, new Set())[0].key;
    expect(logic.visibleRows(tree, new Set([key])).map((r) => r.item.title)).toEqual([
      "Alpha",
      "a",
    ]);
  });
});

describe("collectDashboards", () => {
  const ctx = (scope: (t: string) => string | undefined) =>
    ({ org: "o", userId: "005000000000001AAA", scope, note: vi.fn() }) as never;
  it("is 'No data available' when the tables aren't synced", async () => {
    const out = await dash.collectDashboards(ctx((t) => (t === "Folder" ? "" : undefined)));
    expect(out).toEqual({ noData: true, items: [] });
  });
  it("keeps what the rep can read", async () => {
    vi.mocked(helpers.queryResult).mockImplementation((async (soql: string) =>
      soql.includes("FROM Folder")
        ? {
            records: [F("00l000000000001AAA", "Open"), F("00l000000000002AAA", "Closed")],
            totalSize: 2,
            truncated: false,
          }
        : {
            records: [
              D("01Z000000000001AAA", "In open", "00l000000000001AAA"),
              D("01Z000000000002AAA", "In closed", "00l000000000002AAA"),
            ],
            totalSize: 2,
            truncated: false,
          }) as never);
    vi.mocked(helpers.query).mockResolvedValue([
      { RecordId: "00l000000000001AAA", HasReadAccess: true },
      { RecordId: "00l000000000002AAA", HasReadAccess: false },
    ]);
    const out = await dash.collectDashboards(ctx(() => ""));
    expect(out?.items.map((s) => s.title)).toEqual(["Open"]);
    expect(out?.items[0].children.map((d) => d.title)).toEqual(["In open"]);
    expect(out?.note).toBeUndefined();
  });
});

describe("loadDashboardDetail", () => {
  it("fails soft when the describe fails", async () => {
    vi.mocked(cli.apiRequest).mockResolvedValue({ success: false, error: "nope" });
    expect(await dash.loadDashboardDetail("o", "01Z000000000001AAA")).toEqual({
      dashboard: null,
      error: "nope",
    });
  });
  it("refuses an id that isn't one", async () => {
    expect((await dash.loadDashboardDetail("o", "x'y")).dashboard).toBeNull();
    expect(cli.apiRequest).not.toHaveBeenCalled();
  });
});
