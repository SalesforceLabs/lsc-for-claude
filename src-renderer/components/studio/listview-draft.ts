import type { PublishedListView } from "./published-types";
import type { ListViewEditFix, ListViewFilter, ListViewOp, LiveListView } from "./types";
import { listViewOpsChange, pendingFor, queueChange, type PendingChange } from "./changes";
import type { DraftState, Verb } from "./edit-draft";
import { StaleDraftError, withGhosts } from "./layout-draft";

/**
 * List views in Draft. Like compact layouts, the tray holds one `editMetadata`
 * change per list view whose ops are the whole difference between the view in
 * the org (`LiveListView`) and what the admin has arranged: columns in order,
 * the filter scope, and the filter rows with their logic. Moving a column back
 * where it was leaves no op behind. Pure: nothing here touches the org.
 *
 * The Metadata API has no sort element, so sort isn't editable; the iPad takes
 * a view's sort from the org's REST describe anyway.
 */

/** Matches the server's ceilings (listview-ops.ts). */
export const MAX_LIST_COLUMNS = 15;
export const MAX_LIST_FILTERS = 10;

/** The part of a list view the ops change. */
export interface ListViewModel {
  columns: string[];
  scope: string | null;
  filters: ListViewFilter[];
  logic: string | null;
}

export const modelOf = (live: LiveListView): ListViewModel => ({
  columns: [...live.columns],
  scope: live.filterScope,
  filters: live.filters.map((f) => ({ ...f })),
  logic: live.booleanFilter,
});

const sameFilter = (a: ListViewFilter, b: ListViewFilter) => a.field === b.field && a.operation === b.operation && a.value === b.value;
export const sameFilters = (a: ListViewFilter[], b: ListViewFilter[]) => a.length === b.length && a.every((f, i) => sameFilter(f, b[i]));

/** "Position 2 of 5" style checks live on the server; here an op that no longer fits throws `StaleDraftError`. */
function applyOp(m: ListViewModel, op: ListViewOp): void {
  switch (op.op) {
    case "moveListColumn":
    case "removeListColumn":
    case "addListColumn": {
      const at = m.columns.indexOf(op.column);
      if (op.op === "addListColumn") {
        if (at >= 0) throw new StaleDraftError(`${op.column} is already a column of the list view.`);
        if (m.columns.length >= MAX_LIST_COLUMNS) throw new StaleDraftError(`A list view holds at most ${MAX_LIST_COLUMNS} columns here.`);
      } else {
        if (at < 0) throw new StaleDraftError(`${op.column} isn't a column of the list view.`);
        if (op.op === "removeListColumn" && m.columns.length <= 1) throw new StaleDraftError("A list view needs at least one column.");
        m.columns.splice(at, 1);
      }
      if (op.op === "removeListColumn") return;
      const before = op.before ? m.columns.indexOf(op.before) : m.columns.length;
      if (before < 0) throw new StaleDraftError(`${op.before} isn't a column of the list view.`);
      m.columns.splice(before, 0, op.column);
      return;
    }
    case "setListFilterScope":
      if (m.scope !== op.from) throw new StaleDraftError(`The filter scope is ${m.scope ?? "not set"}, not ${op.from ?? "not set"}.`);
      m.scope = op.to;
      return;
    case "setListFilters":
      if (!sameFilters(m.filters, op.from) || m.logic !== op.fromLogic) throw new StaleDraftError("The filters are not what the preview showed.");
      m.filters = op.to.map((f) => ({ ...f }));
      m.logic = op.toLogic;
  }
}

/** The view once `ops` are applied; throws `StaleDraftError` when they no longer fit. */
export function applyListViewOps(base: ListViewModel, ops: ListViewOp[]): ListViewModel {
  const m: ListViewModel = { columns: [...base.columns], scope: base.scope, filters: base.filters.map((f) => ({ ...f })), logic: base.logic };
  for (const op of ops) applyOp(m, op);
  return m;
}

