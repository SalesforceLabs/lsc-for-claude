import React from "react";
import type { PublishedDashboard } from "./published-types";
import { AstroIcon, EmptyArt } from "./IpadHome";
import "./record.css";

/** The Account Dashboard tab's cards (AccountSummary, AccountManagementDashboard, NextBestActions, AccountMapDisplay). */

const Sparkle = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
    <path d="m11 1 2.4 7.6L21 11l-7.6 2.4L11 21l-2.4-7.6L1 11l7.6-2.4Z" fill="#0b5cff" />
  </svg>
);

export function SummaryCard({ data }: { data: PublishedDashboard }) {
  const s = data.summary;
  return (
    <div className="studio-ipad-rec-card dash summary">
      <div className="studio-ipad-rec-dash-head">
        <AstroIcon size={22} />
        <span>Provider Summary</span>
        <Sparkle />
      </div>
      {s ? (
        <div className="studio-ipad-rec-sum">
          <div className="studio-ipad-rec-sum-date">{s.generated}</div>
          {s.sections.map((sec, i) => (
            <div key={i} className="studio-ipad-rec-sum-sec">
              <div className="studio-ipad-rec-sum-title">{sec.title}</div>
              <ul>
                {sec.items.map((x, j) => (
                  <li key={j}>{x}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <div className="studio-ipad-rec-dash-empty tall">
          <EmptyArt height={344} />
          <div>No data available</div>
        </div>
      )}
    </div>
  );
}

export function OverviewCard({ data }: { data: PublishedDashboard }) {
  const o = data.overview;
  return (
    <div className="studio-ipad-rec-card dash">
      <div className="studio-ipad-rec-dash-box overview">
        <div className="studio-ipad-rec-ov-title">Overview</div>
        <div className="studio-ipad-rec-ov-label">Specialties</div>
        {o.specialties.length === 0 ? (
          <div className="studio-ipad-rec-ov-none">No specialties to display</div>
        ) : (
          <div className="studio-ipad-rec-ov-list">
            {o.specialties.map((s, i) => (
              <span key={i} className="studio-ipad-rec-ov-chip">
                {s.primary && <Star />}
                {s.label}
              </span>
            ))}
          </div>
        )}
        <div className="studio-ipad-rec-ov-legend">
          <Star />
          <span>Primary Specialty</span>
          {o.target && <span className="studio-ipad-rec-ov-target">Target</span>}
        </div>
      </div>
    </div>
  );
}

const Star = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <path d="m10 1.5 2.5 5.3 5.8.8-4.2 4.1 1 5.8L10 14.7l-5.1 2.8 1-5.8L1.700 7.600l5.800-.8Z" fill="#0b6e6a" />
  </svg>
);

export function NextBestActionsCard({ data }: { data: PublishedDashboard }) {
  const n = data.nba;
  return (
    <div className="studio-ipad-rec-card dash">
      <div className="studio-ipad-rec-dash-box nba">
        <div className="studio-ipad-rec-nba-head">
          <span className="link">‹ Previous Week</span>
          <b>Next Best Action ({n.week.replace(" – ", "–")})</b>
          <span className="link">Next Week ›</span>
        </div>
        {n.items.length === 0 ? (
          <div className="studio-ipad-rec-dash-empty">
            <EmptyArt height={128} />
            <div>No recommended actions</div>
          </div>
        ) : (
          <div className="studio-ipad-rec-nba-list">
            {n.items.map((x) => (
              <div key={x.id} className="studio-ipad-rec-nba-item">
                <div className="t">{x.title || x.type}</div>
                <div className="s">
                  {[x.type, x.due, x.status].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="studio-ipad-rec-nba-all">View All Actions</div>
      </div>
    </div>
  );
}

export function MapCard({ data }: { data: PublishedDashboard }) {
  const m = data.map;
  return (
    <div className="studio-ipad-rec-card dash mapcard">
      <div className="studio-ipad-rec-map" aria-label="Map">
        <div className="studio-ipad-rec-map-panel">
          <div className="h">Address</div>
          <div className="a">{m.address || "No address"}</div>
          {m.license !== "disabled" && m.address && (
            <span className={`studio-ipad-rec-map-pill${m.license === "validated" ? "" : " bad"}`}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M7 1 12 3v4c0 3-2.200 5-5 6-2.800-1-5-3-5-6V3Z" fill="currentColor" />
              </svg>
              State
            </span>
          )}
          <span className="studio-ipad-rec-map-dir">Get Directions</span>
        </div>
        <div className="studio-ipad-rec-map-note">On the iPad Apple Maps draws the map here; this preview shows the address only.</div>
      </div>
    </div>
  );
}
