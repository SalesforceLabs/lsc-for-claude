import React, { useState } from "react";
import { MetricDetail } from "./TableauDetail";
import type { ScreenProps } from "./types";
import "./tableau.css";

/** tableau_logo.svg from OCEDemo/Assets.xcassets (the colored plus marks). */
function TableauLogo(): React.ReactElement {
  return (
    <svg className="studio-ipad-tableau-logo" width="32" height="32" viewBox="0 0 32 32" fill="none">
      <path d="M15.0835 21.3327H16.8613V16.8044H21.3327V15.1943H16.8613V10.666H15.0835V15.1943H10.666V16.8044H15.0835V21.3327Z" fill="#E8762D" />
      <path d="M6.61766 28.7995H8.31463V24.2117H12.7995V22.778H8.31463V18.1328H6.61766V22.778H2.13281V24.2117H6.61766V28.7995Z" fill="#C72037" />
      <path d="M23.6587 13.8661H25.3461V8.79227H29.8659V7.27011H25.3461V2.13281H23.6587V7.27011H19.1992V8.79227H23.6587V13.8661Z" fill="#5B879B" />
      <path d="M14.2924 31.9996H15.5212V29.2974H18.1324V28.3018H15.5212V25.5996H14.2924V28.3018H11.7324V29.2974H14.2924V31.9996Z" fill="#5C6692" />
      <path d="M6.67827 13.8661H8.25403V8.72885H12.7995V7.27011H8.25403V2.13281H6.67827V7.27011H2.13281V8.72885H6.67827V13.8661Z" fill="#EB9129" />
      <path d="M28.1596 19.1991H29.3884V16.0787H31.9996V14.8528H29.3884V11.7324H28.1596V14.8528H25.5996V16.0787H28.1596V19.1991Z" fill="#5C6692" />
      <path fillRule="evenodd" clipRule="evenodd" d="M23.6587 28.7995H25.3461V24.2117H29.8659V22.778H25.3461V18.1328H23.6587V22.778H19.1992V24.2117H23.6587V28.7995Z" fill="#1F457E" />
      <path d="M18.1333 3.63677V2.77809H15.6218V0H14.7176V2.77809H12.2061V3.63677H14.7176V6.41486H15.6218V3.63677H18.1333ZM2.51154 18.1333H3.4157V15.3552H5.92724V14.4966H3.4157V11.769H2.51154V14.4966H0V15.4058L2.51154 15.3552V18.1333Z" fill="#7199A6" />
    </svg>
  );
}

/** Tableau Followed Metrics (LSCTableauViewController), drawn like LSC Mobile at 1210×834pt. Null until there is data, so the preview keeps its placeholder. */
export default function TableauScreen({ snapshot }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.tableau;
  const [openId, setOpenId] = useState<string | null>(null);
  if (!data) return null;
  const open = openId ? data.metrics.find((m) => m.id === openId) : undefined;
  if (open) return <MetricDetail metric={open} onBack={() => setOpenId(null)} />;
  return (
    <div className="studio-ipad-tableau">
      <div className="studio-ipad-tableau-header">
        <TableauLogo />
        <div className="studio-ipad-tableau-headings">
          <div className="studio-ipad-tableau-eyebrow">Tableau</div>
          <div className="studio-ipad-tableau-title">Followed Metrics</div>
        </div>
      </div>
      {data.metrics.length === 0 ? (
        <div className="studio-ipad-tableau-empty">
          <div className="studio-ipad-tableau-empty-title">There is nothing to display.</div>
          <div className="studio-ipad-tableau-empty-body">Start following metrics on the desktop to see your data here!</div>
        </div>
      ) : (
        <div className="studio-ipad-tableau-list">
          {data.metrics.map((m) => (
            <div key={m.id} className="studio-ipad-tableau-card" onClick={m.unavailable ? undefined : () => setOpenId(m.id)}>
              <div className="studio-ipad-tableau-row">
                <div className="studio-ipad-tableau-name">{m.name}</div>
                <div className="studio-ipad-tableau-ban">{m.unavailable ? "Metric Unavailable" : m.ban}</div>
              </div>
              <div className="studio-ipad-tableau-line">
                {m.popc.relative && <span className={`studio-ipad-tableau-rel ${m.popc.tone ?? "neutral"}`}>{m.popc.relative} </span>}
                {m.popc.comparison}
              </div>
              <div className="studio-ipad-tableau-line">{m.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
