import React, { useEffect, useRef, useState } from "react";
import { Check, Ellipsis, type LucideIcon } from "lucide-react";

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  /** A choice: shows a check when true (any item given `checked` makes the menu a list of choices). */
  checked?: boolean;
  /** Shown but not selectable, e.g. "Loading…". */
  disabled?: boolean;
  onSelect: () => void;
}

interface MenuProps {
  items: MenuItem[];
  label: string;
  className?: string;
  /** What the button shows instead of the "more" icon, e.g. the current choice. */
  trigger?: React.ReactNode;
  /** Hover text for a `trigger` button. */
  title?: string;
  /** Open above the button (for bars at the bottom of the window). */
  above?: boolean;
}

/** A "more" button (or a `trigger`) that opens a small menu of actions or choices. Escape and outside clicks close it. */
export default function Menu({ items, label, className, trigger, title, above }: MenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={`ui-menu${className ? ` ${className}` : ""}`} ref={root} onClick={(e) => e.stopPropagation()}>
      {trigger ? (
        <button type="button" className="ui-menu-trigger" aria-label={label} title={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          {trigger}
        </button>
      ) : (
        <button type="button" className="ui-icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Ellipsis size={16} aria-hidden="true" />
        </button>
      )}
      {open && (
        <div className={`ui-menu-list${above ? " above" : ""}`} role="menu" aria-label={label}>
          {items.map((it) => {
            const Icon = it.checked === undefined ? it.icon : it.checked ? Check : null;
            const choice = items.some((i) => i.checked !== undefined);
            return (
              <button
                key={it.label}
                type="button"
                role={choice ? "menuitemradio" : "menuitem"}
                aria-checked={choice ? it.checked === true : undefined}
                className={`ui-menu-item${it.danger ? " danger" : ""}${choice ? " choice" : ""}`}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {Icon ? <Icon size={14} aria-hidden="true" /> : choice && <span className="ui-menu-check" aria-hidden="true" />}
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
