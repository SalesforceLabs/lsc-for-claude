import React from "react";
import { createPortal } from "react-dom";
import type { PublishedReportItem } from "./published-types";
import type { PublishedReportData } from "./report-types";
import "./report-viewer.css";

/** What the sheet shows for a report, decided from what the preview could read. */
export type ReportViewState = { kind: "table"; data: PublishedReportData } | { kind: "empty" } | { kind: "web" } | { kind: "unavailable" };

/**
 * ReportDetailsViewController: Tabular and Summary reports with no rows say "No data available"; a failed fetch does too
 * in the app. The preview separates "the connected account got no rows" from "couldn't run it here" so it never shows an
 * empty report it doesn't know to be empty.
 */
export function reportViewState(item: PublishedReportItem): ReportViewState {
  if (!item.native) return { kind: "web" };
  const data = item.data;
  if (!data) return { kind: "unavailable" };
  if (data.entries.length === 0) return { kind: "empty" };
  return { kind: "table", data };
}

/** The "View Report" sheet (full screen): Close left, "View in Salesforce" right, the grid or a message below. */
export function ReportViewer({ item, host, onClose }: { item: PublishedReportItem; host: Element | null; onClose: () => void }) {
  if (!host) return null;
  const state = reportViewState(item);
  const node = (
    <div className="studio-ipad-reportview" role="dialog" aria-label="View Report">
      <div className={`studio-ipad-reportview-bar${state.kind === "table" ? " data" : ""}`}>
        <button type="button" className="studio-ipad-reportview-btn left" onClick={onClose}>
          Close
        </button>
        <div className="studio-ipad-reportview-title">View Report</div>
        <span className="studio-ipad-reportview-btn right">View in Salesforce</span>
      </div>
      {state.kind === "table" && <ReportGrid data={state.data} />}
      {state.kind === "empty" && <div className="studio-ipad-reportview-message">No data available</div>}
      {state.kind === "web" && (
        <div className="studio-ipad-reportview-message">
          <div>{item.title}</div>
          <div className="studio-ipad-reportview-note">{item.format || "This report"} opens in Salesforce&apos;s web report viewer in the app; the preview does not draw it.</div>
        </div>
      )}
      {state.kind === "unavailable" && (
        <div className="studio-ipad-reportview-message">
          <div className="studio-ipad-reportview-note">The preview could not run this report with the connected account, so it cannot show what the viewer would see.</div>
        </div>
      )}
      {(state.kind === "table" || state.kind === "empty") && (
        <div className="studio-ipad-reportview-label">
          Preview only: run as the connected admin, not the viewer, so rows can differ{state.kind === "table" && state.data.truncated ? "; long reports are cut short" : ""}.
        </div>
      )}
    </div>
  );
  return createPortal(node, host);
}

/** DataTableView / CascadeGroupedGridCollectionLayout: 56pt header, 60pt rows, 64pt subtotals and grand total, 200pt columns. */
function ReportGrid({ data }: { data: PublishedReportData }) {
  const cols = data.columns.length;
  const width = 10 + cols * 200;
  return (
    <div className="studio-ipad-reportview-scroll">
      <div className="studio-ipad-reportview-grid" style={{ width }}>
        <div className="studio-ipad-reportview-line head">
          <span className="studio-ipad-reportview-gutter" />
          {data.columns.map((c, i) => (
            <span key={i} className="studio-ipad-reportview-cell head">
              {c}
            </span>
          ))}
        </div>
        {data.entries.map((e, i) =>
          e.kind === "subtotal" ? (
            <div key={i} className="studio-ipad-reportview-line total" style={{ background: tint(e.level) }} title={e.title}>
              <span className="studio-ipad-reportview-gutter" />
              {data.columns.map((_, j) => (
                <span key={j} className="studio-ipad-reportview-cell">
                  {e.cells[j] ?? ""}
                </span>
              ))}
            </div>
          ) : (
            <div key={i} className="studio-ipad-reportview-line">
              <span className="studio-ipad-reportview-gutter" />
              {data.columns.map((_, j) => {
                const c = e.cells[j];
                return (
                  <span key={j} className={`studio-ipad-reportview-cell${c?.link ? " link" : ""}`}>
                    {c?.bool !== undefined ? (c.bool ? "✓" : "✕") : c?.label}
                  </span>
                );
              })}
            </div>
          )
        )}
        {data.grandTotal && (
          <div className="studio-ipad-reportview-line grand" title={data.grandTotal.label}>
            <span className="studio-ipad-reportview-gutter" />
            {data.columns.map((_, j) => (
              <span key={j} className="studio-ipad-reportview-cell">
                {data.grandTotal?.cells[j] ?? ""}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** SummaryReportDetailsViewController.backgroundColor(forGroupLevel:): the secondary background, 3% lighter per level. */
function tint(level: number): string {
  const v = Math.min(255, 243 + Math.round(level * 3 * 2.55 * 0.4));
  return `rgb(${v}, ${v}, ${v})`;
}
