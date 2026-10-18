/** The slice of a layout item's own describe the record view needs: what the cache already carries for each field. */

import type { Row } from "../helpers.js";

export interface RecordFieldSpec {
  /** API name; a dotted path (`MessageRecord.ContentText`) is a related record's field. */
  name: string;
  label: string;
  /** Lower-cased describe type (`lookup`, `picklist`, `datetime`, …); empty when the cache has no describe for it. */
  type: string;
  /** Lookup targets. */
  ref?: string[];
  /** Picklist value → label, when any label differs from its value. */
  picklist?: Record<string, string>;
  /** The layout marks it Required (the create form's red asterisk). */
  required?: boolean;
  /** The layout marks it Readonly. */
  readOnly?: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

export function recordFieldSpec(item: Row, label: string): RecordFieldSpec {
  const spec: RecordFieldSpec = { name: str(item.fullName) || str(item.field), label, type: str(item.type).toLowerCase() };
  const behavior = str(item.behavior).toLowerCase();
  if (behavior === "required") spec.required = true;
  if (behavior === "readonly") spec.readOnly = true;
  if (Array.isArray(item.referenceTo) && item.referenceTo.length) spec.ref = item.referenceTo.map(str);
  const labels = (Array.isArray(item.picklistValues) ? item.picklistValues : []).filter((p): p is Row => !!p && typeof p === "object");
  const differing = labels.filter((p) => str(p.label) && str(p.label) !== str(p.value));
  if (differing.length) spec.picklist = Object.fromEntries(labels.map((p) => [str(p.value), str(p.label) || str(p.value)]));
  return spec;
}
