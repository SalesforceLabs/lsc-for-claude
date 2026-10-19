/**
 * Report results for the preview's "View Report" sheet. The app runs a Summary or Tabular report as the viewer
 * (ReportsService → ReportDetailsViewModel → DataTableView); the preview can only run it as the connected admin
 * (`GET /analytics/reports/{id}?includeDetails=true`, read-only), so rows may differ from what the viewer sees.
 */

import { apiRequest } from "../../salesforce/cli.js";
import type { Row } from "../helpers.js";

export interface PublishedReportCell {
  label: string;
  /** A lookup column with a value: drawn in the accent color (ReportDetailsViewModel.canSelectCell). */
  link?: boolean;
  /** A boolean column: drawn as a check or a cross instead of text. */
  bool?: boolean;
}

export type PublishedReportEntry =
  | { kind: "row"; cells: PublishedReportCell[] }
  /** A group's subtotal row (a gray row above its rows), tinted by nesting level. */
  | { kind: "subtotal"; level: number; title: string; cells: string[] };

export interface PublishedReportData {
  /** Which format ran: Matrix and Joined open the web view in the app, so they carry no data. */
  format: "tabular" | "summary";
  /** Header cells (detail columns, then aggregate columns for summary reports). */
  columns: string[];
  /** Summary reports: the grouping column titles, joined " / " (the gutter header). */
  groupHeader?: string;
  entries: PublishedReportEntry[];
  /** Summary reports with Grand Total on: "Grand Total: 411600" and the totals per column. */
  grandTotal?: { label: string; cells: string[] };
  /** Rows beyond the cap were left out. */
  truncated?: boolean;
}

const ROW_CAP = 150;

function asRows(v: unknown): Row[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Row[]) : [];
}

function obj(v: unknown): Row {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}

