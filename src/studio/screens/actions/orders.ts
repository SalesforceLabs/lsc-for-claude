/**
 * Order (Quote) creation from the ••• menu: the price books the device lists and the products it can add.
 * iOS: module/Orders — PricebookSelectionViewModel / LineItemsRepository.fetchActivePricebooks
 * (IsActive, ValidFrom <= today or null, ValidTo >= today or null). The pricing engine itself
 * (module/LSCPricingEngine, the org's expression sets and decision tables) is not run here.
 */

import { inList, query, type Row } from "../../helpers.js";
import { type ScreenContext, softFail } from "../context.js";

export interface OrderPricebook {
  id: string;
  name: string;
  description?: string;
  isStandard: boolean;
}

export interface OrderProduct {
  /** PricebookEntry Id. */
  id: string;
  productId: string;
  name: string;
  code?: string;
  unitPrice: number;
}

export interface PublishedOrder {
  /** Sorted standard price book first, then by name (PricebookSelectionViewModel). */
  pricebooks: OrderPricebook[];
  /** Active entries per price book id, the first PRODUCT_CAP by product name. */
  products: Record<string, OrderProduct[]>;
  /** Price books whose product list was cut at PRODUCT_CAP. */
  cut: string[];
  /** The viewer's currency (ISO code); USD when the org isn't multi-currency. */
  currency: string;
}

export const PRODUCT_CAP = 100;
const PRICEBOOK_CAP = 6;

const str = (v: unknown): string => (v == null ? "" : String(v));

/** iOS PricebookSelectionViewModel: the standard price book first, then the rest by name, ignoring case. */
export function sortPricebooks<T extends { name: string; isStandard: boolean }>(books: T[]): T[] {
  return [...books].sort((a, b) =>
    a.isStandard !== b.isStandard
      ? a.isStandard
        ? -1
        : 1
      : a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );
}

/** LineItemsRepository.fetchActivePricebooks: active, and today inside ValidFrom…ValidTo (either may be empty). */
export function pricebookActiveOn(
  row: { IsActive?: unknown; ValidFrom?: unknown; ValidTo?: unknown },
  today: string
): boolean {
  if (row.IsActive === false || str(row.IsActive).toLowerCase() === "false") return false;
  const from = str(row.ValidFrom).slice(0, 10);
  const to = str(row.ValidTo).slice(0, 10);
  return (!from || from <= today) && (!to || to >= today);
}

export async function collectOrder(ctx: ScreenContext): Promise<PublishedOrder | undefined> {
  if (ctx.scope("Pricebook2") === undefined && ctx.scope("PricebookEntry") === undefined) {
    // Neither table is synced: the device has no price books to offer.
    return { pricebooks: [], products: {}, cut: [], currency: "USD" };
  }
  const today = new Date().toISOString().slice(0, 10);
  const rows = await query(
    "SELECT Id, Name, Description, IsStandard, IsActive, ValidFrom, ValidTo FROM Pricebook2 WHERE IsActive = true",
    ctx.org
  ).catch(softFail(ctx, "Order price books", [] as Row[]));
  const books = sortPricebooks(
    rows
      .filter((r) => pricebookActiveOn(r, today))
      .map((r) => ({
        id: str(r.Id),
        name: str(r.Name),
        description: str(r.Description) || undefined,
        isStandard: r.IsStandard === true || str(r.IsStandard) === "true",
      }))
  );
  const shown = books.slice(0, PRICEBOOK_CAP);
  if (books.length > shown.length)
    ctx.note(`Order: showing ${shown.length} of ${books.length} price books.`);
  const products: Record<string, OrderProduct[]> = {};
  const cut: string[] = [];
  await Promise.all(
    shown.map(async (b) => {
      const entries = await query(
        `SELECT Id, Product2Id, Product2.Name, Product2.ProductCode, UnitPrice FROM PricebookEntry WHERE Pricebook2Id IN (${inList([b.id])}) AND IsActive = true AND Product2.IsActive = true ORDER BY Product2.Name LIMIT ${PRODUCT_CAP + 1}`,
        ctx.org
      ).catch(softFail(ctx, "Order products", [] as Row[]));
      if (entries.length > PRODUCT_CAP) cut.push(b.id);
      products[b.id] = entries.slice(0, PRODUCT_CAP).map((e) => {
        const p = (e.Product2 ?? {}) as Row;
        return {
          id: str(e.Id),
          productId: str(e.Product2Id),
          name: str(p.Name),
          code: str(p.ProductCode) || undefined,
          unitPrice: Number(e.UnitPrice ?? 0),
        };
      });
    })
  );
  const me = await query(
    `SELECT DefaultCurrencyIsoCode FROM User WHERE Id = '${ctx.userId.replace(/[^A-Za-z0-9]/g, "")}'`,
    ctx.org
  ).catch(() => [] as Row[]);
  return {
    pricebooks: shown,
    products,
    cut,
    currency: str(me[0]?.DefaultCurrencyIsoCode) || "USD",
  };
}
