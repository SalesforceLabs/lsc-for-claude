/**
 * What the iPad does with a Lightning page that admins don't expect: templates it replaces,
 * regions it never draws, components stacked on top of each other, a tab set that fills the
 * screen, and a generic related list with no object or field set. Every rule is from
 * lifesciences-ios (cited per rule); the page is FlexiPage metadata JSON, either nested as the
 * metadata cache has it or flat with Facet regions as the Tooling API returns it.
 */

import { componentInfo, TEMPLATE_REGIONS, trimNamespace, visibilityOf } from "./published.js";

type Row = Record<string, unknown>;

export interface PageProblem {
  code: "template" | "home-blank" | "region-dropped" | "stacked" | "after-tabset" | "related-list-config";
  severity: "error" | "warning";
  message: string;
}

const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const obj = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * SFFlexiPageView.xib: a "view" region pins every component to its four edges, so they sit on
 * top of each other (SFLayoutViewRegion.addComponent) and on a Home page it adds nothing at all
 * (addHomeComponent is left empty); a "scroll" region stacks them top to bottom.
 */
const REGION_KIND: Record<string, Record<string, "view" | "scroll">> = {
  recordHomeTemplateDesktop: { header: "view", main: "scroll", sidebar: "scroll" },
  recordHomeSingleColTemplateDesktop: { header: "scroll", main: "scroll" },
  appHomeTemplateHeaderTwoColumnsLeftSidebar: { header: "view", sidebar: "view", main: "view" },
  defaultAppHomeTemplate: { header: "view", main: "scroll" },
  defaultFlexiPage: { main: "view" },
  desktopTemplate: { top: "scroll" },
};

export type TemplateFallback = "unsupported" | "only-main" | "empty-region";

/** The template the iPad uses: SFFlexiPageViewController's lookup plus shouldDisplayDefaultFlexiPage. */
export function resolveTemplate(page: Row): { requested: string; template: string; fallback: TemplateFallback | null } {
  const regions = arr(page.flexiPageRegions).filter((r) => str(r.type) !== "Facet");
  const name = str(obj(page.template).name);
  const requested = name.includes(":") ? name.split(":")[1] : name;
  if (regions.length === 1 && str(regions[0].name) === "main") return { requested, template: "defaultFlexiPage", fallback: "only-main" };
  if (str(page.type) === "RecordPage" && regions.length === 2 && regions.some((r) => arr(r.itemInstances).length === 0))
    return { requested, template: "defaultFlexiPage", fallback: "empty-region" };
  if (!TEMPLATE_REGIONS[requested]) return { requested, template: "defaultFlexiPage", fallback: "unsupported" };
  return { requested, template: requested, fallback: null };
}

/** Is this region drawn as a view region on a Home page, where the iPad adds nothing? */
export function homeViewRegion(template: string, region: string): boolean {
  return REGION_KIND[template]?.[region] === "view";
}

/**
 * Turn the Tooling API's flat page (a tab set's `tabs` and a tab's `body` name Facet regions)
 * into the nested shape the metadata cache uses. A nested page comes back unchanged.
 */
export function nestFacets(page: Row): Row {
  const facets = new Map(arr(page.flexiPageRegions).filter((r) => str(r.type) === "Facet").map((r) => [str(r.name), arr(r.itemInstances)]));
  if (facets.size === 0) return page;
  const seen = new Set<string>();
  const nest = (items: Row[]): Row[] =>
    items.map((item) => {
      if (arr(item.itemInstances).length > 0) return { ...item, itemInstances: nest(arr(item.itemInstances)) };
      const ci = obj(item.componentInstance);
      const children = arr(ci.componentInstanceProperties).flatMap((p) => {
        const facet = str(p.value);
        if (!facets.has(facet) || seen.has(facet)) return [];
        seen.add(facet);
        return nest(facets.get(facet)!);
      });
      return children.length > 0 ? { ...item, itemInstances: children } : item;
    });
  return {
    ...page,
    flexiPageRegions: arr(page.flexiPageRegions)
      .filter((r) => str(r.type) !== "Facet")
      .map((r) => ({ ...r, itemInstances: nest(arr(r.itemInstances)) })),
  };
}

interface Drawn {
  name: string;
  label: string;
  item: Row;
}

/** Components the iPad would draw in a list of items: supported and not hidden by their visibility rule. */
function drawn(items: Row[]): Drawn[] {
  return items.flatMap((item) => {
    const ci = obj(item.componentInstance);
    const name = str(ci.componentName);
    if (!name) return [];
    const info = componentInfo(name);
    if (!info.supported || visibilityOf(ci.visibilityRule).visibility === "hidden") return [];
    return [{ name, label: info.label, item }];
  });
}

