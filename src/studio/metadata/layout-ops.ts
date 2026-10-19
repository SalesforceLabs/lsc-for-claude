/**
 * Edits to a page layout's XML: move, add and remove fields, sections and
 * related lists, a field's behavior, and whether a section shows its heading.
 *
 * Fields and related lists are found by name, sections by their raw label and
 * which of the sections with that label they are (`nth`). Each op is checked
 * against the document as it is now — a target that isn't there, or a value
 * that isn't what the map saw, throws `StaleLayoutError` — and returns the op
 * that reverses it. Ops apply in order, each to the result of the one before.
 */

import type { FieldBehavior, FieldSlot, LayoutOp, SectionRef } from "../types.js";
import {
  childText,
  childrenNamed,
  cloneNode,
  insertInOrder,
  leaf,
  parseXml,
  serializeNode,
  setChildText,
  type XmlNode,
} from "./xml.js";

/** Layout's top-level elements in Metadata API order. */
const LAYOUT_ORDER = [
  "customButtons",
  "customConsoleComponents",
  "emailDefault",
  "excludeButtons",
  "feedLayout",
  "headers",
  "layoutSections",
  "miniLayout",
  "multilineLayoutFields",
  "platformActionList",
  "quickActionList",
  "relatedContent",
  "relatedLists",
  "relatedObjects",
  "runAssignmentRulesDefault",
  "showEmailCheckbox",
  "showHighlightsPanel",
  "showInteractionLogPanel",
  "showKnowledgeComponent",
  "showRunAssignmentRulesCheckbox",
  "showSolutionSection",
  "showSubmitAndAttachButton",
  "summaryLayout",
];
const SECTION_ORDER = ["customLabel", "detailHeading", "editHeading", "label", "layoutColumns", "style"];
const ITEM_ORDER = ["analyticsCloudComponent", "behavior", "canvas", "component", "customLink", "emptySpace", "field"];

export class StaleLayoutError extends Error {}

export interface LayoutChange {
  field: string;
  before: string;
  after: string;
}

const NAME = /^[\w.]+$/;
const BEHAVIORS: FieldBehavior[] = ["Edit", "Required", "Readonly"];
const BEHAVIOR_WORDS: Record<FieldBehavior, string> = { Edit: "Editable", Required: "Required", Readonly: "Read only" };

function assertName(name: string): void {
  if (!NAME.test(name)) throw new Error(`Invalid layout name: ${name}`);
}
function assertBehavior(b: string): asserts b is FieldBehavior {
  if (!BEHAVIORS.includes(b as FieldBehavior)) throw new Error(`Invalid field behavior: ${b}`);
}

// --- Sections ----------------------------------------------------------------------

const sections = (root: XmlNode) => childrenNamed(root, "layoutSections");
const sectionLabel = (sec: XmlNode) => childText(sec, "label") ?? "";
const sectionName = (label: string) => (label ? `"${label}"` : "Untitled section");

function refOf(root: XmlNode, sec: XmlNode): SectionRef {
  const label = sectionLabel(sec);
  return { label, nth: sections(root).filter((s) => sectionLabel(s) === label).indexOf(sec) };
}

function findSection(root: XmlNode, ref: SectionRef): XmlNode {
  const sec = sections(root).filter((s) => sectionLabel(s) === ref.label)[ref.nth];
  if (!sec) throw new StaleLayoutError(`The section ${sectionName(ref.label)} isn't on the layout.`);
  return sec;
}

const position = (root: XmlNode, sec: XmlNode) => `${sections(root).indexOf(sec) + 1} of ${sections(root).length}`;

function nextSection(root: XmlNode, sec: XmlNode): XmlNode | undefined {
  const all = sections(root);
  return all[all.indexOf(sec) + 1];
}

/** Insert a section before `before`, or after the last section. */
function placeSection(root: XmlNode, sec: XmlNode, before: SectionRef | null): void {
  if (!before) return insertInOrder(root, sec, LAYOUT_ORDER);
  const target = findSection(root, before);
  root.children.splice(root.children.indexOf(target), 0, sec);
}

