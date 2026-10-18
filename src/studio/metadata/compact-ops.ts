/**
 * Edits to a compact layout's XML — the fields of the record header on the
 * iPad: move a field, add one, take one off.
 *
 * A compact layout is a list of `<fields>` in order followed by its `<label>`.
 * Fields are found by API name. Each op is checked against the document as it
 * is now — a field that isn't there, or one that's already there, throws
 * `StaleCompactError` — and returns the op that reverses it. Ops apply in order,
 * each to the result of the one before.
 */

import type { CompactOp } from "../types.js";
import { childrenNamed, cloneNode, insertInOrder, leaf, unescapeXml, type XmlNode } from "./xml.js";

/** CompactLayout's top-level elements in Metadata API order. */
const COMPACT_ORDER = ["fields", "label"];

/** The Metadata API refuses a compact layout with more fields than this. */
export const MAX_COMPACT_FIELDS = 10;

export class StaleCompactError extends Error {}

export interface CompactChange {
  field: string;
  before: string;
  after: string;
}

const NAME = /^[\w.]+$/;

function assertName(name: string): void {
  if (!NAME.test(name)) throw new Error(`Invalid compact layout field: ${name}`);
}

const fieldNodes = (root: XmlNode) => childrenNamed(root, "fields");
/** A `<fields>` element is a leaf holding the field's API name. */
const unwrap = (node: XmlNode) => unescapeXml(node.text ?? "");

/** The compact layout's fields, in order. */
export const compactFields = (root: XmlNode): string[] => fieldNodes(root).map(unwrap);

function findField(root: XmlNode, field: string): XmlNode {
  const node = fieldNodes(root).find((f) => unwrap(f) === field);
  if (!node) throw new StaleCompactError(`${field} isn't on the compact layout.`);
  return node;
}

function nextField(root: XmlNode, node: XmlNode): string | null {
  const all = fieldNodes(root);
  const next = all[all.indexOf(node) + 1];
  return next ? unwrap(next) : null;
}

/** Insert a field before `before`, or after the last field. */
function placeField(root: XmlNode, node: XmlNode, before: string | null): void {
  if (!before) {
    const all = fieldNodes(root);
    const last = all[all.length - 1];
    if (last) root.children.splice(root.children.indexOf(last) + 1, 0, node);
    else insertInOrder(root, node, COMPACT_ORDER);
    return;
  }
  const target = findField(root, before);
  root.children.splice(root.children.indexOf(target), 0, node);
}

function detach(root: XmlNode, node: XmlNode): void {
  root.children.splice(root.children.indexOf(node), 1);
}

const position = (root: XmlNode, node: XmlNode) => `Position ${fieldNodes(root).indexOf(node) + 1} of ${fieldNodes(root).length}`;

/** Apply one op to `root` in place; returns its inverse and what changed, in words. */
export function applyCompactOp(root: XmlNode, op: CompactOp): { inverse: CompactOp; change: CompactChange } {
  switch (op.op) {
    case "moveCompactField": {
      assertName(op.field);
      const node = findField(root, op.field);
      const was = position(root, node);
      const next = nextField(root, node);
      detach(root, node);
      placeField(root, node, op.before);
      return {
        inverse: { op: "moveCompactField", field: op.field, before: next },
        change: { field: `Field ${op.field}`, before: was, after: position(root, node) },
      };
    }
    case "removeCompactField": {
      assertName(op.field);
      const node = findField(root, op.field);
      const was = position(root, node);
      const next = nextField(root, node);
      detach(root, node);
      return {
        inverse: { op: "addCompactField", field: op.field, before: next },
        change: { field: `Field ${op.field}`, before: was, after: "(removed)" },
      };
    }
    case "addCompactField": {
      assertName(op.field);
      if (fieldNodes(root).some((f) => unwrap(f) === op.field)) throw new StaleCompactError(`${op.field} is already on the compact layout.`);
      if (fieldNodes(root).length >= MAX_COMPACT_FIELDS) {
        throw new StaleCompactError(`A compact layout holds at most ${MAX_COMPACT_FIELDS} fields. Remove one first.`);
      }
      const node = leaf("fields", op.field);
      placeField(root, node, op.before);
      return {
        inverse: { op: "removeCompactField", field: op.field },
        change: { field: `Field ${op.field}`, before: "(not on the compact layout)", after: position(root, node) },
      };
    }
    default:
      throw new Error(`Not a compact layout edit: ${(op as { op?: string }).op ?? "?"}`);
  }
}

/** Apply ops in order to a copy of `root`. The inverse ops undo them all, in the order given. */
export function applyCompactOps(root: XmlNode, ops: CompactOp[]): { root: XmlNode; inverse: CompactOp[]; changes: CompactChange[] } {
  const copy = cloneNode(root);
  const inverse: CompactOp[] = [];
  const changes: CompactChange[] = [];
  for (const op of ops) {
    const r = applyCompactOp(copy, op);
    inverse.unshift(r.inverse);
    changes.push(r.change);
  }
  return { root: copy, inverse, changes };
}
