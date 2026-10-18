import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyFlexiPageOps, newIdentifier as serverIdentifier, tabTitle as serverTabTitle } from "../../../src/studio/metadata/flexipage-ops.js";
import { liveFlexiPageOf } from "../../../src/studio/metadata/live.js";
import { cloneNode, parseXml, type XmlNode } from "../../../src/studio/metadata/xml.js";
import {
  alignFlexiPage,
  componentVerbs,
  diffOps,
  draftComponents,
  draftRecordTabs,
  insertComponent,
  insertVerb,
  locateItem,
  modelOf,
  moveComponentTo,
  moveRecordTabTo,
  newIdentifier,
  propertyEdits,
  removedItems,
  tabTitle,
  targetOf,
  type FlexiModel,
  type PageDraft,
} from "../../../src-renderer/components/studio/flexipage-draft.js";
import { StaleDraftError } from "../../../src-renderer/components/studio/layout-draft.js";
import type { PendingChange } from "../../../src-renderer/components/studio/changes.js";
import type { FlexiSource, PublishedComponent, PublishedPage } from "../../../src-renderer/components/studio/published-types.js";
import type { ComponentCatalog, FlexiPageOp, LiveFlexiPage } from "../../../src-renderer/components/studio/types.js";

const FULL_NAME = "Account_LSDO_PH_FSR_KAM_MSL_HCO_HCP";
const root = parseXml(readFileSync(join(__dirname, "../../fixtures/metadata/Account_LSDO_PH_FSR_KAM_MSL_HCO_HCP.flexipage-meta.xml"), "utf8"));

const liveOf = (r: XmlNode): LiveFlexiPage => ({ ...liveFlexiPageOf(FULL_NAME, r), profiles: ["Field Sales"], appDefaults: [], managed: false, production: false });
const live = liveOf(root);
const base = modelOf(live);

const TABS = "Facet-c9e9688e-b828-4cab-a8fa-56c617c55316";
const INSIGHTS = "Facet-a64df66a-8ac1-4153-9d43-f68fb0d03a9e";
const RELATED = "Facet-15c92d90-79cd-4674-9108-2d4261d4f834";

/** The published page as the metadata cache would describe it, with sources: main's tabset, its tabs and their components. */
function publishedOf(m: FlexiModel): PublishedPage {
  const region = (name: string) => m.regions.find((r) => r.name === name)!;
  const step = (name: string, i: number) => {
    const it = region(name).items[i];
    return { component: it.component, identifier: it.identifier, index: i };
  };
  const tabset = region("main").items[0];
  const tabsetStep = step("main", 0);
  const tabs = region(TABS).items.map((t, ti) => {
    const tabSource: FlexiSource = { region: "main", path: [tabsetStep, step(TABS, ti)] };
    const body = t.facets[0];
    return {
      title: tabTitle(t.properties.title ?? ""),
      active: t.properties.active === "true",
      source: tabSource,
      components: region(body).items.map((c, ci): PublishedComponent => ({
        name: c.component,
        label: c.component,
        supported: true,
        halfWidth: false,
        visibility: "shown",
        properties: { ...c.properties },
        source: { region: "main", path: [...tabSource.path, step(body, ci)] },
      })),
    };
  });
  const comp: PublishedComponent = { name: tabset.component, label: "Tabs", supported: true, halfWidth: false, visibility: "shown", properties: {}, tabs, source: { region: "main", path: [tabsetStep] } };
  return { name: FULL_NAME, label: live.label, type: "RecordPage", template: live.template, regions: [{ name: "main", components: [comp] }], droppedRegions: [] };
}

const published = publishedOf(base);

function draftOf(pending: PendingChange[] = []): PageDraft {
  return { fullName: FULL_NAME, label: live.label, live, base, target: targetOf(FULL_NAME, base, pending), aligned: alignFlexiPage(published, base)! };
}

const queued = (pending: PendingChange[]): FlexiPageOp[] => {
  const fix = pending.find((p) => p.fix.kind === "editMetadata" && p.fix.doc.type === "FlexiPage")?.fix;
  return fix && fix.kind === "editMetadata" ? (fix.ops as FlexiPageOp[]) : [];
};

