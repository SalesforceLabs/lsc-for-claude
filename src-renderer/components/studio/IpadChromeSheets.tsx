import React, { useState } from "react";
import "./chrome.css";
import { IpadSearchField, IpadStatusBar } from "./IpadChrome";
import { EmptyArt } from "./IpadHome";
import { initials } from "./ipad-chrome";
import type { PublishedIpad } from "./published-types";
import type { AlertPill, PublishedChrome } from "./screens/chrome-types";

/** What a top-bar button opens. */
export type ChromeSheet = { kind: "alerts" | "profile" | "briefings" };

const NOTE = "Preview only: Studio does not run this action.";

/** A form sheet over a dim (UISheetPresentationController, formSheet): 590 x 642pt, centered. */
function Sheet({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="studio-ipad-chrome-scrim">
      <div className={`studio-ipad-chrome-sheet ${className}`} role="dialog">
        {children}
      </div>
    </div>
  );
}

/** The sheets behind the top-bar buttons (TabsCoordinator, UserProfileCoordinator, StoriesCoordinator). */
export function ChromeSheets({ sheet, snapshot, onClose }: { sheet: ChromeSheet | null; snapshot: PublishedIpad; onClose: () => void }) {
  if (!sheet) return null;
  const chrome = snapshot.screens?.chrome;
  switch (sheet.kind) {
    case "alerts":
      return <AlertsModal chrome={chrome} onClose={onClose} />;
    case "profile":
      return <ProfileSheet snapshot={snapshot} chrome={chrome} onClose={onClose} />;
    case "briefings":
      return <BriefingsPlayer onClose={onClose} />;
  }
}

/** StoriesCoordinator: the first-run "Audio briefings are AI-generated" card, then the mini player (Stop ends it, Hide collapses it). The track is the org's briefing content, which Studio doesn't read. */
function BriefingsPlayer({ onClose }: { onClose: () => void }) {
  const [intro, setIntro] = useState(true);
  const [hidden, setHidden] = useState(false);
  return (
    <div className="studio-ipad-chrome-brief">
      {intro && (
        <div className="studio-ipad-chrome-brief-card" role="dialog">
          <svg width="130" height="115" viewBox="0 0 130 115" aria-hidden="true">
            <circle cx="52" cy="66" r="46" fill="none" stroke="#d3e1fb" strokeWidth="9" />
            <path d="M40 44v44l38-22-38-22Z" fill="#d3e1fb" />
            <path d="m100 12 4.5 11 11 4.5-11 4.5-4.5 11-4.5-11-11-4.5 11-4.5 4.5-11ZM116 50l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5 2.5-6Z" fill="#d3e1fb" />
          </svg>
          <div className="studio-ipad-chrome-brief-title">Audio briefings are AI-generated</div>
          <div className="studio-ipad-chrome-brief-body">Generative AI can produce inaccurate responses. Review responses carefully</div>
          <button type="button" className="studio-ipad-chrome-brief-ok" onClick={() => setIntro(false)}>Got It</button>
        </div>
      )}
      {!hidden && (
        <div className="studio-ipad-chrome-brief-bar">
          <span className="grip" />
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10v4M7 7v10M11 3v18M15 7v10M19 10v4" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>
          <span className="track">
            <span className="name">Daily Briefings</span>
            <span className="progress" />
          </span>
          <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true"><path d="M3 1v14M18 1v14L7 8l11-7Z" fill="#7d8aa5" stroke="#7d8aa5" strokeWidth="1.5" strokeLinejoin="round" /></svg>
          <span className="play"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5v15l13-7.5-13-7.5Z" fill="#fff" /></svg></span>
          <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true"><path d="M17 1v14M2 1v14l11-7L2 1Z" fill="#fff" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" /></svg>
          <button type="button" className="act" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" fill="#fff" /></svg>Stop
          </button>
          <button type="button" className="act" onClick={() => setHidden(true)}>
            <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true"><path d="M1 8s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Zm2-7 12 14" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>Hide
          </button>
        </div>
      )}
    </div>
  );
}

const PILLS: { key: AlertPill; label: string; empty: string }[] = [
  { key: "alerts", label: "Alerts", empty: "No alerts to display" },
  { key: "recommendations", label: "Recommendations", empty: "No recommendations to display" },
  { key: "guidedActions", label: "Guided Actions", empty: "No guided actions to display" },
];

