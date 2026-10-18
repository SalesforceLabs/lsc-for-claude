/**
 * Property definitions for the properties sheet (`studio_component_props`,
 * server side in src/studio/component-props.ts) and the typed checks on a
 * value. Pure, so the sheet and the tests share them.
 */

export type PropKind = "String" | "Integer" | "Boolean" | "Picklist";

export interface ComponentPropDef {
  name: string;
  label: string;
  type: PropKind;
  multiline?: boolean;
  description?: string;
  default?: string;
  min?: number;
  max?: number;
  required?: boolean;
  options?: string[];
  ipad: "used" | "unused" | "unknown";
  ipadNote?: string;
}

export interface ComponentProps {
  component: string;
  source: "bundle" | "curated" | "none";
  properties: ComponentPropDef[];
  dynamic?: string;
  note?: string;
}

/** Properties the iPad preview reads from any component. Copy of IPAD_READS in src/studio/component-props.ts, kept equal by a test. */
export const IPAD_READS: string[] = [
  "active",
  "dashboardName",
  "entityNames",
  "graphName",
  "label",
  "layoutName",
  "maxRecords",
  "maxRecordsToDisplay",
  "mobileHeight",
  "relatedListApiName",
  "richTextValue",
  "rowsToDisplay",
  "showEnhActivityPlanOnMobileHomepage",
  "title",
  "totalCards",
];

/** Components whose every property the iPad reads, whatever its name (published.ts `keepAll`). */
export const DYNAMIC_COMPONENTS = ["lsAgentforceWelcome", "Ratings"];

/** The longest value a property can have; the page's live read leaves longer ones out. */
export const VALUE_MAX = 1000;

/** Integer properties with no range of their own. */
const DEFAULT_MAX = 9999;

/** What is wrong with `value` for `def`, or a warning about it. An empty value is fine unless the property is required. */
export function checkProp(def: ComponentPropDef, value: string): { problem?: string; warning?: string } {
  const empty = value.trim() === "";
  if (empty) return def.required ? { problem: `${def.label} is required.` } : {};
  switch (def.type) {
    case "Integer": {
      if (!/^-?\d+$/.test(value.trim())) return { problem: range(def) };
      const n = Number(value);
      if (n < (def.min ?? 1) || n > (def.max ?? DEFAULT_MAX)) return { problem: range(def) };
      return {};
    }
    case "Boolean":
      return value === "true" || value === "false" ? {} : { problem: "Choose on or off." };
    case "Picklist":
      return def.options && !def.options.includes(value) ? { problem: "Choose one of the listed values." } : {};
    default:
      return value.length > VALUE_MAX ? { problem: `At most ${VALUE_MAX} characters.` } : {};
  }
}

function range(def: ComponentPropDef): string {
  return `Enter a whole number from ${def.min ?? 1} to ${def.max ?? DEFAULT_MAX}.`;
}

/** The value as the page stores it: whole numbers without padding, an empty value as none. */
export function normalizeProp(def: ComponentPropDef, value: string): string | null {
  if (value.trim() === "") return null;
  return def.type === "Integer" ? String(Number(value)) : value;
}

/** An untyped definition for a property already on the page that no definition covers. */
export function untypedDef(name: string, dynamic: boolean): ComponentPropDef {
  const reads = dynamic || IPAD_READS.includes(name);
  return {
    name,
    label: name,
    type: "String",
    ipad: reads ? "used" : "unknown",
    ipadNote: reads ? undefined : "Studio doesn't know whether the iPad reads this.",
  };
}