/** Regions by name with their items, keys left out (the server re-reads identifiers). */
const shape = (m: FlexiModel) =>
  Object.fromEntries(m.regions.map((r) => [r.name, { facet: r.facet, items: r.items.map((i) => ({ component: i.component, identifier: i.identifier, properties: i.properties, facets: i.facets })) }]));

/** The tray's ops, applied by the server to the org's XML and read back, give exactly the arranged page. */
function roundTrips(pending: PendingChange[]) {
  const target = targetOf(FULL_NAME, base, pending);
  const ops = queued(pending);
  expect(ops).toEqual(diffOps(base, target));
  const { root: out } = applyFlexiPageOps(cloneNode(root), ops);
  expect(shape(modelOf(liveOf(out)))).toEqual(shape(target));
  return target;
}

const verbOf = (d: PageDraft, key: string, id: string, tab = false, shown?: string[]) => {
  const at = locateItem(d.target, key)!;
  const v = componentVerbs(d, key, key, shown ?? at.region.items.map((i) => i.key), tab).find((x) => x.id === id);
  if (!v) throw new Error(`no ${id} verb`);
  return v;
};

describe("flexipage-draft", () => {
  it("reads the org's page and diffs nothing when nothing changed", () => {
    expect(base.regions.find((r) => r.name === "main")!.items.map((i) => i.component)).toEqual(["flexipage:tabset"]);
    expect(diffOps(base, targetOf(FULL_NAME, base, []))).toEqual([]);
  });

  it("lines every published block up with the org's page", () => {
    const aligned = alignFlexiPage(published, base)!;
    expect(aligned.size).toBe(1 + 10 + base.regions.filter((r) => r.facet && r.name !== TABS).reduce((n, r) => n + r.items.length, 0));
    expect(aligned.get(`main/flexipage_tabset/flexipage_tab`)).toBe("flexipage_tab");
  });

  it("doesn't line up a published page that changed in Setup", () => {
    const moved = publishedOf(base);
    const tabs = moved.regions[0].components[0].tabs!;
    tabs.push(tabs.shift()!);
    expect(alignFlexiPage(moved, base)).toBeNull();
    const renamed = publishedOf(base);
    renamed.regions[0].components[0].tabs![0].source!.path[1].identifier = "flexipage_tab99";
    expect(alignFlexiPage(renamed, base)).toBeNull();
  });

  it("moves a tab left and round-trips through the server", () => {
    const pending = verbOf(draftOf(), "flexipage_tab", "up", true).run!([]);
    const target = roundTrips(pending);
    expect(target.regions.find((r) => r.name === TABS)!.items.map((i) => i.key).slice(2, 4)).toEqual(["flexipage_tab", "flexipage_tab5"]);
    expect(pending[0].affects).toEqual(["Field Sales"]);
    // Back again drops the change.
    expect(verbOf(draftOf(pending), "flexipage_tab", "down", true).run!(pending)).toEqual([]);
  });

  it("can't move the first tab left", () => {
    const v = verbOf(draftOf(), "flexipage_tab3", "up", true);
    expect(v.run).toBeUndefined();
    expect(v.reason).toBe("Already the first tab");
  });

  it("removes a tab with its body, draws it as a ghost, and restores it", () => {
    const pending = verbOf(draftOf(), "flexipage_tab5", "remove", true).run!([]);
    const target = roundTrips(pending);
    expect(target.regions.some((r) => r.name === INSIGHTS)).toBe(false);
    const d = draftOf(pending);
    const tabs = draftRecordTabs(d, published.regions[0].components[0].tabs!);
    expect(tabs.find((t) => t.key === "flexipage_tab5")!.state).toBe("removed");
    const restore = componentVerbs(d, "flexipage_tab5", "Insights", [], true);
    expect(restore.map((v) => v.id)).toEqual(["restore"]);
    expect(restore[0].run!(pending)).toEqual([]);
  });

  it("moves a component in a tab, steps past what the iPad doesn't draw, and draws it pending", () => {
    const shown = ["force_relatedListSingleContainer", "force_relatedListSingleContainer4"];
    const pending = verbOf(draftOf(), "force_relatedListSingleContainer4", "up", false, shown).run!([]);
    const target = roundTrips(pending);
    expect(target.regions.find((r) => r.name === RELATED)!.items.map((i) => i.key).slice(0, 3)).toEqual([
      "force_relatedListSingleContainer4",
      "force_relatedListSingleContainer",
      "force_relatedListSingleContainer3",
    ]);
    const related = published.regions[0].components[0].tabs!.find((t) => t.title === "Related")!;
    const drawn = draftComponents(draftOf(pending), related.components);
    expect(drawn.slice(0, 2).map((b) => [b.key, b.state])).toEqual([
      ["force_relatedListSingleContainer4", "moved"],
      ["force_relatedListSingleContainer", "moved"],
    ]);
  });

  it("drops a tab before another, matching the move verbs, and a drop back in place queues nothing", () => {
    const keys = () => base.regions.find((r) => r.name === TABS)!.items.map((i) => i.key);
    const [a, b, c] = [keys()[2], keys()[3], keys()[4]];
    const pending = moveRecordTabTo(draftOf(), b, a, [])!;
    const target = roundTrips(pending);
    expect(target.regions.find((r) => r.name === TABS)!.items.map((i) => i.key).slice(2, 4)).toEqual([b, a]);
    expect(moveRecordTabTo(draftOf(), b, a, [])).toEqual(verbOf(draftOf(), b, "up", true).run!([]));
    // Back where it was, or before its own next neighbour, is the org's page again.
    expect(moveRecordTabTo(draftOf(pending), b, c, pending)).toEqual([]);
    expect(moveRecordTabTo(draftOf(), a, b, [])).toEqual([]);
    // Last in the tab set.
    const last = moveRecordTabTo(draftOf(), a, null, [])!;
    expect(roundTrips(last).regions.find((r) => r.name === TABS)!.items.at(-1)!.key).toBe(a);
  });

  it("drops a component within its region, and refuses other regions and tabs mixed with components", () => {
    const items = base.regions.find((r) => r.name === RELATED)!.items.map((i) => i.key);
    const pending = moveComponentTo(draftOf(), items[2], items[0], [])!;
    const target = roundTrips(pending);
    expect(target.regions.find((r) => r.name === RELATED)!.items.map((i) => i.key).slice(0, 3)).toEqual([items[2], items[0], items[1]]);
    expect(moveComponentTo(draftOf(), items[1], items[0], [])).toEqual(verbOf(draftOf(), items[1], "up").run!([]));
    expect(moveComponentTo(draftOf(), items[0], items[1], [])).toEqual([]);
    const other = base.regions.find((r) => r.name === INSIGHTS)!.items[0].key;
    expect(moveComponentTo(draftOf(), items[0], other, [])).toBeNull();
    expect(moveComponentTo(draftOf(), items[0], "nope", [])).toBeNull();
    expect(moveComponentTo(draftOf(), "flexipage_tab", null, [])).toBeNull();
    expect(moveRecordTabTo(draftOf(), items[0], null, [])).toBeNull();
    // A removed component isn't on the arranged page.
    const removed = verbOf(draftOf(), items[0], "remove").run!([]);
    expect(moveComponentTo(draftOf(removed), items[0], null, removed)).toBeNull();
  });

  it("removes a component and lists it to put back", () => {
    const pending = verbOf(draftOf(), "lsc4ce_Ratings", "remove").run!([]);
    roundTrips(pending);
    const d = draftOf(pending);
    expect(removedItems(d).map((r) => r.key)).toEqual(["lsc4ce_Ratings"]);
    const ratings = published.regions[0].components[0].tabs!.find((t) => t.title === "Ratings")!;
    expect(draftComponents(d, ratings.components).map((b) => b.state)).toEqual(["removed"]);
  });

  it("inserts a catalog component after the selected one with App Builder's identifier", () => {
    const catalog: ComponentCatalog = {
      setupPath: "/lightning/setup/FlexiPageList/home",
      entries: [
        { key: "lwc:lscMobileInline_Other", component: "lscMobileInline_Other", label: "Other", group: "Inline LWC", pages: ["RecordPage"], properties: [{ name: "mobileHeight", value: "400" }], insertable: true },
        { key: "std:activity", component: "runtime_sales_activities:activityPanel", label: "Activity", group: "Standard", pages: ["RecordPage"], properties: [], insertable: false },
      ],
    };
    const v = insertVerb(draftOf(), "c_lscMobileInline_CarouselLwc", catalog);
    expect(v.pick!.options.map((o) => o.value)).toEqual(["new:lwc:lscMobileInline_Other"]);
    expect(v.pick!.description).toContain("Activity");
    const pending = v.pick!.run("new:lwc:lscMobileInline_Other", []);
    const target = roundTrips(pending);
    expect(target.regions.find((r) => r.name === INSIGHTS)!.items.map((i) => i.identifier)).toEqual(["c_lscMobileInline_CarouselLwc", "c_lscMobileInline_Other"]);
    const insights = published.regions[0].components[0].tabs!.find((t) => t.title === "Insights")!;
    expect(draftComponents(draftOf(pending), insights.components).map((b) => b.state)).toEqual(["same", "added"]);
  });

  it("leaves related lists already on the page out of the catalog", () => {
    const catalog: ComponentCatalog = {
      setupPath: "",
      entries: [
        { key: "rl:Visits", component: "force:relatedListSingleContainer", label: "Visits", group: "Related list", pages: ["RecordPage"], properties: [{ name: "relatedListApiName", value: "Visits" }], insertable: true, object: "Visit" },
      ],
    };
    expect(insertVerb(draftOf(), "force_relatedListSingleContainer", catalog).pick!.options).toEqual([]);
    expect(insertVerb(draftOf(), "force_relatedListSingleContainer", null).reason).toBe("Loading the component library…");
  });

  it("sets an inline LWC's height and a tab's title, warning on long titles", () => {
    const height = propertyEdits(draftOf(), "c_lscMobileInline_CarouselLwc").find((p) => p.property === "mobileHeight")!;
    expect(height.value).toBe("550");
    expect(height.check("0").problem).toBeTruthy();
    expect(height.set("abc", [])).toBeNull();
    let pending = height.set("600", [])!;
    roundTrips(pending);
    const title = propertyEdits(draftOf(pending), "flexipage_tab5").find((p) => p.property === "title")!;
    expect(title.check("A title that runs past twenty-five").warning).toContain("25");
    expect(title.check("").problem).toBeTruthy();
    expect(title.check("{!$Label.lsc4ce__Dashboard}").warning).toBe(`Shown as "Dashboard", from a custom label translated for each rep. Typing a title replaces it with fixed text.`);
    expect(title.check("Insights").warning).toBeUndefined();
    pending = title.set("Field insights", pending)!;
    const target = roundTrips(pending);
    expect(locateItem(target, "flexipage_tab5")!.item.properties.title).toBe("Field insights");
    expect(locateItem(target, "c_lscMobileInline_CarouselLwc")!.item.properties.mobileHeight).toBe("600");
  });

  it("lists definitions then the page's other simple properties, leaving region pointers out", () => {
    const defs = { component: "force:relatedListSingleContainer", source: "curated" as const, properties: [{ name: "showActionBar", label: "Show action bar", type: "Boolean" as const, ipad: "unused" as const }] };
    const edits = propertyEdits(draftOf(), "force_relatedListSingleContainer", defs);
    expect(edits.map((e) => e.property)).toContain("showActionBar");
    expect(edits.find((e) => e.property === "relatedListApiName")!.readOnly).toBe(true);
    // The unused one sorts last; the tab's body pointer isn't offered.
    expect(edits[edits.length - 1].def.ipad).toBe("unused");
    expect(propertyEdits(draftOf(), "flexipage_tab5").map((e) => e.property)).toEqual(["title"]);
  });

  it("edits a typed property, shows the org's value, resets it, and round-trips to the XML", () => {
    const defs = { component: "force:relatedListSingleContainer", source: "curated" as const, properties: [{ name: "showActionBar", label: "Show action bar", type: "Boolean" as const, ipad: "unused" as const }] };
    const bar = (pending: PendingChange[] = []) => propertyEdits(draftOf(pending), "force_relatedListSingleContainer", defs).find((e) => e.property === "showActionBar")!;
    expect(bar().changed).toBe(false);
    const pending = bar().set("false", [])!;
    const edited = bar(pending);
    expect(edited).toMatchObject({ value: "false", orgValue: "true", changed: true });
    expect(queued(pending)).toEqual([expect.objectContaining({ op: "setComponentProperty", property: "showActionBar", from: "true", to: "false" })]);
    expect(locateItem(roundTrips(pending), "force_relatedListSingleContainer")!.item.properties.showActionBar).toBe("false");
    // Reset puts the org's value back, so nothing is left to apply.
    expect(queued(edited.reset(pending))).toEqual([]);
  });

  it("takes an optional property off with an empty value and sets a new one", () => {
    const defs = { component: "lscMobileInline_CarouselLwc", source: "bundle" as const, properties: [{ name: "heading", label: "Heading", type: "String" as const, ipad: "unknown" as const }] };
    const heading = (pending: PendingChange[] = []) => propertyEdits(draftOf(pending), "c_lscMobileInline_CarouselLwc", defs).find((e) => e.property === "heading")!;
    expect(heading().value).toBe("");
    const set = heading().set("Welcome", [])!;
    expect(queued(set)).toEqual([expect.objectContaining({ op: "setComponentProperty", property: "heading", from: null, to: "Welcome" })]);
    expect(locateItem(roundTrips(set), "c_lscMobileInline_CarouselLwc")!.item.properties.heading).toBe("Welcome");
    const cleared = heading(set).set("", set)!;
    expect(queued(cleared)).toEqual([]);
  });

  it("refuses values the definition's range rules out", () => {
    const defs = { component: "lscMobileInline_CarouselLwc", source: "bundle" as const, properties: [{ name: "mobileHeight", label: "Height", type: "Integer" as const, min: 100, max: 900, ipad: "used" as const }] };
    const height = propertyEdits(draftOf(), "c_lscMobileInline_CarouselLwc", defs).find((e) => e.property === "mobileHeight")!;
    expect(height.set("50", [])).toBeNull();
    expect(height.set("901", [])).toBeNull();
    expect(height.set("500", [])).not.toBeNull();
  });

  it("draws a pending property where the preview reads it", () => {
    const edited = propertyEdits(draftOf(), "c_lscMobileInline_CarouselLwc").find((e) => e.property === "mobileHeight")!.set("640", [])!;
    const comp: PublishedComponent = { name: "lscMobileInline_CarouselLwc", label: "x", supported: true, halfWidth: false, visibility: "shown", properties: { mobileHeight: "550" }, source: published.regions[0].components[0].tabs![2].components[0].source };
    const drawn = draftComponents(draftOf(edited), [comp]);
    expect(drawn[0].value.properties.mobileHeight).toBe("640");
    expect(drawn[0].state).toBe("moved");
  });

  it("makes a tab the default", () => {
    const pending = verbOf(draftOf(), "flexipage_tab9", "default", true).run!([]);
    const target = roundTrips(pending);
    expect(target.regions.find((r) => r.name === TABS)!.items.filter((i) => i.properties.active === "true").map((i) => i.key)).toEqual(["flexipage_tab9"]);
    const tabs = draftRecordTabs(draftOf(pending), published.regions[0].components[0].tabs!);
    expect(tabs.find((t) => t.key === "flexipage_tab9")!.value.active).toBe(true);
    expect(verbOf(draftOf(pending), "flexipage_tab9", "default", true).run).toBeUndefined();
  });

  it("throws StaleDraftError when the queued ops no longer fit the page", () => {
    const pending = insertComponent(draftOf(), INSIGHTS, null, "lscMobileInline_Other", [], []);
    const ops = queued(pending);
    const gone: FlexiPageOp = { op: "removeComponent", component: { region: INSIGHTS, item: { component: "lscMobileInline_Gone", identifier: "c_lscMobileInline_Gone", index: 0 } } };
    const stale = [{ ...pending[0], fix: { ...pending[0].fix, ops: [...ops, gone] } } as PendingChange];
    expect(() => targetOf(FULL_NAME, base, stale)).toThrow(StaleDraftError);
  });

  it("names new components and tabs as the server does", () => {
    const taken = new Set(["c_lscMobileInline_X", "force_relatedListSingleContainer", "force_relatedListSingleContainer2"]);
    for (const c of ["lscMobileInline_X", "lscMobileInline_Y", "force:relatedListSingleContainer", "flexipage:tab"]) {
      expect(newIdentifier(c, taken)).toBe(serverIdentifier(c, taken));
    }
    for (const t of ["Standard.Tab.detail", "Standard.Tab.relatedLists", "{!$Label.lsc4ce__Dashboard}", "{!$Label.Mine}", "Plain"]) {
      expect(tabTitle(t)).toBe(serverTabTitle(t));
    }
  });
});
