import { describe, expect, it } from "vitest";
import {
  addLine,
  applyDiscount,
  discountValid,
  money,
  netTotal,
  orderTotals,
  removeLine,
  setQuantity,
  type OrderLine,
} from "../../../../src-renderer/components/studio/actions/orders/logic";
import { pricebookActiveOn, sortPricebooks } from "../../../../src/studio/screens/actions/orders";

const p = (id: string, unitPrice: number) => ({
  id,
  productId: `P${id}`,
  name: `Product ${id}`,
  unitPrice,
});

describe("order discounts", () => {
  it("applies each type like OrderModels.DiscountType", () => {
    expect(applyDiscount(200, { type: "percentage", value: 25 })).toBe(150);
    expect(applyDiscount(200, { type: "amount", value: 500 })).toBe(0);
    expect(applyDiscount(200, { type: "override", value: 80 })).toBe(80);
  });
  it("validates ranges", () => {
    expect(discountValid({ type: "percentage", value: 0 }, 100)).toBe(false);
    expect(discountValid({ type: "percentage", value: 100 }, 100)).toBe(true);
    expect(discountValid({ type: "amount", value: 101 }, 100)).toBe(false);
    expect(discountValid({ type: "override", value: 0 }, 100)).toBe(true);
  });
});

describe("order totals", () => {
  const lines: OrderLine[] = [
    { product: p("1", 100), quantity: 3, discount: { type: "percentage", value: 10 } },
    { product: p("2", 50), quantity: 2 },
  ];
  it("sums gross and net and derives the discount", () => {
    expect(netTotal(lines[0])).toBe(270);
    const t = orderTotals(lines);
    expect(t.gross).toBe(400);
    expect(t.net).toBe(370);
    expect(t.discount).toBe(30);
    expect(t.discountPercentage).toBeCloseTo(7.5);
  });
  it("ignores an invalid discount", () => {
    expect(
      netTotal({ product: p("1", 100), quantity: 1, discount: { type: "percentage", value: 150 } })
    ).toBe(100);
  });
  it("is zero for an empty order", () => {
    expect(orderTotals([])).toEqual({ gross: 0, net: 0, discount: 0, discountPercentage: 0 });
  });
});

describe("order lines", () => {
  it("adds, counts up, sets and removes", () => {
    let l = addLine([], p("1", 10));
    l = addLine(l, p("1", 10));
    expect(l[0].quantity).toBe(2);
    l = setQuantity(l, "1", 0);
    expect(l[0].quantity).toBe(2);
    l = setQuantity(l, "1", 5);
    expect(l[0].quantity).toBe(5);
    expect(removeLine(l, "1")).toEqual([]);
  });
  it("formats money", () => {
    expect(money(1234.5, "USD")).toBe("$1,234.50");
  });
});

describe("price book selection", () => {
  it("lists the standard book first, then by name", () => {
    const s = sortPricebooks([
      { name: "b", isStandard: false },
      { name: "Standard Price Book", isStandard: true },
      { name: "A", isStandard: false },
    ]);
    expect(s.map((x) => x.name)).toEqual(["Standard Price Book", "A", "b"]);
  });
  it("honours the validity window", () => {
    expect(
      pricebookActiveOn(
        { IsActive: true, ValidFrom: "2026-01-01", ValidTo: "2026-12-31" },
        "2026-06-01"
      )
    ).toBe(true);
    expect(pricebookActiveOn({ IsActive: true, ValidTo: "2026-01-01" }, "2026-06-01")).toBe(false);
    expect(pricebookActiveOn({ IsActive: false }, "2026-06-01")).toBe(false);
  });
});
