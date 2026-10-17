import React, { useState } from "react";
import { Sheet } from "./interact-ui";
import "./accounts-overlays.css";

/** A full-page modal (the iPad presents these over the whole screen, tabs included). */
function Modal({ title, left, right, rightOn = false, onLeft, onRight, children }: { title?: string; left: string; right: string; rightOn?: boolean; onLeft: () => void; onRight?: () => void; children: React.ReactNode }) {
  return (
    <div className="studio-ipad-accounts-modal">
      <div className="studio-ipad-accounts-modal-bar">
        <button type="button" className="left" onClick={onLeft}>
          {left}
        </button>
        <b>{title}</b>
        <button type="button" className={`right${rightOn ? " on" : ""}`} disabled={!rightOn} onClick={onRight}>
          {right}
        </button>
      </div>
      {children}
    </div>
  );
}

/** New Account: Advanced Search's type chooser (HCP, HCO, or by license ID). Next leads to Search Before Create, which the preview only describes. */
export function NewAccountModal({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [next, setNext] = useState(false);
  if (next)
    return (
      <Sheet
        title="New Account"
        closeLabel="Cancel"
        note={`On the iPad, Next searches for existing ${picked} accounts (Search Before Create) and then opens the New Account form. Studio doesn't create accounts.`}
        onClose={onClose}
      />
    );
  const options: { key: string; title: string; text: string; section: string }[] = [
    { key: "HCP", title: "HCP", text: "Search Healthcare Professional (HCP) Accounts", section: "Search by account type" },
    { key: "HCO", title: "HCO", text: "Search Healthcare Organization (HCO) Accounts", section: "Search by account type" },
    { key: "By ID", title: "By ID", text: "Search Business Licenses", section: "Search by License" },
  ];
  return (
    <Modal title="Advanced Search" left="Cancel" right="Next" rightOn={picked !== null} onLeft={onClose} onRight={() => setNext(true)}>
      <div className="studio-ipad-accounts-modal-body">
        {["Search by account type", "Search by License"].map((section) => (
          <div key={section} className="studio-ipad-accounts-modal-section">
            <div className="studio-ipad-accounts-modal-heading">{section}</div>
            {options
              .filter((o) => o.section === section)
              .map((o) => (
                <button key={o.key} type="button" className={`studio-ipad-accounts-modal-option${picked === o.key ? " on" : ""}`} onClick={() => setPicked(o.key)}>
                  <span className="dot" />
                  <span>
                    <b>{o.title}</b>
                    <small>{o.text}</small>
                  </span>
                </button>
              ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Search Online: matches outside the territory. The org answers it through the data-provider search, which the preview never calls. */
export function SearchOnlineModal({ onClose }: { onClose: () => void }) {
  const [more, setMore] = useState(false);
  return (
    <>
      <Modal left="Cancel" right="Use Selected" onLeft={onClose}>
        <div className="studio-ipad-accounts-modal-search">
          <input placeholder="Search..." spellCheck={false} />
        </div>
        <div className="studio-ipad-accounts-modal-empty">Matches from outside your territories appear here on the iPad.</div>
        <button type="button" className="studio-ipad-accounts-modal-more" onClick={() => setMore(true)}>
          More Search Options
        </button>
      </Modal>
      {more && <Sheet title="More Search Options" closeLabel="Close" note="On the iPad this opens the search filters (account type, specialty, address). Studio doesn't search outside your territories." onClose={() => setMore(false)} />}
    </>
  );
}

/** The dark multi-select bar over the cards' bottom edge. */
export function SelectBar({ selected, allLabel, onCancel, onAll, onUpdate, onAddTo }: { selected: number; allLabel: string; onCancel: () => void; onAll: () => void; onUpdate: () => void; onAddTo: (e: React.MouseEvent) => void }) {
  return (
    <div className="studio-ipad-accounts-selbar">
      <button type="button" className="cancel" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="all" onClick={onAll}>
        {allLabel}
      </button>
      <button type="button" className="update" disabled={selected === 0} onClick={onUpdate}>
        Update Selected
      </button>
      <button type="button" className="addto" onClick={onAddTo}>
        Add To...
      </button>
      <span className="count">
        {selected > 0 && <b>{selected} Selected</b>}
        <small>...Or drag selected to a list.</small>
      </span>
    </div>
  );
}

/** The map view (Apple Maps on the iPad). The preview has no map tiles, so it says so and lists what would be plotted. */
export function MapPanel({ plotted, onOptimize }: { plotted: number; onOptimize: () => void }) {
  return (
    <div className="studio-ipad-accounts-map-panel">
      <button type="button" className="fit" aria-label="Show all">
        ⤢
      </button>
      <button type="button" className="optimize" onClick={onOptimize}>
        Optimize View
      </button>
      <div className="note">
        <b>Map view</b>
        <span>On the iPad this is an Apple Map with {plotted} accounts plotted as pins. Studio doesn't render map tiles.</span>
      </div>
    </div>
  );
}