const regionLabel = (name: string) => (name ? name[0].toUpperCase() + name.slice(1) : name);
const list = (names: string[]) => (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`);
const several = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function prop(ci: Row, key: string): string {
  const p = arr(ci.componentInstanceProperties).find((x) => str(x.name).toLowerCase() === key.toLowerCase());
  return str(p?.value).trim();
}

/** Every item in the page, tab contents included. */
function allItems(items: Row[]): Row[] {
  return items.flatMap((item) => [item, ...allItems(arr(item.itemInstances))]);
}

/** What the iPad does differently from Lightning App Builder for this page. */
export function lintPage(input: Row): PageProblem[] {
  const page = nestFacets(input);
  const home = str(page.type) === "HomePage";
  const regions = arr(page.flexiPageRegions).filter((r) => str(r.type) !== "Facet");
  const { requested, template, fallback } = resolveTemplate(page);
  const slots = TEMPLATE_REGIONS[template];
  const problems: PageProblem[] = [];
  const shownAnywhere = regions.some((r) => drawn(arr(r.itemInstances)).length > 0);

  // SFFlexiPageViewController.swift:332-336 falls back to defaultFlexiPage, a single view region.
  if (fallback === "unsupported" && shownAnywhere) {
    problems.push({
      code: "template",
      severity: home ? "error" : "warning",
      message: home
        ? `The iPad doesn't have the ${requested || "page's"} template, so this Home page shows nothing on the iPad. Use the Standard Home Page template (top region).`
        : `The iPad doesn't have the ${requested || "page's"} template, so it draws only the Main region, with its components on top of each other. Use Header and One Region or Header and Right Sidebar.`,
    });
  }

  for (const region of regions) {
    const name = str(region.name);
    const shown = drawn(arr(region.itemInstances));
    if (shown.length === 0) continue;
    if (!slots.includes(name)) {
      // SFFlexiPageView.buildLayout only fills the template's slots; other regions are dropped.
      if (fallback !== "unsupported") {
        problems.push({
          code: "region-dropped",
          severity: "warning",
          message: `${several(shown.length, "component")} in the ${regionLabel(name)} region won't show on the iPad (${list(shown.map((c) => c.label))}). This template only draws ${slots.map(regionLabel).join(" and ")}.`,
        });
      }
      continue;
    }
    const kind = REGION_KIND[template]?.[name];
    if (home && kind === "view") {
      // SFLayoutRegion.addHomeComponent is empty for view regions.
      problems.push({
        code: "home-blank",
        severity: "error",
        message:
          fallback === "only-main"
            ? `This Home page has only a Main region, which the iPad draws as an empty screen. Use the Standard Home Page template and put the components in its top region.`
            : `The iPad shows nothing in the ${regionLabel(name)} region of this Home page (${list(shown.map((c) => c.label))}). Move them to a region that scrolls, like the top region of the Standard Home Page template.`,
      });
      continue;
    }
    // An unknown template's message already says its components sit on top of each other.
    if (!home && kind === "view" && shown.length > 1 && fallback !== "unsupported") {
      // SFLayoutViewRegion.addComponent pins every component to the region's edges; the last one covers the others.
      problems.push({
        code: "stacked",
        severity: "warning",
        message: `${shown.length} components share the ${regionLabel(name)} region, which the iPad draws one on top of another, so only ${shown[shown.length - 1].label} shows. Keep one component there${name === "header" ? ", the Highlights Panel" : ""}.`,
      });
    }
    if (kind === "scroll") {
      // SFComponentTabSetView takes the region's full height, so whatever follows it starts a screen lower.
      const at = shown.findIndex((c) => trimNamespace(c.name) === "flexipage:tabset");
      const after = at >= 0 ? shown.slice(at + 1) : [];
      if (after.length > 0) {
        problems.push({
          code: "after-tabset",
          severity: "warning",
          message: `${several(after.length, "component")} come${after.length === 1 ? "s" : ""} after the tab set in ${regionLabel(name)} (${list(after.map((c) => c.label))}). The tab set fills the screen on the iPad, so reps only find ${after.length === 1 ? "it" : "them"} by scrolling past it. Put ${after.length === 1 ? "it" : "them"} in a tab.`,
        });
      }
    }
  }

  // GenericRelatedList.Configuration.swift:82,86 — "Invalid or blank config. Please check page properties in Lightning App Builder".
  for (const item of allItems(regions.flatMap((r) => arr(r.itemInstances)))) {
    const ci = obj(item.componentInstance);
    const name = str(ci.componentName);
    if (!trimNamespace(name).toLowerCase().includes("lscgenericrelatedlist")) continue;
    const missing = [!prop(ci, "objectName") && "Object", !prop(ci, "fieldSetName") && "Field set"].filter(Boolean) as string[];
    if (missing.length === 0) continue;
    const label = prop(ci, "label");
    problems.push({
      code: "related-list-config",
      severity: "error",
      message: `The ${label ? `"${label}" ` : ""}generic related list has no ${missing.join(" or ").toLowerCase()}, so the iPad shows "Invalid or blank config. Please check page properties in Lightning App Builder". Fill in its ${missing.join(" and ")} properties.`,
    });
  }
  return problems;
}
