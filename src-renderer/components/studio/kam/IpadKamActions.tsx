import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PublishedIpad } from "../published-types";
import type { KamObjective, KamPlan, PublishedKam } from "../screens/kam/kam-types";
import IpadActionSheet from "../IpadActionSheets";
import { Backdrop, NavBar, Note, linkBtn } from "../ipad-sheet-ui";
import {
  importSourcePlans,
  importStakeholderPlans,
  productOptions,
  statusOptions,
  type KebabItem,
  type ObjectiveFilter,
} from "./ipad-kam-logic";

/**
 * Sheets and menus on the Key Account Management plan page. Nothing here writes: forms are the object's published layout with Save inert,
 * and picks (import, template, filters) live in renderer state only.
 */

/** Where sheets draw: the iPad screen, like the other action sheets (they are positioned inside it). */
function useScreen(): [React.RefObject<HTMLSpanElement>, HTMLElement | null] {
  const ref = useRef<HTMLSpanElement>(null);
  const [screen, setScreen] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setScreen((ref.current?.closest(".studio-ipad-screen") as HTMLElement | null) ?? null);
  }, []);
  return [ref, screen];
}

export type KamSheet =
  | { kind: "form"; object: string; label: string }
  | { kind: "filter" }
  | { kind: "importObjectives" }
  | { kind: "importStakeholders" }
  | { kind: "addStakeholder" }
  | { kind: "info"; title: string; note: string };

/** The sheet host for one plan page component: renders at most one sheet into the iPad screen. */
export function KamSheets({
  sheet,
  onClose,
  snapshot,
  kam,
  plan,
  record,
  filter,
  onFilter,
  onSheet,
}: {
  sheet: KamSheet | null;
  onClose: () => void;
  snapshot: PublishedIpad;
  kam: PublishedKam;
  plan: KamPlan;
  record: { id: string; object: string; title: string };
  filter: ObjectiveFilter;
  onFilter: (f: ObjectiveFilter) => void;
  onSheet: (s: KamSheet) => void;
}) {
  const [ref, screen] = useScreen();
  let body: React.ReactNode = null;
  if (sheet?.kind === "form")
    body = (
      <IpadActionSheet
        presentation={{ kind: "create", object: sheet.object, label: sheet.label }}
        ctx={{ snapshot, record }}
        onClose={onClose}
      />
    );
  else if (sheet?.kind === "filter")
    body = (
      <FilterSheet
        objectives={plan.objectives}
        filter={filter}
        onFilter={onFilter}
        onClose={onClose}
      />
    );
  else if (sheet?.kind === "importObjectives")
    body = <ImportObjectivesSheet kam={kam} onClose={onClose} />;
  else if (sheet?.kind === "importStakeholders")
    body = <ImportStakeholdersSheet kam={kam} planId={record.id} onClose={onClose} />;
  else if (sheet?.kind === "addStakeholder")
    body = <AddFromSheet onClose={onClose} onSheet={onSheet} />;
  else if (sheet?.kind === "info")
    body = <InfoSheet title={sheet.title} note={sheet.note} onClose={onClose} />;
  return (
    <>
      <span ref={ref} hidden />
      {body && screen ? createPortal(body, screen) : null}
    </>
  );
}

function InfoSheet({ title, note, onClose }: { title: string; note: string; onClose: () => void }) {
  return (
    <Backdrop onClose={onClose} className="studio-ipad-kam-sheet small">
      <NavBar left={linkBtn("Cancel", onClose)} title={title} />
      <div className="studio-ipad-kam-sheet-body">
        <Note>Not in the preview: {note}</Note>
      </div>
    </Backdrop>
  );
}

