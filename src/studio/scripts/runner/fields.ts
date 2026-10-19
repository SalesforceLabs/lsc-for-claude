/** Field selection and row shaping shared by the runner's org reads. */

import { RUN_LIMITS, type DescribeInfo, type Row } from "./types.js";

/** Field types SOQL can't return as plain values in a flat row. */
const SKIPPED_TYPES = new Set(["address", "location", "base64", "anyType", "complexvalue"]);

/** Id first, then Name, then the rest, up to `cap` fields. */
export function pickFields(info: DescribeInfo, cap: number = RUN_LIMITS.maxFields): { fields: string[]; capped: boolean } {
  const usable = info.fields.filter((f) => !SKIPPED_TYPES.has(f.type)).map((f) => f.name);
  const first = ["Id", "Name"].filter((n) => usable.includes(n));
  const rest = usable.filter((n) => !first.includes(n));
  const all = [...first, ...rest];
  return { fields: all.slice(0, cap), capped: all.length > cap };
}

/** A query result row without the REST `attributes` envelope. */
export function plainRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (k !== "attributes") out[k] = v;
  return out;
}

export function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export const ID_RE = /^[a-zA-Z0-9]{15,18}$/;
