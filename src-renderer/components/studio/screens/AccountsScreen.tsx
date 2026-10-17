import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MicIcon } from "../IpadChrome";
import type { ScreenProps } from "./types";
import type { PublishedAccountCard, PublishedAccountList } from "./accounts-types";
import { SORT_OPTIONS, DEFAULT_SORT, addressMaxLines, addressTop, filterByChip, filterByList, nextSort, sortCards, sortPillLabel, ADDRESS_LINE } from "./accounts-logic";
import HcoIcon from "./assets/accounts-hco-icon";
import "./accounts.css";

function Magnifier({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m13.5 13.5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** The "ellipsis" button, rotated 90°. */
function Dots() {
  return (
    <svg width="4" height="18" viewBox="0 0 4 18" aria-hidden="true">
      <circle cx="2" cy="2" r="2" fill="currentColor" />
      <circle cx="2" cy="9" r="2" fill="currentColor" />
      <circle cx="2" cy="16" r="2" fill="currentColor" />
    </svg>
  );
}

/** AccountRecordTypeIcon: HCP is standard:person_account on #5867E8 (a building and a person); HCO is the bundled building. */
function PersonIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#5867e8" />
      <rect x="5.5" y="6" width="6.5" height="10.500" rx="0.8" fill="#e4e7ff" />
      <path d="M7.200 8h1.200M9.400 8h1.200M7.200 10h1.200M9.400 10h1.200M7.200 12h1.200M9.400 12h1.200M7.200 14h1.200M9.400 14h1.200" stroke="#5867e8" strokeWidth="0.800" />
      <circle cx="16" cy="9.300" r="2.400" fill="#fff" />
      <path d="M11 17.500c0-2.600 2.200-4.100 5-4.100s5 1.500 5 4.100v.5H11Z" fill="#fff" />
    </svg>
  );
}