/** NotificationViewController: pink bell title, close button, three pills, then the cards or the empty placeholder. */
function AlertsModal({ chrome, onClose }: { chrome: PublishedChrome | undefined; onClose: () => void }) {
  const [pill, setPill] = useState<AlertPill>("alerts");
  const shown = chrome?.alerts.filter((a) => a.pill === pill) ?? [];
  const label = PILLS.find((p) => p.key === pill)!;
  return (
    <div className="studio-ipad-chrome-modal" role="dialog">
      <IpadStatusBar />
      <div className="studio-ipad-chrome-modal-head">
        <span className="studio-ipad-chrome-bellbadge" aria-hidden="true">{BELL(26)}</span>
        <span className="studio-ipad-chrome-modal-title">Alerts</span>
        <button type="button" className="studio-ipad-chrome-x" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 18 18"><path d="m3 3 12 12M15 3 3 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="studio-ipad-chrome-pills">
        {PILLS.map((p) => (
          <button key={p.key} type="button" className={`studio-ipad-chrome-pill${p.key === pill ? " current" : ""}`} onClick={() => setPill(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      {!chrome ? (
        <div className="studio-ipad-chrome-empty-card">
          <div className="studio-ipad-h-empty-title">Alerts could not be read</div>
        </div>
      ) : shown.length === 0 ? (
        <div className="studio-ipad-chrome-empty-card">
          <EmptyArt height={192} />
          <div className="studio-ipad-h-empty-title">{label.empty}</div>
        </div>
      ) : (
        <div className="studio-ipad-chrome-alerts">
          {shown.map((a) => (
            <div key={a.id} className="studio-ipad-chrome-alert-card">
              <span className="studio-ipad-chrome-alert-icon" aria-hidden="true">
                <svg width="20" height="16" viewBox="0 0 20 16"><path d="M2 1h11a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 10H7l-3.5 3.5V10H2A1.5 1.5 0 0 1 .5 8.5v-6A1.5 1.5 0 0 1 2 1Zm14 2a3.5 3.5 0 0 1 0 6" fill="#fff" stroke="#fff" strokeWidth="1.2" /></svg>
              </span>
              <div className="studio-ipad-chrome-alert-main">
                <div className="studio-ipad-chrome-alert-when">{a.when}</div>
                <div className="studio-ipad-chrome-alert-title">{a.title}</div>
                <div className="studio-ipad-chrome-alert-body" dangerouslySetInnerHTML={{ __html: a.body }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** LSCAdaptiveProfileView: identity, Begin Sync (a confirm only here), View Database, Territory, then the account actions. */
function ProfileSheet({ snapshot, chrome, onClose }: { snapshot: PublishedIpad; chrome: PublishedChrome | undefined; onClose: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const name = snapshot.viewer?.name ?? snapshot.profile;
  const p = chrome?.profile;
  return (
    <Sheet className="profile">
      <button type="button" className="studio-ipad-chrome-done" onClick={onClose}>Done</button>
      <div className="studio-ipad-chrome-avatar">{initials(name)}</div>
      <div className="studio-ipad-chrome-name">{name}</div>
      <div className="studio-ipad-chrome-profile">{snapshot.profile}</div>
      {p?.username && <div className="studio-ipad-chrome-username">{p.username}</div>}
      <button type="button" className="studio-ipad-chrome-sync" onClick={() => setConfirm(true)}>
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M18 8A7.5 7.5 0 0 0 4.5 7M4 14a7.5 7.5 0 0 0 13.5 1M4.5 3v4.5H9M17.5 19v-4H13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Begin Sync
      </button>
      {p?.synced && <div className="studio-ipad-chrome-synced">Synced: {p.synced}</div>}
      <div className="studio-ipad-chrome-hint">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.5" fill="#706e6b" /><rect x="7.2" y="7" width="1.6" height="5" fill="#fff" /><circle cx="8" cy="4.8" r="1" fill="#fff" /></svg>
        When the sync is in progress, you will be unable to access the app.
      </div>
      <div className="studio-ipad-chrome-row">View Database</div>
      <div className="studio-ipad-chrome-section">Territory</div>
      {p?.territory && (
        <div className="studio-ipad-chrome-row territory">
          <span>{p.territory}</span>
          <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true"><path d="m2 2 8 8-8 8" fill="none" stroke="#5c5c5c" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
      )}
      <div className="studio-ipad-chrome-row view-online">View Online</div>
      <div className="studio-ipad-chrome-row">Change Passcode</div>
      <div className="studio-ipad-chrome-row danger">Log out</div>
      {confirm && (
        <div className="studio-ipad-chrome-alert" role="alertdialog">
          <div className="studio-ipad-chrome-alert-box">
            <div className="studio-ipad-chrome-h">Begin Sync?</div>
            <p className="studio-ipad-chrome-p">{NOTE}</p>
            <button type="button" className="studio-ipad-chrome-alert-btn" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export const BELL = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5v4l-2 3.5v1h17v-1l-2-3.5V9A6.5 6.5 0 0 0 12 2.5Zm-2.6 16.5a2.6 2.6 0 0 0 5.2 0H9.4Z" fill="currentColor" />
  </svg>
);

/** The Search tab (SearchTabView): title, white card with the search field and Recent Items. */
export function SearchTab() {
  return (
    <div className="studio-ipad-chrome-search">
      <div className="studio-ipad-chrome-search-title">Search</div>
      <div className="studio-ipad-chrome-search-card">
        <IpadSearchField className="wide" />
        <div className="studio-ipad-chrome-recent">Recent Items</div>
        <div className="studio-ipad-chrome-recent-empty">
          Recent items are kept on each device, so Studio cannot show them. They appear here as the rep opens records.
        </div>
      </div>
    </div>
  );
}
