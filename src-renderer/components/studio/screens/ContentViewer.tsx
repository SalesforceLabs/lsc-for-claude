import React, { useEffect, useState } from "react";
import type { PublishedContentCard } from "./content-types";
import { slideLabel } from "./content-logic";
import "./content-viewer.css";

/** The stored image of page `i` (0-based): the first-page image, or a later page's when it was rendered. */
function pageImage(card: PublishedContentCard, i: number): string | undefined {
  return i === 0 ? card.thumbnail : card.pageThumbnails?.[i - 1] ?? undefined;
}

/**
 * The CLM player (PresentationViewController) with its bottom bar shown, as on the device after a tap on the bottom edge.
 * The snapshot keeps only each presentation's first-page image, so page 1 is real and the other pages are labelled stand-ins.
 */
export default function ContentViewer({ card, onClose }: { card: PublishedContentCard; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(true);
  const [rate, setRate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPaused(false), 2600);
    return () => clearTimeout(t);
  }, []);
  const pages = Math.max(1, card.pages);
  return (
    <div className="studio-ipad-content-viewer">
      <div className="studio-ipad-content-viewer-stage">
        {pageImage(card, page) ? (
          <img src={pageImage(card, page)!} alt="" />
        ) : (
          <div className="studio-ipad-content-viewer-standin">
            <strong>{card.name}</strong>
            <span>Page {page + 1}</span>
            <small>{page === 0 ? "No preview image is stored for this presentation." : "Studio has no stored image for this page; the iPad renders every page."}</small>
          </div>
        )}
        {paused && <div className="studio-ipad-content-viewer-paused">Session Time Paused</div>}
      </div>
      <div className="studio-ipad-content-viewer-bar">
        <div className="studio-ipad-content-viewer-row">
          <div className="studio-ipad-content-viewer-seg">
            <span>Presentations</span>
            <span>Favorites</span>
            <span className="on">Pages</span>
          </div>
          <button type="button" className="studio-ipad-content-viewer-circle" aria-label="Search">
            <svg width="20" height="20" viewBox="0 0 18 18">
              <circle cx="7.5" cy="7.5" r="5.2" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="m11.6 11.6 4.4 4.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <span className="spacer" />
          <button type="button" className="studio-ipad-content-viewer-circle" aria-label="Pen">
            ✎
          </button>
          <button type="button" className="studio-ipad-content-viewer-circle" aria-label="Lock">
            ⚿
          </button>
          <button type="button" className="studio-ipad-content-viewer-circle" aria-label="Play">
            ▶
          </button>
          <span className="spacer wide" />
          <button type="button" className="studio-ipad-content-viewer-circle" aria-label="Add Attendees">
            +
          </button>
          <button type="button" className="studio-ipad-content-viewer-circle" aria-label="Quick Actions">
            ⋮
          </button>
          <button type="button" className="studio-ipad-content-viewer-pill">
            Visit
          </button>
          <button type="button" className="studio-ipad-content-viewer-pill close" onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <div className="studio-ipad-content-viewer-title">
          <span className="name">{card.name}</span>
          <span className="count">{slideLabel(page, pages)}</span>
          <label className="rate">
            <input type="checkbox" checked={rate} onChange={(e) => setRate(e.target.checked)} />
            <span className="switch" />
            <span>Rate Content</span>
          </label>
        </div>
        <div className="studio-ipad-content-viewer-strip">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" className="studio-ipad-content-viewer-page" onClick={() => setPage(i)}>
              <span className={`thumb${i === page ? " on" : ""}`}>{pageImage(card, i) ? <img src={pageImage(card, i)!} alt="" /> : <em>Page {i + 1}</em>}</span>
              <span className="num">{i + 1}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
