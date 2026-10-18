import React, { useMemo, useState } from "react";
import type { PublishedIpad, PublishedTab } from "./published-types";
import { textWidth } from "./IpadRecord";
import { fabState, menuLayout, MENU, recordFabItems } from "./ipad-fabs-logic";
import type { PublishedFabItem } from "./screens/fabs-types";
import IpadActionSheet from "./IpadActionSheets";
import { AGENT_BUTTON, presentationFor, type Presentation } from "./ipad-fab-actions";
import { editAttrs, useEditOn } from "./EditLayer";
import type { DraftState } from "./edit-draft";
import "./fabs.css";

/** agent_astro.svg (OCEDemo/Assets.xcassets), template-tinted with the accent color. */
const ASTRO_PATHS = [
  "M31.49,27.62h.02c-.82.07-1.55.21-2.18.41,0,0-.92.29-2.33.49-.33.05-.75.05-.98.05h-.17c-.23,0-.66-.02-.98-.07-1.41-.23-2.32-.55-2.32-.55-.63-.2-1.36-.35-2.18-.44-4.49-.46-6.43,1.25-6.54,1.57-.11.32.38,4.48.74,5.14.35.65.89,1.03,1.38,1.24.5.21,4.61.62,5.98.43,1.37-.19,1.58-.65,1.95-1.35.26-.5.93-2.76,1.3-4.09.09-.26.1-.78.73-.82.63.05.64.58.72.84.36,1.33.99,3.61,1.24,4.11.35.71.56,1.17,1.93,1.39,1.36.21,5.48-.12,5.98-.32.5-.2,1.04-.57,1.4-1.22.36-.65.92-4.8.82-5.12-.1-.33-2.01-2.07-6.51-1.69Z",
  "M45.52,14.55h.01c-1.25-1.59-2.73-3-4.37-4.21,1.7-.3,2.99-1.78,2.99-3.56,0-2-1.62-3.63-3.63-3.63s-3.63,1.62-3.63,3.63c0,.4.08.78.2,1.14-2.58-1.22-5.4-2.02-8.35-2.33-4.94-.52-9.71.36-13.82,2.3.11-.35.19-.72.19-1.11,0-2-1.62-3.63-3.63-3.63s-3.63,1.62-3.63,3.63c0,1.78,1.28,3.25,2.96,3.56-4.66,3.44-7.91,8.45-8.65,14.26-.69,5.37.84,10.75,4.32,15.15,3.94,4.98,10.06,8.25,16.78,8.96.94.1,1.87.15,2.79.15,11.99,0,22.37-8.14,23.79-19.16.69-5.37-.84-10.75-4.32-15.15ZM26.02,42.66h-.01c-9.02-.01-16.36-6.03-16.36-13.43,0-2.23.68-4.37,1.91-6.27.11.68.31,1.27.53,1.71.3.6.9.95,1.53.95.25,0,.51-.05.75-.17.85-.41,1.2-1.43.81-2.28-.21-.45-.75-1.94.56-3.08,1.27,1.15,3.09,2.5,5.14,3.16,3.82,1.21,6.71.5,6.83.47.58-.15,1.03-.58,1.21-1.15.18-.57.05-1.19-.34-1.63-1.93-2.22-2.85-3.84-3.25-4.82,7.82,1.06,9.32,7.29,9.38,7.57.17.8.88,1.35,1.67,1.35.12,0,.23-.01.35-.04.93-.19,1.52-1.1,1.33-2.03-.24-1.16-.87-2.73-1.99-4.3,3.83,2.46,6.31,6.28,6.31,10.57,0,7.4-7.34,13.42-16.36,13.42Z",
];

function AstroGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 52 52" aria-hidden="true">
      {ASTRO_PATHS.map((d, i) => (
        <path key={i} d={d} fill="#0250d9" />
      ))}
    </svg>
  );
}

const ASTRO_LABEL = "Ask Agentforce";

/** The Agentforce AnimatedButton: a 60pt circle that expands to show its label ~1s after it appears, then collapses (animateOnAppear / resetValues). */
function Astro({ onOpen }: { onOpen: () => void }) {
  const labelWidth = Math.ceil(textWidth(ASTRO_LABEL, 17, 400));
  return (
    <button type="button" className="studio-ipad-fab-astro" style={{ "--label-w": `${labelWidth}px` } as React.CSSProperties} onClick={onOpen} aria-label={ASTRO_LABEL}>
      <AstroGlyph />
      <span className="studio-ipad-fab-astro-label">{ASTRO_LABEL}</span>
    </button>
  );
}

