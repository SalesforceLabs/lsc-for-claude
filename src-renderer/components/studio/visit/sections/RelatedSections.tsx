import { useEffect, useState } from "react";
import { useVisit } from "../draft";
import { Alert } from "../structure/parts";
import {
  REMOVE_ATTENDEE_TITLE,
  detailBadges,
  detailSubtitle,
  lotOptions,
  removeAttendeeMessage,
  type Section,
} from "./logic";
import { addRow, removeRow, seedRows, setValue } from "./rows";
import { useVisitSections } from "./useSections";
import type { SectionProduct, VisitSections } from "./types";
import "./sections.css";

/** The open sidebar card's content, drawn in the form under Visit Information. Edits stay in memory (draft.rows); nothing is written. */
export function RelatedSections({ organisation }: { organisation?: boolean }) {
  const { draft, update, editId } = useVisit();
  const { data, sections, accountId } = useVisitSections(organisation);

  // An edited visit opens with the rows the org has for it.
  useEffect(() => {
    if (draft.rowsSeeded || !editId) return;
    update((d) =>
      d.rowsSeeded ? {} : { rowsSeeded: true, rows: { ...seedRows(data, editId), ...d.rows } }
    );
  }, [data, draft.rowsSeeded, editId, update]);

  return <Sections sections={sections} data={data} accountId={accountId} />;
}

/** Every related section of the visit that has rows, in the sidebar's order: collapsible, titled like its card. */
function Sections({
  sections,
  data,
  accountId,
}: {
  sections: Section[];
  data: VisitSections;
  accountId: string | undefined;
}) {
  const { draft } = useVisit();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  return (
    <>
      {sections
        .filter((s) => (draft.rows[s.object]?.length ?? 0) > 0)
        .map((s) => {
          // Details draws its rows with no section header (canShowChrome: false).
          if (s.id === "details")
            return (
              <div key={s.key} className="studio-ipad-vs-sec">
                <SectionBody section={s} data={data} accountId={accountId} />
              </div>
            );
          const shut = closed.has(s.key);
          return (
            <div key={s.key} className="studio-ipad-vs-sec">
              <div className="studio-ipad-vs-head">
                <button
                  type="button"
                  className="studio-ipad-vs-collapse"
                  aria-expanded={!shut}
                  onClick={() =>
                    setClosed((c) => {
                      const n = new Set(c);
                      if (!n.delete(s.key)) n.add(s.key);
                      return n;
                    })
                  }
                >
                  <span className={`studio-ipad-vs-chev${shut ? "" : " down"}`}>›</span>
                  {s.title}
                </button>
              </div>
              {!shut && <SectionBody section={s} data={data} accountId={accountId} />}
            </div>
          );
        })}
    </>
  );
}

const productName = (products: SectionProduct[], id: string) =>
  products.find((p) => p.id === id)?.name || id;

function SectionBody({
  section,
  data,
  accountId,
}: {
  section: Section;
  data: VisitSections;
  accountId: string | undefined;
}) {
  switch (section.id) {
    case "clm":
      return <Clm />;
    case "details":
      return <Details data={data} />;
    case "samples":
      return <Samples data={data} />;
    case "dtp":
      return (
        <ProductRows
          data={data}
          object="ProviderVisitRqstSample"
          kind="dtp"
          qtyField="RequestedQuantity"
        />
      );
    case "items":
      return (
        <ProductRows
          data={data}
          object="ProviderVisitMarketingItem"
          kind="item"
          qtyField="Quantity"
        />
      );
    case "attendees":
      return <Attendees data={data} />;
    default:
      return <Generic object={section.object} label={section.title} />;
  }
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="studio-ipad-vs-btn danger"
      aria-label={label}
      onClick={onClick}
    >
      Delete
    </button>
  );
}

// ── CLM ──

function Clm() {
  const { draft, update } = useVisit();
  return (
    <>
      {(draft.rows.PresentationForum ?? []).map((r) => (
        <div key={r.id} className="studio-ipad-vs-row">
          <span className="studio-ipad-vs-title">
            <b>{r.values.Name || r.values.ForumReferenceId}</b>
          </span>
          <RemoveButton
            label="Remove content"
            onClick={() => update((d) => ({ rows: removeRow(d.rows, "PresentationForum", r.id) }))}
          />
        </div>
      ))}
    </>
  );
}

// ── Details, Messages, Discussions ──

