import React, { useState } from "react";
import "./chrome.css";
import { IpadSearchField } from "./IpadChrome";
import type { PublishedIpad } from "./published-types";

/** What a top-bar button or list control opens. `label` names the sheet for "new". */
export type ChromeSheet = { kind: "alerts" | "profile" | "briefings" } | { kind: "new"; label: string };

const NOTE = "Preview only: Studio does not run this action.";

/** A page-sheet over the screen (UISheetPresentationController, formSheet). */
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
  switch (sheet.kind) {
    case "alerts":
      return <AlertsModal onClose={onClose} />;
    case "profile":
      return <ProfileSheet snapshot={snapshot} onClose={onClose} />;
    case "briefings":
      return (
        <Sheet className="small">
          <button type="button" className="studio-ipad-chrome-done" onClick={onClose}>Done</button>
          <div className="studio-ipad-chrome-h">Briefings</div>
          <p className="studio-ipad-chrome-p">On the iPad this opens the Stories audio player with the user's daily briefing. {NOTE}</p>
        </Sheet>
      );
    case "new":
      return (
        <Sheet className="small">
          <button type="button" className="studio-ipad-chrome-done" onClick={onClose}>Cancel</button>
          <div className="studio-ipad-chrome-h">{sheet.label}</div>
          <p className="studio-ipad-chrome-p">On the iPad this opens the new record form for the object. {NOTE}</p>
        </Sheet>
      );
  }
}

/** The Alerts modal: pink bell title, close button, three pills (NotificationSQLBuilder). */
function AlertsModal({ onClose }: { onClose: () => void }) {
  const [pill, setPill] = useState("Alerts");
  return (
    <div className="studio-ipad-chrome-modal" role="dialog">
      <div className="studio-ipad-chrome-modal-head">
        <span className="studio-ipad-chrome-bellbadge" aria-hidden="true">{BELL(22)}</span>
        <span className="studio-ipad-chrome-modal-title">Alerts</span>
        <button type="button" className="studio-ipad-chrome-x" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 18 18"><path d="m3 3 12 12M15 3 3 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="studio-ipad-chrome-pills">
        {["Alerts", "Recommendations", "Guided Actions"].map((p) => (
          <button key={p} type="button" className={`studio-ipad-chrome-pill${p === pill ? " current" : ""}`} onClick={() => setPill(p)}>
            {p}
          </button>
        ))}
      </div>
      <div className="studio-ipad-chrome-empty">
        Alerts are AppAlert records the viewer can read. Studio does not read them yet, so this list is not shown. {NOTE}
      </div>
    </div>
  );
}

/** UserProfile sheet: avatar, name, profile, Begin Sync (confirm only), View Database, Territory, View Online. */
function ProfileSheet({ snapshot, onClose }: { snapshot: PublishedIpad; onClose: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const name = snapshot.viewer?.name ?? snapshot.profile;
  const letters = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <Sheet className="profile">
      <button type="button" className="studio-ipad-chrome-done" onClick={onClose}>Done</button>
      <div className="studio-ipad-chrome-avatar">{letters}</div>
      <div className="studio-ipad-chrome-name">{name}</div>
      <div className="studio-ipad-chrome-profile">{snapshot.profile}</div>
      <button type="button" className="studio-ipad-chrome-sync" onClick={() => setConfirm(true)}>
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M18 8A7.5 7.5 0 0 0 4.5 7M4 14a7.5 7.5 0 0 0 13.5 1M4.5 3v4.5H9M17.5 19v-4H13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Begin Sync
      </button>
      <div className="studio-ipad-chrome-hint">When the sync is in progress, you will be unable to access the app.</div>
      <div className="studio-ipad-chrome-row">View Database</div>
      <div className="studio-ipad-chrome-section">Territory</div>
      <div className="studio-ipad-chrome-row left">Territories are read per user in the Territory and Users map.</div>
      <div className="studio-ipad-chrome-row">View Online</div>
      <div className="studio-ipad-chrome-row">Change Passcode</div>
      <div className="studio-ipad-chrome-row danger">Log out</div>
      {confirm && (
        <div className="studio-ipad-chrome-alert" role="alertdialog">
          <div className="studio-ipad-chrome-alert-box">
            <div className="studio-ipad-chrome-h">Begin Sync?</div>
            <p className="studio-ipad-chrome-p">{NOTE}</p>
            <button type="button" className="studio-ipad-chrome-alert-btn" onClick={() => setConfirm(false)}>OK</button>
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
