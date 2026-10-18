import React, { useState } from "react";
import type { CalendarSegment } from "./calendar-types";
import type { PublishedAccounts } from "./accounts-types";
import { CREATE_EVENT_TYPES, EVENT_INDICATOR, EVENT_SWITCHES, TODO_STATUSES, VISIT_VARIANTS, subDetail, subKey } from "./calendar-logic";
import { Popover, ScreenLayer, Sheet } from "./interact-ui";
import "./calendar-menus.css";

type Kind = CalendarSegment["kind"];

/** The two toolbar popovers sit under their buttons: x 891..1190, from the top of the grid header (screen y 156; drawn at the screen layer so the arrow clears the page). */
const POP = { left: 891, top: 156, width: 300, layer: "screen" as const };

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

type Page = "root" | "filter" | "indicator" | "delete" | "todo" | "visit";

const GROUPS = {
  todo: { title: "Assessment Task", names: TODO_STATUSES },
  visit: { title: "Visit", names: VISIT_VARIANTS },
} as const;

/** "•••": Filter Events, Event Indicator and Delete Events, each pushing a page inside the popover. */
export function MoreMenu({ hidden, hiddenSub, range, onApply, onClose }: { hidden: ReadonlySet<Kind>; hiddenSub: ReadonlySet<string>; range?: { from: string; to: string }; onApply: (hidden: Set<Kind>, hiddenSub: Set<string>) => void; onClose: () => void }) {
  const [page, setPage] = useState<Page>("root");
  const [draft, setDraft] = useState<Set<Kind>>(new Set(hidden));
  const [note, setNote] = useState(false);
  const [sub, setSub] = useState<Set<string>>(new Set(hiddenSub));
  const changed = draft.size !== hidden.size || [...draft].some((k) => !hidden.has(k)) || sub.size !== hiddenSub.size || [...sub].some((k) => !hiddenSub.has(k));
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
  const toggleSub = (key: string) =>
    setSub((d) => {
      const n = new Set(d);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  // The drill-in pages edit the same draft and share the filter popover's size and Apply button.
  const editing = page === "filter" || page === "todo" || page === "visit";
  const apply = (
    <button
      type="button"
      className="studio-ipad-calendar-menu-apply pin"
      disabled={!changed}
      onClick={() => {
        onApply(draft, sub);
        onClose();
      }}
    >
      Apply
    </button>
  );
  return (
    <Popover {...POP} left={editing ? 791 : POP.left} width={editing ? 400 : POP.width} height={page === "root" ? 167 : editing ? 393 : page === "indicator" ? 451 : 344} arrowX={1175} onClose={onClose}>
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
              <button type="button" className="clear" onClick={() => {
                  setDraft(new Set(EVENT_SWITCHES.map((s) => s.kind)));
                  setSub(new Set([...GROUPS.todo.names.map((n) => subKey("todo", n)), ...GROUPS.visit.names.map((n) => subKey("visit", n))]));
                }}>
                Clear All
              </button>
            </div>
            <button type="button" className="studio-ipad-calendar-menu-row plain drill" onClick={() => setPage("todo")}>
              <span className="label">Assessment Task</span>
              <span className="all">{subDetail("todo", TODO_STATUSES, sub)}</span>
            </button>
            {EVENT_SWITCHES.map((s) => (
              <div key={s.kind} className="studio-ipad-calendar-menu-row plain">
                <span className="label">{s.label}</span>
                <button type="button" role="switch" aria-checked={!draft.has(s.kind)} className={`studio-ipad-calendar-switch${draft.has(s.kind) ? "" : " on"}`} onClick={() => toggle(s.kind)} />
              </div>
            ))}
            <button type="button" className="studio-ipad-calendar-menu-row plain drill" onClick={() => setPage("visit")}>
              <span className="label">Visit</span>
              <span className="all">{subDetail("visit", VISIT_VARIANTS, sub)}</span>
            </button>
            {apply}
          </>
        )}
        {(page === "todo" || page === "visit") && (
          <>
            <div className="studio-ipad-calendar-menu-nav">
              <button type="button" className="studio-ipad-calendar-menu-back" aria-label="Back" onClick={() => setPage("filter")}>
                <svg width="12" height="20" viewBox="0 0 12 20">
                  <path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <b>{GROUPS[page].title}</b>
              <button type="button" className="clear" onClick={() => setSub((d) => new Set([...d, ...GROUPS[page].names.map((n) => subKey(page, n))]))}>
                Clear All
              </button>
            </div>
            {GROUPS[page].names.map((n) => (
              <div key={n} className="studio-ipad-calendar-menu-row plain">
                <span className="label">{n}</span>
                <button type="button" role="switch" aria-checked={!sub.has(subKey(page, n))} className={`studio-ipad-calendar-switch${sub.has(subKey(page, n)) ? "" : " on"}`} onClick={() => toggleSub(subKey(page, n))} />
              </div>
            ))}
            {apply}
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
            <div className="studio-ipad-calendar-delete">
              <label>
                <i>*</i> Event Type
                <span className="field select">All</span>
              </label>
              <label>
                <i>*</i> From
                <span className="field">{range?.from ?? ""}</span>
              </label>
              <label>
                <i>*</i> To
                <span className="field">{range?.to ?? ""}</span>
              </label>
              <button type="button" className="go" onClick={() => setNote(true)}>
                Delete Events
              </button>
            </div>
            {note && <Sheet title="Delete Events" closeLabel="Close" note="On the iPad this deletes the events in the range after a confirmation. Studio is read-only and never deletes records." onClose={() => setNote(false)} />}
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
    <ScreenLayer>
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
          <div className="chips">
            {["Type", "Lists", "Filters"].map((c) => (
              <span key={c} className={`chip${c === "Type" ? " on" : ""}`}>
                {c}
                <svg width="14" height="9" viewBox="0 0 14 9" aria-hidden="true">
                  <path d="m1.500 1.500 5.500 5.500 5.500-5.500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            ))}
          </div>
        </div>
        <div className="studio-ipad-calendar-adv-list">
          {cards.map((c) => (
            <div key={c.id} className="studio-ipad-calendar-adv-card" onClick={() => flip(c.id)}>
              <span className={`circle${selected.has(c.id) ? " on" : ""}`} />
              <svg className="icon" width="25" height="25" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="12" fill="#5867e8" />
                <rect x="5.500" y="6" width="6.500" height="10.500" rx="0.800" fill="#e4e7ff" />
                <circle cx="16" cy="9.300" r="2.400" fill="#fff" />
                <path d="M11 17.500c0-2.600 2.200-4.100 5-4.100s5 1.500 5 4.100v.5H11Z" fill="#fff" />
              </svg>
              {c.license === "valid" && (
                <svg className="shield" width="25" height="25" viewBox="0 0 25 25" aria-hidden="true">
                  <circle cx="12.500" cy="12.500" r="12.500" fill="#acf3e4" />
                  <path d="M12.500 5 7 7v5c0 3.200 2.300 5.800 5.500 7 3.200-1.200 5.500-3.800 5.500-7V7Z" fill="#04644e" />
                  <path d="m9.800 12.300 2 2 3.600-3.800" fill="none" stroke="#acf3e4" strokeWidth="1.600" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              <div className="who">
                <b className="name">{c.name}</b>
                <span className="addr">{c.address}</span>
              </div>
              {(accounts?.columns ?? []).slice(0, 3).map((title, i) => (
                <div key={title} className={`col c${i + 1}`}>
                  <small>{title}</small>
                  <div>{(c.cells[i] ?? ["--"]).join(" ")}</div>
                </div>
              ))}
            </div>
          ))}
          {cards.length === 0 && <div className="studio-ipad-calendar-adv-none">No data available</div>}
        </div>
      </div>
    </ScreenLayer>
  );
}
