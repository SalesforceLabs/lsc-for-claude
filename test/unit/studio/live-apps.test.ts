import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  cachedDescribeSObject: vi.fn(),
  describeSObject: vi.fn(),
  apiRequest: vi.fn(),
  retrieveMetadata: vi.fn(),
}));

const cli = await import("../../../src/salesforce/cli.js");
const live = await import("../../../src/studio/metadata/live.js");

type Row = Record<string, unknown>;

const ID_A = "06m000000000001AAA";
const ID_B = "06m000000000002AAA";
const LONG_AGO = "2020-01-01T00:00:00.000+0000";

let apps: Record<string, { modified: string; label: string; dev: string; ns?: string; manageable?: string; metadata: Row }>;
let metadataReads: string[];

function respond(q: string) {
  if (/WHERE Id = '(\w+)'/.test(q)) {
    const id = /WHERE Id = '(\w+)'/.exec(q)![1];
    metadataReads.push(id);
    const a = apps[id];
    return Promise.resolve({ success: true, data: { totalSize: 1, done: true, records: [{ Label: a.label, DeveloperName: a.dev, NamespacePrefix: a.ns ?? null, Metadata: a.metadata }] } });
  }
  const records = Object.entries(apps).map(([Id, a]) => ({
    Id,
    DeveloperName: a.dev,
    NamespacePrefix: a.ns ?? null,
    Label: a.label,
    ManageableState: a.manageable ?? "unmanaged",
    LastModifiedDate: a.modified,
  }));
  return Promise.resolve({ success: true, data: { totalSize: records.length, done: true, records } });
}

beforeEach(() => {
  vi.clearAllMocks();
  metadataReads = [];
  apps = {
    [ID_A]: {
      modified: LONG_AGO,
      label: "Sales",
      dev: "Sales",
      metadata: {
        label: "Sales",
        actionOverrides: [
          { content: "PageX", formFactor: "Large" },
          { content: "PageX", formFactor: "Small" },
        ],
        profileActionOverrides: [
          { content: "PageX", profile: "LS%20Rep", formFactor: "Large" },
          { content: "PageX", profile: "Admin" },
          { content: "PageX", profile: "Phone", formFactor: "Small" },
        ],
      },
    },
    [ID_B]: { modified: LONG_AGO, label: "Service", dev: "Service", metadata: { label: "Service", actionOverrides: [], profileActionOverrides: [] } },
  };
  vi.mocked(cli.runSoqlQuery).mockImplementation(respond as never);
  vi.mocked(cli.runToolingQuery).mockImplementation(respond as never);
});

describe("app overrides over Tooling", () => {
  it("gives the page assignments a wildcard retrieve would (large form factors, no formFactor means large)", async () => {
    const got = await live.appOverridesViaTooling("live-apps-1");
    expect(live.pageAssignmentsOf(got!)).toEqual({
      profiles: [["PageX", ["LS Rep", "System Administrator"]]],
      appDefaults: [["PageX", ["Sales"]]],
    });
    expect(got!.map((a) => a.fullName)).toEqual(["Sales", "Service"]);
  });

  it("leaves out apps installed from a package, as a wildcard retrieve does", async () => {
    apps[ID_B].manageable = "installed";
    const got = await live.appOverridesViaTooling("live-apps-2");
    expect(got!.map((a) => a.fullName)).toEqual(["Sales"]);
  });

  it("reads an app again only when its last-modified time changed", async () => {
    await live.appOverridesViaTooling("live-apps-3");
    expect(metadataReads.sort()).toEqual([ID_A, ID_B]);
    metadataReads = [];
    await live.appOverridesViaTooling("live-apps-3");
    expect(metadataReads).toEqual([]);
    apps[ID_B].modified = "2021-01-01T00:00:00.000+0000";
    apps[ID_B].metadata = { label: "Service", actionOverrides: [{ content: "PageX", formFactor: "Large" }], profileActionOverrides: [] };
    const got = await live.appOverridesViaTooling("live-apps-3");
    expect(metadataReads).toEqual([ID_B]);
    expect(await live.appsReferencingPage("PageX", "live-apps-3")).toEqual(["Sales", "Service"]);
    expect(got!.find((a) => a.fullName === "Service")!.actionOverrides).toHaveLength(1);
  });

  it("does not trust a read made right after the app was saved", async () => {
    apps[ID_A].modified = new Date().toISOString();
    await live.appOverridesViaTooling("live-apps-4");
    metadataReads = [];
    await live.appOverridesViaTooling("live-apps-4");
    expect(metadataReads).toEqual([ID_A]);
  });

  it("is null when a read fails, so callers fall back", async () => {
    vi.mocked(cli.runToolingQuery).mockResolvedValue({ success: false, error: "nope" } as never);
    vi.mocked(cli.runSoqlQuery).mockResolvedValue({ success: false, error: "nope" } as never);
    expect(await live.appOverridesViaTooling("live-apps-5")).toBeNull();
    expect(await live.appsReferencingPage("PageX", "live-apps-5")).toBeNull();
  });
});
