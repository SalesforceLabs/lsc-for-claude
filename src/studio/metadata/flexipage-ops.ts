/**
 * Edits to a Lightning page's XML: move, remove and insert components and
 * record tabs within their region or facet, and set a few properties
 * (`mobileHeight`, a tab's `active` and `title`, `maxRecordsToDisplay` / `rowsToDisplay`).
 *
 * Regions and facets are found by name; items by their `identifier` when they
 * have one, else by index, and their component name is checked either way.
 * Each op is checked against the document as it is now — a target that isn't
 * there, or a value that isn't what the map saw, throws `StaleFlexiPageError` —
 * and returns the op that reverses it, addressed against the document after
 * it. Ops apply in order, each to the result of the one before.
 */

import { TEMPLATE_REGIONS } from "../published.js";
import type { FlexiItemRef, FlexiPageOp, FlexiPageProperty } from "../types.js";
import { childText, childrenNamed, cloneNode, insertInOrder, leaf, parseXml, serializeNode, setChildText, type XmlNode } from "./xml.js";

const FLEXIPAGE_ORDER = ["description", "events", "flexiPageRegions", "masterLabel", "parentFlexiPage", "platformActionlist", "quickActionList", "sobjectType", "template", "type"];
const REGION_ORDER = ["appendable", "componentInstances", "itemInstances", "mode", "name", "prependable", "replaceable", "type"];
const COMPONENT_ORDER = ["componentInstanceProperties", "componentName", "identifier", "visibilityRule"];
const PROPERTY_ORDER = ["name", "type", "value", "valueList"];

export class StaleFlexiPageError extends Error {}

export interface FlexiPageChange {
  field: string;
  before: string;
  after: string;
}

const COMPONENT = /^\w+(:\w+)?$/;
const IDENTIFIER = /^\w+$/;
const REGION = /^[\w-]+$/;
/** Tab titles longer than this are cut on the iPad. */
export const TAB_TITLE_MAX = 25;

function assertRegion(name: string): void {
  if (!REGION.test(name)) throw new Error(`Invalid region name: ${name}`);
}
function assertItem(ref: FlexiItemRef): void {
  const component = ref.component.startsWith("field:") ? ref.component.slice(6) : ref.component;
  if (!/^[\w.]+$/.test(component) && !COMPONENT.test(component)) throw new Error(`Invalid component name: ${ref.component}`);
  if (ref.identifier !== null && !IDENTIFIER.test(ref.identifier)) throw new Error(`Invalid identifier: ${ref.identifier}`);
  if (!Number.isInteger(ref.index) || ref.index < 0) throw new Error(`Invalid index: ${ref.index}`);
}

// --- Reading -----------------------------------------------------------------------

export const regionsOf = (root: XmlNode) => childrenNamed(root, "flexiPageRegions");
export const regionName = (r: XmlNode) => childText(r, "name") ?? "";
export const itemsOf = (region: XmlNode) => childrenNamed(region, "itemInstances");

const instanceOf = (item: XmlNode) => item.children.find((c) => c.tag === "componentInstance" || c.tag === "fieldInstance");

/** The item's componentName, or `field:<fieldItem>` for a Dynamic Forms field. */
export function componentOf(item: XmlNode): string {
  const inst = instanceOf(item);
  if (!inst) return "";
  return inst.tag === "fieldInstance" ? `field:${childText(inst, "fieldItem") ?? ""}` : childText(inst, "componentName") ?? "";
}

export function identifierOf(item: XmlNode): string | null {
  const inst = instanceOf(item);
  return (inst && childText(inst, "identifier")) || null;
}

const propertyNodes = (item: XmlNode) => {
  const inst = instanceOf(item);
  return inst && inst.tag === "componentInstance" ? childrenNamed(inst, "componentInstanceProperties") : [];
};

/** The item's properties that have a value. */
export function propertiesOf(item: XmlNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of propertyNodes(item)) {
    const value = childText(p, "value");
    if (value !== undefined) out[childText(p, "name") ?? ""] = value;
  }
  return out;
}

/** Facet regions the item's properties name: a tabset's tabs, a tab's body, and so on. */
export function facetsOf(root: XmlNode, item: XmlNode): string[] {
  const facets = new Set(regionsOf(root).filter((r) => childText(r, "type") === "Facet").map(regionName));
  return Object.values(propertiesOf(item)).filter((v) => facets.has(v));
}

function findRegion(root: XmlNode, name: string): XmlNode {
  const region = regionsOf(root).find((r) => regionName(r) === name);
  if (!region) throw new StaleFlexiPageError(`The region ${name} isn't on the page.`);
  return region;
}

