import React, { useMemo, useState } from "react";
import type { FormContext, SheetContext } from "../../ipad-sheet-ui";
import {
  Backdrop,
  layoutsFor,
  linkBtn,
  Magnifier,
  NavBar,
  Note,
  Sections,
} from "../../ipad-sheet-ui";
import type { OrderPricebook, OrderProduct } from "../../screens/fabs-types";
import {
  addLine,
  discountValid,
  grossPrice,
  money,
  netTotal,
  orderTotals,
  removeLine,
  selectedLabel,
  setQuantity,
  type Discount,
  type DiscountType,
  type OrderLine,
} from "./logic";
import "./orders.css";

/**
 * Create an order (Quote) from the ••• menu: the Quote create form, Select Price Book, then Add Products to Quote.
 * iOS: module/Orders (PricebookSelectionViewModel, CreateLineItemView, OrderReviewView). The pricing engine and
 * the org's pricing rules are not run: the net price is the price book price less a discount typed here.
 */
export default function OrderSheet({ ctx, onClose }: { ctx: SheetContext; onClose: () => void }) {
  const { snapshot, record } = ctx;
  const order = snapshot.screens?.fabs?.order;
  const rt = snapshot.objects.Quote?.recordTypes[0];
  const layouts = rt ? layoutsFor(snapshot, "Quote", rt.name) : [];
  const [step, setStep] = useState<"form" | "pricebook" | "lines" | "review">(
    layouts.length ? "form" : "pricebook"
  );
  const books = order?.pricebooks ?? [];
  const [bookId, setBookId] = useState<string | undefined>(books.find((b) => b.isStandard)?.id);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const seed = useMemo(() => crypto.randomUUID().toUpperCase(), []);
  const account = record?.object === "Account" ? record.title : "";
  const form: FormContext = {
    seed,
    defaults: rt?.picklistDefaults,
    values: (spec) => (/^Account/.test(spec.name) && account ? account : undefined),
    nullLabels: [],
  };
  const currency = order?.currency ?? "USD";
  const book = books.find((b) => b.id === bookId);

  if (step === "form") {
    return (
      <Backdrop onClose={onClose} className="order">
        <NavBar
          plain
          left={linkBtn("Cancel", onClose)}
          title="New Quote"
          right={linkBtn("Next", () => setStep("pricebook"))}
        />
        <div className="studio-ipad-act-body form">
          {layouts.map((l) => (
            <Sections key={l.name} layout={l} firstNull={0} form={form} />
          ))}
          <Note>The form is not saved. The app creates the quote when you tap Next.</Note>
        </div>
      </Backdrop>
    );
  }

  if (step === "pricebook") {
    return (
      <Backdrop onClose={onClose} className="order small">
        <NavBar
          plain
          left={linkBtn("Cancel", onClose)}
          title="Select Price Book"
          right={linkBtn("Next", () => setStep("lines"), !bookId)}
        />
        <div className="studio-ipad-act-body">
          {books.map((b) => (
            <PricebookRow key={b.id} book={b} on={b.id === bookId} onPick={() => setBookId(b.id)} />
          ))}
          {order && !books.length && (
            <div className="studio-ipad-ord-empty">
              <b>No Price Books Available</b>
              <span>Please contact your administrator to set up price books.</span>
            </div>
          )}
          {!order && (
            <Note>
              This snapshot has no price book list. Publish again, or the viewer's profile doesn't
              sync price books.
            </Note>
          )}
        </div>
      </Backdrop>
    );
  }

  if (step === "review") {
    return (
      <Backdrop onClose={onClose} className="order">
        <NavBar
          plain
          left={linkBtn("Close Review", () => setStep("lines"))}
          title="Review Order"
          right={linkBtn("Submit Order")}
        />
        <div className="studio-ipad-act-body">
          <LinesTable lines={lines} currency={currency} readOnly />
          <Totals lines={lines} currency={currency} />
          <div className="studio-ipad-ord-sign">
            <div>Your Signature</div>
            <div className="studio-ipad-ord-pad" />
            <span className="studio-ipad-act-link">Clear</span>
          </div>
          <Note>
            Nothing is submitted. The app asks for the disclaimer and a signature, then sends the
            order.
          </Note>
        </div>
      </Backdrop>
    );
  }

  return (
    <LineItems
      book={book}
      products={(bookId && order?.products[bookId]) || []}
      cut={!!bookId && !!order?.cut.includes(bookId)}
      lines={lines}
      setLines={setLines}
      currency={currency}
      onClose={onClose}
      onReview={() => setStep("review")}
    />
  );
}

function PricebookRow({
  book,
  on,
  onPick,
}: {
  book: OrderPricebook;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <div
      className={`studio-ipad-act-radio${on ? " on" : ""}`}
      onClick={onPick}
      role="radio"
      aria-checked={on}
    >
      <span>
        {book.name}
        {book.description && <small className="studio-ipad-ord-sub">{book.description}</small>}
      </span>
      {on && <span className="studio-ipad-act-tick" />}
    </div>
  );
}

