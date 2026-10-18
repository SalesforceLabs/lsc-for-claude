import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

export interface SearchPickerOption {
  value: string;
  label: string;
  /** Shown after the label, dimmed (an API name, a type). Searched too. */
  detail?: string;
}

interface SearchPickerProps {
  options: SearchPickerOption[];
  onPick: (value: string) => void;
  /** Escape, or Cancel. */
  onClose: () => void;
  "aria-label": string;
  placeholder?: string;
  /** Shown when nothing matches the search, or there's nothing to pick. */
  empty?: string;
}

/**
 * Pick one item from a long list by typing: a search field over a list of
 * 30px rows. Arrow keys move, Enter picks, Escape closes. Drawn in place (in an
 * inspector or a dialog body), not as a popover.
 */
export default function SearchPicker({ options, onPick, onClose, placeholder = "Search", empty = "Nothing matches.", ...rest }: SearchPickerProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.detail ?? ""}`.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (shown.length) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length);
    } else if (e.key === "Enter" && shown[active]) {
      e.preventDefault();
      onPick(shown[active].value);
    }
  };

  return (
    <div className="ui-picker" onKeyDown={onKey}>
      <div className="ui-picker-search">
        <Search size={14} aria-hidden />
        <input
          ref={input}
          className="ui-field"
          type="search"
          value={query}
          placeholder={placeholder}
          aria-label={rest["aria-label"]}
          role="combobox"
          aria-expanded="true"
          aria-controls={id}
          aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {shown.length ? (
        <ul ref={list} id={id} className="ui-picker-list" role="listbox" aria-label={rest["aria-label"]}>
          {shown.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={`ui-picker-row${i === active ? " active" : ""}`}
              title={o.detail ? `${o.label} (${o.detail})` : o.label}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(o.value)}
            >
              <span className="ui-picker-label">{o.label}</span>
              {o.detail && <span className="ui-picker-detail">{o.detail}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ui-picker-empty">{empty}</p>
      )}
      <div className="ui-picker-footer">
        <button type="button" className="studio-btn ghost sm" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
