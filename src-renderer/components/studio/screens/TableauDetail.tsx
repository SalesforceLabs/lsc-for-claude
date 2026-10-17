import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PublishedTableauMetric } from "./tableau-types";
import "./tableau-detail.css";

/** Geometry measured on LSC Mobile (page coordinates; y from the top of the 180pt chart area). */
const PLOT = { left: 92, right: 1194, top: 1, bottom: 127, width: 1210, height: 180 };

/** MetricDetailView: title band, Time Range, the BAN and comparison, the line chart, the insight text, related dimensions, Ask Agentforce. */
export function MetricDetail({ metric, onBack }: { metric: PublishedTableauMetric; onBack: () => void }): React.ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState<Element | null>(null);
  useEffect(() => {
    setNav(root.current?.closest(".studio-ipad-screen")?.querySelector(".studio-ipad-navbar") ?? null);
  }, []);
  return (
    <div className="studio-ipad-tableau-detail" ref={root}>
      {nav &&
        createPortal(
          <button type="button" className="studio-ipad-tableau-back" onClick={onBack} aria-label="Back">
            <svg width="13" height="21" viewBox="0 0 13 21" aria-hidden="true">
              <path d="M11 2 2.5 10.5 11 19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>,
          nav
        )}
      <div className="studio-ipad-tableau-detail-band">{metric.name}</div>
      <div className="studio-ipad-tableau-range">
        Time Range: <span className="studio-ipad-tableau-range-value">{metric.description}</span>
        <svg width="11" height="7" viewBox="0 0 11 7" aria-hidden="true">
          <path d="M0 0h11L5.5 7z" fill="#0250d9" />
        </svg>
      </div>
      <div className="studio-ipad-tableau-detail-ban">{metric.ban}</div>
      <div className="studio-ipad-tableau-detail-popc">
        {metric.popc.relative && <span className={`studio-ipad-tableau-rel ${metric.popc.tone ?? "neutral"}`}>{metric.popc.relative} </span>}
        {metric.popc.comparison}
      </div>
      <div className="studio-ipad-tableau-chart">
        {metric.detail ? <MetricChart detail={metric.detail} /> : <div className="studio-ipad-tableau-note">The preview could not read this metric&apos;s time series, so the chart is not drawn.</div>}
      </div>
      <div className="studio-ipad-tableau-insight-note">
        Preview note: the expected-range band and the trend sentences come from Salesforce&apos;s insights service, which only answers the mobile app&apos;s own session, so they are not shown here.
      </div>
      <div className="studio-ipad-tableau-dims">
        <div className="studio-ipad-tableau-dims-title">No related dimensions</div>
        <div className="studio-ipad-tableau-dims-body">This metric doesn&apos;t have any related dimensions, so it can&apos;t be broken down</div>
      </div>
      <div className="studio-ipad-tableau-ask">
        <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="17" r="13" fill="#0b5cff" />
          <circle cx="11" cy="15" r="3.2" fill="#fff" />
          <circle cx="21" cy="15" r="3.2" fill="#fff" />
          <path d="M9 22q7 5 14 0" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Ask Agentforce
      </div>
    </div>
  );
}

function MetricChart({ detail }: { detail: NonNullable<PublishedTableauMetric["detail"]> }): React.ReactElement {
  const { series, ticks, domain } = detail;
  const n = series.length;
  const x = (i: number) => PLOT.left + (i * (PLOT.right - PLOT.left)) / (n - 1);
  const y = (v: number) => PLOT.bottom - ((v - domain[0]) / (domain[1] - domain[0])) * (PLOT.bottom - PLOT.top);
  const month = detail.granularity === "month";
  const lastY = y(series[n - 1][1]);
  return (
    <svg width={PLOT.width} height={PLOT.height} viewBox={`0 0 ${PLOT.width} ${PLOT.height}`} className="studio-ipad-tableau-svg">
      <line x1={PLOT.left} x2={PLOT.left} y1={PLOT.top} y2={PLOT.bottom} stroke="#c9c9c9" />
      <line x1={PLOT.left} x2={PLOT.right} y1={PLOT.bottom} y2={PLOT.bottom} stroke="#c9c9c9" />
      <line x1={PLOT.right - 1} x2={PLOT.right - 1} y1={PLOT.top} y2={PLOT.bottom} stroke="#555" strokeWidth="1.5" />
      {ticks.map((t) => (
        <g key={t.value}>
          <line x1={PLOT.left - 5} x2={PLOT.left} y1={y(t.value)} y2={y(t.value)} stroke="#c9c9c9" />
          <text x={82} y={y(t.value) + 5} textAnchor="end" className="studio-ipad-tableau-axis">
            {t.label}
          </text>
        </g>
      ))}
      {month ? (
        /* The device draws no dot on the y axis itself: its first month sits under the axis line (measured on NRx and TRx). */
        series.map(([d, v], i) => (i === 0 ? null : <circle key={d} cx={x(i)} cy={y(v)} r={2.6} fill="#3d8bff" />))
      ) : (
        <polyline points={series.map(([, v], i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke="#3d8bff" strokeWidth="2.2" strokeLinejoin="round" />
      )}
      <text x={x(n - 1) - 12} y={lastY + 5} textAnchor="end" className="studio-ipad-tableau-axis">
        {detail.lastLabel}
      </text>
      <text x={91} y={151} className="studio-ipad-tableau-axis">
        {detail.startLabel}
      </text>
      <text x={PLOT.right} y={151} textAnchor="end" className="studio-ipad-tableau-axis">
        {detail.endLabel}
      </text>
    </svg>
  );
}
