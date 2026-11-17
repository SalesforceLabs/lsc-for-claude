/**
 * Sales Data tab (lifesciences-ios OCEDemo/Tabs/ReportsTab: SalesDataTabCoordinator,
 * TerritorySalesReportViewController/ViewModel). The device reads the Data Cloud
 * prescription (HCP) and distribution (HCO) DMO tables it synced and pivots
 * them: one row per account, one column per product, values from
 * `measureNTotal__c`, sorted by account name, 20 rows a page. Read-only.
 * The sales chart above the table needs the FlexiPage's `salesDataType` and
 * isn't drawn.
 */

import { query, type Row } from "../../helpers.js";
import type { ScreenContext } from "../context.js";
import { softFail } from "../context.js";

export interface SalesTable {
  /** "HCP" (prescriptions) or "HCO" (distribution), ChartEntityType. */
  type: "HCP" | "HCO";
  /** "Measure 1 Summary". */
  title: string;
  /** Product names, in column order. */
  products: string[];
  /** Account rows sorted by name; `values` lines up with `products`, null where the account has no row. */
  rows: { account: string; values: (number | null)[] }[];
  /** Past the row cap; the table shows what was read. */
  truncated?: boolean;
}

export interface PublishedSalesData {
  tables: SalesTable[];
  pageSize: number;
  note?: string;
}

/** SalesDataTabCoordinator / TerritorySalesReportViewModel page size. */
export const SALES_PAGE_SIZE = 20;
const ROW_CAP = 2000;
const SOURCES = [
  { type: "HCP" as const, object: "LifeSciDrugPrescriptionData__dlm" },
  { type: "HCO" as const, object: "LifeSciDrugDistributionData__dlm" },
];
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Pivot DMO rows (account × product, measure N) into the table the device draws. Sums rows that repeat a pair. */
export function pivotSales(
  rows: Row[],
  measure: number,
  productNames: Map<string, string>
): Omit<SalesTable, "type" | "title"> {
  const col = `Measure${measure}Total__c`;
  const products = new Set<string>();
  const byAccount = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const account = str(r.AccountFullName__c) || str(r.Account__c);
    if (!account) continue;
    const product = productNames.get(str(r.Product__c)) || str(r.Product__c);
    if (!product) continue;
    products.add(product);
    const m = byAccount.get(account) ?? new Map<string, number>();
    m.set(product, (m.get(product) ?? 0) + (Number(r[col]) || 0));
    byAccount.set(account, m);
  }
  const cols = [...products].sort((a, b) => a.localeCompare(b));
  return {
    products: cols,
    rows: [...byAccount.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([account, m]) => ({ account, values: cols.map((p) => m.get(p) ?? null) })),
  };
}

export async function collectSalesData(
  ctx: ScreenContext
): Promise<PublishedSalesData | undefined> {
  const synced = SOURCES.filter((s) => ctx.scope(s.object) !== undefined);
  const tables: SalesTable[] = [];
  const notes: string[] = [];
  for (const s of synced) {
    const rows = await query(
      `SELECT Account__c, AccountFullName__c, Product__c, DataPeriod__c, Measure1Total__c FROM ${s.object} LIMIT ${ROW_CAP + 1}`,
      ctx.org
    ).catch(softFail(ctx, `Sales data (${s.type})`, null as Row[] | null));
    if (!rows) {
      notes.push(`the ${s.type} sales table couldn't be read`);
      continue;
    }
    const cut = rows.length > ROW_CAP;
    const used = rows.slice(0, ROW_CAP);
    const ids = [
      ...new Set(
        used.map((r) => str(r.Product__c)).filter((id) => /^[a-zA-Z0-9]{15,18}$/.test(id))
      ),
    ];
    const names = new Map<string, string>();
    if (ids.length)
      for (const p of await query(
        `SELECT Id, Name FROM Product2 WHERE Id IN (${ids.map((i) => `'${i}'`).join(",")}) LIMIT 200`,
        ctx.org
      ).catch(() => [] as Row[]))
        names.set(str(p.Id), str(p.Name));
    if (cut)
      notes.push(`the ${s.type} table shows the first ${ROW_CAP.toLocaleString("en-US")} rows`);
    tables.push({
      type: s.type,
      title: "Measure 1 Summary",
      ...pivotSales(used, 1, names),
      ...(cut ? { truncated: true } : {}),
    });
  }
  if (!synced.length)
    notes.push(
      "this rep's DB Schema doesn't sync the sales data tables, so the device shows an empty table"
    );
  notes.push("the sales chart above the table, and measures other than the first");
  return { tables, pageSize: SALES_PAGE_SIZE, note: `Not in the preview: ${notes.join("; ")}.` };
}
