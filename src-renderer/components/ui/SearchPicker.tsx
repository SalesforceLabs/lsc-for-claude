import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, type LucideIcon } from "lucide-react";
import StateView from "./StateView";

export interface PickerOption {
  value: string;
  label: string;
  /** Secondary text after the label, e.g. an API name and type. */
  detail?: string;
}

interface SearchPickerProps {
  title: string;
  /** Small caps line above the title. */
  eyebrow?: string;
  description?: React.ReactNode;
  options: PickerOption[];
  /** Placeholder for the search field. */
  placeholder?: string;
  /** Shown when there's nothing to pick at all. */
  emptyTitle: string;
  emptyDetail?: React.ReactNode;
  emptyIcon?: LucideIcon;
  onPick: (value: string) => void;
  onCancel: () => void;
  /** For options that come from a server search: told on every keystroke so the parent can re-query and pass new options. */
  onQueryChange?: (q: string) => void;
  /** A server search is running; shown beside the count. */
  searching?: boolean;
  /** The server search failed. */
  error?: string;
}

/** A dialog that picks one of many: a search field over a list, filtered by label and detail as you type. */
export default function SearchPicker({
  title,
  eyebrow,
  description,
  options,
  placeholder = "Search",
  emptyTitle,
  emptyDetail,
  emptyIcon,
  onPick,
  onCancel,
  onQueryChange,
  searching,
  error,
}: SearchPickerProps) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return options.filter((o) => words.every((w) => `${o.label} ${o.detail ?? ""} ${o.value}`.toLowerCase().includes(w)));
  }, [options, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(shown.length - 1, i + step)));
    } else if (e.key === "Enter" && shown[active]) {
      e.preventDefault();
      onPick(shown[active].value);
    }
  };

  return (
    <div className="studio-modal-backdrop" onClick={onCancel}>
      <div className="studio-modal ui-picker" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="studio-modal-header">
          <span className="studio-inspector-eyebrow">{eyebrow}</span>
          <button type="button" className="ui-icon-btn" onClick={onCancel} title="Close" aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </div>
        <h2 className="studio-inspector-title">{title}</h2>
        {description && <p className="studio-inspector-desc">{description}</p>}
        {options.length === 0 && !onQueryChange && !searching ? (
          <StateView kind="empty" layout="inline" icon={emptyIcon} title={emptyTitle} detail={emptyDetail} className="studio-modal-state" />
        ) : (
          <>
            <label className="ui-picker-search">
              <Search size={14} aria-hidden />
              <input
                className="studio-input"
                type="search"
                autoFocus
                value={q}
                placeholder={placeholder}
                aria-label={placeholder}
                aria-controls="ui-picker-list"
                onChange={(e) => {
                  setQ(e.target.value);
                  onQueryChange?.(e.target.value);
                }}
                onKeyDown={onKeyDown}
              />
            </label>
            {error && <StateView kind="error" layout="inline" title="Couldn't search" detail={error} className="studio-modal-state" />}
            {!error && shown.length === 0 && searching && <StateView kind="loading" layout="inline" title="Searching…" className="studio-modal-state" />}
            {!error && shown.length === 0 && !searching ? (
              <StateView kind="empty" layout="inline" icon={Search} title={`Nothing matches "${q}"`} detail="Try another word." className="studio-modal-state" />
            ) : error || shown.length === 0 ? null : (
              <ul className="ui-picker-list" id="ui-picker-list" role="listbox" aria-label={title} ref={listRef}>
                {shown.map((o, i) => (
                  <li key={o.value} role="option" aria-selected={i === active} data-index={i}>
                    <button type="button" className="ui-picker-row" onMouseEnter={() => setActive(i)} onClick={() => onPick(o.value)} title={o.detail ? `${o.label} · ${o.detail}` : o.label}>
                      <span className="ui-picker-label">{o.label}</span>
                      {o.detail && <span className="ui-picker-detail">{o.detail}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <span className="ui-picker-count ui-num">
              {searching ? "Searching…" : shown.length === options.length ? `${options.length}` : `${shown.length} of ${options.length}`}
            </span>
          </>
        )}
        <div className="studio-modal-actions">
          <button type="button" className="studio-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
