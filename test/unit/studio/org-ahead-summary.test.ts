import { describe, expect, it } from "vitest";
import {
  describeSummary,
  prettyName,
  summarizeCompact,
  summarizeFlexiPage,
  summarizeLayout,
  summarizeListView,
} from "../../../src-renderer/components/studio/org-ahead-summary";
import { configSummary } from "../../../src/studio/unpublished-logic";
import type { PublishedLayout, PublishedListView, PublishedPage } from "../../../src-renderer/components/studio/published-types";
import type { LiveCompactLayout, LiveFlexiPage, LiveLayout, LiveListView } from "../../../src-renderer/components/studio/types";

const liveLayout = (sections: { label: string; fields: string[] }[], relatedLists: string[] = []): LiveLayout => ({
  type: "Layout",
  fullName: "Account-L",
  sections: sections.map((s) => ({ label: s.label, nth: 0, heading: true, columns: [s.fields.map((field) => ({ field, behavior: "Edit" as never }))] })),
  relatedLists,
  profiles: null,
  production: false,
  available: [{ field: "Phone", label: "Phone", type: "phone" }],
  availableRelated: null,
  placed: [
    { field: "Parent_Account__c", label: "Parent Account", type: "reference" },
    { field: "Name", label: "Account Name", type: "string" },
  ],
});
const pubLayout = (sections: { label: string; fields: string[] }[], related: string[] = []): PublishedLayout => ({
  name: "Account-L",
  sections: sections.map((s) => ({
    label: s.label,
    columns: [s.fields],
    source: { label: s.label, nth: 0, columns: [0], fields: [s.fields], heading: true },
  })),
  relatedLists: related.map((name) => ({ name, label: name })),
  actions: [],
});

describe("prettyName", () => {
  it("makes API names readable", () => {
    expect(prettyName("Parent_Account__c")).toBe("Parent Account");
    expect(prettyName("OwnerId")).toBe("Owner");
    expect(prettyName("LastModifiedDate")).toBe("Last Modified Date");
  });
});

describe("describeSummary", () => {
  it("names the first two lines and counts the rest", () => {
    expect(describeSummary(["Added A", "Removed B"]).text).toBe("Added A; Removed B");
    const many = describeSummary(["a", "b", "c", "d"]);
    expect(many.text).toBe("a; b; +2 more");
    expect(many.all).toHaveLength(4);
  });
  it("is empty with no lines and drops duplicates", () => {
    expect(describeSummary([]).text).toBe("");
    expect(describeSummary(["x", "x"]).all).toEqual(["x"]);
  });
});

describe("summarizeLayout", () => {
  it("says what was added and removed", () => {
    const pub = pubLayout([{ label: "Info", fields: ["Name", "Fax"] }]);
    const live = liveLayout([{ label: "Info", fields: ["Name", "Phone"] }]);
    expect(summarizeLayout(pub, live)).toEqual(["Added Phone", "Removed Fax"]);
  });
  it("names the field with the org's label", () => {
    const pub = pubLayout([{ label: "Info", fields: ["Name"] }]);
    const live = liveLayout([{ label: "Info", fields: ["Name", "Parent_Account__c"] }]);
    expect(summarizeLayout(pub, live)).toEqual(["Added Parent Account"]);
  });
  it("notices a reorder and moves between sections", () => {
    const pub = pubLayout([{ label: "Info", fields: ["Name", "Phone", "Fax"] }]);
    expect(summarizeLayout(pub, liveLayout([{ label: "Info", fields: ["Phone", "Name", "Fax"] }]))).toEqual(["Moved Account Name above Fax"]);
    const two = pubLayout([
      { label: "Info", fields: ["Name", "Phone"] },
      { label: "More", fields: ["Fax"] },
    ]);
    expect(
      summarizeLayout(
        two,
        liveLayout([
          { label: "Info", fields: ["Name"] },
          { label: "More", fields: ["Fax", "Phone"] },
        ])
      )
    ).toEqual(["Moved Phone to another section"]);
  });
  it("covers sections and related lists", () => {
    const pub = pubLayout([{ label: "Info", fields: ["Name"] }], ["Contacts"]);
    const live = liveLayout(
      [
        { label: "Info", fields: ["Name"] },
        { label: "Extra", fields: ["Phone"] },
      ],
      ["Cases"]
    );
    expect(summarizeLayout(pub, live)).toEqual(['Added the section "Extra"', "Added the Cases related list", "Removed the Contacts related list"]);
  });
  it("is empty when nothing differs, null when the cache can't say", () => {
    const pub = pubLayout([{ label: "Info", fields: ["Name"] }]);
    expect(summarizeLayout(pub, liveLayout([{ label: "Info", fields: ["Name"] }]))).toEqual([]);
    expect(summarizeLayout(undefined, liveLayout([]))).toBeNull();
    pub.sections[0].source = undefined;
    expect(summarizeLayout(pub, liveLayout([{ label: "Info", fields: ["Name"] }]))).toBeNull();
  });
});

