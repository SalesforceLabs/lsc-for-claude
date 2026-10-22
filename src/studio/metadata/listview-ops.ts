/**
 * Edits to a list view's XML — the columns of the list on the iPad, the filters
 * that pick its records, and its filter scope.
 *
 * A list view is `<columns>` in order, a `<filterScope>`, `<filters>` rows, an
 * optional `<booleanFilter>` ("1 AND (2 OR 3)") and its `<label>`. Columns are
 * found by the id the view stores. There is no sort element in the Metadata API,
 * so sort can't be edited here. Each op is checked against the document as it
 * is now — a column that isn't there, or filters that aren't what the op saw,
 * throw `StaleListViewError` — and returns the op that reverses it.
 */

import type { ListViewFilter, ListViewOp } from "../types.js";
import {
  childrenNamed,
  cloneNode,
  escapeXml,
  insertInOrder,
  leaf,
  setChildText,
  unescapeXml,
  type XmlNode,
} from "./xml.js";

/** ListView's top-level elements in Metadata API order. */
const LISTVIEW_ORDER = [
  "fullName",
  "booleanFilter",
  "columns",
  "division",
  "filterScope",
  "filters",
  "label",
  "language",
  "queue",
  "sharedTo",
];

/** Rough ceilings that keep the list readable on a tablet; the API itself allows more columns. */
export const MAX_LIST_COLUMNS = 15;
export const MAX_LIST_FILTERS = 10;

export const FILTER_OPERATIONS = [
  "equals",
  "notEqual",
  "lessThan",
  "greaterThan",
  "lessOrEqual",
  "greaterOrEqual",
  "contains",
  "notContain",
  "startsWith",
  "includes",
  "excludes",
  "within",
] as const;

/** A standard-object column named the old way (ACCOUNT.NAME). */
const LEGACY_ID = /^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+$/;
export const FILTER_SCOPES = [
  "Everything",
  "Mine",
  "Queue",
  "Delegated",
  "MyTerritory",
  "MyTeamTerritory",
  "Team",
] as const;

export class StaleListViewError extends Error {}

export interface ListViewChange {
  field: string;
  before: string;
  after: string;
}

const NAME = /^[\w.]+$/;

function assertName(name: string): void {
  if (!NAME.test(name)) throw new Error(`Invalid list view column: ${name}`);
}

const columnNodes = (root: XmlNode) => childrenNamed(root, "columns");
const unwrap = (node: XmlNode) => unescapeXml(node.text ?? "");

/** The list view's column ids, in order. */
export const listColumns = (root: XmlNode): string[] => columnNodes(root).map(unwrap);

const textOf = (node: XmlNode, tag: string) => {
  const c = node.children.find((x) => x.tag === tag);
  return c ? unescapeXml(c.text ?? "") : undefined;
};

/** The list view's filter rows, in order. */
export const listFilters = (root: XmlNode): ListViewFilter[] =>
  childrenNamed(root, "filters").map((f) => ({
    field: textOf(f, "field") ?? "",
    operation: textOf(f, "operation") ?? "",
    value: textOf(f, "value") ?? "",
  }));

export const listFilterScope = (root: XmlNode): string | null => {
  const n = childrenNamed(root, "filterScope")[0];
  return n ? unwrap(n) : null;
};

export const listBooleanFilter = (root: XmlNode): string | null => {
  const n = childrenNamed(root, "booleanFilter")[0];
  return n ? unwrap(n) : null;
};

function findColumn(root: XmlNode, column: string): XmlNode {
  const node = columnNodes(root).find((c) => unwrap(c) === column);
  if (!node) throw new StaleListViewError(`${column} isn't a column of the list view.`);
  return node;
}

function nextColumn(root: XmlNode, node: XmlNode): string | null {
  const all = columnNodes(root);
  const next = all[all.indexOf(node) + 1];
  return next ? unwrap(next) : null;
}

/** Insert a column before `before`, or after the last column. */
function placeColumn(root: XmlNode, node: XmlNode, before: string | null): void {
  if (!before) {
    const all = columnNodes(root);
    const last = all[all.length - 1];
    if (last) root.children.splice(root.children.indexOf(last) + 1, 0, node);
    else insertInOrder(root, node, LISTVIEW_ORDER);
    return;
  }
  const target = findColumn(root, before);
  root.children.splice(root.children.indexOf(target), 0, node);
}