function text(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

interface Column {
  key: string;
  label: string;
  dataType: string;
  lookup: boolean;
}

function columnOf(key: string, info: Row): Column {
  return { key, label: text(info.label), dataType: text(info.dataType), lookup: info.isLookup === true };
}

/** Rebuild the grid ReportDetailsViewModel draws from a report run's JSON. Undefined for formats the app opens on the web. */
export function buildReportData(run: Row): PublishedReportData | undefined {
  const meta = obj(run.reportMetadata);
  const ext = obj(run.reportExtendedMetadata);
  const format = text(meta.reportFormat).toUpperCase();
  if (format !== "TABULAR" && format !== "SUMMARY") return undefined;
  const hasDetails = meta.hasDetailRows !== false;
  const detailInfo = obj(ext.detailColumnInfo);
  const detailKeys = Array.isArray(meta.detailColumns) ? (meta.detailColumns as unknown[]).map(text) : [];
  const detail: Column[] = hasDetails ? detailKeys.filter((k) => detailInfo[k]).map((k) => columnOf(k, obj(detailInfo[k]))) : [];
  const facts = obj(run.factMap);
  const out: PublishedReportData = { format: format === "TABULAR" ? "tabular" : "summary", columns: detail.map((c) => c.label), entries: [] };

  const cellOf = (c: Column, raw: Row): PublishedReportCell => {
    const label = text(raw.label);
    return {
      label,
      ...(c.dataType === "boolean" ? { bool: raw.value === true || raw.value === "true" } : {}),
      ...(c.lookup && raw.value != null && text(raw.value) !== "" ? { link: true } : {}),
    };
  };
  let total = 0;
  const rowsOf = (key: string, extra: number): PublishedReportEntry[] => {
    const rows = asRows(obj(facts[key]).rows);
    const entries: PublishedReportEntry[] = [];
    for (const r of rows) {
      if (total >= ROW_CAP) {
        out.truncated = true;
        break;
      }
      total++;
      const cells = asRows(r.dataCells).map((raw, i) => (detail[i] ? cellOf(detail[i], raw) : { label: text(raw.label) }));
      for (let i = 0; i < extra; i++) cells.push({ label: "" });
      entries.push({ kind: "row", cells });
    }
    return entries;
  };

  if (out.format === "tabular") {
    out.entries = rowsOf("T!T", 0);
    return out;
  }

  const aggregates = Array.isArray(meta.aggregates) ? (meta.aggregates as unknown[]).map(text) : [];
  const aggInfo = obj(ext.aggregateColumnInfo);
  const aggColumns: Column[] = aggregates.some((a) => a !== "RowCount")
    ? aggregates
        .filter((k) => {
          const fixed = k.split("!")[1] ?? k;
          return aggInfo[k] && (!hasDetails || !detailKeys.includes(fixed)) && fixed !== "RowCount";
        })
        .map((k) => columnOf(k, obj(aggInfo[k])))
    : [];
  out.columns = [...detail.map((c) => c.label), ...aggColumns.map((c) => c.label)];
  const groupInfo = obj(ext.groupingColumnInfo);
  out.groupHeader = Object.keys(groupInfo)
    .sort((a, b) => Number(obj(groupInfo[a]).groupingLevel ?? 0) - Number(obj(groupInfo[b]).groupingLevel ?? 0))
    .map((k) => text(obj(groupInfo[k]).label))
    .filter(Boolean)
    .join(" / ");

  /** ReportDetailsViewModel's subtotal row: a detail column takes "s!"/"a!" + its key, an aggregate column its own key. */
  const totalsOf = (key: string): string[] | undefined => {
    const aggs = asRows(obj(facts[key]).aggregates);
    if (!aggColumns.length) return undefined;
    const at = (i: number) => (i >= 0 && aggs[i] ? text(aggs[i].label) : "");
    return [
      ...detail.map((c) => {
        let i = aggregates.indexOf(`s!${c.key}`);
        if (i < 0) i = aggregates.indexOf(`a!${c.key}`);
        return at(i);
      }),
      ...aggColumns.map((c) => at(aggregates.indexOf(c.key))),
    ];
  };
  const groupTitles = Object.keys(groupInfo).sort((a, b) => Number(obj(groupInfo[a]).groupingLevel ?? 0) - Number(obj(groupInfo[b]).groupingLevel ?? 0));
  const walk = (groups: Row[], level: number) => {
    for (const g of groups) {
      const key = text(g.key);
      const subtotal = totalsOf(`${key}!T`);
      const title = `${text(obj(groupInfo[groupTitles[level]]).label)}: ${text(g.label)}`;
      if (subtotal) out.entries.push({ kind: "subtotal", level, title, cells: subtotal });
      const sub = asRows(g.groupings);
      if (sub.length) walk(sub, level + 1);
      else out.entries.push(...rowsOf(`${key}!T`, aggColumns.length));
    }
  };
  walk(asRows(obj(run.groupingsDown).groupings), 0);

  if (meta.showGrandTotal !== false) {
    const t = obj(facts["T!T"]);
    const aggs = asRows(t.aggregates);
    const i = aggregates.indexOf("RowCount");
    const raw = i >= 0 && aggs[i] ? aggs[i].value : undefined;
    const value = typeof raw === "number" ? (Number.isInteger(raw) ? String(raw) : String(raw)) : text(i >= 0 && aggs[i] ? aggs[i].label : "");
    out.grandTotal = { label: `Grand Total: ${value}`, cells: totalsOf("T!T") ?? [] };
  }
  return out;
}

/**
 * Report results are a preview, not live data, and each run counts against the org's 500 synchronous report runs
 * an hour — so a run is reused for `REPORT_TTL_MS`, and a run that fails (quota spent, timeout) falls back to the
 * last result however old. Kept in memory only: these are customer records, not configuration.
 */
const REPORT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED_REPORTS = 500;
const reportCache = new Map<string, { at: number; data: PublishedReportData }>();
const reportRuns = new Map<string, Promise<PublishedReportData | undefined>>();

export function clearReportCache(): void {
  reportCache.clear();
  reportRuns.clear();
}

async function fetchReport(id: string, org: string): Promise<PublishedReportData | undefined> {
  const res = await apiRequest<Row>(`/services/data/v66.0/analytics/reports/${id}?includeDetails=true`, "GET", undefined, org);
  if (!res.success || !res.data || typeof res.data !== "object") return undefined;
  return buildReportData(res.data);
}

/** Run one report read-only. Undefined when it can't be run or isn't a native format. */
export async function runReport(id: string, org: string, now = Date.now()): Promise<PublishedReportData | undefined> {
  if (!/^00O[A-Za-z0-9]{12,15}$/.test(id)) return undefined;
  const key = `${org}|${id}`;
  const hit = reportCache.get(key);
  if (hit && now - hit.at < REPORT_TTL_MS) return hit.data;
  let run = reportRuns.get(key);
  if (!run) {
    run = fetchReport(id, org)
      .catch(() => undefined)
      .finally(() => reportRuns.delete(key));
    reportRuns.set(key, run);
  }
  const data = await run;
  if (!data) return hit?.data;
  reportCache.delete(key);
  reportCache.set(key, { at: now, data });
  while (reportCache.size > MAX_CACHED_REPORTS) reportCache.delete(reportCache.keys().next().value as string);
  return data;
}

interface Runnable {
  kind: "section" | "folder" | "report";
  id?: string;
  native?: boolean;
  data?: PublishedReportData;
  /** The run was attempted (so a missing `data` means "couldn't run", not "not tried"). */
  ran?: boolean;
  children: Runnable[];
}

/**
 * Run the tree's native reports (a few at a time, within `budgetMs`) and attach each result to its item, so the
 * viewer sheet can open them without another round trip. Items it doesn't get to keep no `ran` flag.
 */
export async function attachReportData(items: Runnable[], org: string, budgetMs = 20000, maxReports = 60): Promise<void> {
  const todo: Runnable[] = [];
  const collect = (list: Runnable[]) => {
    for (const i of list) {
      if (i.kind === "report" && i.id && i.native) todo.push(i);
      collect(i.children);
    }
  };
  collect(items);
  const deadline = Date.now() + budgetMs;
  const queue = todo.slice(0, maxReports);
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      if (Date.now() > deadline) return;
      item.ran = true;
      item.data = await runReport(item.id as string, org).catch(() => undefined);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
