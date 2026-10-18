import React from "react";
import { IpadMap } from "./IpadMap";
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
        <div className="studio-ipad-rec-ov-title">Account Overview</div>
        <div className="studio-ipad-rec-ov-label">Account Specialties</div>
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

/** ActivityHistory: a timeline of the account's visits grouped by month (Today divider first). */
export function ActivityHistoryCard({ rows }: { rows: { id: string; cells: string[] }[] }) {
  const groups: { month: string; rows: { id: string; cells: string[] }[] }[] = [];
  for (const r of rows) {
    const g = groups.find((x) => x.month === r.cells[1]);
    if (g) g.rows.push(r);
    else groups.push({ month: r.cells[1] ?? "", rows: [r] });
  }
  return (
    <div className="studio-ipad-rec-card dash activity">
      <div className="studio-ipad-rec-act-bar">
        <span className="today">Today</span>
        <span className="cap">Calendar View</span>
        <span className="cap">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1 2h14l-5.5 6.5V14l-3-1.5V8.5Z" fill="currentColor" />
          </svg>
          Filters
        </span>
      </div>
      <div className="studio-ipad-rec-act-group">
        <div className="studio-ipad-rec-act-month">Today</div>
      </div>
      {groups.map((g) => (
        <div key={g.month} className="studio-ipad-rec-act-group">
          <div className="studio-ipad-rec-act-month">{g.month}</div>
          {g.rows.map((r) => (
            <div key={r.id} className="studio-ipad-rec-act-item">
              <svg className="chev" width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
                <path d="m3 2 7 7-7 7" fill="none" stroke="#0250d9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="dot">
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <circle cx="9" cy="6" r="3" fill="none" stroke="#fff" strokeWidth="1.5" />
                  <path d="M3 15c.5-3 3-4 6-4s5.5 1 6 4" fill="none" stroke="#fff" strokeWidth="1.5" />
                </svg>
              </span>
              <span className="bar" />
              <div className="body">
                <div className="t">{r.cells[2] || "Visit"}</div>
                <div className="l">Visit Details</div>
              </div>
              <span className="when">{r.cells[0]}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Points per degree: city-scale, the closest the offline base map draws honestly. */
const MAP_CARD_PPD = 400;

export function MapCard({ data }: { data: PublishedDashboard }) {
  const m = data.map;
  return (
    <div className="studio-ipad-rec-card dash mapcard">
      <div className="studio-ipad-rec-map" aria-label="Map">
        {m.geo && <IpadMap className="studio-ipad-rec-map-base" view={{ lat: m.geo[0], lon: m.geo[1], ppd: MAP_CARD_PPD }} showLabels={false} width={1139} height={305} />}
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
        <div className="studio-ipad-rec-map-note">{m.geo ? "The iPad draws street-level Apple Maps here; this preview shows the coast and borders only." : "On the iPad Apple Maps draws the map here; this account has no coordinates, so the preview shows the address only."}</div>
      </div>
    </div>
  );
}
