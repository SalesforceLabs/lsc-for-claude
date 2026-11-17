import React, { useMemo, useState } from "react";
import type { ScreenProps } from "../types";
import {
  defaultSort,
  insightsForPage,
  PAGE_TITLES,
  searchInsights,
  sortInsights,
  sortOptions,
  type InsightSort,
} from "./insights-logic";
import type { InsightsPage, PublishedInsightItem, PublishedInsights } from "./insights-types";
import "./insights.css";

function Card({
  item,
  data,
  showStatus,
}: {
  item: PublishedInsightItem;
  data: PublishedInsights;
  showStatus: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expandable = !!item.subtitle && !!item.fullSubtitle && item.subtitle !== item.fullSubtitle;
  const badges = [
    ...(data.hideProducts ? [] : item.products.map((name) => ({ name, product: true }))),
    ...(data.hideTags ? [] : item.tags.map((name) => ({ name, product: false }))),
  ];
  return (
    <div className="studio-ipad-insights-card">
      <div className="studio-ipad-insights-card-top">
        <div className="studio-ipad-insights-card-main">
          {!data.hideName && <div className="studio-ipad-insights-card-title">{item.title}</div>}
          <div className="studio-ipad-insights-card-text">
            {open ? item.fullSubtitle : item.subtitle}
            {expandable && (
              <span className="studio-ipad-insights-more" onClick={() => setOpen(!open)}>
                {open ? " Show Less" : " Show More"}
              </span>
            )}
          </div>
        </div>
        <div className="studio-ipad-insights-card-side">
          <div className="studio-ipad-insights-logged">
            <span>Logged by {item.loggedBy}</span>
            <span>{item.date}</span>
            {showStatus && item.status && (
              <span className="studio-ipad-insights-status">{item.status}</span>
            )}
            {item.ownedByMe && (
              <span className="studio-ipad-insights-dots" aria-hidden>
                ⋮
              </span>
            )}
          </div>
          {badges.length > 0 && (
            <div className="studio-ipad-insights-badges">
              {badges.map((b) => (
                <span key={`${b.product}-${b.name}`} className={b.product ? "product" : "tag"}>
                  {b.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="studio-ipad-insights-actions">
        <span>Likes ({item.upvoteCount})</span>
        <span>Child Insights ({item.childCount})</span>
      </div>
    </div>
  );
}

/** Medical Insights feed (InsightsCoordinator / InsightsFeedView), drawn like LSC Mobile. Buttons are inert. */
export default function InsightsScreen({ snapshot }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.insights;
  const [page, setPage] = useState<InsightsPage>("latest");
  const [sorts, setSorts] = useState<Partial<Record<InsightsPage, InsightSort>>>({});
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState(false);
  const sort = sorts[page] ?? defaultSort(page);
  const options = useMemo(() => (data ? sortOptions(data.hideName) : []), [data]);
  const shown = useMemo(
    () =>
      data
        ? sortInsights(searchInsights(insightsForPage(data, page, null), search, data), sort)
        : [],
    [data, page, search, sort]
  );
  if (!data) return null;
  const sortLabel = (options.find((o) => o.id === sort) ?? options[0])?.label;
  return (
    <div className="studio-ipad-insights">
      <div className="studio-ipad-insights-bar">
        <input
          className="studio-ipad-insights-search"
          placeholder="Search Insights..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="studio-ipad-insights-btn">
          Filters
        </button>
        <div className="studio-ipad-insights-sortwrap">
          <button type="button" className="studio-ipad-insights-btn" onClick={() => setMenu(!menu)}>
            Sort By: {sortLabel}
          </button>
          {menu && (
            <div className="studio-ipad-insights-menu">
              {options.map((o) => (
                <div
                  key={o.id}
                  className={o.id === sort ? "on" : ""}
                  onClick={() => {
                    setSorts({ ...sorts, [page]: o.id });
                    setMenu(false);
                  }}
                >
                  {o.label}
                </div>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="studio-ipad-insights-btn primary">
          New
        </button>
      </div>
      <div className="studio-ipad-insights-tabs" role="tablist">
        {data.pages.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={page === p}
            className={page === p ? "on" : ""}
            onClick={() => {
              setPage(p);
              setMenu(false);
            }}
          >
            {PAGE_TITLES[p]}
          </button>
        ))}
      </div>
      <div className="studio-ipad-insights-list">
        {shown.length === 0 ? (
          <div className="studio-ipad-insights-empty">No records to display</div>
        ) : (
          shown.map((i) => (
            <Card
              key={i.id}
              item={i}
              data={data}
              showStatus={page === "myDrafts" || page === "inProgress"}
            />
          ))
        )}
        {data.unavailable?.length ? (
          <div className="studio-ipad-insights-note">
            Not in the preview: {data.unavailable.join(" ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
