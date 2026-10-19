import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  cachedDescribeSObject: vi.fn(),
  apiRequest: vi.fn(),
}));

const cli = await import("../../../src/salesforce/cli.js");
const { buildCatalog, collectCatalog } = await import("../../../src/studio/component-catalog.js");

const input = {
  pageType: "RecordPage" as const,
  sobject: "Account",
  lwcs: [
    { component: "lscMobileInline_Zeta", label: "Zeta" },
    { component: "lsc4ce:lscMobileInline_Alpha", label: "Alpha" },
  ],
  children: [
    { relationshipName: "Visits", childSObject: "Visit" },
    { relationshipName: "Gadgets__r", childSObject: "Gadget__c" },
    { relationshipName: "ContactPointAddresses", childSObject: "ContactPointAddress" },
  ],
  synced: new Set(["Visit", "ContactPointAddress"]),
};

describe("component catalog", () => {
  it("offers Recent items, inline LWCs at 400 high and synced related lists; greys out the rest with why", () => {
    const entries = buildCatalog(input);
    expect(entries.filter((e) => e.insertable).map((e) => e.key)).toEqual([
      "lsc4ce:lscMobileInline_Alpha",
      "lscMobileInline_Zeta",
      "force:relatedListSingleContainer:ContactPointAddresses",
      "force:relatedListSingleContainer:Visits",
    ]);
    const alpha = entries.find((e) => e.key === "lsc4ce:lscMobileInline_Alpha")!;
    expect(alpha.properties).toEqual([{ name: "mobileHeight", value: "400" }]);
    const visits = entries.find((e) => e.key.endsWith(":Visits"))!;
    expect(visits).toMatchObject({ label: "Visits", group: "Related list", object: "Visit" });
    expect(visits.properties).toContainEqual({ name: "parentFieldApiName", value: "Account.Id" });
    expect(visits.properties).toContainEqual({ name: "relatedListApiName", value: "Visits" });
    const gadgets = entries.find((e) => e.key.endsWith(":Gadgets__r"))!;
    expect(gadgets).toMatchObject({ insertable: false, label: "Gadgets", needs: expect.stringContaining("Gadget__c doesn't sync") });
    expect(entries.at(-1)).toBe(gadgets);
    const dashboard = entries.find((e) => e.component === "desktopDashboards:embeddedDashboard")!;
    expect(dashboard).toMatchObject({ insertable: false, needs: expect.stringContaining("Lightning App Builder") });
  });

  it("doesn't offer activity children (Events, Tasks) as related lists, which the org rejects", () => {
    const entries = buildCatalog({
      ...input,
      children: [{ relationshipName: "Events", childSObject: "Event" }, { relationshipName: "Visits", childSObject: "Visit" }],
      synced: new Set(["Visit", "Event"]),
    });
    expect(entries.find((e) => e.key.endsWith(":Events"))).toMatchObject({ insertable: false, needs: expect.stringContaining("is an activity") });
    expect(entries.find((e) => e.key.endsWith(":Visits"))!.insertable).toBe(true);
  });

  it("has no related lists or tabs on a Home page", () => {
    const entries = buildCatalog({ ...input, pageType: "HomePage", sobject: null });
    expect(entries.some((e) => e.group === "Related list" || e.component === "flexipage:tabset")).toBe(false);
    // The org rejects Recent items without its object list, so it can't be inserted with plain properties.
    expect(entries.find((e) => e.key === "flexipage:recentItems")).toMatchObject({ insertable: false, needs: expect.stringContaining("the objects it lists") });
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
  });

  describe("collectCatalog", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(cli.runToolingQuery).mockImplementation((async (q: string) => {
        const records = q.includes("LightningComponentResource")
          ? [
              { LightningComponentBundle: { DeveloperName: "lscMobileInline_CarouselLwc", NamespacePrefix: null }, Source: "<LightningComponentBundle><targetConfigs><targetConfig targets=\"lightning__RecordPage\"><property name=\"mobileHeight\" type=\"Integer\"/></targetConfig></targetConfigs></LightningComponentBundle>" },
            ]
          : q.includes("LightningComponentBundle")
          ? [
              { DeveloperName: "lscMobileInline_CarouselLwc", NamespacePrefix: null, MasterLabel: "Carousel" },
              { DeveloperName: "lscMobileInlineHelper", NamespacePrefix: null, MasterLabel: "Not inline" },
            ]
          : [{ ObjectValue: "Visit" }];
        return { success: true, data: { totalSize: records.length, done: true, records } };
      }) as never);
      vi.mocked(cli.cachedDescribeSObject).mockResolvedValue({
        success: true,
        data: { name: "Account", label: "Account", fields: [], childRelationships: [{ childSObject: "Visit", field: "AccountId", relationshipName: "Visits" }, { childSObject: "X", field: "Y" }] },
      } as never);
    });

    it("reads the org's inline LWCs and the object's synced child lists", async () => {
      const { entries, setupPath } = await collectCatalog("RecordPage", "Account", "org");
      expect(entries.filter((e) => e.insertable).map((e) => e.key)).toEqual(["lscMobileInline_CarouselLwc", "force:relatedListSingleContainer:Visits"]);
      expect(setupPath).toMatch(/^\/lightning\/setup\//);
    });

    it("gives no mobileHeight to an inline LWC whose js-meta.xml doesn't declare it, and keeps it when the bundle can't be read", async () => {
      vi.mocked(cli.runToolingQuery).mockImplementation((async (q: string) => {
        const records = q.includes("LightningComponentResource")
          ? [{ LightningComponentBundle: { DeveloperName: "lscMobileInline_Bare", NamespacePrefix: null }, Source: "<LightningComponentBundle><targets><target>lightning__RecordPage</target></targets></LightningComponentBundle>" }]
          : [
              { DeveloperName: "lscMobileInline_Bare", NamespacePrefix: null, MasterLabel: "Bare" },
              { DeveloperName: "lscMobileInline_Hidden", NamespacePrefix: "mgd", MasterLabel: "Hidden" },
            ];
        return { success: true, data: { totalSize: records.length, done: true, records } };
      }) as never);
      const { entries } = await collectCatalog("HomePage", null, "org");
      expect(entries.find((e) => e.key === "lscMobileInline_Bare")!.properties).toEqual([]);
      expect(entries.find((e) => e.key === "mgd:lscMobileInline_Hidden")!.properties).toEqual([{ name: "mobileHeight", value: "400" }]);
    });

    it("doesn't describe anything for a Home page and refuses bad object names", async () => {
      await collectCatalog("HomePage", null, "org");
      expect(cli.cachedDescribeSObject).not.toHaveBeenCalled();
      await expect(collectCatalog("RecordPage", "Account' OR", "org")).rejects.toThrow(/Invalid object/);
    });
  });
});
