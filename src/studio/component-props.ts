/**
 * The properties of a Lightning page component, for the properties sheet of
 * the iPad preview's Edit mode. A custom LWC's come from the `targetConfigs`
 * of its bundle's `js-meta.xml` (`lightning__HomePage` / `lightning__RecordPage`);
 * the standard and LSC components the iPad draws come from a curated table
 * beside the component catalog. Each definition says whether the iPad reads
 * the property at all — lifesciences-ios is the source of truth, and
 * `published.ts` keeps the properties it passes to the preview (`PROP_KEEP`).
 * Read-only.
 */

import { XMLParser } from "fast-xml-parser";
import { query } from "./helpers.js";
import { PROP_KEEP } from "./published.js";

export type PropKind = "String" | "Integer" | "Boolean" | "Picklist";

export interface ComponentPropDef {
  name: string;
  label: string;
  type: PropKind;
  /** A String that wants a text area. */
  multiline?: boolean;
  description?: string;
  default?: string;
  min?: number;
  max?: number;
  required?: boolean;
  /** A picklist's values (a static datasource). */
  options?: string[];
  /** Whether the iPad reads it: `unused` ones are greyed out, `unknown` ones are passed through for all Studio can tell. */
  ipad: "used" | "unused" | "unknown";
  ipadNote?: string;
}

export interface ComponentProps {
  component: string;
  source: "bundle" | "curated" | "none";
  properties: ComponentPropDef[];
  /** Every non-empty property is read by the iPad whatever its name (the Agentforce welcome's prompt chips). */
  dynamic?: string;
  /** Why there are no definitions, or what's partial. */
  note?: string;
}

/** Properties the iPad preview reads from any component (`published.ts`). */
export const IPAD_READS: string[] = [...PROP_KEEP, "rowsToDisplay", "maxRecordsToDisplay", "active"].sort();

const trimNs = (name: string) => (name.includes(":") ? name.split(":")[1] : name);
const isInline = (component: string) => /^lscMobileInline_/.test(trimNs(component));

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const TARGETS = { HomePage: "lightning__HomePage", RecordPage: "lightning__RecordPage" } as const;

/**
 * The properties a `js-meta.xml` offers on a Home or record page (both when
 * `pageType` is omitted), first definition wins by name. Types: Integer and
 * Boolean as such, a static `datasource` makes a picklist, anything else is a string.
 */
export function parseJsMeta(xml: string, pageType?: "HomePage" | "RecordPage"): ComponentPropDef[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseAttributeValue: false });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }
  type Node = Record<string, unknown>;
  const bundle = doc.LightningComponentBundle as Node | undefined;
  const configs = asArray((bundle?.targetConfigs as Node | undefined)?.targetConfig as Node | Node[] | undefined);
  const wanted: string[] = pageType ? [TARGETS[pageType]] : Object.values(TARGETS);
  const out = new Map<string, ComponentPropDef>();
  for (const config of configs) {
    const targets = String(config["@_targets"] ?? "")
      .split(",")
      .map((t) => t.trim());
    if (!targets.some((t) => wanted.includes(t))) continue;
    for (const p of asArray(config.property as Node | Node[] | undefined)) {
      const name = String(p["@_name"] ?? "");
      if (!/^\w+$/.test(name) || out.has(name)) continue;
      const type = String(p["@_type"] ?? "String");
      const datasource = String(p["@_datasource"] ?? "").trim();
      const options = datasource && !/^apex:\/\//i.test(datasource) ? datasource.split(",").map((o) => o.trim()).filter(Boolean) : [];
      const kind: PropKind = options.length ? "Picklist" : /^integer$/i.test(type) ? "Integer" : /^boolean$/i.test(type) ? "Boolean" : "String";
      const num = (a: string) => (p[a] !== undefined && String(p[a]).trim() !== "" && Number.isFinite(Number(p[a])) ? Number(p[a]) : undefined);
      out.set(name, {
        name,
        label: String(p["@_label"] ?? "") || name,
        type: kind,
        ipad: "unknown",
        ...(p["@_description"] ? { description: String(p["@_description"]) } : {}),
        ...(p["@_default"] !== undefined ? { default: String(p["@_default"]) } : {}),
        ...(kind === "Integer" && num("@_min") !== undefined ? { min: num("@_min") } : {}),
        ...(kind === "Integer" && num("@_max") !== undefined ? { max: num("@_max") } : {}),
        ...(String(p["@_required"]) === "true" ? { required: true } : {}),
        ...(options.length ? { options } : {}),
      });
    }
  }
  return [...out.values()];
}

type Curated = { label: string; properties: ComponentPropDef[]; dynamic?: string };
type DefInput = Omit<ComponentPropDef, "ipad">;

const used = (d: DefInput, ipadNote?: string): ComponentPropDef => ({ ...d, ipad: "used", ...(ipadNote ? { ipadNote } : {}) });
const unused = (d: DefInput, ipadNote = "The iPad ignores this."): ComponentPropDef => ({ ...d, ipad: "unused", ipadNote });

const MOBILE_HEIGHT = used({
  name: "mobileHeight",
  label: "Height on iPad (pt)",
  type: "Integer",
  min: 1,
  max: 9999,
  default: "400",
  description: "How tall the component's frame is on the iPad.",
});