const detach = (root: XmlNode, node: XmlNode) =>
  root.children.splice(root.children.indexOf(node), 1);
const position = (root: XmlNode, node: XmlNode) =>
  `Position ${columnNodes(root).indexOf(node) + 1} of ${columnNodes(root).length}`;

const same = (a: ListViewFilter, b: ListViewFilter) =>
  a.field === b.field && a.operation === b.operation && a.value === b.value;
const sameFilters = (a: ListViewFilter[], b: ListViewFilter[]) =>
  a.length === b.length && a.every((f, i) => same(f, b[i]));

const describeFilter = (f: ListViewFilter) =>
  `${f.field} ${f.operation}${f.value ? ` ${f.value}` : ""}`;
const describeFilters = (filters: ListViewFilter[], logic: string | null) =>
  filters.length
    ? `${filters.map((f, i) => `${i + 1}. ${describeFilter(f)}`).join("; ")}${logic ? ` — ${logic}` : ""}`
    : "(no filters)";

/** "1 AND (2 OR 3)": each of 1..n used, only AND / OR / NOT and parentheses between, parentheses balanced. */
export function validBooleanFilter(logic: string, count: number): boolean {
  const tokens = logic.match(/\d+|AND|OR|NOT|\(|\)|\S/g) ?? [];
  const used = new Set<number>();
  let depth = 0;
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (n < 1 || n > count) return false;
      used.add(n);
    } else if (t === "(") depth++;
    else if (t === ")") {
      if (--depth < 0) return false;
    } else if (t !== "AND" && t !== "OR" && t !== "NOT") return false;
  }
  return depth === 0 && used.size === count;
}

function assertFilters(filters: ListViewFilter[], logic: string | null): void {
  if (filters.length > MAX_LIST_FILTERS)
    throw new StaleListViewError(`A list view holds at most ${MAX_LIST_FILTERS} filters.`);
  for (const f of filters) {
    assertName(f.field);
    if (!(FILTER_OPERATIONS as readonly string[]).includes(f.operation))
      throw new Error(`Invalid filter operation: ${f.operation}`);
    if (f.value.length > 1000 || /[\r\n]/.test(f.value))
      throw new Error(`Invalid filter value for ${f.field}.`);
  }
  if (logic !== null && (filters.length < 2 || !validBooleanFilter(logic, filters.length))) {
    throw new Error(
      `The filter logic "${logic}" must use each of 1 to ${filters.length} once, with AND, OR, NOT and parentheses.`
    );
  }
}

function filterNode(f: ListViewFilter): XmlNode {
  return {
    tag: "filters",
    children: [
      leaf("field", f.field),
      leaf("operation", f.operation),
      ...(f.value ? [leaf("value", f.value)] : []),
    ],
  };
}