function LineItems(p: {
  book: OrderPricebook | undefined;
  products: OrderProduct[];
  cut: boolean;
  lines: OrderLine[];
  setLines: (l: OrderLine[]) => void;
  currency: string;
  onClose: () => void;
  onReview: () => void;
}) {
  const { lines, setLines, currency } = p;
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const shown = p.products.filter((x) =>
    `${x.name} ${x.code ?? ""}`.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <Backdrop onClose={p.onClose} className="order">
      <NavBar
        plain
        left={linkBtn("Close", p.onClose)}
        title={p.book ? `Add Products to Quote · ${p.book.name}` : "Add Products to Quote"}
        right={
          <>
            {linkBtn("Save")}
            {linkBtn("Review", p.onReview, !lines.length)}
          </>
        }
      />
      <div className="studio-ipad-ord-bar">
        <div className="studio-ipad-act-search wide">
          <Magnifier />
          <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" className="studio-ipad-act-pill" onClick={() => setAdding((v) => !v)}>
          {adding ? "Continue" : "Add Manually"}
        </button>
      </div>
      <div className="studio-ipad-act-body">
        {adding ? (
          <>
            {shown.map((x) => (
              <div
                key={x.id}
                className="studio-ipad-ord-product"
                onClick={() => setLines(addLine(lines, x))}
              >
                <span>
                  <b>{x.name}</b>
                  {x.code && <small className="studio-ipad-ord-sub">{x.code}</small>}
                </span>
                <span>{money(x.unitPrice, currency)}</span>
              </div>
            ))}
            {!shown.length && <Note>No active products in this price book match.</Note>}
            {p.cut && (
              <Note>
                Not in the preview: this price book has more products than the first{" "}
                {p.products.length}.
              </Note>
            )}
          </>
        ) : (
          <>
            {lines.length ? (
              <LinesTable
                lines={lines}
                currency={currency}
                onQty={(id, n) => setLines(setQuantity(lines, id, n))}
                onDiscount={(id, d) =>
                  setLines(lines.map((l) => (l.product.id === id ? { ...l, discount: d } : l)))
                }
                onRemove={(id) => setLines(removeLine(lines, id))}
              />
            ) : (
              <div className="studio-ipad-ord-empty">
                <b>No products yet</b>
                <span>Tap Add Manually to pick products from the price book.</span>
              </div>
            )}
          </>
        )}
        <Totals lines={lines} currency={currency} />
        <Note>
          Not in the preview: the app prices lines with the org's pricing engine (expression sets
          and decision tables). Here a line is the price book price times quantity, less any
          discount typed on it. Nothing is saved.
        </Note>
      </div>
    </Backdrop>
  );
}

const DISCOUNT_LABEL: Record<DiscountType, string> = {
  percentage: "% off",
  amount: "Amount off",
  override: "Override price",
};

function LinesTable({
  lines,
  currency,
  readOnly,
  onQty,
  onDiscount,
  onRemove,
}: {
  lines: OrderLine[];
  currency: string;
  readOnly?: boolean;
  onQty?: (id: string, n: number) => void;
  onDiscount?: (id: string, d: Discount | undefined) => void;
  onRemove?: (id: string) => void;
}) {
  return (
    <>
      <table className="studio-ipad-ord-grid">
        <thead>
          <tr>
            <th>Product Name</th>
            <th>Unit Price</th>
            <th>Quantity</th>
            <th>Discount</th>
            <th>Total Price</th>
            {!readOnly && <th />}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const id = l.product.id;
            const bad = l.discount && !discountValid(l.discount, grossPrice(l));
            return (
              <tr key={id}>
                <td>{l.product.name}</td>
                <td>{money(l.product.unitPrice, currency)}</td>
                <td>
                  {readOnly ? (
                    l.quantity
                  ) : (
                    <input
                      type="number"
                      min={1}
                      className="studio-ipad-ord-qty"
                      value={l.quantity}
                      aria-label={`Quantity of ${l.product.name}`}
                      onChange={(e) => onQty?.(id, Number(e.target.value))}
                    />
                  )}
                </td>
                <td>
                  {readOnly ? (
                    l.discount ? (
                      `${l.discount.value}${l.discount.type === "percentage" ? "%" : ""}`
                    ) : (
                      ""
                    )
                  ) : (
                    <span className="studio-ipad-ord-disc">
                      <select
                        value={l.discount?.type ?? ""}
                        aria-label={`Discount type for ${l.product.name}`}
                        onChange={(e) =>
                          onDiscount?.(
                            id,
                            e.target.value
                              ? {
                                  type: e.target.value as DiscountType,
                                  value: l.discount?.value ?? 0,
                                }
                              : undefined
                          )
                        }
                      >
                        <option value="">None</option>
                        {(Object.keys(DISCOUNT_LABEL) as DiscountType[]).map((t) => (
                          <option key={t} value={t}>
                            {DISCOUNT_LABEL[t]}
                          </option>
                        ))}
                      </select>
                      {l.discount && (
                        <input
                          type="number"
                          min={0}
                          className={`studio-ipad-ord-qty${bad ? " bad" : ""}`}
                          value={l.discount.value}
                          aria-label={`Discount for ${l.product.name}`}
                          onChange={(e) =>
                            onDiscount?.(id, {
                              type: l.discount!.type,
                              value: Number(e.target.value),
                            })
                          }
                        />
                      )}
                    </span>
                  )}
                </td>
                <td>{money(netTotal(l), currency)}</td>
                {!readOnly && (
                  <td>
                    <button
                      type="button"
                      className="studio-ipad-act-link"
                      onClick={() => onRemove?.(id)}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="studio-ipad-ord-count">{selectedLabel(lines.length)}</div>
    </>
  );
}

function Totals({ lines, currency }: { lines: OrderLine[]; currency: string }) {
  const t = orderTotals(lines);
  return (
    <dl className="studio-ipad-ord-totals">
      <dt>Order Discount</dt>
      <dd>
        {money(t.discount, currency)} ({t.discountPercentage.toFixed(2)}%)
      </dd>
      <dt>Order Total</dt>
      <dd>{money(t.net, currency)}</dd>
    </dl>
  );
}
