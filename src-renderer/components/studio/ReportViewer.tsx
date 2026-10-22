import React from "react";
import { createPortal } from "react-dom";
import type { PublishedReportItem } from "./published-types";
import type { PublishedReportData } from "./report-types";
import { IpadFail, IpadWait } from "./IpadLazyState";
import { useLazyStudio, type Lazy } from "./useLazyStudio";
import "./report-viewer.css";

/** What the sheet shows for a report, decided from what the preview could read. */
export type ReportViewState =
  | { kind: "table"; data: PublishedReportData }
  | { kind: "empty" }
  | { kind: "web" }
  | { kind: "unavailable" }
  | { kind: "loading" }
  | { kind: "error"; message: string };

const COULD_NOT_RUN = "The preview could not run this report with the connected account, so it cannot show what the viewer would see.";

/**
 * ReportDetailsViewController: Tabular and Summary reports with no rows say "No data available"; a failed fetch does too
 * in the app. The preview separates "the connected account got no rows" from "couldn't run it here" so it never shows an
 * empty report it doesn't know to be empty.
 */
export function reportViewState(item: PublishedReportItem, fetched?: Lazy<PublishedReportData>): ReportViewState {
  if (!item.native) return { kind: "web" };
  // The Sales Chart has no report Id to run.
  if (!item.id || !fetched) return { kind: "unavailable" };
  if (fetched.status === "loading") return { kind: "loading" };
  if (fetched.status === "error") return { kind: "error", message: fetched.message };
  if (fetched.data.entries.length === 0) return { kind: "empty" };
  return { kind: "table", data: fetched.data };
}

/** What `studio_report_data` answers: the report's result, or null when it couldn't be run here (shown as an error with Retry). */
export function pickReportData(answer: unknown): PublishedReportData {
  const data = (answer as { data?: PublishedReportData | null } | undefined)?.data;
  if (!data) throw new Error(COULD_NOT_RUN);
  return data;
}

/** The "View Report" sheet (full screen): Close left, "View in Salesforce" right, the grid or a message below. */
export function ReportViewer({ item, host, userId, onClose }: { item: PublishedReportItem; host: Element | null; userId?: string; onClose: () => void }) {
  if (!host) return null;
  // Only a native report with an Id is run; the result is read now, when the rep opens it, not with the preview.
  return item.native && item.id ? (
    <RunningReport item={item} id={item.id} host={host} userId={userId} onClose={onClose} />
  ) : (
    <ReportSheet item={item} state={reportViewState(item)} host={host} onClose={onClose} onRetry={() => {}} />
  );
}

function RunningReport({ item, id, host, userId, onClose }: { item: PublishedReportItem; id: string; host: Element; userId?: string; onClose: () => void }) {
  const { state, retry } = useLazyStudio(`${id}|${userId ?? ""}`, () => window.lscApi.studioReportData(id, userId), pickReportData);
  return <ReportSheet item={item} state={reportViewState(item, state)} host={host} onClose={onClose} onRetry={retry} />;
}

function ReportSheet({ item, state, host, onClose, onRetry }: { item: PublishedReportItem; state: ReportViewState; host: Element; onClose: () => void; onRetry: () => void }) {
  const node = (
    <div className="studio-ipad-reportview" role="dialog" aria-label="View Report">
      <div className={`studio-ipad-reportview-bar${state.kind === "table" ? " data" : ""}`}>
        <button type="button" className="studio-ipad-reportview-btn left" onClick={onClose}>
          Close
        </button>
        <div className="studio-ipad-reportview-title">View Report</div>
        {state.kind === "web" ? (
          <span className="studio-ipad-reportview-webtools" aria-hidden>
            <span>‹</span>
            <span>›</span>
            <span>↻</span>
            <span>◎</span>
          </span>
        ) : (
          <span className="studio-ipad-reportview-btn right">View in Salesforce</span>
        )}
      </div>
      {state.kind === "table" && <ReportGrid data={state.data} />}
      {state.kind === "empty" && <div className="studio-ipad-reportview-message">No data available</div>}
      {state.kind === "web" && (
        <div className="studio-ipad-reportview-message web">
          <div className="studio-ipad-reportview-note">{item.format || "This report"} opens in Salesforce&apos;s web report viewer in the app; the preview does not load org pages. Labelled note: the device shows a blank page while it loads.</div>
        </div>
      )}
      {state.kind === "loading" && <IpadWait label="Running report…" />}
      {state.kind === "error" && <IpadFail title="Couldn't run this report" message={state.message} onRetry={onRetry} />}
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
              <span className="studio-ipad-reportview-text">{c}</span>
            </span>
          ))}
        </div>
        {data.entries.map((e, i) =>
          e.kind === "subtotal" ? (
            <div key={i} className="studio-ipad-reportview-line total" style={{ background: tint(e.level) }} title={e.title}>
              <span className="studio-ipad-reportview-gutter" />
              {data.columns.map((_, j) => (
                <span key={j} className="studio-ipad-reportview-cell">
                  <span className="studio-ipad-reportview-text">{e.cells[j] ?? ""}</span>
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
                    <span className="studio-ipad-reportview-text">{c?.bool !== undefined ? (c.bool ? "✓" : "✕") : c?.label}</span>
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
                <span className="studio-ipad-reportview-text">{data.grandTotal?.cells[j] ?? ""}</span>
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