function Dots() {
  return (
    <svg width="30" height="8" viewBox="0 0 30 8" aria-hidden="true">
      <circle cx="4" cy="4" r="3.6" fill="#fff" />
      <circle cx="15" cy="4" r="3.6" fill="#fff" />
      <circle cx="26" cy="4" r="3.6" fill="#fff" />
    </svg>
  );
}

/** VerticallyStackedQuickActionsViewController: a dim over the screen, the stacked action capsules, and the ••• turned into a white close button. An item closes the menu and opens what the app presents for it (IpadActionSheets); the preview never runs the action. */
function Menu({ items, states, object, onClose, onPick }: { items: PublishedFabItem[]; states?: DraftState[]; object?: string; onClose: () => void; onPick: (item: PublishedFabItem) => void }) {
  const { width, tops } = useMemo(() => menuLayout(items.map((i) => textWidth(i.label, 18, 600))), [items]);
  const editing = useEditOn();
  return (
    <>
      <div className="studio-ipad-fab-dim" onClick={onClose} />
      <div className="studio-ipad-fab-menu" onClick={onClose}>
        {items.map((a, i) => (
          <span
            key={a.name}
            className={`studio-ipad-fab-item${states?.[i] === "removed" ? " ghost" : states?.[i] === "added" || states?.[i] === "moved" ? " pending" : ""}`}
            title={a.name}
            role="button"
            {...editAttrs(
              editing,
              { kind: "action", name: a.name, label: a.label, index: i, place: object ? "record" : "home", ...(object ? { object } : {}) },
              false,
              // Draft drags the Home menu only; record actions come from the layout and have no order to change here.
              states && !object ? { family: "home-actions", id: a.name, ghost: states[i] === "removed" } : undefined
            )}
            onClick={(e) => {
              e.stopPropagation();
              onPick(a);
            }}
            style={{ top: tops[i], width, height: MENU.height, animationDelay: `${(items.length - 1 - i) * 0.02}s` }}>
            {a.label}
          </span>
        ))}
      </div>
      <button type="button" className="studio-ipad-fab-close" onClick={onClose} aria-label="Close actions">
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <path d="M5 5l18 18M23 5L5 23" stroke="#0250d9" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </button>
    </>
  );
}

/**
 * The floating buttons over a screen: Agentforce and the ••• quick-action menu, where the app adds them
 * (see fabState). ••• toggles its menu; a menu item or the Agentforce button opens a drawn copy of what
 * the app presents (IpadActionSheets). The preview never saves or calls the org.
 */
export default function IpadFabs({
  snapshot,
  tab,
  record,
  agentforce,
  homeMenu,
}: {
  snapshot: PublishedIpad;
  tab: PublishedTab | undefined;
  record: string | null;
  agentforce: boolean;
  /** Draft's Home menu (edit mode), in place of the published one. */
  homeMenu?: { value: PublishedFabItem; state: DraftState }[];
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Presentation | null>(null);
  const rec = record ? snapshot.records?.byId[record] : undefined;
  const fabs = snapshot.screens?.fabs;
  const onHome = !rec && tab?.kind === "home" && record === null;
  const items = rec ? recordFabItems(fabs, rec.object, rec.recordType ?? undefined) : onHome ? (homeMenu?.map((d) => d.value) ?? fabs?.home ?? []) : [];
  const states = onHome ? homeMenu?.map((d) => d.state) : undefined;
  const state = fabState({ kind: tab?.kind, onRecord: !!rec, menuCount: items.length, agentforce });
  if (!state.astro && !state.more) return null;
  return (
    <div key={`${tab?.fullName}:${record ?? ""}`} className="studio-ipad-fabs-layer">
      <div className={`studio-ipad-fab-row${shown?.kind === "visit" ? " over" : ""}`}>
        {state.astro && shown?.kind !== "visit" && <Astro onOpen={() => setShown(AGENT_BUTTON)} />}
        {state.more && (
          <button type="button" className="studio-ipad-fab-more" onClick={() => setOpen(!open)} aria-label="More actions">
            <Dots />
          </button>
        )}
      </div>
      {open && state.more && (
        <Menu
          items={items}
          states={states}
          object={rec?.object}
          onClose={() => setOpen(false)}
          onPick={(item) => {
            setOpen(false);
            setShown(presentationFor(item, { onRecord: !!rec }));
          }}
        />
      )}
      {shown && (
        <IpadActionSheet
          presentation={shown}
          ctx={{ snapshot, record: rec && record ? { id: record, object: rec.object, title: rec.title } : null }}
          onClose={() => setShown(null)}
        />
      )}
    </div>
  );
}