function detach(parent: XmlNode, node: XmlNode): void {
  parent.children.splice(parent.children.indexOf(node), 1);
}

// --- Fields ------------------------------------------------------------------------

const columnsOf = (sec: XmlNode) => childrenNamed(sec, "layoutColumns");
const fieldOf = (item: XmlNode) => childText(item, "field");

interface FieldLocation {
  section: XmlNode;
  column: XmlNode;
  columnIndex: number;
  index: number;
  item: XmlNode;
}

function locateField(root: XmlNode, field: string): FieldLocation | undefined {
  for (const section of sections(root)) {
    const columns = columnsOf(section);
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      const column = columns[columnIndex];
      const index = column.children.findIndex((c) => c.tag === "layoutItems" && fieldOf(c) === field);
      if (index >= 0) return { section, column, columnIndex, index, item: column.children[index] };
    }
  }
  return undefined;
}

function findField(root: XmlNode, field: string): FieldLocation {
  const at = locateField(root, field);
  if (!at) throw new StaleLayoutError(`${field} isn't on the layout.`);
  return at;
}

/** Where a field sits, as a slot that puts it back there. */
function slotOf(root: XmlNode, at: FieldLocation): FieldSlot {
  const next = at.column.children.slice(at.index + 1).map(fieldOf).find((f) => f);
  return { section: refOf(root, at.section), column: at.columnIndex, before: next ?? null, at: at.index };
}

function placeField(root: XmlNode, item: XmlNode, slot: FieldSlot): FieldLocation {
  const section = findSection(root, slot.section);
  const column = columnsOf(section)[slot.column];
  if (!column) throw new StaleLayoutError(`${sectionName(slot.section.label)} has no column ${slot.column + 1}.`);
  let index = column.children.length;
  if (slot.at !== undefined) index = Math.min(slot.at, index);
  else if (slot.before) {
    index = column.children.findIndex((c) => fieldOf(c) === slot.before);
    if (index < 0) throw new StaleLayoutError(`${slot.before} isn't in that column of ${sectionName(slot.section.label)} any more.`);
  }
  column.children.splice(index, 0, item);
  return { section, column, columnIndex: slot.column, index, item };
}

const where = (root: XmlNode, at: FieldLocation) =>
  `${sectionLabel(at.section) || "Untitled section"}, column ${at.columnIndex + 1}, row ${
    at.column.children.indexOf(at.item) + 1
  }`;

function behaviorOf(item: XmlNode): FieldBehavior {
  const b = childText(item, "behavior") ?? "Edit";
  return BEHAVIORS.includes(b as FieldBehavior) ? (b as FieldBehavior) : "Edit";
}

// --- Related lists -----------------------------------------------------------------

const relatedLists = (root: XmlNode) => childrenNamed(root, "relatedLists");
const relatedName = (rl: XmlNode) => childText(rl, "relatedList") ?? "";

function findRelated(root: XmlNode, name: string): XmlNode {
  const rl = relatedLists(root).find((r) => relatedName(r) === name);
  if (!rl) throw new StaleLayoutError(`The related list ${name} isn't on the layout.`);
  return rl;
}

function nextRelated(root: XmlNode, rl: XmlNode): string | null {
  const all = relatedLists(root);
  const next = all[all.indexOf(rl) + 1];
  return next ? relatedName(next) : null;
}

function placeRelated(root: XmlNode, rl: XmlNode, before: string | null): void {
  if (!before) return insertInOrder(root, rl, LAYOUT_ORDER);
  const target = findRelated(root, before);
  root.children.splice(root.children.indexOf(target), 0, rl);
}

const relatedPosition = (root: XmlNode, rl: XmlNode) => `${relatedLists(root).indexOf(rl) + 1} of ${relatedLists(root).length}`;

/** The block a new related list gets: its name column (`nameField`; the legacy NAME token only suits some objects), without the New button (not every child object takes MassDeleteAll, and the org refuses a layout that excludes an action the list lacks). */
export function newRelatedList(name: string, nameField = "NAME"): XmlNode {
  return {
    tag: "relatedLists",
    children: [leaf("excludeButtons", "New"), leaf("fields", nameField), leaf("relatedList", name)],
  };
}