/** Apply one op to `root` in place; returns its inverse and what changed, in words. */
export function applyListViewOp(
  root: XmlNode,
  op: ListViewOp
): { inverse: ListViewOp; change: ListViewChange } {
  switch (op.op) {
    case "moveListColumn": {
      assertName(op.column);
      const node = findColumn(root, op.column);
      const was = position(root, node);
      const next = nextColumn(root, node);
      detach(root, node);
      placeColumn(root, node, op.before);
      return {
        inverse: { op: "moveListColumn", column: op.column, before: next },
        change: { field: `Column ${op.column}`, before: was, after: position(root, node) },
      };
    }
    case "removeListColumn": {
      assertName(op.column);
      const node = findColumn(root, op.column);
      if (columnNodes(root).length <= 1)
        throw new StaleListViewError("A list view needs at least one column.");
      const was = position(root, node);
      const next = nextColumn(root, node);
      detach(root, node);
      return {
        inverse: { op: "addListColumn", column: op.column, before: next },
        change: { field: `Column ${op.column}`, before: was, after: "(removed)" },
      };
    }
    case "addListColumn": {
      assertName(op.column);
      if (
        columnNodes(root).some((c) => LEGACY_ID.test(unwrap(c))) &&
        !LEGACY_ID.test(op.column) &&
        !op.column.endsWith("__c")
      ) {
        throw new Error(
          `${op.column} can't be added here: this view names its standard columns the old way (ACCOUNT.NAME), so only custom fields can be added to it.`
        );
      }
      if (columnNodes(root).some((c) => unwrap(c) === op.column))
        throw new StaleListViewError(`${op.column} is already a column of the list view.`);
      if (columnNodes(root).length >= MAX_LIST_COLUMNS)
        throw new StaleListViewError(
          `A list view holds at most ${MAX_LIST_COLUMNS} columns here. Remove one first.`
        );
      const node = leaf("columns", op.column);
      placeColumn(root, node, op.before);
      return {
        inverse: { op: "removeListColumn", column: op.column },
        change: {
          field: `Column ${op.column}`,
          before: "(not a column)",
          after: position(root, node),
        },
      };
    }
    case "setListFilterScope": {
      if (!(FILTER_SCOPES as readonly string[]).includes(op.to))
        throw new Error(`Invalid filter scope: ${op.to}`);
      const now = listFilterScope(root);
      if (now !== op.from)
        throw new StaleListViewError(
          `The filter scope is ${now ?? "not set"}, not ${op.from ?? "not set"}.`
        );
      setChildText(root, "filterScope", op.to, LISTVIEW_ORDER);
      return {
        inverse:
          op.from === null
            ? { op: "setListFilterScope", from: op.to, to: "Everything" }
            : { op: "setListFilterScope", from: op.to, to: op.from },
        change: { field: "Filter scope", before: now ?? "(not set)", after: op.to },
      };
    }
    case "setListFilters": {
      assertFilters(op.to, op.toLogic);
      const now = listFilters(root);
      const nowLogic = listBooleanFilter(root);
      if (!sameFilters(now, op.from) || nowLogic !== op.fromLogic) {
        throw new StaleListViewError(
          `The filters are ${describeFilters(now, nowLogic)}, not what the preview showed.`
        );
      }
      const existing = childrenNamed(root, "filters");
      const free = existing.map((n, i) => ({ n, f: now[i] }));
      const nodes = op.to.map((f) => {
        const at = free.findIndex((e) => same(e.f, f));
        if (at >= 0) return free.splice(at, 1)[0].n;
        return filterNode(f);
      });
      const first = existing.length ? root.children.indexOf(existing[0]) : -1;
      root.children = root.children.filter((c) => c.tag !== "filters");
      if (first >= 0) root.children.splice(first, 0, ...nodes);
      else nodes.forEach((n) => insertInOrder(root, n, LISTVIEW_ORDER));
      const logic = childrenNamed(root, "booleanFilter")[0];
      if (op.toLogic === null) {
        if (logic) root.children.splice(root.children.indexOf(logic), 1);
      } else if (logic) {
        logic.text = escapeXml(op.toLogic);
      } else {
        insertInOrder(root, leaf("booleanFilter", op.toLogic), LISTVIEW_ORDER);
      }
      return {
        inverse: {
          op: "setListFilters",
          from: op.to,
          to: op.from,
          fromLogic: op.toLogic,
          toLogic: op.fromLogic,
        },
        change: {
          field: "Filters",
          before: describeFilters(now, nowLogic),
          after: describeFilters(op.to, op.toLogic),
        },
      };
    }
    default:
      throw new Error(`Not a list view edit: ${(op as { op?: string }).op ?? "?"}`);
  }
}

/** Apply ops in order to a copy of `root`. The inverse ops undo them all, in the order given. */
export function applyListViewOps(
  root: XmlNode,
  ops: ListViewOp[]
): { root: XmlNode; inverse: ListViewOp[]; changes: ListViewChange[] } {
  const copy = cloneNode(root);
  const inverse: ListViewOp[] = [];
  const changes: ListViewChange[] = [];
  for (const op of ops) {
    const r = applyListViewOp(copy, op);
    inverse.unshift(r.inverse);
    changes.push(r.change);
  }
  return { root: copy, inverse, changes };
}
