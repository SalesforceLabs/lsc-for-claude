/**
 * Shared building blocks for LSC Studio collectors — query wrappers, item and
 * surface constructors, and Admin Console record mapping.
 */

import { QueryTruncatedError, runSoqlQuery, runToolingQuery, type SoqlQueryResult } from "../salesforce/cli.js";
import type { ConfigRecord } from "../config/types.js";
import { chunkIds } from "../tools/helpers.js";
import type { Audience, ItemEdit, StudioFinding, StudioItem, StudioSurface } from "./types.js";

export type Row = Record<string, unknown>;
export type Props = StudioItem["properties"];
export type SurfaceMeta = Pick<StudioSurface, "id" | "title" | "lane" | "description">;

export const ID_PATTERN = /^[a-zA-Z0-9]{15,18}$/;

export interface QueryOptions {
  /** Return the rows read so far instead of throwing when the row cap is hit. */
  allowTruncated?: boolean;
  /** Row cap (default 50,000). */
  maxRows?: number;
}

/**
 * Rows for a query. Throws `QueryTruncatedError` when more rows matched than
 * could be read, unless `allowTruncated` — then use `queryResult` to tell.
 */
export async function query(soql: string, org: string, tooling = false, options: QueryOptions = {}): Promise<Row[]> {
  return (await queryResult(soql, org, tooling, options)).records as Row[];
}

/** Like `query`, with `totalSize` and `truncated` for "showing N of M" notes. */
export async function queryResult(
  soql: string,
  org: string,
  tooling = false,
  options: QueryOptions = {}
): Promise<SoqlQueryResult> {
  const result = tooling
    ? await runToolingQuery(soql, org, { maxRows: options.maxRows })
    : await runSoqlQuery(soql, org, { maxRows: options.maxRows });
  if (!result.success) throw new Error(result.error || "Query failed");
  const data = result.data ?? { totalSize: 0, done: true, records: [] };
  if (data.truncated && !options.allowTruncated) throw new QueryTruncatedError(data.records.length, data.totalSize);
  return { ...data, records: data.records ?? [] };
}

export async function count(soql: string, org: string): Promise<number> {
  const result = await runSoqlQuery(soql, org);
  if (!result.success) throw new Error(result.error || "Query failed");
  return result.data?.totalSize ?? 0;
}

/**
 * `COUNT(Id)` per value of `key` for the given ids. An aggregate query can't
 * page past 2,000 groups, so ids go in IN-list chunks (≤ 400 groups each) and
 * the chunks are merged. Ids with no rows are absent from the map.
 */
export async function countGroupedBy(
  object: string,
  key: string,
  ids: string[],
  org: string,
  where?: string
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const chunks = await Promise.all(
    chunkIds(ids).map((chunk) =>
      query(
        `SELECT ${key}, COUNT(Id) cnt FROM ${object} WHERE ${key} IN (${inList(chunk)})${where ? ` AND ${where}` : ""} GROUP BY ${key}`,
        org
      )
    )
  );
  for (const r of chunks.flat()) out.set(String(r[key]), Number(r.cnt ?? r.expr0 ?? 0));
  return out;
}

/** An info finding saying a list was cut short — never leave a cap unannounced. */
export function showingNote(shown: number, total: number, noun: string, order?: string): StudioFinding {
  const n = (v: number) => v.toLocaleString("en-US");
  return {
    severity: "info",
    title: `Showing ${n(shown)} of ${n(total)} ${noun}`,
    ...(order ? { detail: `${order}. Counts in findings cover all ${n(total)}.` } : {}),
  };
}

export function inList(values: string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(",");
}

export function scalar(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

/** Split a semicolon/comma separated config value ("A;B;C") into trimmed parts. */
export function splitList(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return v
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function item(id: string, label: string, extra: Partial<StudioItem> = {}): StudioItem {
  return { id, label, properties: {}, findings: [], ...extra };
}

export async function buildSurface(
  meta: SurfaceMeta,
  collect: () => Promise<{ items: StudioItem[]; findings?: StudioFinding[]; creates?: StudioSurface["creates"] }>
): Promise<StudioSurface> {
  try {
    const { items, findings = [], creates } = await collect();
    return { ...meta, items, findings, ...(creates?.length ? { creates } : {}) };
  } catch (err) {
    return { ...meta, items: [], findings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export function configItem(rec: ConfigRecord, label: string | undefined, sublabel: string): StudioItem {
  const properties: Props = {};
  for (const [k, v] of Object.entries(rec.fields)) properties[k] = scalar(v);
  const assigned = assignedTo(rec);
  if (assigned) properties["Assigned to"] = assigned;
  return item(`${rec.category}:${rec.developerName}`, label || rec.developerName, {
    sublabel,
    active: rec.isActive,
    properties,
    edit: configEdit(rec),
  });
}

/** Admin Console records an admin can switch on/off and re-target by profile from Studio. */
function isEditableConfig(rec: ConfigRecord): boolean {
  if (rec.category === "UISchema") return rec.fields.Type === "TAB";
  return ["DbSchema", "QuickAction", "CustomAction"].includes(rec.category);
}

export function configEdit(rec: ConfigRecord): ItemEdit | undefined {
  if (!isEditableConfig(rec)) return undefined;
  const edit: ItemEdit = {
    record: { type: "config", category: rec.category, developerName: rec.developerName, label: rec.label || rec.developerName },
    active: !!rec.isActive,
  };
  // Org-level records apply to everyone; there's no profile list to edit.
  if (rec.isOrgLevel) return edit;
  const assigned = rec.assignments.filter((a) => a.level === "Profile").map((a) => a.name);
  // Actions list profiles in their Profiles field — unless it's empty and they use assignments instead.
  const raw = typeof rec.fields.Profiles === "string" ? rec.fields.Profiles : "";
  const hasField = "Profiles" in rec.fields || "Profiles" in rec.fieldTypes;
  edit.profiles =
    hasField && (raw.trim() || assigned.length === 0) ? { source: "field", raw } : { source: "assignments", names: assigned };
  return edit;
}

export function assignedTo(rec: ConfigRecord): string | null {
  if (rec.assignments.length > 0) return rec.assignments.map((a) => a.name).join(", ");
  return rec.isOrgLevel ? "Org level" : null;
}

/**
 * Who an Admin Console record applies to, from its profile / permission set
 * assignments. Org-level records apply to everyone (no audience); an
 * unassigned, non-org-level record applies to no one.
 */
export function audienceOf(rec: ConfigRecord): Audience | undefined {
  if (rec.isOrgLevel) return undefined;
  const names = (level: string) => rec.assignments.filter((a) => a.level === level).map((a) => a.name);
  return { profiles: names("Profile"), permissionSets: names("PermissionSet") };
}

export function profileAudience(profile: string): Audience {
  return { profiles: [profile], permissionSets: [] };
}

/**
 * A source fetched once and shared by several surfaces. `settle` never rejects,
 * so a failure only surfaces when (and where) a surface unwraps it — no
 * unhandled rejections while other surfaces are still awaiting.
 */
export type Settled<T> = Promise<{ ok: true; value: T } | { ok: false; error: unknown }>;

export function settle<T>(p: Promise<T>): Settled<T> {
  return p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
}

export async function unwrap<T>(s: Settled<T>): Promise<T> {
  const r = await s;
  if (!r.ok) throw r.error;
  return r.value;
}
