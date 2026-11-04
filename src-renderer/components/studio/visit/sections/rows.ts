import type { VisitRow } from "../draft";
import type { SeedRow, VisitSections } from "./types";

/** Pure edits of `draft.rows` (rows by object API name), kept apart from React so they can be tested. */
export type Rows = Record<string, VisitRow[]>;

let counter = 0;
/** A local id for a row added in the preview; never a real record Id. */
export const localId = (): string => `local-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function addRow(
  rows: Rows,
  object: string,
  values: Record<string, string>,
  id = localId()
): Rows {
  return { ...rows, [object]: [...(rows[object] ?? []), { id, values }] };
}

export function setValue(
  rows: Rows,
  object: string,
  id: string,
  field: string,
  value: string
): Rows {
  return {
    ...rows,
    [object]: (rows[object] ?? []).map((r) =>
      r.id === id ? { ...r, values: { ...r.values, [field]: value } } : r
    ),
  };
}

/** Removing a detailing row takes its messages and discussions with it (their parent is gone). */
export function removeRow(rows: Rows, object: string, id: string): Rows {
  const next: Rows = { ...rows, [object]: (rows[object] ?? []).filter((r) => r.id !== id) };
  if (object === "ProviderVisitProdDetailing")
    for (const child of ["ProviderVisitDtlProductMsg", "ProviderVisitProdDiscussion"])
      if (next[child])
        next[child] = next[child].filter((r) => r.values.ProviderVisitProductDtlId !== id);
  return next;
}

/** The rows an edited visit opens with: what the collector read for it. A new visit starts empty. */
export function seedRows(data: VisitSections, editId: string | undefined): Rows {
  const mine = editId ? data.children[editId] : undefined;
  const rows: Rows = {};
  for (const [object, list] of Object.entries(mine ?? {}))
    rows[object] = list.map((r: SeedRow) => ({ id: r.id, values: { ...r.values } }));
  return rows;
}

/** Product Ids already used by the rows of an object, so the picker doesn't offer them twice. */
export function usedProducts(rows: VisitRow[] | undefined, field = "ProductId"): Set<string> {
  return new Set((rows ?? []).map((r) => r.values[field]).filter(Boolean));
}

/** A sidebar option: adds a row when no row has `value` in `field`, removes it (and what hangs off it) when one does. */
export function toggleRow(
  rows: Rows,
  object: string,
  field: string,
  value: string,
  values: Record<string, string>
): Rows {
  const have = (rows[object] ?? []).find((r) => r.values[field] === value);
  return have
    ? removeRow(rows, object, have.id)
    : addRow(rows, object, { ...values, [field]: value });
}