function findItem(region: XmlNode, ref: FlexiItemRef): XmlNode {
  const items = itemsOf(region);
  const item = ref.identifier !== null ? items.find((i) => identifierOf(i) === ref.identifier) : items[ref.index];
  const name = ref.identifier ?? `${ref.component} (item ${ref.index + 1})`;
  if (!item || (ref.identifier === null && identifierOf(item) !== null)) throw new StaleFlexiPageError(`${name} isn't in ${regionName(region)} any more.`);
  if (componentOf(item) !== ref.component) throw new StaleFlexiPageError(`${name} is no longer a ${ref.component}.`);
  return item;
}

/** How an op addresses `item` in `region` as the document is now. */
export function refOf(region: XmlNode, item: XmlNode): FlexiItemRef {
  return { component: componentOf(item), identifier: identifierOf(item), index: itemsOf(region).indexOf(item) };
}

function nextItem(region: XmlNode, item: XmlNode): XmlNode | undefined {
  const items = itemsOf(region);
  return items[items.indexOf(item) + 1];
}

function place(region: XmlNode, item: XmlNode, before: FlexiItemRef | null): void {
  if (!before) return insertInOrder(region, item, REGION_ORDER);
  const target = findItem(region, before);
  region.children.splice(region.children.indexOf(target), 0, item);
}

function detach(parent: XmlNode, node: XmlNode): void {
  parent.children.splice(parent.children.indexOf(node), 1);
}

/** Every identifier on the page — App Builder keeps them unique per page. */
export function identifiersOf(root: XmlNode): Set<string> {
  return new Set(regionsOf(root).flatMap((r) => itemsOf(r).map(identifierOf)).filter((i): i is string => !!i));
}