/** Ops that turn `base` into `target`: column removals, then each column last first goes right before the one after it, then scope and filters. */
export function diffListViewOps(base: ListViewModel, target: ListViewModel): ListViewOp[] {
  const cur: ListViewModel = { ...base, columns: [...base.columns] };
  const ops: ListViewOp[] = [];
  const push = (op: ListViewOp) => {
    applyOp(cur, op);
    ops.push(op);
  };
  for (const c of base.columns) if (!target.columns.includes(c)) push({ op: "removeListColumn", column: c });
  for (let j = target.columns.length - 1; j >= 0; j--) {
    const column = target.columns[j];
    const before = target.columns[j + 1] ?? null;
    const at = cur.columns.indexOf(column);
    if (at >= 0 && (cur.columns[at + 1] ?? null) === before) continue;
    push(at >= 0 ? { op: "moveListColumn", column, before } : { op: "addListColumn", column, before });
  }
  if (target.scope !== base.scope && target.scope) push({ op: "setListFilterScope", from: base.scope, to: target.scope });
  if (!sameFilters(base.filters, target.filters) || base.logic !== target.logic) {
    push({ op: "setListFilters", from: base.filters, to: target.filters, fromLogic: base.logic, toLogic: target.logic });
  }
  return ops;
}

// --- Lining the published view up with the org's -----------------------------------

/**
 * Whether the published list view's columns are the org's now: both are lists of
 * the same ids in the same order. Snapshots from before views carried their
 * source can't be lined up.
 */
export function alignListView(published: PublishedListView | undefined, live: string[]): boolean {
  const source = published?.source;
  return !!source && source.columns.length === live.length && source.columns.every((c, i) => sameColumn(c, live[i]));
}

/** The cache names a lookup column by its Id field (`AccountId`) where the view stores the relationship (`Account`). */
const sameColumn = (published: string, live: string) => published === live || published === `${live}Id`;
const columnIndex = (published: string[], live: string) => published.findIndex((c) => sameColumn(c, live));

/** Set when the view's filters or scope were changed in Setup since the publish: the rows drawn come from the earlier ones. */
export function filtersChanged(published: PublishedListView | undefined, live: LiveListView): boolean {
  const source = published?.source;
  if (!source) return false;
  return (
    (source.filterScope ?? null) !== (live.filterScope ?? null) ||
    (source.booleanFilter ?? null) !== (live.booleanFilter ?? null) ||
    !sameFilters(source.filters, live.filters)
  );
}

// --- What the iPad draws -----------------------------------------------------------

export interface DraftListColumn {
  /** The id the view stores. */
  id: string;
  label: string;
  state: DraftState;
  /** The column's place in the published rows' cells; null for one added in Draft (nothing to show yet). */
  orig: number | null;
}

/** Old-style ids (`ACCOUNT.NAME`, `FULL_NAME`) the Metadata API keeps for standard objects' views. */
export const isLegacyId = (id: string) => /^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)*$/.test(id);

/** A fresh column's header: the field's label, else the id made readable. */
function labelFor(id: string, live: LiveListView): string {
  const known = live.available.find((a) => a.name === id);
  if (known) return known.label;
  const last = id.split(".").pop() ?? id;
  return last.replace(/__c$|__pc$/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (m) => m.toUpperCase());
}

/**
 * The columns as the tray leaves them: the target order with removed columns as
 * ghosts where they were; added ones are labelled from the object's describe.
 */
export function draftListColumns(published: PublishedListView, live: LiveListView, base: string[], target: string[]): DraftListColumn[] {
  const ids = published.source?.columns ?? base;
  const common = base.filter((c) => target.includes(c));
  const commonTarget = target.filter((c) => base.includes(c));
  return withGhosts(base, target).map(({ key, ghost }) => {
    const orig = columnIndex(ids, key);
    const added = !base.includes(key);
    const state: DraftState = ghost ? "removed" : added ? "added" : common.indexOf(key) !== commonTarget.indexOf(key) ? "moved" : "same";
    return { id: key, label: orig >= 0 && published.columns[orig] ? published.columns[orig] : labelFor(key, live), state, orig: orig >= 0 ? orig : null };
  });
}

// --- Verbs -------------------------------------------------------------------------

/** One list view in Draft: the org's view, the arranged one, and how to queue a new arrangement. */
export interface ListViewDraft {
  /** "Object.DeveloperName". */
  fullName: string;
  label: string;
  live: LiveListView;
  base: ListViewModel;
  target: ListViewModel;
  /** Columns drawn, in Draft order: moves step past these only. */
  shown: string[];
  /** The view's columns and filters use old-style ids, so only custom fields can be added (their API names). */
  legacy: boolean;
}

export function listViewFix(fullName: string, label: string, ops: ListViewOp[]): ListViewEditFix {
  return listViewOpsChange(fullName, label, ops) as ListViewEditFix;
}

