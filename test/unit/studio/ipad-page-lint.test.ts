import { describe, it, expect } from "vitest";
import { lintPage, nestFacets, resolveTemplate } from "../../../src/studio/ipad-page-lint.js";

type Row = Record<string, unknown>;

const comp = (componentName: string, props: Record<string, string> = {}, extra: Row = {}): Row => ({
  componentInstance: {
    componentName,
    componentInstanceProperties: Object.entries(props).map(([name, value]) => ({ name, value })),
    ...extra,
  },
});
const region = (name: string, items: Row[], type = "Region"): Row => ({ name, type, itemInstances: items });
const page = (type: string, template: string, regions: Row[]): Row => ({ type, template: { name: template }, flexiPageRegions: regions });

const codes = (p: Row) => lintPage(p).map((x) => x.code);

describe("resolveTemplate", () => {
  it("keeps a template the iPad has", () => {
    expect(resolveTemplate(page("RecordPage", "flexipage:recordHomeTemplateDesktop", [region("header", []), region("main", []), region("sidebar", [])]))).toEqual({
      requested: "recordHomeTemplateDesktop",
      template: "recordHomeTemplateDesktop",
      fallback: null,
    });
  });

  it("falls back for an unknown template, a lone main region, or a record page with an empty region of two", () => {
    expect(resolveTemplate(page("RecordPage", "flexipage:recordHomeWithSubheaderTemplateDesktop", [region("header", []), region("subheader", []), region("main", [])])).fallback).toBe("unsupported");
    expect(resolveTemplate(page("HomePage", "flexipage:defaultAppHomeTemplate", [region("main", [comp("flexipage:richText")])])).fallback).toBe("only-main");
    expect(resolveTemplate(page("RecordPage", "flexipage:recordHomeSingleColTemplateDesktop", [region("header", []), region("main", [comp("force:detailPanel")])])).fallback).toBe("empty-region");
  });
});

describe("lintPage", () => {
  it("finds nothing on a well-built record page", () => {
    const p = page("RecordPage", "flexipage:recordHomeTemplateDesktop", [
      region("header", [comp("force:highlightsPanel")]),
      region("main", [comp("force:detailPanel"), comp("flexipage:tabset")]),
      region("sidebar", [comp("c:unsupportedThing")]),
    ]);
    expect(lintPage(p)).toEqual([]);
  });

  it("says a Home page on a template the iPad doesn't have is blank", () => {
    const p = page("HomePage", "c:myTemplate", [region("top", [comp("flexipage:richText")]), region("bottom", [])]);
    const [problem] = lintPage(p);
    expect(problem).toMatchObject({ code: "template", severity: "error" });
    expect(problem.message).toContain("shows nothing");
  });

  it("flags Home components in the Header of the Standard Home Page and in the two-column template", () => {
    expect(codes(page("HomePage", "flexipage:defaultAppHomeTemplate", [region("header", [comp("flexipage:richText")]), region("main", [comp("flexipage:recentItems")])]))).toEqual(["home-blank"]);
    expect(
      codes(page("HomePage", "flexipage:appHomeTemplateHeaderTwoColumnsLeftSidebar", [region("header", []), region("sidebar", [comp("flexipage:recentItems")]), region("main", [comp("flexipage:richText")])]))
    ).toEqual(["home-blank", "home-blank"]);
  });

  it("explains a Home page with only a Main region", () => {
    const [problem] = lintPage(page("HomePage", "flexipage:defaultAppHomeTemplate", [region("main", [comp("flexipage:richText")])]));
    expect(problem.code).toBe("home-blank");
    expect(problem.message).toContain("only a Main region");
  });

  it("names components in regions the template doesn't draw", () => {
    const p = page("HomePage", "flexipage:desktopTemplate", [
      region("top", [comp("flexipage:richText")]),
      region("bottomLeft", [comp("flexipage:recentItems"), comp("c:custom")]),
      region("bottomRight", []),
    ]);
    const problems = lintPage(p);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: "region-dropped", severity: "warning" });
    expect(problems[0].message).toBe("1 component in the BottomLeft region won't show on the iPad (Recent items). This template only draws Top.");
  });

  it("warns when a record page's Header holds more than one component", () => {
    const p = page("RecordPage", "flexipage:recordHomeTemplateDesktop", [
      region("header", [comp("force:highlightsPanel"), comp("flexipage:richText")]),
      region("main", [comp("force:detailPanel")]),
      region("sidebar", []),
    ]);
    const [problem] = lintPage(p);
    expect(problem.code).toBe("stacked");
    expect(problem.message).toContain("only Rich text shows");
  });

  it("doesn't count components hidden by a rule that never passes", () => {
    const hidden = comp("flexipage:richText", {}, { visibilityRule: { criteria: [{ leftValue: "{!$Browser.formFactor}", operator: "EQUAL", rightValue: "LARGE" }] } });
    const p = page("RecordPage", "flexipage:recordHomeTemplateDesktop", [region("header", [comp("force:highlightsPanel"), hidden]), region("main", []), region("sidebar", [])]);
    expect(lintPage(p)).toEqual([]);
  });

  it("warns about components after a tab set", () => {
    const p = page("RecordPage", "flexipage:recordHomeSingleColTemplateDesktop", [
      region("header", [comp("force:highlightsPanel")]),
      region("main", [comp("flexipage:tabset"), comp("force:relatedListContainer"), comp("c:unsupported")]),
    ]);
    const [problem] = lintPage(p);
    expect(problem.code).toBe("after-tabset");
    expect(problem.message).toContain("1 component comes after the tab set in Main (Related lists)");
  });

  it("finds a generic related list without an object or field set, inside a tab", () => {
    // Flat, as the Tooling API returns it: the tab set's tabs and the tab's body are Facet regions.
    const p = page("RecordPage", "flexipage:recordHomeSingleColTemplateDesktop", [
      region("header", [comp("force:highlightsPanel")]),
      region("main", [comp("flexipage:tabset", { tabs: "Facet-1" })]),
      region("Facet-1", [comp("flexipage:tab", { body: "Facet-2", title: "Related" })], "Facet"),
      region("Facet-2", [comp("industries_ls_commercial:LSCGenericRelatedList", { label: "Orders", objectName: "Order", fieldSetName: " " })], "Facet"),
    ]);
    const problems = lintPage(p);
    expect(problems.map((x) => x.code)).toEqual(["related-list-config"]);
    expect(problems[0].message).toBe(
      'The "Orders" generic related list has no field set, so the iPad shows "Invalid or blank config. Please check page properties in Lightning App Builder". Fill in its Field set properties.'
    );
  });
});

describe("nestFacets", () => {
  it("puts facet contents under the component that names them", () => {
    const p = nestFacets(
      page("RecordPage", "x", [region("main", [comp("flexipage:tabset", { tabs: "F1" })]), region("F1", [comp("flexipage:tab", { body: "F2" })], "Facet"), region("F2", [comp("force:detailPanel")], "Facet")])
    );
    const regions = p.flexiPageRegions as Row[];
    expect(regions).toHaveLength(1);
    const tabset = (regions[0].itemInstances as Row[])[0];
    const tab = (tabset.itemInstances as Row[])[0];
    expect(((tab.itemInstances as Row[])[0].componentInstance as Row).componentName).toBe("force:detailPanel");
  });

  it("leaves a page without facets alone", () => {
    const p = page("RecordPage", "x", [region("main", [])]);
    expect(nestFacets(p)).toBe(p);
  });
});
