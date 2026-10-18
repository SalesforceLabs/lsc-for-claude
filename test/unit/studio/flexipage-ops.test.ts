import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyFlexiPageOps,
  flexiPageWarnings,
  identifiersOf,
  itemsOf,
  newIdentifier,
  propertiesOf,
  regionName,
  regionsOf,
  StaleFlexiPageError,
  identifierOf,
} from "../../../src/studio/metadata/flexipage-ops.js";
import { liveFlexiPageOf } from "../../../src/studio/metadata/live.js";
import { cloneNode, parseXml, serializeXml, type XmlNode } from "../../../src/studio/metadata/xml.js";
import type { FlexiItemRef, FlexiPageOp } from "../../../src/studio/types.js";

const xml = readFileSync(join(__dirname, "../../fixtures/metadata/Account_LSDO_PH_FSR_KAM_MSL_HCO_HCP.flexipage-meta.xml"), "utf8");
const root = parseXml(xml);

const TABS = "Facet-c9e9688e-b828-4cab-a8fa-56c617c55316";
const INSIGHTS = "Facet-a64df66a-8ac1-4153-9d43-f68fb0d03a9e";
const RELATED = "Facet-15c92d90-79cd-4674-9108-2d4261d4f834";

const tab = (identifier: string, index = 0): FlexiItemRef => ({ component: "flexipage:tab", identifier, index });
const region = (r: XmlNode, name: string) => regionsOf(r).find((x) => regionName(x) === name)!;
const ids = (r: XmlNode, name: string) => itemsOf(region(r, name)).map(identifierOf);

/** Applying the ops then their inverse gives back the retrieved file, byte for byte. */
function roundTrip(ops: FlexiPageOp[], base = root, original = xml) {
  const forward = applyFlexiPageOps(base, ops);
  const back = applyFlexiPageOps(forward.root, forward.inverse);
  expect(serializeXml(back.root)).toBe(original);
  return forward;
}

describe("Lightning page XML", () => {
  it("round-trips a retrieved page byte for byte", () => {
    expect(serializeXml(root)).toBe(xml);
  });

  it("reads regions, facets and the facets each item points at", () => {
    const live = liveFlexiPageOf("Account_LSDO_PH_FSR_KAM_MSL_HCO_HCP", root);
    expect(live).toMatchObject({ template: "recordHomeSingleColTemplateDesktop", pageType: "RecordPage", sobjectType: "Account" });
    const main = live.regions.find((r) => r.name === "main")!;
    expect(main).toMatchObject({ facet: false, items: [{ component: "flexipage:tabset", identifier: "flexipage_tabset", facets: [TABS] }] });
    const tabs = live.regions.find((r) => r.name === TABS)!;
    expect(tabs.facet).toBe(true);
    expect(tabs.items[2]).toMatchObject({ identifier: "flexipage_tab5", properties: { title: "Insights", body: INSIGHTS }, facets: [INSIGHTS] });
  });
});