describe("summarizeCompact", () => {
  const live = (fields: string[]): LiveCompactLayout => ({
    type: "CompactLayout",
    fullName: "Account.C",
    label: "C",
    fields,
    available: [{ name: "Phone", label: "Phone", type: "phone" }],
    recordTypes: null,
    production: false,
  });
  it("describes header fields", () => {
    expect(summarizeCompact(["Name"], live(["Name", "Phone"]))).toEqual(["Added Phone to the record header"]);
    expect(summarizeCompact(["Name", "Phone"], live(["Name"]))).toEqual(["Removed Phone from the record header"]);
    // The record's title field is not a header field the rep sees move.
    expect(summarizeCompact(["Name", "Phone"], live(["Phone", "Name"]))).toEqual([]);
    expect(summarizeCompact(["Phone", "Fax"], live(["Fax", "Phone"]))).toEqual(["Moved Phone to the end in the record header"]);
    expect(summarizeCompact(undefined, live([]))).toBeNull();
  });
});

describe("summarizeListView", () => {
  const source = { fullName: "Account.All", columns: ["Name", "Phone"], filterScope: "Mine", filters: [], booleanFilter: null };
  const pub = { name: "All", label: "All", columns: [], source } as PublishedListView;
  const live = (over: Partial<LiveListView>): LiveListView => ({
    type: "ListView",
    fullName: "Account.All",
    label: "All",
    columns: ["Name", "Phone"],
    filterScope: "Mine",
    filters: [],
    booleanFilter: null,
    sharedTo: null,
    available: [{ name: "Fax", label: "Fax", type: "phone", filterable: true }],
    managed: false,
    production: false,
    ...over,
  });
  it("describes scope, columns and filters", () => {
    expect(summarizeListView(pub, live({ filterScope: "Everything" }))).toEqual(["List view scope: Mine → Everything"]);
    expect(summarizeListView(pub, live({ columns: ["Name", "Fax"] }))).toEqual(["Added the Fax column", "Removed the Phone column"]);
    expect(summarizeListView(pub, live({ filters: [{ field: "Fax", operation: "equals", value: "1" }], booleanFilter: "1" }))).toEqual(["Added a filter on Fax", "Changed the filter logic"]);
    expect(summarizeListView(pub, live({ columns: ["Phone", "Name"] }))).toEqual(["Moved Name to the end in the list"]);
  });
  it("is null without a source", () => {
    expect(summarizeListView({ name: "All", label: "All", columns: [] }, live({}))).toBeNull();
  });
});

describe("summarizeFlexiPage", () => {
  const step = (component: string, identifier: string | null, index: number) => ({ component, identifier, index });
  const comp = (name: string, label: string, identifier: string, index: number) => ({
    name,
    label,
    supported: true,
    halfWidth: false,
    visibility: "shown" as const,
    properties: {},
    source: { region: "main", path: [step(name, identifier, index)] },
  });
  const page: PublishedPage = {
    name: "P",
    label: "P",
    type: "HomePage",
    template: "t",
    regions: [{ name: "main", components: [comp("flexipage:richText", "Welcome", "a", 0), comp("lsc:chat", "Agentforce welcome", "b", 1)] }],
    droppedRegions: [],
  };
  const live = (items: { component: string; identifier: string | null }[]): LiveFlexiPage => ({
    type: "FlexiPage",
    fullName: "P",
    label: "P",
    pageType: "HomePage",
    template: "t",
    sobjectType: null,
    regions: [{ name: "main", facet: false, items: items.map((i) => ({ ...i, properties: {}, facets: [] })) }],
    profiles: null,
    appDefaults: null,
    managed: false,
    production: false,
  });
  it("names removed and added components", () => {
    expect(
      summarizeFlexiPage(
        page,
        live([
          { component: "flexipage:richText", identifier: "a" },
          { component: "flexipage:recentItems", identifier: "c" },
        ])
      )
    ).toEqual(["Removed the Agentforce welcome component", "Added Recent Items"]);
  });
  it("is empty when the page matches, null when sources are missing", () => {
    expect(
      summarizeFlexiPage(
        page,
        live([
          { component: "flexipage:richText", identifier: "a" },
          { component: "lsc:chat", identifier: "b" },
        ])
      )
    ).toEqual([]);
    const bare = { ...page, regions: [{ name: "main", components: [{ ...page.regions[0].components[0], source: undefined }] }] };
    expect(summarizeFlexiPage(bare, live([]))).toBeNull();
  });
});

