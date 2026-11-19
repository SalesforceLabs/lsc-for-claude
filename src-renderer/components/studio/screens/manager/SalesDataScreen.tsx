import React, { useState } from "react";
import type { ScreenProps } from "../types";
import "./manager.css";

/** Sales Data tab (TerritorySalesReportViewController): the summary table, 20 accounts a page. */
export default function SalesDataScreen({ tab, snapshot }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.salesData;
  const [page, setPage] = useState(0);
  if (!data) return null;
  const table = data.tables[0];
  const pages = table ? Math.max(1, Math.ceil(table.rows.length / data.pageSize)) : 1;
  const shown = table ? table.rows.slice(page * data.pageSize, (page + 1) * data.pageSize) : [];
  return (
    <div className="studio-ipad-sales">
      <div className="studio-ipad-sales-header">{tab.label || "Reports"}</div>
      <div className="studio-ipad-sales-body">
        {data.note ? <div className="studio-ipad-sales-note">{data.note}</div> : null}
        <div className="studio-ipad-sales-card">
          <h3>{table?.title ?? "Summary"}</h3>
          {table && table.rows.length > 0 ? (
            <>
              <table className="studio-ipad-sales-table">
                <thead>
                  <tr>
                    <th>Accounts</th>
                    {table.products.map((p) => (
                      <th key={p}>{p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.account}>
                      <td>{r.account}</td>
                      {r.values.map((v, i) => (
                        <td key={i}>{v === null ? "-" : v.toLocaleString("en-US")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="studio-ipad-sales-note">
                <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  ‹
                </button>{" "}
                {page + 1} of {pages}{" "}
                <button
                  type="button"
                  disabled={page + 1 >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  ›
                </button>
              </div>
            </>
          ) : (
            <div className="studio-ipad-sales-note">No data available</div>
          )}
        </div>
      </div>
    </div>
  );
}
