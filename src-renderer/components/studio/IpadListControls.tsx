import React, { useState } from "react";
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
export function CardList({ rows, onOpen, links = [] }: { rows: { id: string; cells: (string | null)[] }[]; onOpen: (id: string) => void; /** Per column: a lookup or formula value, drawn in the link color (DataTableCardCell). */ links?: boolean[] }) {
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
          </button>
        );
      })}
    </div>
  );
}