function parseFragment(xml: string, tag: string): XmlNode {
  const node = parseXml(xml);
  if (node.tag !== tag) throw new Error(`Expected a ${tag} element.`);
  return node;
}

const hasRelatedObject = (root: XmlNode, field: string) => childrenNamed(root, "relatedObjects").some((n) => n.text === field);

// --- Ops ---------------------------------------------------------------------------

/** Apply one op to `root` in place; returns its inverse and what changed, in words. */
export function applyLayoutOp(root: XmlNode, op: LayoutOp): { inverse: LayoutOp; change: LayoutChange } {
  switch (op.op) {
    case "moveField": {
      assertName(op.field);
      const from = findField(root, op.field);
      const was = where(root, from);
      const inverse: LayoutOp = { op: "moveField", field: op.field, to: slotOf(root, from) };
      detach(from.column, from.item);
      const to = placeField(root, from.item, op.to);
      return { inverse, change: { field: `Field ${op.field}`, before: was, after: where(root, to) } };
    }
    case "removeField": {
      assertName(op.field);
      const from = findField(root, op.field);
      const was = where(root, from);
      const inverse: LayoutOp = {
        op: "addField",
        field: op.field,
        behavior: behaviorOf(from.item),
        to: slotOf(root, from),
        xml: serializeNode(from.item),
        // The org drops a lookup's <relatedObjects> entry when its field leaves the layout (so the preview shows it going too); undo puts it back.
        ...(hasRelatedObject(root, op.field) ? { relatedObject: true } : {}),
      };
      detach(from.column, from.item);
      for (const ro of childrenNamed(root, "relatedObjects").filter((n) => n.text === op.field)) detach(root, ro);
      return { inverse, change: { field: `Field ${op.field}`, before: was, after: "(removed)" } };
    }
    case "addField": {
      assertName(op.field);
      assertBehavior(op.behavior);
      if (locateField(root, op.field)) throw new StaleLayoutError(`${op.field} is already on the layout.`);
      const item = op.xml
        ? parseFragment(op.xml, "layoutItems")
        : { tag: "layoutItems", children: [leaf("behavior", op.behavior), leaf("field", op.field)] };
      if (fieldOf(item) !== op.field) throw new Error("The field doesn't match its layout item.");
      const to = placeField(root, item, op.to);
      if (op.relatedObject && !hasRelatedObject(root, op.field)) insertInOrder(root, leaf("relatedObjects", op.field), LAYOUT_ORDER);
      return {
        inverse: { op: "removeField", field: op.field },
        change: { field: `Field ${op.field}`, before: "(not on the layout)", after: `${where(root, to)} · ${BEHAVIOR_WORDS[op.behavior]}` },
      };
    }
    case "setFieldBehavior": {
      assertName(op.field);
      assertBehavior(op.to);
      const at = findField(root, op.field);
      const now = behaviorOf(at.item);
      if (now !== op.from) throw new StaleLayoutError(`${op.field} is now ${BEHAVIOR_WORDS[now].toLowerCase()} on the layout.`);
      setChildText(at.item, "behavior", op.to, ITEM_ORDER);
      return {
        inverse: { op: "setFieldBehavior", field: op.field, from: op.to, to: op.from },
        change: { field: `Field ${op.field}`, before: BEHAVIOR_WORDS[op.from], after: BEHAVIOR_WORDS[op.to] },
      };
    }
    case "moveSection": {
      const sec = findSection(root, op.section);
      const was = position(root, sec);
      const next = nextSection(root, sec);
      detach(root, sec);
      placeSection(root, sec, op.before);
      return {
        inverse: { op: "moveSection", section: refOf(root, sec), before: next ? refOf(root, next) : null },
        change: { field: `Section ${sectionName(op.section.label)}`, before: `Position ${was}`, after: `Position ${position(root, sec)}` },
      };
    }
    case "removeSection": {
      const sec = findSection(root, op.section);
      const was = position(root, sec);
      const next = nextSection(root, sec);
      const fields = columnsOf(sec).reduce((n, c) => n + c.children.filter(fieldOf).length, 0);
      detach(root, sec);
      return {
        inverse: { op: "addSection", xml: serializeNode(sec), before: next ? refOf(root, next) : null },
        change: {
          field: `Section ${sectionName(op.section.label)}`,
          before: `Position ${was}${fields ? `, ${fields} field${fields === 1 ? "" : "s"}` : ""}`,
          after: "(removed)",
        },
      };
    }
    case "addSection": {
      const sec = parseFragment(op.xml, "layoutSections");
      placeSection(root, sec, op.before);
      return {
        inverse: { op: "removeSection", section: refOf(root, sec) },
        change: { field: `Section ${sectionName(sectionLabel(sec))}`, before: "(not on the layout)", after: `Position ${position(root, sec)}` },
      };
    }
    case "setSectionHeading": {
      const sec = findSection(root, op.section);
      const now = childText(sec, "detailHeading") === "true";
      if (now !== op.from) throw new StaleLayoutError(`${sectionName(op.section.label)} ${now ? "now shows" : "no longer shows"} its heading.`);
      setChildText(sec, "detailHeading", String(op.to), SECTION_ORDER);
      const words = (b: boolean) => (b ? "Heading shown" : "Heading hidden");
      return {
        inverse: { op: "setSectionHeading", section: op.section, from: op.to, to: op.from },
        change: { field: `Section ${sectionName(op.section.label)}`, before: words(op.from), after: words(op.to) },
      };
    }
    case "moveRelatedList": {
      assertName(op.relatedList);
      const rl = findRelated(root, op.relatedList);
      const was = relatedPosition(root, rl);
      const next = nextRelated(root, rl);
      detach(root, rl);
      placeRelated(root, rl, op.before);
      return {
        inverse: { op: "moveRelatedList", relatedList: op.relatedList, before: next },
        change: { field: `Related list ${op.relatedList}`, before: `Position ${was}`, after: `Position ${relatedPosition(root, rl)}` },
      };
    }
    case "removeRelatedList": {
      assertName(op.relatedList);
      const rl = findRelated(root, op.relatedList);
      const was = relatedPosition(root, rl);
      const next = nextRelated(root, rl);
      detach(root, rl);
      return {
        inverse: { op: "addRelatedList", relatedList: op.relatedList, before: next, xml: serializeNode(rl) },
        change: { field: `Related list ${op.relatedList}`, before: `Position ${was}`, after: "(removed)" },
      };
    }
    case "addRelatedList": {
      assertName(op.relatedList);
      if (relatedLists(root).some((r) => relatedName(r) === op.relatedList)) {
        throw new StaleLayoutError(`The related list ${op.relatedList} is already on the layout.`);
      }
      const rl = op.xml ? parseFragment(op.xml, "relatedLists") : newRelatedList(op.relatedList, op.nameField);
      if (relatedName(rl) !== op.relatedList) throw new Error("The related list doesn't match its XML.");
      placeRelated(root, rl, op.before);
      return {
        inverse: { op: "removeRelatedList", relatedList: op.relatedList },
        change: { field: `Related list ${op.relatedList}`, before: "(not on the layout)", after: `Position ${relatedPosition(root, rl)}` },
      };
    }
  }
}

/** Apply ops in order to a copy of `root`. The inverse ops undo them all, in the order given. */
export function applyLayoutOps(root: XmlNode, ops: LayoutOp[]): { root: XmlNode; inverse: LayoutOp[]; changes: LayoutChange[] } {
  const copy = cloneNode(root);
  const inverse: LayoutOp[] = [];
  const changes: LayoutChange[] = [];
  for (const op of ops) {
    const r = applyLayoutOp(copy, op);
    inverse.unshift(r.inverse);
    changes.push(r.change);
  }
  return { root: copy, inverse, changes };
}

export const relatedListCount = (root: XmlNode) => relatedLists(root).length;
