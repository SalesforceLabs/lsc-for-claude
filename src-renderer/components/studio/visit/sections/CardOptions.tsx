import { useMemo, type ReactNode } from "react";
import { useVisit } from "../draft";
import { attendeeGroups, defaultQuantity, detailOptions, productsFor, type Section } from "./logic";
import { addRow, toggleRow } from "./rows";
import type { VisitSections } from "./types";

const CLM_ITEMS = 5;

interface Option {
  id: string;
  label: string;
  sub?: string;
  on: boolean;
  toggle: () => void;
}
interface Group {
  key: string;
  caption?: string;
  options: Option[];
}

/** One option: a toggle button; tapping adds or removes the visit's child row (the row draws in the form). */
function OptionButton({ o }: { o: Option }) {
  return (
    <button
      type="button"
      className={`studio-ipad-vs-opt${o.on ? " on" : ""}`}
      aria-pressed={o.on}
      onClick={o.toggle}
    >
      <span className="studio-ipad-vs-optmark">{o.on ? "✓" : "+"}</span>
      <span className="studio-ipad-vs-optl">
        {o.label}
        {o.sub && <span className="studio-ipad-vs-sub">{o.sub}</span>}
      </span>
    </button>
  );
}

/** An expanded sidebar card: the things you can add, grouped, then the card's footer. */
export function CardOptions({
  section,
  data,
  accountId,
}: {
  section: Section;
  data: VisitSections;
  accountId: string | undefined;
}) {
  const { draft, update, snapshot } = useVisit();
  const rows = draft.rows;
  const groups = useMemo<Group[]>(() => {
    const productName = (id: string) => data.products.find((p) => p.id === id)?.name ?? id;
    const byProduct = (object: string, kind: "detail" | "dtp" | "item", qty?: string): Option[] =>
      productsFor(kind, data.products).map((p) => ({
        id: p.id,
        label: p.name,
        on: (rows[object] ?? []).some((r) => r.values.ProductId === p.id),
        toggle: () =>
          update((d) => ({
            rows: toggleRow(d.rows, object, "ProductId", p.id, {
              ...(qty ? { [qty]: defaultQuantity(p) } : {}),
              ...(kind === "detail" ? { Priority: String((d.rows[object]?.length ?? 0) + 1) } : {}),
            }),
          })),
      }));
    switch (section.id) {
      case "clm": {
        const cards = snapshot.screens?.content?.cards ?? [];
        const have = new Set((rows.PresentationForum ?? []).map((r) => r.values.ForumReferenceId));
        const sorted = [
          ...cards.filter((c) => have.has(c.id)),
          ...cards.filter((c) => !have.has(c.id)),
        ];
        return [
          {
            key: "all",
            options: sorted.slice(0, CLM_ITEMS).map((c) => ({
              id: c.id,
              label: c.name,
              on: have.has(c.id),
              toggle: () =>
                update((d) => ({
                  rows: toggleRow(d.rows, "PresentationForum", "ForumReferenceId", c.id, {
                    Name: c.name,
                  }),
                })),
            })),
          },
        ];
      }
      case "details": {
        const recent = new Set(
          Object.values(data.children).flatMap((c) =>
            (c.ProviderVisitProdDetailing ?? []).map((r) => r.values.ProductId)
          )
        );
        const all = byProduct("ProviderVisitProdDetailing", "detail");
        if (!data.settings.showRecentSidebar) return [{ key: "all", options: all }];
        const recentOpts = detailOptions(productsFor("detail", data.products), data.settings, [
          ...recent,
        ]).map((p) => p.id);
        const isRecent = new Set(recentOpts.filter((id) => recent.has(id)));
        return [
          { key: "recent", caption: "Recent", options: all.filter((o) => isRecent.has(o.id)) },
          { key: "other", caption: "Not recent", options: all.filter((o) => !isRecent.has(o.id)) },
        ];
      }
      case "samples":
        return [
          {
            key: "all",
            options: data.inventory.items.map((i) => {
              const product = data.products.find((p) => p.id === i.productId);
              return {
                id: i.id,
                label: productName(i.productId),
                on: (rows.ProductDisbursement ?? []).some((r) => r.values.ProductItemId === i.id),
                toggle: () =>
                  update((d) => ({
                    rows: toggleRow(d.rows, "ProductDisbursement", "ProductItemId", i.id, {
                      ProductId: i.productId,
                      QuantityDisbursed: defaultQuantity(product),
                    }),
                  })),
              };
            }),
          },
        ];
      case "dtp":
        return [
          { key: "all", options: byProduct("ProviderVisitRqstSample", "dtp", "RequestedQuantity") },
        ];
      case "items":
        return [
          { key: "all", options: byProduct("ProviderVisitMarketingItem", "item", "Quantity") },
        ];
      case "attendees": {
        const have = new Set((rows.Visit ?? []).map((r) => r.values.AccountId));
        const mk = (id: string, name: string): Option => ({
          id,
          label: name,
          on: have.has(id),
          toggle: () =>
            update((d) => ({
              rows: toggleRow(d.rows, "Visit", "AccountId", id, { AccountName: name }),
            })),
        });
        // Selected attendees stay listed so they can be taken off again.
        const selected = (rows.Visit ?? []).map((r) =>
          mk(
            r.values.AccountId,
            r.values.AccountName ||
              data.attendeePool.find((a) => a.id === r.values.AccountId)?.name ||
              "Attendee"
          )
        );
        const groups = attendeeGroups(data.attendeePool, accountId, [...have]).map((g) => ({
          key: g.key,
          caption: g.title,
          options: g.accounts.map((a) => mk(a.id, a.name)),
        }));
        return [...(selected.length ? [{ key: "selected", options: selected }] : []), ...groups];
      }
      default:
        return [];
    }
  }, [section.id, data, rows, snapshot, accountId, update]);

  let footer: ReactNode = null;
  if (section.id === "clm")
    footer = (
      <button
        type="button"
        className="studio-ipad-vs-btn"
        disabled
        title="Opens the Content Library on the iPad"
      >
        Go to Content Library
      </button>
    );
  if (section.id === "attendees")
    footer = (
      <div className="studio-ipad-vs-sub">Search All Accounts is only available on the iPad.</div>
    );
  if (section.id === "custom")
    footer = (
      <button
        type="button"
        className="studio-ipad-vs-btn"
        onClick={() =>
          update((d) => ({ rows: addRow(d.rows, section.object, { Name: section.title }) }))
        }
      >
        Add
      </button>
    );

  const empty = groups.every((g) => g.options.length === 0);
  return (
    <div className="studio-ipad-vs-opts">
      {section.id === "samples" && data.settings.validateSampleLimits && (
        <button
          type="button"
          className="studio-ipad-vs-btn"
          disabled
          title="Sample limits are checked on the iPad"
        >
          Sample Limits
        </button>
      )}
      {empty && section.id !== "custom" && (
        <div className="studio-ipad-vs-empty">No items found</div>
      )}
      {groups
        .filter((g) => g.options.length)
        .map((g) => (
          <div key={g.key}>
            {g.caption && <div className="studio-ipad-vs-group">{g.caption}</div>}
            {g.options.map((o) => (
              <OptionButton key={o.id} o={o} />
            ))}
          </div>
        ))}
      {footer && <div className="studio-ipad-vs-foot">{footer}</div>}
    </div>
  );
}
