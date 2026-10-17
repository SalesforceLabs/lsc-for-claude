import React, { useEffect, useMemo, useState } from "react";
import { tabPages, tabWidth } from "./ipad-chrome";

/** One tab in the floating tab bar. */
export interface ChromeTab {
  key: string;
  label: string;
  title?: string;
  /** Extra classes (visibility, findings, pending changes). */
  className?: string;
  badge?: React.ReactNode;
}

/** The iPadOS status bar. */
export function IpadStatusBar() {
  const date = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
  return (
    <div className="studio-ipad-statusbar">
      <span>
        9:41 AM <span className="studio-ipad-statusbar-date">{date}</span>
      </span>
      <span className="studio-ipad-statusbar-icons" aria-hidden="true">
        <svg width="17" height="12" viewBox="0 0 17 12">
          <path d="M8.5 2.2c2.4 0 4.6.9 6.2 2.5l1.2-1.2A10.4 10.4 0 0 0 8.5.5 10.4 10.4 0 0 0 1.1 3.5l1.2 1.2a8.7 8.7 0 0 1 6.2-2.5Zm0 3.4c1.5 0 2.8.6 3.8 1.5l1.2-1.2a7 7 0 0 0-10 0l1.2 1.2c1-.9 2.3-1.5 3.8-1.5Zm0 3.4c.6 0 1.1.2 1.5.6L8.5 11.1 7 9.6c.4-.4.9-.6 1.5-.6Z" fill="currentColor" />
        </svg>
        <span className="studio-ipad-battery">
          <span>100</span>
        </span>
      </span>
    </div>
  );
}

/**
 * The navigation bar: back button, the floating tab bar (centered, paged,
 * search pinned last), and Briefings / notifications / profile on the right.
 */
export function IpadTopBar({
  tabs,
  current,
  onOpen,
  searchKey,
  onBack,
  name,
  onBriefings,
  briefingsOpen,
  onBell,
  onAvatar,
}: {
  tabs: ChromeTab[];
  current: string;
  onOpen: (key: string) => void;
  /** Key of the pinned search tab, or undefined when the search tab isn't tappable. */
  searchKey?: string;
  onBack?: () => void;
  name: string;
  onBriefings?: () => void;
  briefingsOpen?: boolean;
  onBell?: () => void;
  onAvatar?: () => void;
}) {
  const pages = useMemo(() => tabPages(tabs.map((t) => tabWidth(t.label))), [tabs]);
  const startPage = Math.max(0, pages.findIndex((p) => p.some((i) => tabs[i].key === current)));
  const [page, setPage] = useState(startPage);
  const shown = pages[Math.min(page, pages.length - 1)] ?? [];
  // Opening a tab from outside the bar (a deep link) turns to its page.
  const showing = shown.some((i) => tabs[i]?.key === current);
  useEffect(() => {
    if (!showing) setPage(startPage);
  }, [current]);
  return (
    <div className="studio-ipad-navbar">
      {onBack && (
        <button type="button" className="studio-ipad-back" onClick={onBack} aria-label="Back">
          <svg width="13" height="21" viewBox="0 0 13 21" aria-hidden="true">
            <path d="M11 2 2.5 10.5 11 19" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <nav className="studio-ipad-tabbar" aria-label="Navigation tabs">
        {page > 0 && (
          <button type="button" className="studio-ipad-pager" onClick={() => setPage(page - 1)} aria-label="Previous Page">
            <Chevron left />
          </button>
        )}
        {shown.map((i) => {
          const t = tabs[i];
          return (
            <button
              key={t.key}
              type="button"
              className={`studio-ipad-pill${t.key === current ? " current" : ""}${t.className ?? ""}`}
              title={t.title}
              onClick={() => onOpen(t.key)}
            >
              {t.label}
              {t.badge}
            </button>
          );
        })}
        <button
          type="button"
          className={`studio-ipad-pill search${searchKey && searchKey === current ? " current" : ""}`}
          title="Search and recent items (always pinned)"
          disabled={!searchKey}
          onClick={() => searchKey && onOpen(searchKey)}
          aria-label="Search"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="m13.5 13.5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        {page < pages.length - 1 && (
          <button type="button" className="studio-ipad-pager" onClick={() => setPage(page + 1)} aria-label="Next Page">
            <Chevron />
          </button>
        )}
      </nav>
      <div className="studio-ipad-nav-buttons">
        <button type="button" className={`studio-ipad-round briefings${briefingsOpen ? " open" : ""}`} title="Briefings" onClick={onBriefings}>
          {briefingsOpen ? (
            // The player is up: the button shows the waveform and drops the new-briefing dot.
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 10v4M7 7v10M11 3v18M15 7v10M19 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <>
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="13" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
                <path d="M9 9.5v7l6-3.5-6-3.5Z" fill="currentColor" />
                <path d="m19 2 .8 1.7 1.7.8-1.7.8L19 7l-.8-1.7-1.7-.8 1.7-.8L19 2Z" fill="currentColor" />
              </svg>
              <span className="studio-ipad-round-dot" />
            </>
          )}
        </button>
        <button type="button" className="studio-ipad-round bell" title="Notifications" aria-label="Notifications" onClick={onBell}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5v4l-2 3.5v1h17v-1l-2-3.5V9A6.5 6.5 0 0 0 12 2.5Zm-2.6 16.5a2.6 2.6 0 0 0 5.2 0H9.4Z" fill="currentColor" />
          </svg>
        </button>
        <button type="button" className="studio-ipad-round avatar" title="Profile" onClick={onAvatar}>
          {name}
        </button>
      </div>
    </div>
  );
}

function Chevron({ left = false }: { left?: boolean }) {
  return (
    <svg width="11" height="18" viewBox="0 0 11 18" aria-hidden="true">
      <path
        d={left ? "M9 1.5 1.8 9 9 16.5" : "M2 1.5 9.2 9 2 16.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** DictationTextFieldControl — the pill search field with a magnifier and a microphone. */
export function IpadSearchField({ className = "", mic = true, value, onChange }: { className?: string; mic?: boolean; value?: string; onChange?: (v: string) => void }) {
  return (
    <div className={`studio-ipad-searchfield ${className}`}>
      <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="m13.5 13.5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {onChange ? (
        <input className="studio-ipad-searchfield-text" placeholder="Search..." value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <span className="studio-ipad-searchfield-text">Search...</span>
      )}
      {mic && <MicIcon />}
      {onChange && value && (
        <button type="button" className="studio-ipad-searchfield-clear" aria-label="Clear text" onClick={() => onChange("")}>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="currentColor" /><path d="m6.5 6.5 7 7m0-7-7 7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
  );
}

export function MicIcon() {
  return (
    <svg className="studio-ipad-mic" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="7" y="2" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3M7 18h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