/** The state license pill: teal shield-check when valid, pink xmark when not. */
function LicensePill({ state }: { state: "valid" | "invalid" }) {
  return (
    <span className={`studio-ipad-accounts-license ${state}`} aria-hidden="true">
      {state === "valid" ? (
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M8 1 3.500 2.500v5c0 3 1.900 5.500 4.500 6.800 2.600-1.300 4.500-3.800 4.500-6.800v-5Z" fill="currentColor" />
          <path d="m5.400 8 1.800 1.800L10.700 6.200" fill="none" stroke="#acf3e4" strokeWidth="1.500" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="m5.500 5.500 5 5m0-5-5 5" stroke="#fddde3" strokeWidth="1.500" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

function ListRow({ list, selected, onClick }: { list?: PublishedAccountList; selected?: boolean; onClick: () => void }) {
  return (
    <div className={`studio-ipad-accounts-row ${list ? "" : "all"} ${selected ? "selected" : ""}`} onClick={onClick}>
      <span className="studio-ipad-accounts-row-bar" />
      <div className="studio-ipad-accounts-row-text">
        <div className="studio-ipad-accounts-row-title">{list ? list.name : "All"}</div>
        {list && <div className="studio-ipad-accounts-row-detail">{list.detail}</div>}
      </div>
      {list && (
        <span className="studio-ipad-accounts-row-more">
          <Dots />
        </span>
      )}
    </div>
  );
}

function Card({ card, columns, onOpen }: { card: PublishedAccountCard; columns: string[]; onOpen?: (id: string) => void }) {
  const name = useRef<HTMLDivElement>(null);
  const [wrapped, setWrapped] = useState(false);
  useLayoutEffect(() => setWrapped((name.current?.offsetHeight ?? 0) > 22), [card.name]);
  return (
    <div className="studio-ipad-accounts-card" onClick={() => onOpen?.(card.id)}>
      <div className={`studio-ipad-accounts-card-text ${wrapped ? "wrapped" : ""}`}>
        <div className="studio-ipad-accounts-card-row">
          <span className="studio-ipad-accounts-card-icon">{card.hco ? <HcoIcon size={24} /> : <PersonIcon />}</span>
          <div ref={name} className="studio-ipad-accounts-card-name">
            {card.name}
          </div>
        </div>
        <div className="studio-ipad-accounts-card-row second">
          {card.license ? <LicensePill state={card.license} /> : <span className="studio-ipad-accounts-card-icon" />}
          <div className="studio-ipad-accounts-card-address" style={{ maxHeight: addressMaxLines(addressTop(wrapped)) * ADDRESS_LINE }}>
            {card.address}
          </div>
        </div>
      </div>
      {columns.map((title, i) => (
        <div key={title} className={`studio-ipad-accounts-col c${i + 1}`}>
          <div className="studio-ipad-accounts-col-title">{title}</div>
          <div className="studio-ipad-accounts-col-value">
            {(card.cells[i] ?? ["--"]).map((line, j) => (
              <div key={j}>{line}</div>
            ))}
          </div>
        </div>
      ))}
      <span className="studio-ipad-accounts-card-more">
        <Dots />
      </span>
    </div>
  );
}

/** Cards in their own scroll pane; iOS draws a thin indicator while scrolling that fades out afterwards. */
function CardsPane({ cards, columns, resetKey, onOpen }: { cards: PublishedAccountCard[]; columns: string[]; resetKey: string; onOpen?: (id: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  const [active, setActive] = useState(false);
  const fade = useRef<ReturnType<typeof setTimeout>>();
  const measure = () => {
    const el = scroller.current;
    if (!el || el.scrollHeight <= el.clientHeight + 1) return setThumb(null);
    const track = el.clientHeight - 8;
    const height = Math.max(36, (track * el.clientHeight) / el.scrollHeight);
    setThumb({ top: 4 + ((track - height) * el.scrollTop) / (el.scrollHeight - el.clientHeight), height });
  };
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    measure();
  }, [resetKey, cards.length]);
  useEffect(() => () => clearTimeout(fade.current), []);
  return (
    <div className="studio-ipad-accounts-cards">
      <div
        ref={scroller}
        className="studio-ipad-accounts-scroll"
        onScroll={() => {
          measure();
          setActive(true);
          clearTimeout(fade.current);
          fade.current = setTimeout(() => setActive(false), 900);
        }}
      >
        {cards.map((c) => (
          <Card key={c.id} card={c} columns={columns} onOpen={onOpen} />
        ))}
      </div>
      {thumb && <span className={`studio-ipad-accounts-thumb ${active ? "active" : ""}`} style={{ top: thumb.top, height: thumb.height }} />}
    </div>
  );
}

/** Accounts tab (SearchFilterCustomersViewController), drawn like LSC Mobile at 1210×834pt. Null until there is data, so the preview keeps its placeholder. */
export default function AccountsScreen({ tab, snapshot, onOpenRecord }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.accounts;
  const [broken, setBroken] = useState(false);
  const [chip, setChip] = useState("All");
  const [listId, setListId] = useState<string | null>(null);
  const [sort, setSort] = useState({ label: DEFAULT_SORT, ascending: true });
  const [popover, setPopover] = useState(false);
  void tab;
  const list = useMemo(() => (data ? [...data.lists.own, ...data.lists.shared].find((l) => l.id === listId) : undefined), [data, listId]);
  const cards = useMemo(
    () => (data ? sortCards(filterByChip(filterByList(data.cards, list?.memberIds), chip), sort.label, sort.ascending) : []),
    [data, list, chip, sort]
  );
  if (!data) return null;
  const theme = snapshot.objects?.Account?.theme;
  return (
    <div className="studio-ipad-accounts">
      <div className="studio-ipad-accounts-head">
        {/* MetadataThemeInfo.icon(style: .circular) */}
        <span className="studio-ipad-accounts-obj" style={theme ? { background: theme.color } : undefined} aria-hidden="true">
          {theme && !broken ? <img src={theme.iconUrl} alt="" onError={() => setBroken(true)} /> : "A"}
        </span>
        <div className="studio-ipad-accounts-head-text">
          <div className="studio-ipad-accounts-eyebrow">Accounts</div>
          <div className="studio-ipad-accounts-selected">{list ? list.name : "All"}</div>
        </div>
        {data.newAccount && <span className="studio-ipad-accounts-new">New Account</span>}
      </div>

      <div className="studio-ipad-accounts-search">
        <div className="studio-ipad-accounts-field">
          <Magnifier />
          <span>Search...</span>
          <MicIcon />
        </div>
        {data.searchOnline && (
          <span className="studio-ipad-accounts-online">
            <Magnifier size={20} />
            Search Online
          </span>
        )}
        <div className="studio-ipad-accounts-actions">
          {data.select && <span className="studio-ipad-accounts-pill select">Select</span>}
          <span className="studio-ipad-accounts-pill sort clickable" onClick={() => setPopover((o) => !o)}>
            {sortPillLabel(sort.label, sort.ascending)}
          </span>
          {data.maps && (
            <span className="studio-ipad-accounts-map" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 20 20">
                <path d="M2 4.500 7 2.500l6 2 5-2v13l-5 2-6-2-5 2Z" fill="currentColor" />
                <path d="M7 2.500v13M13 4.500v13" stroke="#fff" strokeWidth="1.200" />
                <circle cx="10" cy="9" r="2.200" fill="#fff" />
              </svg>
            </span>
          )}
        </div>
      </div>

      <div className="studio-ipad-accounts-sidebar">
        <div className="studio-ipad-accounts-lists">Lists <span /></div>
        <div className="studio-ipad-accounts-filter">
          <Magnifier />
          <span>Search...</span>
        </div>
        <div className="studio-ipad-accounts-divider" />
        <ListRow selected={!list} onClick={() => setListId(null)} />
        {data.lists.own.map((l) => (
          <ListRow key={l.id} list={l} selected={l.id === listId} onClick={() => setListId(l.id)} />
        ))}
        {data.lists.shared.length > 0 && <div className="studio-ipad-accounts-section">Shared with you</div>}
        {data.lists.shared.map((l) => (
          <ListRow key={l.id} list={l} selected={l.id === listId} onClick={() => setListId(l.id)} />
        ))}
      </div>

      <div className="studio-ipad-accounts-chips">
        {data.chips.map((c) => (
          <span key={c.label} className={`studio-ipad-accounts-chip ${c.label === chip ? "selected" : ""}`} onClick={() => setChip(c.label)}>
            {c.label}
            <span className="studio-ipad-accounts-chip-count">{c.count}</span>
          </span>
        ))}
      </div>

      <CardsPane onOpen={onOpenRecord} cards={cards} columns={data.columns} resetKey={`${chip}|${listId}|${sort.label}|${sort.ascending}`} />

      {popover && (
        <>
          <div className="studio-ipad-accounts-backdrop" onClick={() => setPopover(false)} />
          <div className="studio-ipad-accounts-popover" role="menu">
            <div className="studio-ipad-accounts-popover-list">
              {SORT_OPTIONS.map((o) => {
                const on = o.label === sort.label;
                return (
                  <div
                    key={o.label}
                    className="studio-ipad-accounts-popover-row"
                    role="menuitem"
                    onClick={() => {
                      setSort(nextSort(sort, o.label));
                      setPopover(false);
                    }}
                  >
                    <span className="studio-ipad-accounts-popover-check">{on ? "✓" : ""}</span>
                    {o.label}
                    {on && <span className="studio-ipad-accounts-popover-dir">{sort.ascending ? "↑" : "↓"}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
