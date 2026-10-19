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

/** How a page property that no definition lists is treated. */
export type Unlisted = "used" | "unused" | "unknown";

export interface ComponentProps {
  component: string;
  source: "bundle" | "curated" | "none";
  properties: ComponentPropDef[];
  dynamic?: string;
  /** Whether the iPad draws the component at all; `no` means none of its properties is used. */
  renders: "yes" | "no";
  /** Said once for the component (not drawn, only an inline LWC's height passed, not traced). */
  rendersNote?: string;
  unlisted: Unlisted;
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

/** Components whose every property the iPad reads, whatever its name (AgentforceWelcomeViewModel.swift:70-88). */
export const DYNAMIC_COMPONENTS = ["lsAgentforceWelcome"];

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

/**
 * An untyped definition for a property already on the page that no definition
 * covers. `unlisted` is the component's answer from `studio_component_props`
 * (which lists what lifesciences-ios reads); every component reads `title` as
 * its header (SFComponentViewController.swift:119, 395). Until the answer
 * arrives (`undefined`) the preview's own list stands in and nothing is claimed
 * about the rest.
 */
export function untypedDef(name: string, unlisted?: Unlisted): ComponentPropDef {
  const base = { name, label: name, type: "String" as const };
  if (name === "title" || unlisted === "used") return { ...base, ipad: "used" };
  if (unlisted === "unused") return { ...base, ipad: "unused" };
  if (unlisted === undefined && IPAD_READS.includes(name)) return { ...base, ipad: "used" };
  return { ...base, ipad: "unknown" };
}

/**
 * The line shown once under the sheet's heading, or null: a component the iPad
 * doesn't draw says so for all its properties, an inline LWC says what it is
 * passed, an untraced one says Studio hasn't traced it.
 */
export function componentNote(loaded: ComponentProps | null | undefined): string | null {
  if (!loaded) return null;
  if (loaded.renders === "no") return loaded.rendersNote ?? "The iPad doesn't draw this component, so none of its properties are used.";
  return loaded.rendersNote ?? null;
}

/**
 * The line under one field about the iPad, or null. A property the iPad doesn't
 * read says "Not used on the iPad", except when the component isn't drawn at
 * all (`notDrawn`) and says that once for every property. "Doesn't know" is
 * never said per field.
 */
export function fieldIpadNote(def: ComponentPropDef, notDrawn: boolean): string | null {
  if (def.ipad === "unused") {
    if (notDrawn) return null;
    return `Not used on the iPad${def.ipadNote && def.ipadNote !== "The iPad ignores this." ? ` — ${def.ipadNote}` : ""}`;
  }
  return def.ipad === "used" && def.ipadNote ? def.ipadNote : null;
}