describe("configSummary", () => {
  it("names the edited values, assignments and record", () => {
    const e = { recordId: "1", category: "DbSchema", developerName: "X", at: 1, by: null, allProfiles: true, profileIds: [] };
    expect(configSummary({ ...e, changedFields: ["WhereSoql", "WhereSoql", "OneWaySync"], assignmentsChanged: true, recordEdited: true })).toEqual([
      "OneWaySync changed",
      "WhereSoql changed",
      "Profile assignments changed",
      "Record settings changed (such as Active)",
    ]);
    expect(configSummary(e)).toEqual([]);
  });
});

describe("false positives from real org documents", () => {
  it("pairs a layout's raw related list names with the iPad's Object.Field names", () => {
    const pub = pubLayout([{ label: "Info", fields: ["Name"] }]);
    pub.relatedLists = [
      { name: "ContactPointAddress.ParentId", label: "Addresses" },
      { name: "CaseHistory.CaseId", label: "Case History" },
    ] as never;
    const live = liveLayout([{ label: "Info", fields: ["Name"] }], ["ContactPointAddresses", "RelatedEntityHistoryList"]);
    expect(summarizeLayout(pub, live)).toEqual([]);
  });
  it("pairs person-account short names (RelatedHCPSpecialtyPaList) with the iPad's object", () => {
    const pub = pubLayout([{ label: "Info", fields: ["Name"] }]);
    pub.relatedLists = [
      { name: "HealthcareProviderSpecialty.AccountId", label: "Healthcare Provider Specialties" },
      { name: "BusinessLicense.AccountId", label: "Business Licenses" },
    ] as never;
    const live = liveLayout([{ label: "Info", fields: ["Name"] }], ["RelatedHCPSpecialtyPaList", "RelatedBusinessLicensePaList"]);
    expect(summarizeLayout(pub, live)).toEqual([]);
  });
  it("still reports a related list that really is new", () => {
    const pub = pubLayout([{ label: "Info", fields: ["Name"] }]);
    pub.relatedLists = [{ name: "ContactPointAddress.ParentId", label: "Addresses" }] as never;
    const live = liveLayout([{ label: "Info", fields: ["Name"] }], ["ContactPointAddresses", "Visits__r"]);
    expect(summarizeLayout(pub, live)?.join("|")).toMatch(/Visits/);
  });
  it("sees a section renamed in Setup as a rename, not a removal plus an addition", () => {
    const pub = pubLayout([{ label: "Address", fields: ["Name", "Phone", "Fax"] }]);
    const live = liveLayout([{ label: "Additional Information", fields: ["Name", "Phone", "Fax"] }]);
    const out = summarizeLayout(pub, live) ?? [];
    expect(out.join("|")).not.toMatch(/Added the section|Removed the section/);
  });
});

describe("summarizeFlexiPage regions and properties", () => {
  const page = (props: Record<string, string>): PublishedPage =>
    ({
      name: "Home",
      label: "Home",
      type: "HomePage",
      template: "t",
      regions: [
        {
          name: "top",
          components: [
            { name: "lsc4ce:lsAgentforceWelcome", label: "Agentforce welcome", supported: true, halfWidth: false, visibility: "shown", properties: props, source: { region: "top", path: [{ component: "lsc4ce:lsAgentforceWelcome", identifier: "w", index: 0 }] } },
          ],
        },
      ],
    }) as unknown as PublishedPage;
  const live = (props: Record<string, string>, sidebar = false): LiveFlexiPage =>
    ({
      type: "FlexiPage",
      fullName: "Home",
      label: "Home",
      pageType: "HomePage",
      template: "t",
      sobjectType: null,
      regions: [
        { name: "top", facet: false, items: [{ component: "lsc4ce:lsAgentforceWelcome", identifier: "w", properties: props, facets: [] }] },
        ...(sidebar ? [{ name: "sidebar", facet: false, items: [{ component: "flexipage:recentItems", identifier: "r", properties: {}, facets: [] }] }] : []),
      ],
      profiles: null,
    }) as unknown as LiveFlexiPage;
  it("ignores components in a region the iPad does not draw", () => {
    expect(summarizeFlexiPage(page({ a: "1" }), live({ a: "1" }, true))).toEqual([]);
  });
  it("names an edited property", () => {
    expect(summarizeFlexiPage(page({ welcomeMessage: "Hi" }), live({ welcomeMessage: "Hello" }))).toEqual(["Agentforce welcome: welcome message changed"]);
  });
  it("ignores properties the iPad does not carry", () => {
    expect(summarizeFlexiPage(page({ a: "1" }), live({ a: "1", hideOnError: "true" }))).toEqual([]);
  });
});