function Details({ data }: { data: VisitSections }) {
  const { draft, update, snapshot } = useVisit();
  const rows = draft.rows.ProviderVisitProdDetailing ?? [];
  const messages = draft.rows.ProviderVisitDtlProductMsg ?? [];
  const discussions = draft.rows.ProviderVisitProdDiscussion ?? [];
  const recordTypes = snapshot.objects.ProviderVisitProdDiscussion?.recordTypes ?? [];
  const objectives = data.settings.nextVisitObjectives !== "None";
  return (
    <>
      {rows.map((r, i) => {
        const p = data.products.find((x) => x.id === r.values.ProductId);
        const mine = messages.filter((m) => m.values.ProviderVisitProductDtlId === r.id);
        const taken = new Set(mine.map((m) => m.values.MessageRecordId));
        const msgOptions = data.messages
          .filter((m) => m.productId === r.values.ProductId && !taken.has(m.id))
          .map((m) => ({ id: m.id, label: m.text.slice(0, 80) }));
        return (
          <div key={r.id}>
            <div className="studio-ipad-vs-row">
              <span className="studio-ipad-vs-title">
                <b>{p?.name ?? r.values.ProductId}</b>
                {detailSubtitle(p) && (
                  <span className="studio-ipad-vs-sub">{detailSubtitle(p)}</span>
                )}
              </span>
              {detailBadges(r.values, i, data.settings).map((b) => (
                <span
                  key={b.text}
                  className={`studio-ipad-vs-badge${b.tone === "warn" ? " warn" : ""}`}
                >
                  {b.text}
                </span>
              ))}
              {data.settings.discussOffLabelProducts && (
                <label className="studio-ipad-vs-sub">
                  <input
                    type="checkbox"
                    checked={r.values.IsOffLabel === "true"}
                    onChange={(e) =>
                      update((d) => ({
                        rows: setValue(
                          d.rows,
                          "ProviderVisitProdDetailing",
                          r.id,
                          "IsOffLabel",
                          String(e.target.checked)
                        ),
                      }))
                    }
                  />{" "}
                  Off Label
                </label>
              )}
              <AddPicker
                prompt="Add Discussion"
                options={recordTypes.map((t) => ({ id: t.name, label: t.label }))}
                onAdd={(rt) =>
                  update((d) => ({
                    rows: addRow(d.rows, "ProviderVisitProdDiscussion", {
                      RecordTypeName: recordTypes.find((t) => t.name === rt)?.label ?? rt,
                      ProviderVisitProductDtlId: r.id,
                    }),
                  }))
                }
              />
              <AddPicker
                prompt="Add Message"
                options={msgOptions}
                onAdd={(id) =>
                  update((d) => ({
                    rows: addRow(d.rows, "ProviderVisitDtlProductMsg", {
                      MessageRecordId: id,
                      ProviderVisitProductDtlId: r.id,
                    }),
                  }))
                }
              />
              <RemoveButton
                label={`Remove ${p?.name ?? "product"}`}
                onClick={() =>
                  update((d) => ({ rows: removeRow(d.rows, "ProviderVisitProdDetailing", r.id) }))
                }
              />
            </div>
            {mine.map((m) => (
              <div key={m.id} className="studio-ipad-vs-row child">
                <span className="studio-ipad-vs-title">
                  {data.messages.find((x) => x.id === m.values.MessageRecordId)?.text ??
                    m.values.MessageRecordId}
                </span>
                <RemoveButton
                  label="Remove message"
                  onClick={() =>
                    update((d) => ({ rows: removeRow(d.rows, "ProviderVisitDtlProductMsg", m.id) }))
                  }
                />
              </div>
            ))}
            {discussions
              .filter((x) => x.values.ProviderVisitProductDtlId === r.id)
              .map((x) => (
                <div key={x.id} className="studio-ipad-vs-row child">
                  <span className="studio-ipad-vs-title">
                    {x.values.RecordTypeName || x.values.RecordTypeId}
                  </span>
                  <RemoveButton
                    label="Remove discussion"
                    onClick={() =>
                      update((d) => ({
                        rows: removeRow(d.rows, "ProviderVisitProdDiscussion", x.id),
                      }))
                    }
                  />
                </div>
              ))}
            {objectives && (
              <div className="studio-ipad-vs-row child">
                <input
                  className="studio-ipad-vs-input wide"
                  placeholder="Next visit objective"
                  value={r.values.NextPrvdVisitObjectives ?? ""}
                  onChange={(e) =>
                    update((d) => ({
                      rows: setValue(
                        d.rows,
                        "ProviderVisitProdDetailing",
                        r.id,
                        "NextPrvdVisitObjectives",
                        e.target.value
                      ),
                    }))
                  }
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** A small picker for the things nested under a Details row (messages, discussions). */
function AddPicker({
  prompt,
  options,
  onAdd,
}: {
  prompt: string;
  options: { id: string; label: string }[];
  onAdd: (id: string) => void;
}) {
  return (
    <select
      className="studio-ipad-vs-select"
      value=""
      disabled={options.length === 0}
      aria-label={prompt}
      onChange={(e) => e.target.value && onAdd(e.target.value)}
    >
      <option value="">{prompt}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ── Samples, DTP, Items ──

function Samples({ data }: { data: VisitSections }) {
  const { draft, update } = useVisit();
  const rows = draft.rows.ProductDisbursement ?? [];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      {rows.map((r) => {
        const item = data.inventory.items.find((i) => i.id === r.values.ProductItemId);
        const lots = lotOptions(
          r.values.ProductItemId,
          data.inventory.batches,
          data.settings,
          today
        );
        return (
          <div key={r.id} className="studio-ipad-vs-row">
            <span className="studio-ipad-vs-title">
              <b>{productName(data.products, item?.productId ?? r.values.ProductId ?? "")}</b>
            </span>
            <select
              className="studio-ipad-vs-select"
              aria-label="Lot"
              value={r.values.ProductionBatchId ?? ""}
              onChange={(e) =>
                update((d) => ({
                  rows: setValue(
                    d.rows,
                    "ProductDisbursement",
                    r.id,
                    "ProductionBatchId",
                    e.target.value
                  ),
                }))
              }
            >
              {lots.map((l) => (
                <option key={l.id} value={l.batchId ?? l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <QtyInput
              object="ProductDisbursement"
              id={r.id}
              field="QuantityDisbursed"
              value={r.values.QuantityDisbursed}
            />
            <RemoveButton
              label="Remove sample"
              onClick={() =>
                update((d) => ({ rows: removeRow(d.rows, "ProductDisbursement", r.id) }))
              }
            />
          </div>
        );
      })}
    </>
  );
}

function QtyInput({
  object,
  id,
  field,
  value,
}: {
  object: string;
  id: string;
  field: string;
  value?: string;
}) {
  const { update } = useVisit();
  return (
    <input
      className="studio-ipad-vs-input qty"
      inputMode="numeric"
      aria-label="Quantity"
      value={value ?? ""}
      onChange={(e) =>
        update((d) => ({
          rows: setValue(d.rows, object, id, field, e.target.value.replace(/[^0-9]/g, "")),
        }))
      }
    />
  );
}

function ProductRows({
  data,
  object,
  kind,
  qtyField,
}: {
  data: VisitSections;
  object: string;
  kind: "dtp" | "item";
  qtyField: string;
}) {
  const { draft, update } = useVisit();
  const rows = draft.rows[object] ?? [];
  const place = draft.values.PlaceId || undefined;
  return (
    <>
      {kind === "dtp" && place && <div className="studio-ipad-vs-sub">Ship to {place}</div>}
      {rows.map((r) => (
        <div key={r.id} className="studio-ipad-vs-row">
          <span className="studio-ipad-vs-title">
            <b>{productName(data.products, r.values.ProductId)}</b>
          </span>
          <QtyInput object={object} id={r.id} field={qtyField} value={r.values[qtyField]} />
          <RemoveButton
            label="Remove"
            onClick={() => update((d) => ({ rows: removeRow(d.rows, object, r.id) }))}
          />
        </div>
      ))}
    </>
  );
}

// ── Attendees ──

function Attendees({ data }: { data: VisitSections }) {
  const { draft, update, openAttendee } = useVisit();
  const rows = draft.rows.Visit ?? [];
  const [confirm, setConfirm] = useState<string | undefined>();
  const [menu, setMenu] = useState<string | undefined>();
  const pending = rows.find((r) => r.id === confirm);
  return (
    <>
      {rows.map((r) => {
        const name =
          r.values.AccountName ||
          data.attendeePool.find((a) => a.id === r.values.AccountId)?.name ||
          "Attendee";
        return (
          <div key={r.id} className="studio-ipad-vs-row">
            <span className="studio-ipad-vs-title">
              <b>{name}</b>
            </span>
            <button
              type="button"
              className="studio-ipad-vs-btn"
              disabled={!openAttendee}
              onClick={() => openAttendee?.(r.id)}
            >
              Attendee Visit
            </button>
            <span className="studio-ipad-vs-menuwrap">
              <button
                type="button"
                className="studio-ipad-vs-btn"
                aria-label={`More for ${name}`}
                aria-haspopup="menu"
                aria-expanded={menu === r.id}
                onClick={() => setMenu(menu === r.id ? undefined : r.id)}
              >
                …
              </button>
              {menu === r.id && (
                <span className="studio-ipad-vs-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(undefined);
                      setConfirm(r.id);
                    }}
                  >
                    Remove
                  </button>
                </span>
              )}
            </span>
          </div>
        );
      })}
      {pending && (
        <Alert
          title={REMOVE_ATTENDEE_TITLE}
          message={removeAttendeeMessage(pending.values.AccountName || "this attendee")}
          actions={[
            { label: "Cancel", onClick: () => setConfirm(undefined) },
            {
              label: "Remove",
              strong: true,
              onClick: () => {
                update((d) => ({ rows: removeRow(d.rows, "Visit", pending.id) }));
                setConfirm(undefined);
              },
            },
          ]}
          row
        />
      )}
    </>
  );
}

// ── Compliance Activity and custom related lists ──

function Generic({ object, label }: { object: string; label: string }) {
  const { draft, update } = useVisit();
  const rows = draft.rows[object] ?? [];
  return (
    <>
      {rows.map((r) => (
        <div key={r.id} className="studio-ipad-vs-row">
          <span className="studio-ipad-vs-title">{r.values.Name || r.values.Subject || label}</span>
          <RemoveButton
            label="Remove"
            onClick={() => update((d) => ({ rows: removeRow(d.rows, object, r.id) }))}
          />
        </div>
      ))}
    </>
  );
}
