import React, { useRef, useState } from "react";
import type { PublishedReportItem } from "./published-types";
import { IpadSearchField } from "./IpadChrome";
import { ReportViewer } from "./ReportViewer";

/**
 * MultiReportsViewController: a 64pt header (search bar, "Collapse All") over
 * an RATreeView of MultiReportsTableViewCell rows — all collapsed at first.
 */
export function ReportsTree({ items }: { items: PublishedReportItem[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<PublishedReportItem | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const rows: React.ReactNode[] = [];
  const walk = (list: PublishedReportItem[], level: number, path: string) => {
    list.forEach((item, i) => {
      const key = `${path}/${i}`;
      const expanded = open.has(key);
      rows.push(
        <ReportRow
          key={key}
          item={item}
          level={level}
          expanded={expanded}
          onOpenReport={() => setViewing(item)}
          onToggle={() =>
            setOpen((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
        />
      );
      if (expanded) walk(item.children, level + 1, key);
    });
  };
  walk(items, 0, "");
  return (
    <div className="studio-ipad-reports" ref={root}>
      <div className="studio-ipad-reports-head">
        <IpadSearchField className="studio-ipad-reports-search" mic={false} />
        <button type="button" className="studio-ipad-reports-collapse" onClick={() => setOpen(new Set())}>
          Collapse All
        </button>
      </div>
      {rows}
      {viewing && <ReportViewer item={viewing} host={root.current?.closest(".studio-ipad-screen") ?? null} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** MultiReportsTableViewCell.setup: chevron (hidden for reports), type icon (none for sections), title, description. */
function ReportRow({ item, level, expanded, onToggle, onOpenReport }: { item: PublishedReportItem; level: number; expanded: boolean; onToggle: () => void; onOpenReport: () => void }) {
  let left = 8 + 24 * level;
  if (item.kind === "report" && level > 0) left -= 24;
  const report = item.kind === "report";
  return (
    <div
      className={`studio-ipad-report-row${report ? " report" : ""}${level === 0 && !expanded ? " separated" : ""}`}
      style={{ paddingLeft: left }}
      onClick={report ? onOpenReport : onToggle}
    >
      <span className="studio-ipad-report-chevron">
        {!report && (
          <svg width="13" height="8" viewBox="0 0 13 8" aria-hidden="true">
            <path d={expanded ? "M1 7l5.5-5.5L12 7" : "M1 1l5.5 5.5L12 1"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {item.kind !== "section" && (
        <span className="studio-ipad-report-icon">{report ? <ReportIcon web={!item.native} /> : <FolderIcon />}</span>
      )}
      <span className="studio-ipad-report-text">
        <span className="studio-ipad-report-title">{item.title}</span>
        {item.description && <span className="studio-ipad-report-desc">{item.description}</span>}
      </span>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4l2 2h7A1.5 1.5 0 0 1 18 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** APSymbolIcons `.report` (a dog-eared page with bars) for native reports; `x-icon-report-online` adds a globe for web ones. */
function ReportIcon({ web }: { web: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.5 1h12v18H1.5V6z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M1.5 6h5V1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 18.5V13M10 18.5V9M14 18.5V12" stroke="currentColor" strokeWidth="2.2" />
      {web && (
        <g>
          <circle cx="15" cy="15" r="4.6" fill="#fff" />
          <circle cx="15" cy="15" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <path d="M11.6 15h6.8M15 11.6c-1.6 2-1.6 4.8 0 6.8M15 11.6c1.6 2 1.6 4.8 0 6.8" fill="none" stroke="currentColor" strokeWidth="0.9" />
        </g>
      )}
    </svg>
  );
}