describe("Lightning page ops", () => {
  it("moves a record tab and back", () => {
    const { root: r, changes } = roundTrip([{ op: "moveComponent", component: { region: TABS, item: tab("flexipage_tab5") }, before: tab("flexipage_tab3") }]);
    expect(ids(r, TABS).slice(0, 3)).toEqual(["flexipage_tab5", "flexipage_tab3", "flexipage_tab2"]);
    expect(changes[0]).toEqual({ field: 'Tab "Insights"', before: "Position 3 of 10 in the record tabs", after: "Position 1 of 10 in the record tabs" });
  });

  it("moves to the end with before: null", () => {
    const { root: r } = roundTrip([{ op: "moveComponent", component: { region: TABS, item: tab("flexipage_tab3") }, before: null }]);
    expect(ids(r, TABS).at(-1)).toBe("flexipage_tab3");
  });

  it("removes a tab with its body facet, and undo puts both back", () => {
    const { root: r, inverse, changes } = roundTrip([{ op: "removeComponent", component: { region: TABS, item: tab("flexipage_tab5") } }]);
    expect(ids(r, TABS)).not.toContain("flexipage_tab5");
    expect(regionsOf(r).map(regionName)).not.toContain(INSIGHTS);
    expect(inverse[0]).toMatchObject({ op: "addComponent", region: TABS, before: tab("flexipage_tab", 2), facets: [{ at: 3 }] });
    expect(changes[0].after).toBe("(removed)");
  });

  it("removes the tabset with every tab body", () => {
    const { root: r } = roundTrip([
      { op: "removeComponent", component: { region: "main", item: { component: "flexipage:tabset", identifier: "flexipage_tabset", index: 0 } } },
    ]);
    expect(regionsOf(r).map(regionName)).toEqual(["header", "main"]);
  });

  it("moves a component within a tab's body", () => {
    const rl = (identifier: string): FlexiItemRef => ({ component: "force:relatedListSingleContainer", identifier, index: 0 });
    const { root: r, changes } = roundTrip([{ op: "moveComponent", component: { region: RELATED, item: rl("force_relatedListSingleContainer4") }, before: rl("force_relatedListSingleContainer") }]);
    expect(ids(r, RELATED).slice(0, 2)).toEqual(["force_relatedListSingleContainer4", "force_relatedListSingleContainer"]);
    expect(changes[0].before).toBe('Position 3 of 7 in the "Related" tab');
  });

  it("sets any simple property, adding it in name order, and removes it again", () => {
    const rl = { region: RELATED, item: { component: "force:relatedListSingleContainer", identifier: "force_relatedListSingleContainer", index: 0 } };
    const { root: r, changes } = roundTrip([
      { op: "setComponentProperty", component: rl, property: "showActionBar", from: "true", to: "false" },
      { op: "setComponentProperty", component: rl, property: "zeta", from: null, to: "Z" },
    ]);
    const props = propertiesOf(itemsOf(region(r, RELATED))[0]);
    expect(props.showActionBar).toBe("false");
    expect(props.zeta).toBe("Z");
    expect(changes.map((c) => c.after)).toEqual(["false", "Z"]);
    expect(() => applyFlexiPageOps(cloneNode(root), [{ op: "setComponentProperty", component: rl, property: "showActionBar", from: "false", to: "x".repeat(1001) }])).toThrow(/Invalid/);
    expect(() => applyFlexiPageOps(cloneNode(root), [{ op: "setComponentProperty", component: rl, property: "bad name", from: null, to: "x" }])).toThrow();
  });

  it("refuses a property that points at a region of the page", () => {
    expect(() =>
      applyFlexiPageOps(cloneNode(root), [{ op: "setComponentProperty", component: { region: TABS, item: tab("flexipage_tab5") }, property: "body", from: INSIGHTS, to: null }])
    ).toThrow(/region/);
  });

  it("sets a tab's title and default flag, and an inline LWC's height", () => {
    const carousel = { region: INSIGHTS, item: { component: "lscMobileInline_CarouselLwc", identifier: "c_lscMobileInline_CarouselLwc", index: 0 } };
    const { root: r, changes } = roundTrip([
      { op: "setComponentProperty", component: { region: TABS, item: tab("flexipage_tab5") }, property: "title", from: "Insights", to: "Field insights" },
      { op: "setComponentProperty", component: { region: TABS, item: tab("flexipage_tab5") }, property: "active", from: null, to: "true" },
      { op: "setComponentProperty", component: carousel, property: "mobileHeight", from: "550", to: "400" },
    ]);
    const t = itemsOf(region(r, TABS))[2];
    expect(propertiesOf(t)).toEqual({ active: "true", body: INSIGHTS, title: "Field insights" });
    expect(propertiesOf(itemsOf(region(r, INSIGHTS))[0]).mobileHeight).toBe("400");
    expect(changes.map((c) => [c.before, c.after])).toEqual([
      ['"Insights"', '"Field insights"'],
      ["false", "true"],
      ["550", "400"],
    ]);
    // A new property goes in by name, as App Builder writes them.
    expect(serializeXml(r)).toMatch(/<name>active<\/name>\s*<value>true<\/value>\s*<\/componentInstanceProperties>\s*<componentInstanceProperties>\s*<name>body<\/name>\s*<value>Facet-a64df66a/);
  });

  it("inserts a new component with an App Builder identifier", () => {
    const taken = identifiersOf(root);
    expect(newIdentifier("flexipage:tab", taken)).toBe("flexipage_tab8");
    const identifier = newIdentifier("flexipage:recentItems", taken);
    expect(identifier).toBe("flexipage_recentItems");
    const { root: r, changes } = roundTrip([
      { op: "addComponent", region: RELATED, before: null, component: "flexipage:recentItems", identifier, properties: [{ name: "maxRecords", value: "5" }] },
    ]);
    expect(ids(r, RELATED).at(-1)).toBe("flexipage_recentItems");
    expect(changes[0]).toEqual({ field: "Component flexipage:recentItems", before: "(not on the page)", after: 'Position 8 of 8 in the "Related" tab' });
  });

  it("refuses edits that don't fit the page as it is", () => {
    expect(() => applyFlexiPageOps(root, [{ op: "removeComponent", component: { region: TABS, item: tab("flexipage_tab99") } }])).toThrow(StaleFlexiPageError);
    expect(() => applyFlexiPageOps(root, [{ op: "removeComponent", component: { region: "sidebar", item: tab("flexipage_tab5") } }])).toThrow(StaleFlexiPageError);
    // The tab is in the tabs facet, not main: moves never cross regions.
    expect(() => applyFlexiPageOps(root, [{ op: "moveComponent", component: { region: "main", item: tab("flexipage_tab5") }, before: null }])).toThrow(StaleFlexiPageError);
    expect(() =>
      applyFlexiPageOps(root, [{ op: "setComponentProperty", component: { region: TABS, item: tab("flexipage_tab5") }, property: "title", from: "Other", to: "X" }])
    ).toThrow(/title is now "Insights"/);
    expect(() =>
      applyFlexiPageOps(root, [{ op: "addComponent", region: TABS, before: null, component: "flexipage:tab", identifier: "flexipage_tab5" }])
    ).toThrow(/already on the page/);
    // Only the short list of properties, on the components they belong to.
    expect(() =>
      applyFlexiPageOps(root, [{ op: "setComponentProperty", component: { region: TABS, item: tab("flexipage_tab5") }, property: "mobileHeight", from: null, to: "400" }])
    ).toThrow(/can't set mobileHeight/);
    expect(() =>
      applyFlexiPageOps(root, [{ op: "setComponentProperty", component: { region: TABS, item: tab("flexipage_tab5") }, property: "title", from: "Insights", to: "</value>" }])
    ).not.toThrow();
  });

  it("addresses items by index when the page has no identifiers", () => {
    const bare = xml.replace(/\n\s*<identifier>[^<]*<\/identifier>/g, "");
    const r0 = parseXml(bare);
    const ref = (index: number): FlexiItemRef => ({ component: "flexipage:tab", identifier: null, index });
    const { root: r, inverse } = roundTrip([{ op: "moveComponent", component: { region: TABS, item: ref(2) }, before: ref(0) }], r0, bare);
    expect(propertiesOf(itemsOf(region(r, TABS))[0]).title).toBe("Insights");
    expect(inverse[0]).toEqual({ op: "moveComponent", component: { region: TABS, item: ref(0) }, before: ref(3) });
    expect(() => applyFlexiPageOps(r0, [{ op: "removeComponent", component: { region: TABS, item: { ...ref(0), component: "flexipage:tabset" } } }])).toThrow(
      StaleFlexiPageError
    );
  });

  it("inserts only into regions the template has on the iPad, or a facet", () => {
    const sidebar = parseXml(xml.replace("<name>header</name>", "<name>sidebar</name>"));
    const add = (region: string): FlexiPageOp => ({ op: "addComponent", region, before: null, component: "flexipage:recentItems", identifier: "flexipage_recentItems" });
    expect(() => applyFlexiPageOps(sidebar, [add("sidebar")])).toThrow(/doesn't show the sidebar region/);
    expect(() => applyFlexiPageOps(root, [add("header")])).not.toThrow();
    // Putting back a removed component isn't refused: it was there.
    const removed = applyFlexiPageOps(sidebar, [
      { op: "removeComponent", component: { region: "sidebar", item: { component: "force:highlightsPanel", identifier: "force_highlightsPanel", index: 0 } } },
    ]);
    expect(() => applyFlexiPageOps(removed.root, removed.inverse)).not.toThrow();
  });

  it("warns when an edited component's visibility rule has conditions the iPad skips", () => {
    const rule =
      "<visibilityRule><criteria><leftValue>{!$Client.formFactor}</leftValue><operator>EQUAL</operator><rightValue>Large</rightValue></criteria>" +
      "<criteria><leftValue>{!$Permission.CustomPermission.X}</leftValue><operator>EQUAL</operator><rightValue>true</rightValue></criteria></visibilityRule>";
    const ruled = parseXml(xml.replace("<identifier>flexipage_tab5</identifier>", `<identifier>flexipage_tab5</identifier>${rule}`));
    const op: FlexiPageOp = { op: "moveComponent", component: { region: TABS, item: tab("flexipage_tab5") }, before: null };
    const { root: r } = applyFlexiPageOps(ruled, [op]);
    expect(flexiPageWarnings([op], r)).toEqual(['Tab "Insights" has a visibility rule with several conditions and no filter logic — the iPad only checks the first condition.']);
    expect(flexiPageWarnings([op], applyFlexiPageOps(root, [op]).root)).toEqual([]);
  });

  it("warns about tab titles the iPad cuts", () => {
    const op: FlexiPageOp = {
      op: "setComponentProperty",
      component: { region: TABS, item: tab("flexipage_tab5") },
      property: "title",
      from: "Insights",
      to: "Insights for the whole territory team",
    };
    expect(flexiPageWarnings([op])).toEqual([expect.stringContaining("over 25 characters")]);
  });
});
