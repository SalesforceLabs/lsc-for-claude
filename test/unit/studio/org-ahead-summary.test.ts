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
  it("joins up to three lines, counts more", () => {
    expect(describeSummary(["Added A", "Removed B"]).text).toBe("Added A; Removed B");
    const many = describeSummary(["a", "b", "c", "d"]);
    expect(many.text).toBe("4 changes");
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
    expect(summarizeLayout(pub, liveLayout([{ label: "Info", fields: ["Phone", "Name", "Fax"] }]))).toEqual(["Rearranged fields in a section"]);
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
    expect(summarizeCompact(["Name", "Phone"], live(["Phone", "Name"]))).toEqual(["Reordered the record header fields"]);
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
    expect(summarizeListView(pub, live({ columns: ["Phone", "Name"] }))).toEqual(["Reordered the columns"]);
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
