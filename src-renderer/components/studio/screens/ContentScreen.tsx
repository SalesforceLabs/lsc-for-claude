import React, { useState } from "react";
import type { ScreenProps } from "./types";
import type { PublishedContentCard } from "./content-types";
import { categoryRows, collapseLabel, sectionTitle, visibleSections } from "./content-logic";
import ContentViewer from "./ContentViewer";
import { Check, EmptyArt, Popover, Sheet } from "./interact-ui";
import errorRecoverable from "./assets/content-error-recoverable.png";
import "./content.css";

/** Intelligent Content grid (CLMGridViewController), drawn like LSC Mobile at 1210×834pt. Null until there is data, so the preview keeps its placeholder. */
export default function ContentScreen({ snapshot }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.content;
  const [segment, setSegment] = useState("Presentations");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  if (!data) return null;

  const sections = visibleSections(data, { segment, search, favorites, approvedOnly, category });
  const viewed = viewing ? data.cards.find((c) => c.id === viewing) : undefined;
  const titles = sections.map((s) => s.title);
  const flip = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const label = collapseLabel(titles, collapsed);
  // Every card on a fresh device is "New": the viewed list is device-local.
  return (
    <div className="studio-ipad-content">
      <div className="studio-ipad-content-panel">
        <div className="studio-ipad-content-bar">
          <label className="studio-ipad-content-search">
            <SearchIcon />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." spellCheck={false} />
          </label>
          <button type="button" className="studio-ipad-content-btn filters" onClick={() => setFiltersOpen(true)}>
            Filters
            <ChevronDown />
          </button>
          {data.hasTags && (
            <button type="button" className="studio-ipad-content-plain" onClick={() => setCollapsed(label === "Collapse All" ? new Set(titles) : new Set())}>
              {label}
            </button>
          )}
          {data.canCreate && (
            <button type="button" className="studio-ipad-content-btn new" onClick={() => setNewOpen(true)}>
              <Plus />
              New
            </button>
          )}
        </div>
        {data.segments.length > 1 && (
          <div className="studio-ipad-content-segments" role="tablist">
            {data.segments.map((s, i) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={s === segment}
                className={`studio-ipad-content-segment${s === segment ? " on" : ""}${data.segments[i + 1] === segment ? " nosep" : ""}`}
                onClick={() => setSegment(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="studio-ipad-content-scroll">
          {sections.map((section) => {
            const open = !collapsed.has(section.title);
            return (
              <section key={section.title}>
                {data.hasTags && (
                  <button type="button" className="studio-ipad-content-head" onClick={() => setCollapsed(flip(collapsed, section.title))}>
                    {open ? <ChevronDown /> : <ChevronRight />}
                    <span>{sectionTitle(section.title)}</span>
                  </button>
                )}
                {open && (
                  <div className="studio-ipad-content-grid" style={{ gridTemplateColumns: `repeat(${data.columns}, 1fr)` }}>
                    {section.cards.map((card) => (
                      <Card key={card.id} card={card} isNew favorite={favorites.has(card.id)} onFavorite={() => setFavorites(flip(favorites, card.id))} onPreview={() => setViewing(card.id)} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {sections.length === 0 && <EmptyArt text="No data available" />}
        </div>
      </div>
      {filtersOpen && (
        <Popover left={739} top={85} width={289} height={530} arrowX={884} onClose={() => setFiltersOpen(false)}>
          <div className="studio-ipad-content-filters">
            <label className="studio-ipad-content-filters-search">
              <SearchIcon />
              <input value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} placeholder="Search..." spellCheck={false} />
            </label>
            <div className="studio-ipad-content-filters-list">
              {matches("Sharing Settings", "Approved for Sharing", filterSearch) && (
                <>
                  <div className="studio-ipad-interact-row head">Sharing Settings</div>
                  <button type="button" className="studio-ipad-interact-row" onClick={() => setApprovedOnly(!approvedOnly)}>
                    <span>Approved for Sharing</span>
                    {approvedOnly && <Check />}
                  </button>
                </>
              )}
              <div className="studio-ipad-interact-row head">Categories</div>
              {categoryRows(data)
                .filter((r) => !filterSearch.trim() || `${r.label} (${r.count})`.toLowerCase().includes(filterSearch.trim().toLowerCase()))
                .map((r) => (
                  <button key={r.label} type="button" className="studio-ipad-interact-row" onClick={() => setCategory(r.title)}>
                    <span>{`${r.label} (${r.count})`}</span>
                    {category === r.title && <Check />}
                  </button>
                ))}
            </div>
          </div>
        </Popover>
      )}
      {newOpen && (
        <Sheet
          title="New Presentation"
          note="On the iPad this opens the New Presentation builder: your presentations on the left, the pages you add on the right, with Save, Save as, Remove, Reorder and Edit Details. Studio doesn't build presentations."
          onClose={() => setNewOpen(false)}
        />
      )}
      {viewed && <ContentViewer card={viewed} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** CLMCardView: the success state, or (failed) the error state with the title at the bottom. */
export function Card({
  card,
  isNew,
  favorite,
  onFavorite,
  onPreview,
  failed = false,
}: {
  card: PublishedContentCard;
  isNew: boolean;
  favorite: boolean;
  onFavorite: () => void;
  onPreview?: () => void;
  failed?: boolean;
}) {
  if (failed)
    return (
      <div className="studio-ipad-content-card failed">
        <img className="studio-ipad-content-error-art" src={errorRecoverable} alt="" />
        <div className="studio-ipad-content-error-title">Content could not load</div>
        <div className="studio-ipad-content-error-sub">Please try again later</div>
        <div className="studio-ipad-content-name bottom">{card.name}</div>
      </div>
    );
  return (
    <div className="studio-ipad-content-card" onClick={onPreview}>
      <div className="studio-ipad-content-thumb">
        {card.thumbnail && <img src={card.thumbnail} alt="" />}
        <button type="button" className={`studio-ipad-content-fav${favorite ? " on" : ""}`} aria-label="Favorite" onClick={(e) => {
            e.stopPropagation();
            onFavorite();
          }}
        >
          <Heart filled={favorite} />
        </button>
        {isNew && <span className="studio-ipad-content-badge">New</span>}
      </div>
      <div className="studio-ipad-content-name">{card.name}</div>
      <div className="studio-ipad-content-meta">
        <DocOnDoc />
        <span className="pages">{card.pages}</span>
        <Sync />
        <span>{card.date}</span>
      </div>
      <div className="studio-ipad-content-preview">
        <Eye />
        <span>Preview</span>
      </div>
    </div>
  );
}

/** Filters popover: a heading shows only when its heading or one of its rows matches the search text. */
const matches = (heading: string, row: string, needle: string) => !needle.trim() || `${heading} ${row}`.toLowerCase().includes(needle.trim().toLowerCase());

// SF Symbols redrawn as inline SVG.
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="m11.6 11.6 4.6 4.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
function ChevronDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m2.5 5.2 5.5 5.6 5.5-5.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m5.2 2.5 5.6 5.5-5.6 5.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Plus() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5v13M1.5 8h13" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
function Heart({ filled }: { filled: boolean }) {
  return (
    <svg width="20" height="18" viewBox="0 0 22 20" aria-hidden="true">
      <path
        d="M11 18.2C5.4 13.8 2 10.8 2 7.1 2 4.5 4 2.6 6.4 2.6c1.8 0 3.4 1 4.6 2.8 1.2-1.8 2.8-2.8 4.6-2.8C18 2.6 20 4.5 20 7.1c0 3.7-3.4 6.7-9 11.1Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function DocOnDoc() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M4.3 3.6V2.4c0-.7.5-1.2 1.2-1.2h4.1l2.5 2.5v5.3c0 .7-.5 1.2-1.2 1.2h-.9" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M1.8 5.2c0-.7.5-1.2 1.2-1.2h3.9l2.3 2.3v5.5c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2Z" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}
function Sync() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2.2 6.3A4.9 4.9 0 0 1 10.8 3.9M11.8 7.7A4.9 4.9 0 0 1 3.2 10.1" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M11.4 1.3v2.9H8.5M2.6 12.7V9.8h2.9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Eye() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
      <path d="M10 .8C5.6.8 2.3 3.6.6 7c1.7 3.4 5 6.2 9.4 6.2s7.7-2.8 9.4-6.2C17.7 3.6 14.4.8 10 .8Z" fill="currentColor" />
      <circle cx="10" cy="7" r="3.1" fill="#fff" />
      <circle cx="10" cy="7" r="1.6" fill="currentColor" />
    </svg>
  );
}