/** A "..." or "Add" button with a popover menu. */
export function KamMenu({
  label,
  items,
  onPick,
  className = "",
}: {
  label: React.ReactNode;
  items: { id: string; title: string; destructive?: boolean }[];
  onPick: (id: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <span ref={box} className={`studio-ipad-kam-menu ${className}`} data-edit-through>
      <button
        type="button"
        className="studio-ipad-kam-menubtn"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <span className="studio-ipad-kam-pop" role="menu">
          {items.map((i) => (
            <button
              key={i.id}
              type="button"
              role="menuitem"
              className={i.destructive ? "destructive" : ""}
              onClick={() => {
                setOpen(false);
                onPick(i.id);
              }}
            >
              {i.title}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** The row kebab: items from `kebabItems`, indexed so picks map back. */
export function Kebab({ items, onPick }: { items: KebabItem[]; onPick: (i: KebabItem) => void }) {
  return (
    <KamMenu
      label={<span aria-label="More actions">•••</span>}
      className="kebab"
      items={items.map((i, n) => ({ id: String(n), title: i.title, destructive: i.destructive }))}
      onPick={(id) => onPick(items[Number(id)])}
    />
  );
}

/** ObjectiveAccordionHeaderView's Filter sheet: product filter (ObjectiveViewModel.productFilter). */
function FilterSheet({
  objectives,
  filter,
  onFilter,
  onClose,
}: {
  objectives: KamObjective[];
  filter: ObjectiveFilter;
  onFilter: (f: ObjectiveFilter) => void;
  onClose: () => void;
}) {
  const options = productOptions(objectives);
  const [picked, setPicked] = useState<string[]>(filter.products);
  const toggle = (n: string) =>
    setPicked(picked.includes(n) ? picked.filter((p) => p !== n) : [...picked, n]);
  return (
    <Backdrop onClose={onClose} className="studio-ipad-kam-sheet small">
      <NavBar
        left={linkBtn("Cancel", onClose)}
        title="Filter"
        right={linkBtn("Apply", () => {
          onFilter({ ...filter, products: picked });
          onClose();
        })}
      />
      <div className="studio-ipad-kam-sheet-body">
        {!options.length && (
          <div className="studio-ipad-kam-empty">No products on these objectives</div>
        )}
        {options.map((o) => (
          <label key={o.name} className="studio-ipad-kam-pick">
            <input
              type="checkbox"
              checked={picked.includes(o.name)}
              onChange={() => toggle(o.name)}
            />
            <span>{o.name}</span>
            <span className="count">{o.count}</span>
          </label>
        ))}
        {!!picked.length && (
          <div className="studio-ipad-kam-sheet-foot">{linkBtn("Clear", () => setPicked([]))}</div>
        )}
      </div>
    </Backdrop>
  );
}

/**
 * ImportFromTerritoryPlan sheet: "Select Territory Plan", a product filter, "Search…", a tree of objectives with checkboxes, "Review & Confirm".
 * The review step lists the picks; Confirm does nothing in Studio.
 */
function ImportObjectivesSheet({ kam, onClose }: { kam: PublishedKam; onClose: () => void }) {
  const plans = importSourcePlans(kam);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const plan = plans.find((p) => p.id === planId)?.plan;
  const t = search.trim().toLowerCase();
  const rows = (plan?.objectives ?? []).filter(
    (o) =>
      !t ||
      o.title.toLowerCase().includes(t) ||
      o.actionPlans.some((a) => a.title.toLowerCase().includes(t))
  );
  const chosen = (plan?.objectives ?? []).filter((o) => picked.includes(o.id));
  return (
    <Backdrop onClose={onClose} className="studio-ipad-kam-sheet">
      <NavBar
        left={review ? linkBtn("Previous", () => setReview(false)) : linkBtn("Cancel", onClose)}
        title={review ? "Review & Confirm" : "Import from Territory Business Plan"}
        right={
          review
            ? linkBtn("Confirm", onClose, !chosen.length)
            : linkBtn("Review & Confirm", () => setReview(true), !picked.length)
        }
      />
      <div className="studio-ipad-kam-sheet-body">
        {review ? (
          <>
            {chosen.map((o) => (
              <div key={o.id} className="studio-ipad-kam-pick static">
                <span>{o.title}</span>
                <span className="count">{o.actionPlans.length}</span>
              </div>
            ))}
            <Note>
              Not in the preview: Confirm copies the objectives into the plan. Studio never writes.
            </Note>
          </>
        ) : !plans.length ? (
          <Note>
            Not in the preview: no Territory Business Plans were read for this profile (it needs the
            Territory Business Plan table synced).
          </Note>
        ) : (
          <>
            <label className="studio-ipad-kam-field">
              <span>Select Territory Plan</span>
              <select
                value={planId}
                onChange={(e) => {
                  setPlanId(e.target.value);
                  setPicked([]);
                }}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.plan.name ?? p.id}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="studio-ipad-kam-search wide"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {rows.map((o) => (
              <label key={o.id} className="studio-ipad-kam-pick">
                <input
                  type="checkbox"
                  checked={picked.includes(o.id)}
                  onChange={() =>
                    setPicked(
                      picked.includes(o.id) ? picked.filter((p) => p !== o.id) : [...picked, o.id]
                    )
                  }
                />
                <span>{o.title}</span>
                <span className="count">{o.actionPlans.length}</span>
              </label>
            ))}
            {!rows.length && <div className="studio-ipad-kam-empty">No objectives</div>}
          </>
        )}
      </div>
    </Backdrop>
  );
}

/** AddStakeholderTypeViewController: "Add From" with three choices. */
function AddFromSheet({
  onClose,
  onSheet,
}: {
  onClose: () => void;
  onSheet: (s: KamSheet) => void;
}) {
  return (
    <Backdrop onClose={onClose} className="studio-ipad-kam-sheet small">
      <NavBar left={linkBtn("Cancel", onClose)} title="Add From" />
      <div className="studio-ipad-kam-sheet-body">
        <button
          type="button"
          className="studio-ipad-kam-pick static btn"
          onClick={() =>
            onSheet({ kind: "form", object: "AccountPlanStakeholder", label: "Add Stakeholder" })
          }
        >
          Accounts or Contacts
        </button>
        <button
          type="button"
          className="studio-ipad-kam-pick static btn"
          onClick={() => onSheet({ kind: "importStakeholders" })}
        >
          Import from Account Plans
        </button>
        <Note>
          Not in the preview: &ldquo;Accounts Aligned to Territory&rdquo; (the aligned-account
          search).
        </Note>
      </div>
    </Backdrop>
  );
}

function ImportStakeholdersSheet({
  kam,
  planId,
  onClose,
}: {
  kam: PublishedKam;
  planId: string;
  onClose: () => void;
}) {
  const plans = importStakeholderPlans(kam, planId);
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <Backdrop onClose={onClose} className="studio-ipad-kam-sheet">
      <NavBar
        left={linkBtn("Cancel", onClose)}
        title="Import from Account Plans"
        right={linkBtn("Import", onClose, !picked.length)}
      />
      <div className="studio-ipad-kam-sheet-body">
        {!plans.length && (
          <div className="studio-ipad-kam-empty">No other plans with stakeholders were read</div>
        )}
        {plans.flatMap((p) =>
          p.stakeholders.map((s) => (
            <label key={`${p.id}-${s.id}`} className="studio-ipad-kam-pick">
              <input
                type="checkbox"
                checked={picked.includes(s.id)}
                onChange={() =>
                  setPicked(
                    picked.includes(s.id) ? picked.filter((x) => x !== s.id) : [...picked, s.id]
                  )
                }
              />
              <span>{s.title}</span>
              <span className="count">{kam.plans[p.id]?.name}</span>
            </label>
          ))
        )}
      </div>
    </Backdrop>
  );
}

/**
 * KAMPromoPlanCoordinator: an 800x650 form sheet "Select Promo Plan Template" listing the PromoPlanTemplate plans (name, status), a search box,
 * then a confirmation "You are going to create {0} from {1}". Reached from the Account action createPromoPlan.
 */
export function PromoPlanSheet({
  kam,
  accountName,
  onClose,
}: {
  kam: PublishedKam | undefined;
  accountName: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const templates = (kam?.promoTemplates ?? []).filter((t) =>
    t.name.toLowerCase().includes(search.trim().toLowerCase())
  );
  const chosen = kam?.promoTemplates?.find((t) => t.id === pick);
  return (
    <Backdrop onClose={onClose} className="studio-ipad-kam-sheet promo">
      <NavBar left={linkBtn("Cancel", onClose)} title="Select Promo Plan Template" />
      <div className="studio-ipad-kam-sheet-body">
        <input
          className="studio-ipad-kam-search wide"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="studio-ipad-kam-pick head">
          <span>Name</span>
          <span className="count">Status</span>
        </div>
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            className="studio-ipad-kam-pick static btn"
            onClick={() => setPick(t.id)}
          >
            <span>{t.name}</span>
            <span className="count">{t.status ?? ""}</span>
          </button>
        ))}
        {!templates.length && (
          <div className="studio-ipad-kam-empty">
            {kam?.promoTemplates ? "No templates match" : "No promo plan templates were read"}
          </div>
        )}
        <Note>
          Not in the preview: the app only lists templates whose cluster attributes match the
          account&rsquo;s.
        </Note>
      </div>
      {chosen && (
        <div className="studio-ipad-kam-alert" role="alertdialog">
          <div className="studio-ipad-kam-alert-box">
            <div className="t">Confirmation</div>
            <div>
              You are going to create {accountName} promo plan from {chosen.name}
            </div>
            <div className="b">
              {linkBtn("Cancel", () => setPick(null))}
              {linkBtn("OK", onClose)}
            </div>
          </div>
        </div>
      )}
    </Backdrop>
  );
}

/** The status selector: "Status All" with a dropdown of counts (ObjectiveViewModel.availableStatusOptions). */
export function StatusMenu({
  title,
  options,
  selected,
  onPick,
}: {
  title: string;
  options: ReturnType<typeof statusOptions>;
  selected: string;
  onPick: (id: string) => void;
}) {
  return (
    <KamMenu
      label={`${title} ▾`}
      items={options.map((o) => ({
        id: o.id,
        title: `${o.label} (${o.count})${o.id === selected ? " ✓" : ""}`,
      }))}
      onPick={onPick}
    />
  );
}
