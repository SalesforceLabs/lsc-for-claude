import React, { useEffect, useRef, useState } from "react";
import { Ellipsis, type LucideIcon } from "lucide-react";

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  onSelect: () => void;
}

/** A "more" button that opens a small menu of actions. Escape and outside clicks close it. */
export default function Menu({ items, label, className }: { items: MenuItem[]; label: string; className?: string }) {
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
      <button type="button" className="ui-icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ellipsis size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="ui-menu-list " role="menu" aria-label={label}>
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={`ui-menu-item${it.danger ? " danger" : ""}`}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {Icon && <Icon size={14} aria-hidden="true" />}
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