/** The identifier App Builder would give a new `component`: `ns_name`, then `ns_name2`, `ns_name3`… (`c_` for a custom one). */
export function newIdentifier(component: string, taken: Set<string>): string {
  const base = component.includes(":") ? component.replace(":", "_") : `c_${component}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

// --- Words for the review ----------------------------------------------------------

/** `Standard.Tab.detail` / `{!$Label.ns__Dashboard}` → a readable title (as published.ts shows it). */
export function tabTitle(raw: string): string {
  const std = /^Standard\.Tab\.(\w+)$/.exec(raw);
  if (std) return ({ detail: "Details", relatedLists: "Related", activity: "Activity", feed: "Chatter", news: "News" } as Record<string, string>)[std[1]] ?? std[1];
  const label = /^\{!\$Label\.(?:\w+__)?(\w+)\}$/.exec(raw);
  if (label) return label[1].replace(/_/g, " ");
  return raw;
}

const isTab = (item: XmlNode) => componentOf(item) === "flexipage:tab";

function itemWords(item: XmlNode): string {
  if (isTab(item)) return `Tab "${tabTitle(propertiesOf(item).title ?? "")}"`;
  return `Component ${componentOf(item)}`;
}

/** "main", or the tab or component whose facet it is. */
function regionWords(root: XmlNode, name: string): string {
  for (const r of regionsOf(root)) {
    for (const item of itemsOf(r)) {
      if (!Object.values(propertiesOf(item)).includes(name)) continue;
      if (isTab(item)) return `the "${tabTitle(propertiesOf(item).title ?? "")}" tab`;
      if (componentOf(item) === "flexipage:tabset") return "the record tabs";
      return `${componentOf(item)}`;
    }
  }
  return `the ${name} region`;
}

const position = (root: XmlNode, region: XmlNode, item: XmlNode) =>
  `Position ${itemsOf(region).indexOf(item) + 1} of ${itemsOf(region).length} in ${regionWords(root, regionName(region))}`;

// --- Properties --------------------------------------------------------------------

function propertyAllowed(component: string, property: FlexiPageProperty): boolean {
  const name = component.includes(":") ? component.split(":")[1] : component;
  switch (property) {
    case "mobileHeight":
      return name.startsWith("lscMobileInline_");
    case "active":
    case "title":
      return component === "flexipage:tab";
    case "maxRecordsToDisplay":
    case "rowsToDisplay":
      return true;
  }
}

function assertValue(property: FlexiPageProperty, value: string | null): void {
  const ok =
    property === "active"
      ? value === null || value === "true" || value === "false"
      : property === "title"
        ? value !== null && value.trim().length > 0 && value.length <= 255
        : value !== null && /^\d{1,4}$/.test(value) && Number(value) >= 1;
  if (!ok) throw new Error(`Invalid ${property}: ${value ?? "(none)"}`);
}

function propertyNode(item: XmlNode, property: string): XmlNode | undefined {
  return propertyNodes(item).find((p) => childText(p, "name") === property);
}

function setProperty(item: XmlNode, property: string, value: string | null): void {
  const inst = instanceOf(item)!;
  const node = propertyNode(item, property);
  if (value === null) {
    if (node) detach(inst, node);
    return;
  }
  if (node) return setChildText(node, "value", value, PROPERTY_ORDER);
  // App Builder lists properties by name.
  const props = childrenNamed(inst, "componentInstanceProperties");
  const after = props.find((p) => (childText(p, "name") ?? "") > property);
  const fresh: XmlNode = { tag: "componentInstanceProperties", children: [leaf("name", property), leaf("value", value)] };
  if (after) inst.children.splice(inst.children.indexOf(after), 0, fresh);
  else insertInOrder(inst, fresh, COMPONENT_ORDER);
}

const valueWords = (property: FlexiPageProperty, v: string | null) =>
  v === null ? (property === "active" ? "false" : "(not set)") : property === "title" ? `"${tabTitle(v)}"` : v;

// --- New items ---------------------------------------------------------------------

function newItem(component: string, identifier: string, properties: { name: string; value: string }[]): XmlNode {
  const props = [...properties]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((p) => {
      if (!/^\w+$/.test(p.name)) throw new Error(`Invalid property name: ${p.name}`);
      return { tag: "componentInstanceProperties", children: [leaf("name", p.name), leaf("value", p.value)] };
    });
  return {
    tag: "itemInstances",
    children: [{ tag: "componentInstance", children: [...props, leaf("componentName", component), leaf("identifier", identifier)] }],
  };
}

function parseFragment(xml: string, tag: string): XmlNode {
  const node = parseXml(xml);
  if (node.tag !== tag) throw new Error(`Expected a ${tag} element.`);
  return node;
}

/** The facets `item` points at, and the ones those point at, in document order. */
function facetTree(root: XmlNode, item: XmlNode): XmlNode[] {
  const out = new Set<XmlNode>();
  const walk = (it: XmlNode) => {
    for (const name of facetsOf(root, it)) {
      const facet = regionsOf(root).find((r) => regionName(r) === name);
      if (!facet || out.has(facet)) continue;
      out.add(facet);
      itemsOf(facet).forEach(walk);
    }
  };
  walk(item);
  return [...out].sort((a, b) => root.children.indexOf(a) - root.children.indexOf(b));
}

// --- Ops ---------------------------------------------------------------------------

/** Apply one op to `root` in place; returns its inverse and what changed, in words. */
export function applyFlexiPageOp(root: XmlNode, op: FlexiPageOp): { inverse: FlexiPageOp; change: FlexiPageChange } {
  switch (op.op) {
    case "moveComponent": {
      assertRegion(op.component.region);
      assertItem(op.component.item);
      if (op.before) assertItem(op.before);
      const region = findRegion(root, op.component.region);
      const item = findItem(region, op.component.item);
      // Both refs address the document as it is before the move.
      const target = op.before ? findItem(region, op.before) : null;
      if (target === item) throw new Error("A component can't move before itself.");
      const was = position(root, region, item);
      const next = nextItem(region, item);
      detach(region, item);
      if (target) region.children.splice(region.children.indexOf(target), 0, item);
      else insertInOrder(region, item, REGION_ORDER);
      return {
        inverse: {
          op: "moveComponent",
          component: { region: op.component.region, item: refOf(region, item) },
          before: next ? refOf(region, next) : null,
        },
        change: { field: itemWords(item), before: was, after: position(root, region, item) },
      };
    }
    case "removeComponent": {
      assertRegion(op.component.region);
      assertItem(op.component.item);
      const region = findRegion(root, op.component.region);
      const item = findItem(region, op.component.item);
      const was = position(root, region, item);
      const words = itemWords(item);
      const facets = facetTree(root, item).map((f) => ({ xml: serializeNode(f), at: root.children.indexOf(f) }));
      const next = nextItem(region, item);
      for (const f of facetTree(root, item)) detach(root, f);
      detach(region, item);
      return {
        inverse: {
          op: "addComponent",
          region: op.component.region,
          before: next ? refOf(region, next) : null,
          component: componentOf(item),
          identifier: identifierOf(item),
          xml: serializeNode(item),
          ...(facets.length ? { facets } : {}),
        },
        change: { field: words, before: was, after: "(removed)" },
      };
    }
    case "addComponent": {
      assertRegion(op.region);
      assertItem({ component: op.component, identifier: op.identifier, index: 0 });
      if (op.before) assertItem(op.before);
      const region = findRegion(root, op.region);
      if (op.identifier !== null && identifiersOf(root).has(op.identifier)) {
        throw new StaleFlexiPageError(`${op.identifier} is already on the page.`);
      }
      let item: XmlNode;
      if (op.xml) {
        item = parseFragment(op.xml, "itemInstances");
        if (componentOf(item) !== op.component || identifierOf(item) !== op.identifier) throw new Error("The component doesn't match its XML.");
      } else {
        if (!op.identifier || !COMPONENT.test(op.component)) throw new Error("A new component needs a component name and an identifier.");
        if (!insertableRegion(root, region)) throw new Error(`The iPad doesn't show the ${regionName(region)} region of this page's template.`);
        item = newItem(op.component, op.identifier, op.properties ?? []);
      }
      const facets = (op.facets ?? []).map((f) => ({ node: parseFragment(f.xml, "flexiPageRegions"), at: f.at }));
      for (const f of facets) {
        if (regionsOf(root).some((r) => regionName(r) === regionName(f.node))) throw new StaleFlexiPageError(`The facet ${regionName(f.node)} is already on the page.`);
        if (childText(f.node, "type") !== "Facet") throw new Error("Only facets come back with a component.");
      }
      place(region, item, op.before);
      for (const f of [...facets].sort((a, b) => a.at - b.at)) {
        if (Number.isInteger(f.at) && f.at >= 0 && f.at <= root.children.length) root.children.splice(f.at, 0, f.node);
        else insertInOrder(root, f.node, FLEXIPAGE_ORDER);
      }
      return {
        inverse: { op: "removeComponent", component: { region: op.region, item: refOf(region, item) } },
        change: { field: itemWords(item), before: "(not on the page)", after: position(root, region, item) },
      };
    }
    case "setComponentProperty": {
      assertRegion(op.component.region);
      assertItem(op.component.item);
      if (!propertyAllowed(op.component.item.component, op.property)) {
        throw new Error(`Studio can't set ${op.property} on ${op.component.item.component}.`);
      }
      assertValue(op.property, op.to);
      const region = findRegion(root, op.component.region);
      const item = findItem(region, op.component.item);
      const now = propertiesOf(item)[op.property] ?? null;
      if (now !== op.from) {
        throw new StaleFlexiPageError(`${itemWords(item)}'s ${op.property} is now ${valueWords(op.property, now)}.`);
      }
      setProperty(item, op.property, op.to);
      return {
        inverse: { op: "setComponentProperty", component: { region: op.component.region, item: refOf(region, item) }, property: op.property, from: op.to, to: op.from },
        change: { field: `${itemWords(item)} · ${op.property}`, before: valueWords(op.property, op.from), after: valueWords(op.property, op.to) },
      };
    }
  }
}

