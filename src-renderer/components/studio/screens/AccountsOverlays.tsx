import React, { useState } from "react";
import { createPortal } from "react-dom";
import { IpadMap, type IpadMapPin } from "../IpadMap";
import { Sheet } from "./interact-ui";
import "./accounts-overlays.css";

/** A full-page modal (the iPad presents these over the whole screen, tabs included). */
function Modal({ title, left, right, rightOn = false, onLeft, onRight, portalTo, children }: { portalTo?: Element | null; title?: string; left: string; right: string; rightOn?: boolean; onLeft: () => void; onRight?: () => void; children: React.ReactNode }) {
  const node = (
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
  return portalTo ? createPortal(node, portalTo) : node;
}

/** Search Online: matches outside the territory. The org answers it through the data-provider search, which the preview never calls. */
export function SearchOnlineModal({ onClose, portalTo }: { onClose: () => void; portalTo?: Element | null }) {
  const [more, setMore] = useState(false);
  return (
    <>
      <Modal portalTo={portalTo} left="Cancel" right="Use Selected" onLeft={onClose}>
        <div className="studio-ipad-accounts-modal-search">
          <input placeholder="Search..." spellCheck={false} />
        </div>
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

/** The map view (Apple Maps on the iPad): the accounts that have a coordinate, fitted the way MKMapView.showAnnotations does. */
export function MapPanel({ pins, onOptimize }: { pins: IpadMapPin[]; onOptimize: () => void }) {
  return (
    <IpadMap className="studio-ipad-accounts-map-panel" pins={pins} fit width={923} height={493}>
      <button type="button" className="fit" aria-label="Show all">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 7V4h3M14 4h3v3M17 13v3h-3M6 16H3v-3" fill="none" stroke="#0250d9" strokeWidth="1.600" strokeLinecap="round" />
          <circle cx="10" cy="10" r="2" fill="#0250d9" />
        </svg>
      </button>
      <button type="button" className="optimize" onClick={onOptimize}>
        Optimize View
      </button>
    </IpadMap>
  );
}
