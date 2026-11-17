import React, { useState } from "react";
import type { ScreenProps } from "../types";
import { useLazyStudio } from "../../useLazyStudio";
import { Dashboard } from "../../IpadDashboard";
import type { PublishedDashboard } from "../../published-types";
import type { DashboardItem } from "./dashboards-types";
import { searchDashboards, visibleRows } from "./dashboards-logic";
import "./manager.css";

const pickDetail = (data: unknown): { dashboard: PublishedDashboard | null; error?: string } => {
  const d = (
    data as { detail?: { dashboard: PublishedDashboard | null; error?: string } } | undefined
  )?.detail;
  if (!d) throw new Error("No answer for that dashboard.");
  return d;
};

function Detail({ item, onBack }: { item: DashboardItem; onBack: () => void }): React.ReactElement {
  const { state, retry } = useLazyStudio(
    item.id ?? "",
    () => window.lscApi.studioManagerData({ kind: "dashboardDetail", dashboardId: item.id ?? "" }),
    pickDetail
  );
  return (
    <div className="studio-ipad-dash">
      <div className="studio-ipad-dash-detail-bar">
        <button type="button" onClick={onBack}>
          ‹ Dashboards
        </button>
        <div className="studio-ipad-dash-title">{item.title}</div>
      </div>
      <div className="studio-ipad-dash-detail">
        {state.status === "loading" ? (
          <div className="studio-ipad-dash-empty">Loading…</div>
        ) : state.status === "error" ? (
          <div className="studio-ipad-dash-empty">
            {state.message}{" "}
            <button type="button" onClick={retry}>
              Retry
            </button>
          </div>
        ) : !state.data.dashboard ? (
          <div className="studio-ipad-dash-empty">No data available</div>
        ) : state.data.dashboard.components.length === 0 ? (
          <div className="studio-ipad-dash-empty">This dashboard has no components</div>
        ) : (
          <Dashboard dashboard={state.data.dashboard} />
        )}
      </div>
    </div>
  );
}

/** Dashboards tab (MultiDashboardsViewController): a searchable tree of folders and dashboards. */
export default function DashboardsScreen({ snapshot }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.dashboards;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<DashboardItem | null>(null);
  if (!data) return null;
  if (picked) return <Detail item={picked} onBack={() => setPicked(null)} />;
  const searching = search.trim() !== "";
  const rows = searching
    ? searchDashboards(data.items, search).map((item, i) => ({ item, depth: 0, key: `s${i}` }))
    : visibleRows(data.items, open);
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <div className="studio-ipad-dash">
      <div className="studio-ipad-dash-header">
        <div className="studio-ipad-dash-title">Dashboards</div>
        <input value={search} placeholder="Search" onChange={(e) => setSearch(e.target.value)} />
        <button type="button" onClick={() => setOpen(new Set())}>
          Collapse All
        </button>
      </div>
      {data.note ? <div className="studio-ipad-myteam-note">{data.note}</div> : null}
      <div className="studio-ipad-dash-list">
        {data.noData || rows.length === 0 ? (
          <div className="studio-ipad-dash-empty">No data available</div>
        ) : (
          rows.map(({ item, depth, key }) => (
            <div
              key={key}
              className={`studio-ipad-dash-row ${item.kind === "dashboard" ? "item" : "folder"}`}
              style={{ paddingLeft: 8 + depth * 24 }}
              onClick={() => (item.kind === "dashboard" ? setPicked(item) : toggle(key))}
            >
              <span className="studio-ipad-dash-chevron">
                {item.kind === "dashboard" ? "" : open.has(key) ? "⌄" : "›"}
              </span>
              <span>{item.kind === "dashboard" ? "▦" : item.kind === "folder" ? "▭" : ""}</span>
              <span>{item.title}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
