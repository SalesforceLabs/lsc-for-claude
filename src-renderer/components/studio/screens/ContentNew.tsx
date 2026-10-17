import React, { useState } from "react";
import type { PublishedContent } from "./content-types";
import { inSegment } from "./content-logic";
import { EmptyArt, ScreenLayer } from "./interact-ui";
import "./content-new.css";

/** "Jun 8, 2026" -> "6/8/26", as the builder lists dates; anything unparseable is shown as stored. */
export function shortDate(date: string): string {
  const t = Date.parse(`${date} UTC`);
  if (Number.isNaN(t)) return date;
  const d = new Date(t);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
}

/**
 * The New Presentation builder (CLMCustomPresentationViewController): the viewer's presentations on the left, the pages added so far on the right.
 * Full screen at the screen layer; the preview lists presentations but never builds one.
 */
export default function ContentNew({ data, onClose }: { data: PublishedContent; onClose: () => void }) {
  const [segment, setSegment] = useState("Presentations");
  const [search, setSearch] = useState("");
  const manage = data.segments.includes("My Presentations");
  const needle = search.trim().toLowerCase();
  const cards = data.cards.filter((c) => (!needle || c.name.toLowerCase().includes(needle)) && inSegment(c, segment, manage, new Set()));
  return (
    <ScreenLayer>
      <div className="studio-ipad-content-new">
        <div className="studio-ipad-content-new-bar">
          <button type="button" className="close" onClick={onClose}>
            Close
          </button>
          <b>New Presentation</b>
          <span className="off save">Save</span>
          <span className="off saveas">Save as</span>
        </div>
        <div className="studio-ipad-content-new-left">
          <div className="head">Presentations</div>
          <label className="search">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="8.500" cy="8.500" r="6" fill="none" stroke="#666" strokeWidth="1.800" />
              <path d="m13 13 5 5" stroke="#666" strokeWidth="1.800" strokeLinecap="round" />
            </svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search presentations…" spellCheck={false} />
          </label>
          <div className="seg">
            {["Presentations", "My Presentations"].map((s) => (
              <span key={s} className={s === segment ? "on" : ""} onClick={() => setSegment(s)}>
                {s}
              </span>
            ))}
          </div>
          <div className="list">
            {cards.map((c) => (
              <div key={c.id} className="row">
                <span className="thumb">{c.thumbnail ? <img src={c.thumbnail} alt="" /> : null}</span>
                <span className="name">{c.name}</span>
                <span className="meta">Last Updated: {shortDate(c.date)}</span>
                <span className="meta pages">{c.pages} Pages</span>
                <span className="chev" aria-hidden="true">
                  <svg width="10" height="16" viewBox="0 0 10 16">
                    <path d="m2 2 6 6-6 6" fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="studio-ipad-content-new-right">
          <div className="head">
            <svg className="panel" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
              <rect x="2" y="4" width="22" height="18" rx="2" fill="none" stroke="#0250d9" strokeWidth="2" />
              <rect x="2" y="4" width="8" height="18" fill="#0250d9" />
            </svg>
            <span className="title">New Presentation</span>
            <span className="pill remove">Remove</span>
            <span className="pill reorder">Reorder</span>
            <span className="pill details">Edit Details</span>
          </div>
          <div className="body">
            <EmptyArt text="No pages added" />
            <p>On the iPad you pick pages from your presentations here and save them. Studio doesn&apos;t build presentations.</p>
          </div>
        </div>
      </div>
    </ScreenLayer>
  );
}
