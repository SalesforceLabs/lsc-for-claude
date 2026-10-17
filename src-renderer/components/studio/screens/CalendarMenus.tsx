import React, { useState } from "react";
import type { CalendarSegment } from "./calendar-types";
import type { PublishedAccounts } from "./accounts-types";
import { CREATE_EVENT_TYPES, EVENT_INDICATOR, EVENT_SWITCHES } from "./calendar-logic";
import { Popover, Sheet } from "./interact-ui";
import "./calendar-menus.css";

type Kind = CalendarSegment["kind"];

/** The two toolbar popovers sit under their buttons: x 891..1190, from the top of the grid header (page y 60). */
const POP = { left: 891, top: 60, width: 299 };

/** "+": CalendarCreateEventViewController's type list. Picking one opens a form on the iPad; here a labelled sheet. */
export function PlusMenu({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (picked)
    return (
      <Sheet title={`New ${picked}`} note={`On the iPad this opens the New ${picked} form. Studio doesn't create calendar records.`} onClose={onClose} closeLabel="Cancel" />
    );
  return (
    <Popover {...POP} height={297} arrowX={1134} onClose={onClose}>
      <div className="studio-ipad-calendar-menu">
        <div className="studio-ipad-calendar-menu-head">
          <b>Create New Event</b>
          <span>Select Event Type to Create</span>
        </div>
        {CREATE_EVENT_TYPES.map((t) => (
          <button key={t} type="button" className="studio-ipad-calendar-menu-row center" onClick={() => setPicked(t)}>
            {t}
          </button>
        ))}
      </div>
    </Popover>
  );
}

type Page = "root" | "filter" | "indicator" | "delete";

/** "•••": Filter Events, Event Indicator and Delete Events, each pushing a page inside the popover. */
export function MoreMenu({ hidden, onApply, onClose }: { hidden: ReadonlySet<Kind>; onApply: (hidden: Set<Kind>) => void; onClose: () => void }) {
  const [page, setPage] = useState<Page>("root");
  const [draft, setDraft] = useState<Set<Kind>>(new Set(hidden));
  const changed = draft.size !== hidden.size || [...draft].some((k) => !hidden.has(k));
  const back = (
    <button type="button" className="studio-ipad-calendar-menu-back" aria-label="Back" onClick={() => setPage("root")}>
      <svg width="12" height="20" viewBox="0 0 12 20">
        <path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
  const toggle = (k: Kind) =>
    setDraft((d) => {
      const n = new Set(d);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <Popover {...POP} height={page === "root" ? 167 : page === "filter" ? 393 : page === "indicator" ? 451 : 281} arrowX={1175} onClose={onClose}>
      <div className="studio-ipad-calendar-menu">
        {page === "root" && (
          <>
            {(
              [
                ["filter", "Filter Events", "▼"],
                ["indicator", "Event Indicator", "☰"],
                ["delete", "Delete Events", "🗑"],
              ] as const
            ).map(([key, label, glyph]) => (
              <button key={key} type="button" className="studio-ipad-calendar-menu-row blue" onClick={() => setPage(key)}>
                <span className="glyph">{glyph}</span>
                <span className="label">{label}</span>
                <span className="chev">›</span>
              </button>
            ))}
          </>
        )}
        {page === "filter" && (
          <>
            <div className="studio-ipad-calendar-menu-nav">
              {back}
              <b>Filter Events</b>
              <button type="button" className="clear" onClick={() => setDraft(new Set(EVENT_SWITCHES.map((s) => s.kind)))}>
                Clear All
              </button>
            </div>
            <div className="studio-ipad-calendar-menu-row plain">
              <span className="label">Assessment Task</span>
              <span className="all">All</span>
            </div>
            {EVENT_SWITCHES.map((s) => (
              <div key={s.kind} className="studio-ipad-calendar-menu-row plain">
                <span className="label">{s.label}</span>
                <button type="button" role="switch" aria-checked={!draft.has(s.kind)} className={`studio-ipad-calendar-switch${draft.has(s.kind) ? "" : " on"}`} onClick={() => toggle(s.kind)} />
              </div>
            ))}
            <div className="studio-ipad-calendar-menu-row plain">
              <span className="label">Visit</span>
              <span className="all">All</span>
            </div>
            <button
              type="button"
              className="studio-ipad-calendar-menu-apply"
              disabled={!changed}
              onClick={() => {
                onApply(draft);
                onClose();
              }}
            >
              Apply
            </button>
          </>
        )}
        {page === "indicator" && (
          <>
            <div className="studio-ipad-calendar-menu-nav">
              {back}
              <b>Event Indicator</b>
            </div>
            {EVENT_INDICATOR.map((e) => (
              <div key={e.label} className="studio-ipad-calendar-menu-row plain">
                <span className="swatch" style={{ background: e.color }} />
                <span className="label">{e.label}</span>
              </div>
            ))}
          </>
        )}
        {page === "delete" && (
          <>
            <div className="studio-ipad-calendar-menu-nav">
              {back}
              <b>Delete Events</b>
            </div>
            <div className="studio-ipad-calendar-menu-note">On the iPad this lets you pick a date range and event types to delete. Studio never deletes records, so this form is not shown.</div>
          </>
        )}
      </div>
    </Popover>
  );
}

/** Advanced Search (full-screen modal): the accounts as cards with check circles. Selection is local; Done and Cancel just close. */
export function AdvancedSearch({ accounts, calendarIds, onClose }: { accounts: PublishedAccounts | undefined; calendarIds: string[]; onClose: () => void }) {
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ids = new Set(calendarIds);
  const pool = accounts ? accounts.cards.filter((c) => ids.has(c.id)) : [];
  const cards = (pool.length ? pool : accounts?.cards ?? []).filter((c) => (!text.trim() || c.name.toLowerCase().includes(text.trim().toLowerCase())) && (tab === "all" || selected.has(c.id)));
  const flip = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="studio-ipad-calendar-adv">
      <div className="studio-ipad-calendar-adv-bar">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <b>Advanced Search</b>
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="studio-ipad-calendar-adv-search">
        <label>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search..." spellCheck={false} />
        </label>
        <span className="online" title="Search Online opens the online search on the iPad">
          Search Online
        </span>
      </div>
      <div className="studio-ipad-calendar-adv-tools">
        <button type="button" className="all" onClick={() => setSelected(new Set(cards.map((c) => c.id)))}>
          Select All
        </button>
        <div className="seg">
          <span className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
            All
          </span>
          <span className={tab === "selected" ? "on" : ""} onClick={() => setTab("selected")}>
            Selected ({selected.size})
          </span>
        </div>
      </div>
      <div className="studio-ipad-calendar-adv-list">
        {cards.map((c) => (
          <div key={c.id} className="studio-ipad-calendar-adv-card" onClick={() => flip(c.id)}>
            <span className={`circle${selected.has(c.id) ? " on" : ""}`} />
            <div className="who">
              <b>{c.name}</b>
              <span>{c.address}</span>
            </div>
            {(accounts?.columns ?? []).map((title, i) => (
              <div key={title} className="col">
                <small>{title}</small>
                {(c.cells[i] ?? ["--"]).map((line, j) => (
                  <div key={j}>{line}</div>
                ))}
              </div>
            ))}
          </div>
        ))}
        {cards.length === 0 && <div className="studio-ipad-calendar-adv-none">No data available</div>}
      </div>
    </div>
  );
}
