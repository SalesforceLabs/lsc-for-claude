/**
 * The Territory and Product tabs of an Account's Ratings card: the values of the account's own
 * ProviderAcctTerritoryInfo row (CustomerRatingsViewModel.fetchAccountTerritoryFields: the row for the account)
 * and its ProviderAcctProductInfo rows, one per product (OCEDBAccountTerritoryProductModel.fetch), read for the
 * viewer's territories — the device holds no other rows. Products are listed by name (CustomerRatingsViewModel:277).
 * Read-only. The General tab's Account values are read by the record collector.
 */

import { apiRequest, dataPath } from "../../../salesforce/cli.js";
import { inList, query, type Row } from "../../helpers.js";
import { type ScreenContext, softFail } from "../context.js";
import type { RatingItem } from "../record-ratings.js";

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

export interface RatingSourceRow {
  row: Row;
  /** Product name, on a product row. */
  product?: string;
}

export interface RatingSources {
  /** Per account: its territory info row in the viewer's first territory that has one. */
  territory: Map<string, RatingSourceRow>;
  /** Per account: its product rows, by product name. */
  product: Map<string, RatingSourceRow[]>;
  /** Lower-cased field name → describe field, per source object. */
  fields: { territory: Map<string, Row>; product: Map<string, Row> };
}

export const isTerritoryItem = (i: RatingItem): boolean =>
  /ProviderAcctTerritoryInfo/i.test(i.sobject);
export const isProductItem = (i: RatingItem): boolean =>
  i.sobject !== "Account" && !isTerritoryItem(i);

async function describeFields(ctx: ScreenContext, object: string): Promise<Map<string, Row>> {
  const r = await apiRequest<Row>(
    await dataPath(ctx.org, `/sobjects/${object}/describe`),
    "GET",
    undefined,
    ctx.org
  ).catch(() => null);
  return new Map(arr(r?.data?.fields).map((f) => [str(f.name).toLowerCase(), f]));
}

function selectList(items: RatingItem[], known: Map<string, Row>): string[] {
  return [...new Set(items.map((i) => i.field).filter((f) => known.has(f.toLowerCase())))].map(
    (f) => str(known.get(f.toLowerCase())?.name)
  );
}

export async function readRatingSources(
  ctx: ScreenContext,
  items: RatingItem[],
  accountIds: string[]
): Promise<RatingSources> {
  const out: RatingSources = {
    territory: new Map(),
    product: new Map(),
    fields: { territory: new Map(), product: new Map() },
  };
  const terrIds = ctx.territories.map((t) => t.id);
  const terrItems = items.filter(isTerritoryItem);
  const prodItems = items.filter(isProductItem);
  if (!accountIds.length || !terrIds.length) return out;
  const order = new Map(terrIds.map((id, i) => [id, i]));
  const byTerritory = (a: Row, b: Row, key: string) =>
    (order.get(str(a[key])) ?? 99) - (order.get(str(b[key])) ?? 99);

  await Promise.all([
    (async () => {
      if (!terrItems.length || ctx.scope("ProviderAcctTerritoryInfo") === undefined) return;
      out.fields.territory = await describeFields(ctx, "ProviderAcctTerritoryInfo");
      const cols = selectList(terrItems, out.fields.territory);
      if (!cols.length) return;
      const rows = await query(
        `SELECT Id, AccountId, Territory2Id, LastModifiedDate${cols.map((c) => `, ${c}`).join("")} FROM ProviderAcctTerritoryInfo WHERE AccountId IN (${inList(accountIds)}) AND Territory2Id IN (${inList(terrIds)}) LIMIT 2000`,
        ctx.org
      ).catch(softFail(ctx, "Ratings (Territory)", [] as Row[]));
      for (const r of [...rows].sort((a, b) => byTerritory(a, b, "Territory2Id"))) {
        if (!out.territory.has(str(r.AccountId))) out.territory.set(str(r.AccountId), { row: r });
      }
    })(),
    (async () => {
      if (!prodItems.length || ctx.scope("ProviderAcctProductInfo") === undefined) return;
      out.fields.product = await describeFields(ctx, "ProviderAcctProductInfo");
      const cols = selectList(prodItems, out.fields.product);
      if (!cols.length) return;
      const rows = await query(
        `SELECT Id, AccountId, ProductId, Product.Name, TerritoryId, LastModifiedDate${cols.map((c) => `, ${c}`).join("")} FROM ProviderAcctProductInfo WHERE AccountId IN (${inList(accountIds)}) AND TerritoryId IN (${inList(terrIds)}) AND Product.IsActive = true LIMIT 2000`,
        ctx.org
      ).catch(softFail(ctx, "Ratings (Product)", [] as Row[]));
      // One row per product: the viewer's first territory wins.
      const seen = new Set<string>();
      for (const r of [...rows].sort((a, b) => byTerritory(a, b, "TerritoryId"))) {
        const k = `${str(r.AccountId)}:${str(r.ProductId)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const list = out.product.get(str(r.AccountId)) ?? [];
        list.push({ row: r, product: str((r.Product as Row | undefined)?.Name) });
        out.product.set(str(r.AccountId), list);
      }
      for (const list of out.product.values())
        list.sort((a, b) => (a.product ?? "").localeCompare(b.product ?? ""));
    })(),
  ]);
  return out;
}
