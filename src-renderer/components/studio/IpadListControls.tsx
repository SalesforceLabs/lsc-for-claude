import React, { useState } from "react";
import type { PublishedComponent, PublishedIpad } from "./published-types";
import type { PublishedFabItem } from "./screens/fabs-types";
import "./list-controls.css";

/** Card mode is remembered per sObject (SharedUserSettings.cardModePreference); the preview keeps it for the session. */
const CARD_MODE = new Map<string, boolean>();
export const cardModeFor = (sObject: string): boolean => CARD_MODE.get(sObject) ?? false;
export const saveCardMode = (sObject: string, on: boolean): void => void CARD_MODE.set(sObject, on);

export interface SortState {
  column: number;
  ascending: boolean;
}

/** AllSObjectsViewController.setupViewModeButton: SF Symbols tablecells in card mode, list.bullet.rectangle in table mode, 22pt accent. */
export function ViewModeButton({ cards, onToggle }: { cards: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="studio-ipad-lv-toggle" title={cards ? "Switch to list view" : "Switch to card view"} aria-label={cards ? "Switch to list view" : "Switch to card view"} onClick={onToggle}>
      {cards ? (
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <rect x="2" y="3.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2 9h18M2 13.5h18M8 3.5v15M14 3.5v15" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ) : (
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <rect x="2" y="3.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.5 8h1.4M5.5 11h1.4M5.5 14h1.4M9 8h8M9 11h8M9 14h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

/** The sort button (card mode only) and its APDropDown: the first five columns, a checkmark and arrow on the sorted one; tapping it again flips the direction. */
export function SortButton({ columns, sort, onSort }: { columns: string[]; sort: SortState; onSort: (s: SortState) => void }) {
  const [open, setOpen] = useState(false);
  const arrow = (up: boolean) => (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d={up ? "M7 12V2M3 6l4-4 4 4" : "M7 2v10M3 8l4 4 4-4"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <span className="studio-ipad-lv-sortwrap">
      <button type="button" className="studio-ipad-lv-sort" onClick={() => setOpen(!open)}>
        Sort by: {columns[sort.column] ?? ""}
        {arrow(sort.ascending)}
      </button>
      {open && (
        <>
          <div className="studio-ipad-lv-sort-scrim" onClick={() => setOpen(false)} />
          <ul className="studio-ipad-lv-sort-menu" role="listbox">
            {columns.slice(0, 5).map((c, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="studio-ipad-lv-sort-item"
                  onClick={() => {
                    onSort({ column: i, ascending: i === sort.column ? !sort.ascending : true });
                    setOpen(false);
                  }}
                >
                  <span className="check">{i === sort.column ? "✓" : ""}</span>
                  <span className="label">{c}</span>
                  {i === sort.column && arrow(sort.ascending)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </span>
  );
}

/** Rows ordered by one column (numbers as numbers, text by locale); null leaves the loaded order. */
export function sortRows<T extends { cells: (string | null)[] }>(rows: T[], sort: SortState | null): T[] {
  if (!sort) return rows;
  const dir = sort.ascending ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a.cells[sort.column] ?? "";
    const y = b.cells[sort.column] ?? "";
    const nx = Number(x.replace(/,/g, ""));
    const ny = Number(y.replace(/,/g, ""));
    if (x !== "" && y !== "" && Number.isFinite(nx) && Number.isFinite(ny)) return (nx - ny) * dir;
    return x.localeCompare(y) * dir;
  });
}

/** DataTableCardCell: the first field in title bold, the second in body, then fields three to five on one line with bullets; "--" for a blank. Row actions are not read by Studio. */
export function CardList({ rows, onOpen, links = [], actions = [], onAction }: { rows: { id: string; cells: (string | null)[] }[]; onOpen: (id: string) => void; /** Per column: a lookup or formula value, drawn in the link color (DataTableCardCell). */ links?: boolean[]; /** The row's action titles (QuickActionsAvailabilityPolicy-filtered): up to three pills, then a ••• menu. */ actions?: PublishedFabItem[]; /** A tapped pill or menu entry: the same sheet a Home menu item opens. */ onAction?: (item: PublishedFabItem) => void }) {
  const [menu, setMenu] = useState<string | null>(null);
  return (
    <div className="studio-ipad-lv-cards">
      {rows.map((r) => {
        const v = (i: number) => (r.cells[i] ? r.cells[i]! : "--");
        const rest = [2, 3, 4].filter((i) => i < r.cells.length);
        return (
          <button key={r.id} type="button" className="studio-ipad-lv-card" onClick={() => onOpen(r.id)}>
            <div className="fields">
              <span className={`f1${links[0] && r.cells[0] ? " link" : ""}`}>{v(0)}</span>
              {r.cells.length > 1 && <span className={`f2${links[1] && r.cells[1] ? " link" : ""}`}>{v(1)}</span>}
              {rest.length > 0 && (
                <span className="f3">
                  {rest.map((i, n) => (
                    <React.Fragment key={i}>
                      {n > 0 && <span className="dot">•</span>}
                      <span className={`${n === 0 ? "bold" : ""}${links[i] && r.cells[i] ? " link" : ""}`.trim() || undefined}>{v(i)}</span>
                    </React.Fragment>
                  ))}
                </span>
              )}
            </div>
            {actions.length > 0 && (
              <span className="actions">
                {actions.slice(0, 3).map((a) => (
                  <span key={a.name} role="button" tabIndex={0} className="pill" onClick={(e) => { e.stopPropagation(); onAction?.(a); }}>{a.label}</span>
                ))}
                {actions.length > 3 && (
                  <span className="morewrap">
                    <span role="button" tabIndex={0} className="more" aria-label="More actions" onClick={(e) => { e.stopPropagation(); setMenu(menu === r.id ? null : r.id); }}>
                      <svg width="14" height="4" viewBox="0 0 14 4" aria-hidden="true"><circle cx="2" cy="2" r="1.6" fill="currentColor" /><circle cx="7" cy="2" r="1.6" fill="currentColor" /><circle cx="12" cy="2" r="1.6" fill="currentColor" /></svg>
                    </span>
                    {menu === r.id && (
                      <span className="menu" role="menu">
                        {actions.slice(3).map((a) => (
                          <span key={a.name} role="menuitem" tabIndex={0} className="item" onClick={(e) => { e.stopPropagation(); setMenu(null); onAction?.(a); }}>{a.label}</span>
                        ))}
                      </span>
                    )}
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const BLOCKLIST = new Set(["AttendeeCall", "Order2", "CreateOrder", "CreateOrder2", "ViewProfile", "Edit"]);
const SUPPORTED = new Set(["Email", "MIRF", "LogACall", "LastCall", "NBC", "SignInNavigator", "SignInSheet", "Survey", "CLM", "ShareContent", "Delete", "CreateAccountWithSBC", "GenerateDocument", "SearchClinicalTrial", "SearchPubMed", "CaptureInsight", "ViewSignature", "EditActiveOpt", "ViewOnline"]);

/** The action pills a list card shows: the record page's actions (SFFlexiPageViewModel.makeActions) kept by QuickActionsAvailabilityPolicy (supported names or Flow/VF items, minus the blocklist), titled by the layout item's label or the readable action name. */
export function rowActions(snapshot: PublishedIpad, objectName: string): PublishedFabItem[] {
  const object = snapshot.objects[objectName];
  const rt = object?.recordTypes[0];
  const page = rt?.flexiPage ? snapshot.pages[rt.flexiPage] : undefined;
  const layout = rt?.layout ? snapshot.layouts[rt.layout] : undefined;
  const names: string[] = [];
  const walk = (c: PublishedComponent) => {
    if (c.actions && !names.length) names.push(...c.actions);
    c.tabs?.forEach((t) => t.components.forEach(walk));
  };
  page?.regions.forEach((r) => r.components.forEach(walk));
  if (!names.length && layout) names.push(...layout.actions);
  const out: PublishedFabItem[] = [];
  for (const full of names) {
    const base = full.split(".").pop()!.replace(/^[a-z0-9]+__/i, "");
    if (BLOCKLIST.has(base)) continue;
    const item = layout?.actionItems?.find((i) => i.name === full);
    if (!(SUPPORTED.has(base) || item?.type === "Flow" || item?.type === "VisualforcePage")) continue;
    out.push({ name: base, label: item?.label || base.replace(/([a-z])([A-Z])/g, "$1 $2") });
  }
  return out;
}