/** Apply ops in order to a copy of `root`. The inverse ops undo them all, in the order given. */
export function applyFlexiPageOps(root: XmlNode, ops: FlexiPageOp[]): { root: XmlNode; inverse: FlexiPageOp[]; changes: FlexiPageChange[] } {
  const copy = cloneNode(root);
  const inverse: FlexiPageOp[] = [];
  const changes: FlexiPageChange[] = [];
  for (const op of ops) {
    const r = applyFlexiPageOp(copy, op);
    inverse.unshift(r.inverse);
    changes.push(r.change);
  }
  return { root: copy, inverse, changes };
}

/** True when the item's visibility rule has several criteria and no boolean filter — the iPad only checks the first. */
function firstCriterionOnly(item: XmlNode): boolean {
  const rule = instanceOf(item)?.children.find((c) => c.tag === "visibilityRule");
  return !!rule && childrenNamed(rule, "criteria").length > 1 && !childText(rule, "booleanFilter");
}

/** Review warnings the ops trip on the iPad: long tab titles, and visibility rules it reads differently, on the edited page `root`. */
export function flexiPageWarnings(ops: FlexiPageOp[], root?: XmlNode): string[] {
  const out = ops.flatMap((op) =>
    op.op === "setComponentProperty" && op.property === "title" && op.to && tabTitle(op.to).length > TAB_TITLE_MAX
      ? [`The tab title "${tabTitle(op.to)}" is over ${TAB_TITLE_MAX} characters — the iPad cuts it short.`]
      : []
  );
  if (!root) return out;
  const touched = new Set(
    ops.flatMap((op) => (op.op === "addComponent" ? [op.identifier] : op.op === "removeComponent" ? [] : [op.component.item.identifier])).filter(Boolean)
  );
  for (const r of regionsOf(root)) {
    for (const item of itemsOf(r)) {
      if (touched.has(identifierOf(item)) && firstCriterionOnly(item)) {
        out.push(`${itemWords(item)} has a visibility rule with several conditions and no filter logic — the iPad only checks the first condition.`);
      }
    }
  }
  return out;
}

/** Regions a new component can go in: the template's slots on the iPad, and any facet (a tab's body). */
function insertableRegion(root: XmlNode, region: XmlNode): boolean {
  if (childText(region, "type") === "Facet") return true;
  const name = childText(childrenNamed(root, "template")[0] ?? { tag: "template", children: [] }, "name") ?? "";
  const slots = TEMPLATE_REGIONS[name.includes(":") ? name.split(":")[1] : name] ?? TEMPLATE_REGIONS.defaultFlexiPage;
  return slots.includes(regionName(region));
}