/** The view once the tray is applied; throws `StaleDraftError` when the queued ops don't fit the org's view. */
export function listViewTargetOf(fullName: string, base: ListViewModel, pending: PendingChange[]): ListViewModel {
  const queued = pendingFor(pending, listViewFix(fullName, "", []))?.fix;
  return queued?.kind === "editMetadata" && queued.doc.type === "ListView" ? applyListViewOps(base, queued.ops as ListViewOp[]) : applyListViewOps(base, []);
}

/** The tray with this list view arranged as `next` (its change dropped when that's the org's view). */
export function arrangeListView(d: ListViewDraft, next: ListViewModel, pending: PendingChange[]): PendingChange[] {
  const without = pending.filter((p) => !(p.fix.kind === "editMetadata" && p.fix.doc.type === "ListView" && p.fix.doc.fullName === d.fullName));
  return queueChange(without, { fix: listViewFix(d.fullName, d.label, diffListViewOps(d.base, next)) });
}

const withColumns = (d: ListViewDraft, columns: string[]): ListViewModel => ({ ...d.target, columns });

function verb(d: ListViewDraft, id: Verb["id"], label: string, title: string, edit: (cols: string[]) => string[] | null, reason?: string): Verb {
  const next = edit([...d.target.columns]);
  return next ? { id, label, title, run: (p) => arrangeListView(d, withColumns(d, next), p) } : { id, label, title, reason: reason ?? title };
}

/** Swap places with the nearest shown neighbour, or null at an end. */
function step(order: string[], shown: string[], column: string, dir: -1 | 1): string[] | null {
  const vis = shown.filter((c) => order.includes(c));
  const other = vis[vis.indexOf(column) + dir];
  if (!vis.includes(column) || other === undefined) return null;
  const out = order.filter((c) => c !== column);
  const at = out.indexOf(other);
  out.splice(dir < 0 ? at : at + 1, 0, column);
  return out;
}

/** Field types a list view can't show as a column. */
const NOT_A_COLUMN = new Set(["base64", "address", "location", "complexvalue", "id", "textarea", "encryptedstring"]);

/** Fields that could be added as a column: not already one, and on an old-style view only custom fields (the ids it can take). */
export function addableColumns(d: ListViewDraft): { name: string; label: string; type: string }[] {
  return d.live.available.filter((a) => !d.target.columns.includes(a.name) && !NOT_A_COLUMN.has(a.type) && (!d.legacy || a.name.endsWith("__c")));
}

