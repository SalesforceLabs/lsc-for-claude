import type { OrderProduct } from "../../screens/fabs-types";

/**
 * The order screen's arithmetic, ported from lifesciences-ios module/Orders. The pricing engine
 * (module/LSCPricingEngine: the org's expression sets and decision tables) is not run, so a line's net price is
 * its price book price less a discount typed by the rep, never a price the org would compute.
 */

/** OrderModels.swift DiscountType. */
export type DiscountType = "percentage" | "amount" | "override";

export interface Discount {
  type: DiscountType;
  value: number;
}

export interface OrderLine {
  product: OrderProduct;
  quantity: number;
  discount?: Discount;
}

/** LineItemWrapper.swift:151 — grossPrice = (listPrice ?? unitPrice) * quantity; a price book entry has only UnitPrice. */
export const grossPrice = (l: OrderLine): number => l.product.unitPrice * l.quantity;

/**
 * Whether a typed discount is accepted (OrderModels.swift): a percentage is above 0 and at most 100,
 * an amount above 0 and at most the line's price, an override from 0 to the line's price.
 */
export function discountValid(d: Discount, price: number): boolean {
  if (!Number.isFinite(d.value)) return false;
  switch (d.type) {
    case "percentage":
      return d.value > 0 && d.value <= 100;
    case "amount":
      return d.value > 0 && d.value <= price;
    case "override":
      return d.value >= 0 && d.value <= price;
  }
}

/** OrderModels.swift DiscountType.apply: percentage → max(0, price - price*v/100), amount → max(0, price - v), override → max(0, v). */
export function applyDiscount(price: number, d: Discount): number {
  switch (d.type) {
    case "percentage":
      return Math.max(0, price - (price * d.value) / 100);
    case "amount":
      return Math.max(0, price - d.value);
    case "override":
      return Math.max(0, d.value);
  }
}

/** LineItemWrapper.effectiveNetTotal: the discounted price when a valid discount is set, else the gross price. */
export function netTotal(l: OrderLine): number {
  const gross = grossPrice(l);
  return l.discount && discountValid(l.discount, gross) ? applyDiscount(gross, l.discount) : gross;
}

export interface OrderTotals {
  gross: number;
  net: number;
  discount: number;
  discountPercentage: number;
}

/** OrderLinePricingService.makeOrderTotal (:396-418): gross and net are sums, discount = gross - net, percentage = discount / gross * 100. */
export function orderTotals(lines: OrderLine[]): OrderTotals {
  const gross = lines.reduce((s, l) => s + grossPrice(l), 0);
  const net = lines.reduce((s, l) => s + netTotal(l), 0);
  const discount = gross - net;
  return { gross, net, discount, discountPercentage: gross > 0 ? (discount / gross) * 100 : 0 };
}

/** Add a product once; adding it again raises its quantity (the line items screen keeps one row per product). */
export function addLine(lines: OrderLine[], product: OrderProduct): OrderLine[] {
  const at = lines.findIndex((l) => l.product.id === product.id);
  if (at < 0) return [...lines, { product, quantity: 1 }];
  return lines.map((l, i) => (i === at ? { ...l, quantity: l.quantity + 1 } : l));
}

/** A quantity of at least 1; anything else keeps the previous one. */
export function setQuantity(lines: OrderLine[], id: string, quantity: number): OrderLine[] {
  if (!Number.isFinite(quantity) || quantity < 1) return lines;
  return lines.map((l) => (l.product.id === id ? { ...l, quantity: Math.floor(quantity) } : l));
}

export const removeLine = (lines: OrderLine[], id: string): OrderLine[] =>
  lines.filter((l) => l.product.id !== id);

export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** The count line under the grid ("{0} Item(s) Selected"). */
export const selectedLabel = (n: number): string => `${n} Item(s) Selected`;
