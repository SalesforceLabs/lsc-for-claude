import React from "react";
import "./interact.css";

/** Transparent backdrop + floating popover (UIPopoverPresentationController look). Placed inside a positioned screen root; coordinates are page pixels. */
export function Popover({
  left,
  top,
  width,
  height,
  arrowX,
  onClose,
  children,
  className = "",
}: {
  left: number;
  top: number;
  width: number;
  height?: number;
  /** Arrow tip x in page pixels (omit for none). */
  arrowX?: number;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <>
      <div className="studio-ipad-interact-backdrop" onClick={onClose} />
      <div className={`studio-ipad-interact-popover ${className}`} style={{ left, top, width, height }}>
        {arrowX !== undefined && <span className="studio-ipad-interact-arrow" style={{ left: arrowX - left - 10 }} />}
        {children}
      </div>
    </>
  );
}

/** Popover left edge for a button: centred on it, clamped to a 20pt margin of the 1210pt page. */
export function popoverLeft(buttonCenterX: number, width: number, pageWidth = 1210): number {
  return Math.max(20, Math.min(pageWidth - 20 - width, Math.round(buttonCenterX - width / 2)));
}

/** An element's box in the screen root's own pixels (the preview may scale the page, so divide the viewport rect by the scale). */
export function pageBox(el: Element, root: Element): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  const o = root.getBoundingClientRect();
  const scale = o.width / ((root as HTMLElement).offsetWidth || o.width || 1);
  return { x: (r.left - o.left) / scale, y: (r.top - o.top) / scale, w: r.width / scale, h: r.height / scale };
}

/** A plain text menu (UIMenu-style popover rows). */
export function TextMenu({ items, tone = "blue", onPick }: { items: { label: string; danger?: boolean }[]; tone?: "blue"; onPick: (label: string, index: number) => void }) {
  return (
    <div className={`studio-ipad-interact-textmenu ${tone}`}>
      {items.map((it, i) => (
        <button key={`${it.label}${i}`} type="button" className={it.danger ? "danger" : ""} onClick={() => onPick(it.label, i)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** A full-page modal sheet for flows the preview can't reproduce: states what the iPad does. */
export function Sheet({ title, closeLabel = "Close", note, onClose, children }: { title: string; closeLabel?: string; note: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className="studio-ipad-interact-sheet-wrap">
      <div className="studio-ipad-interact-sheet">
        <div className="studio-ipad-interact-sheet-bar">
          <button type="button" className="studio-ipad-interact-sheet-close" onClick={onClose}>
            {closeLabel}
          </button>
          <span className="studio-ipad-interact-sheet-title">{title}</span>
        </div>
        <div className="studio-ipad-interact-sheet-body">
          {children}
          <p className="studio-ipad-interact-sheet-note">{note}</p>
        </div>
      </div>
    </div>
  );
}

/** The "no data" illustration (mountains and clouds) with its caption. */
export function EmptyArt({ text }: { text: string }) {
  return (
    <div className="studio-ipad-interact-empty">
      <svg width="220" height="150" viewBox="0 0 220 150" aria-hidden="true">
        <defs>
          <linearGradient id="studio-ipad-interact-mtn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fb1ff" />
            <stop offset="1" stopColor="#3f6cf6" />
          </linearGradient>
        </defs>
        <path d="M45 120 100 28l55 92Z" fill="#c6d6fb" />
        <ellipse cx="62" cy="108" rx="40" ry="20" fill="#dbe6fd" />
        <path d="M95 125 140 52l45 73Z" fill="url(#studio-ipad-interact-mtn)" />
        <ellipse cx="140" cy="86" rx="26" ry="12" fill="#d3e0fc" opacity=".85" />
        <path d="M33 78l3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" fill="#2b4ea8" />
        <path d="M188 82l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#2b4ea8" />
        <path d="M150 16l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="none" stroke="#a9c0f5" strokeWidth="1.2" />
      </svg>
      <div className="studio-ipad-interact-empty-text">{text}</div>
    </div>
  );
}

export function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="m3 9.5 4 4L15 4.5" fill="none" stroke="#0a74ff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