/** "Add column…": fields the view doesn't show yet, placed after `after` (or at the end). */
function addVerb(d: ListViewDraft, after: string | null): Verb {
  const title = "Add a column to the list";
  const options = addableColumns(d)
    .map((a) => ({ value: a.name, label: a.label, detail: a.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (d.target.columns.length >= MAX_LIST_COLUMNS) {
    return { id: "addField", label: "Add column…", title, reason: `A list view holds at most ${MAX_LIST_COLUMNS} columns here. Remove one first.` };
  }
  if (!d.live.available.length) return { id: "addField", label: "Add column…", title, reason: `Couldn't read ${d.fullName.split(".")[0]}'s fields from the org.` };
  return {
    id: "addField",
    label: "Add column…",
    title,
    pick: {
      title: "Add a column to the list",
      description: d.legacy ? "This view names its standard columns the old way, so only custom fields can be added to it here." : undefined,
      placeholder: "Search fields",
      options,
      empty: d.legacy ? "This view has no custom field left to add." : "Every field that can be a column is already one.",
      run: (column, p) => {
        const next = [...d.target.columns];
        const at = after ? next.indexOf(after) + 1 : next.length;
        next.splice(at > 0 ? at : next.length, 0, column);
        return arrangeListView(d, withColumns(d, next), p);
      },
    },
  };
}

/** Verbs for a column; `column` may be a removed one (drawn as a ghost) or an added one. */
export function listColumnVerbs(d: ListViewDraft, column: string, label: string): Verb[] {
  if (!d.target.columns.includes(column)) {
    if (!d.base.columns.includes(column)) return [];
    return [
      verb(d, "restore", "Restore", `Put ${label} back in the list`, (cols) =>
        cols.length >= MAX_LIST_COLUMNS ? null : withGhosts(d.base.columns, cols, (c) => c === column).map((o) => o.key),
        `A list view holds at most ${MAX_LIST_COLUMNS} columns here. Remove one first.`
      ),
    ];
  }
  return [
    verb(d, "up", "Move left", `Move ${label} left`, (cols) => step(cols, d.shown, column, -1), "Already the first column"),
    verb(d, "down", "Move right", `Move ${label} right`, (cols) => step(cols, d.shown, column, 1), "Already the last column"),
    verb(d, "remove", "Remove", `Take ${label} out of the list`, (cols) => (cols.length > 1 ? cols.filter((c) => c !== column) : null), "A list needs at least one column"),
    addVerb(d, column),
  ];
}

/** Verbs for the list view as a whole: add a column at the end. */
export function listViewVerbs(d: ListViewDraft): Verb[] {
  return [addVerb(d, null)];
}

/** A column dropped right before `before` (null: last): one diffed change, as Move left / right queue. Null when either isn't in the list. */
export function moveListColumnTo(d: ListViewDraft, column: string, before: string | null, pending: PendingChange[]): PendingChange[] | null {
  if (before === column) return pending;
  if (!d.target.columns.includes(column) || (before !== null && !d.target.columns.includes(before))) return null;
  const next = d.target.columns.filter((c) => c !== column);
  next.splice(before === null ? next.length : next.indexOf(before), 0, column);
  return next.every((c, i) => c === d.target.columns[i]) ? pending : arrangeListView(d, withColumns(d, next), pending);
}

// --- Scope and filters (the inspector's editor) -------------------------------------

/** Scopes the iPad honours: it lists a view's records as Everything, or Mine, and treats any other scope as Everything. */
export const IPAD_SCOPES = ["Everything", "Mine"] as const;

export const OPERATIONS: { value: string; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "notEqual", label: "not equal to" },
  { value: "lessThan", label: "less than" },
  { value: "greaterThan", label: "greater than" },
  { value: "lessOrEqual", label: "less or equal" },
  { value: "greaterOrEqual", label: "greater or equal" },
  { value: "contains", label: "contains" },
  { value: "notContain", label: "does not contain" },
  { value: "startsWith", label: "starts with" },
  { value: "includes", label: "includes" },
  { value: "excludes", label: "excludes" },
];

/** The tray with the filter scope set (a change back to the org's value leaves none). */
export function setScope(d: ListViewDraft, scope: string, pending: PendingChange[]): PendingChange[] {
  return arrangeListView(d, { ...d.target, scope }, pending);
}

/** "1 AND (2 OR 3)": each of 1..n used, only AND / OR / NOT and parentheses between, parentheses balanced (as the server checks it). */
export function validLogic(logic: string, count: number): boolean {
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

/** What's wrong with these filter rows, or null. */
export function filterProblem(filters: ListViewFilter[], logic: string | null): string | null {
  if (filters.length > MAX_LIST_FILTERS) return `A list view holds at most ${MAX_LIST_FILTERS} filters.`;
  if (filters.some((f) => !f.field)) return "Pick a field for each filter.";
  if (logic !== null && (filters.length < 2 || !validLogic(logic, filters.length))) {
    return `Filter logic must use each of 1 to ${filters.length} once, joined by AND, OR or NOT (parentheses allowed).`;
  }
  return null;
}

/**
 * The tray with these filter rows. The logic follows the rows: a new row joins it with AND,
 * and taking a row out clears it (the numbers would no longer match).
 */
export function setFilters(d: ListViewDraft, filters: ListViewFilter[], logic: string | null | undefined, pending: PendingChange[]): PendingChange[] | null {
  const now = d.target.filters.length;
  let next: string | null = logic === undefined ? d.target.logic : logic;
  if (logic === undefined && next) {
    if (filters.length > now) next = `(${next}) AND ${filters.slice(now).map((_, i) => now + i + 1).join(" AND ")}`;
    else if (filters.length < now) next = null;
  }
  if (filters.length < 2) next = null;
  if (filterProblem(filters, next)) return null;
  return arrangeListView(d, { ...d.target, filters, logic: next }, pending);
}

/** Fields a filter can use: filterable ones; on an old-style view only custom fields. */
export function filterableFields(d: ListViewDraft): { name: string; label: string }[] {
  return d.live.available.filter((a) => a.filterable && (!d.legacy || a.name.endsWith("__c"))).map((a) => ({ name: a.name, label: a.label }));
}

/** Facts about the view the inspector states: what the iPad doesn't do with it. */
export function listViewNotes(d: ListViewDraft): string[] {
  const notes = ["Sort isn't editable here: the Metadata API has no sort setting, and the iPad takes a view's sort from the org."];
  const scope = d.target.scope;
  if (scope && !(IPAD_SCOPES as readonly string[]).includes(scope)) {
    notes.push(`The iPad ignores the "${scope}" filter scope and lists the view as Everything.`);
  }
  return notes;
}