/** Standard and LSC components the iPad draws, by full name or the name without its namespace. */
const CURATED: Record<string, Curated> = {
  "flexipage:tab": {
    label: "Tab",
    properties: [used({ name: "title", label: "Tab title", type: "String", required: true, description: "The iPad cuts titles over 25 characters short." })],
  },
  "flexipage:tabset": {
    label: "Tabs",
    properties: [unused({ name: "variant", label: "Variant", type: "Picklist", options: ["default", "scoped", "vertical"] }, "The iPad draws its own tab bar.")],
  },
  "flexipage:richText": {
    label: "Rich text",
    properties: [
      used({ name: "richTextValue", label: "Text", type: "String", multiline: true, description: "HTML shown in the component." }),
      unused({ name: "decorate", label: "Decorate", type: "Boolean" }),
    ],
  },
  "flexipage:recentItems": {
    label: "Recent items",
    properties: [used({ name: "maxRecords", label: "Records to show", type: "Integer", min: 1, max: 50, default: "3" })],
  },
  "force:relatedListSingleContainer": {
    label: "Related list",
    properties: [
      used({ name: "rowsToDisplay", label: "Rows to show", type: "Integer", min: 1, max: 9999, default: "5", description: "The iPad shows 5 rows unless the list is dynamic or an advanced grid." }),
      unused({ name: "showActionBar", label: "Show action bar", type: "Boolean", default: "true" }),
      unused({ name: "relatedListComponentOverride", label: "Component override", type: "String" }),
    ],
  },
  "desktopDashboards:embeddedDashboard": {
    label: "Dashboard",
    properties: [used({ name: "dashboardName", label: "Dashboard", type: "String", required: true }), unused({ name: "height", label: "Height", type: "Integer", min: 1 })],
  },
  "flexipage:reportChart": {
    label: "Report chart",
    properties: [unused({ name: "reportName", label: "Report", type: "String" }, "The iPad shows a placeholder for report charts.")],
  },
  "flexipage:filterListCard": {
    label: "List view",
    properties: [unused({ name: "maxRecordsToDisplay", label: "Records to show", type: "Integer", min: 1, max: 9999 }, "The iPad shows a placeholder for list views.")],
  },
  ActivityPlanByProduct: {
    label: "Activity plan by product",
    properties: [
      used(
        { name: "showEnhActivityPlanOnMobileHomepage", label: "Enhanced plan on Home", type: "Boolean", default: "false" },
        "When on, the card takes the full width; otherwise it pairs with another half-width card."
      ),
    ],
  },
  lsAgentforceWelcome: {
    label: "Agentforce welcome",
    properties: [],
    dynamic: "Every property with a value becomes a prompt chip on the iPad, whatever its name.",
  },
  Ratings: { label: "Ratings", properties: [], dynamic: "Every property with a value is read by the iPad, whatever its name." },
};

/** The curated entry for a page `componentName`: the full name, then the name without its namespace. */
export function curatedFor(component: string): Curated | undefined {
  return CURATED[component] ?? CURATED[trimNs(component)];
}

/** An LWC's own properties: `mobileHeight` on an inline LWC is read when the bundle declares it (the org rejects a property its js-meta.xml doesn't); for the rest, Studio can't tell. */
function markBundleProps(component: string, defs: ComponentPropDef[]): ComponentPropDef[] {
  const mapped = defs.map((d): ComponentPropDef => {
    if (d.name === "mobileHeight" && isInline(component)) return { ...d, min: d.min ?? 1, ipad: "used", ipadNote: MOBILE_HEIGHT.ipadNote };
    return { ...d, ipadNote: "Studio can't tell whether the iPad passes this to the component." };
  });
  return mapped;
}

const STANDARD_NAMESPACES = new Set(["flexipage", "force", "forceChatter", "lightning", "desktopDashboards", "analytics_embedding", "tableau", "flowruntime", "runtime_sales_activities", "forceContent", "wave", "lst"]);

/** The bundle's `js-meta.xml`, or null when it can't be read (managed bundles hide their source). */
async function jsMetaOf(component: string, org: string): Promise<string | null> {
  const [ns, name] = component.includes(":") ? component.split(":") : ["c", component];
  const nsClause = ns === "c" ? "LightningComponentBundle.NamespacePrefix = null" : `LightningComponentBundle.NamespacePrefix = '${ns}'`;
  const rows = await query(
    `SELECT Source FROM LightningComponentResource WHERE FilePath LIKE '%.js-meta.xml' AND LightningComponentBundle.DeveloperName = '${name}' AND ${nsClause} LIMIT 1`,
    org,
    true
  );
  const source = rows[0]?.Source;
  return typeof source === "string" && source.trim() ? source : null;
}

/** Definitions for one component: the curated table, else the bundle's js-meta.xml. */
export async function collectComponentProps(component: string, pageType: "HomePage" | "RecordPage" | undefined, org: string): Promise<ComponentProps> {
  if (!/^\w+(:\w+)?$/.test(component)) throw new Error(`Invalid component name: ${component}`);
  const curated = curatedFor(component);
  if (curated && !isInline(component)) {
    return { component, source: "curated", properties: curated.properties, ...(curated.dynamic ? { dynamic: curated.dynamic } : {}) };
  }
  const ns = component.includes(":") ? component.split(":")[0] : "c";
  if (STANDARD_NAMESPACES.has(ns)) {
    return { component, source: "none", properties: [], note: "Studio has no definitions for this component. Properties already on the page are listed untyped." };
  }
  let xml: string | null = null;
  try {
    xml = await jsMetaOf(component, org);
  } catch {
    xml = null;
  }
  if (xml) return { component, source: "bundle", properties: markBundleProps(component, parseJsMeta(xml, pageType)) };
  return {
    component,
    source: isInline(component) ? "curated" : "none",
    properties: isInline(component) ? [MOBILE_HEIGHT] : [],
    note: "Studio couldn't read this component's js-meta.xml (a managed package hides it). Properties already on the page are listed untyped.",
  };
}
