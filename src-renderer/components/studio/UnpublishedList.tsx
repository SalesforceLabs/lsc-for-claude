import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CloudUpload,
  Database,
  LayoutDashboard,
  LayoutTemplate,
  List,
  PanelBottom,
  PanelsTopLeft,
  Rows3,
  Settings,
  SlidersHorizontal,
  Tag,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  groupItems,
  indicatorFor,
  kindLabel,
  NOT_LISTED,
  ORG_AHEAD_LEGEND,
  timeAgo,
  whoWhen,
  type UnpublishedItem,
  type UnpublishedKind,
  type UnpublishedState,
} from "./org-ahead";
import { describeSummary, ROW_LINES } from "./org-ahead-summary";
import { useChangeSummaries, type ChangeSummary } from "./useChangeSummaries";
import type { PublishedIpad } from "./published-types";
import "./org-ahead.css";

const KIND_ICON: Record<UnpublishedKind, LucideIcon> = {
  layout: LayoutTemplate,
  compactLayout: Rows3,
  flexiPage: LayoutDashboard,
  recordType: Tag,
  tab: PanelBottom,
  listView: List,
  dbSchema: Database,
  uiSetting: SlidersHorizontal,
  action: Zap,
  appSetting: Settings,
  app: PanelsTopLeft,
};

const NO_ITEMS: UnpublishedItem[] = [];

/** The row's second line: what changed, or a skeleton while it is read. Empty when nothing can be said. */
function whatChanged(item: UnpublishedItem, s: ChangeSummary | undefined) {
  if (item.summary?.length) return describeSummary(item.summary);
  if (s?.status === "loading") return "loading" as const;
  if (s?.status === "ready" && s.lines) {
    // Read and compared, and a rep would see nothing different: say so rather than leave the row bare.
    if (s.lines.length === 0) return { text: "Nothing reps would see has changed", all: [], none: true as const };
    return describeSummary(s.lines);
  }
  return null;
}

interface ListProps {
  profile: string;
  state: UnpublishedState | undefined;
  snapshot: PublishedIpad | null;
  onRetry: () => void;
  onShow: (item: UnpublishedItem) => void;
  /** The foot's Publish button; left out where the bar around the list already offers it. */
  onPublish?: () => void;
  /** A row or Publish was chosen: close whatever holds the list. */
  onClose?: () => void;
}

/**
 * What one profile's org has that its iPads don't: the changes by group (with what changed, read when shown),
 * the outline legend and when it was last published. Shown in the release bar's "In the org" popover.
 */
export function UnpublishedList({ profile, state, snapshot, onRetry, onShow, onPublish, onClose }: ListProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const ind = indicatorFor(state);
  const result = state?.status === "ready" ? state.result : undefined;
  const summaries = useChangeSummaries(true, result?.items ?? NO_ITEMS, snapshot);
  const groups = result ? groupItems(result.items) : [];
  const publishedAt = ind.kind === "changes" || ind.kind === "upToDate" ? ind.publishedAt : null;
  return (
    <>
      <div className="org-ahead-scroll">
        {ind.kind === "changes" && ind.incomplete && (
          <p className="org-ahead-warn" role="status">
            <CircleAlert size={14} aria-hidden />
            <span>
              Some changes may be missing: couldn't read {result?.errors.map((e) => e.kind.toLowerCase()).join(", ")}.{" "}
              <button type="button" className="studio-btn ghost sm" onClick={onRetry}>
                Retry
              </button>
            </span>
          </p>
        )}
        {groups.map((g) => (
          <section key={g.id} className="org-ahead-group">
            <h3 className="ui-section-title">
              {g.title}<span className="count">· {g.items.length}</span>
            </h3>
            {g.note && <p className="org-ahead-note">{g.note}</p>}
            <ul>
              {g.items.map((item) => {
                const Icon = KIND_ICON[item.kind];
                const what = whatChanged(item, summaries[item.id]);
                const more = !!what && what !== "loading" && (what.all.length > ROW_LINES || what.all.some((l) => l.length > 48));
                const isOpen = expanded.has(item.id);
                return (
                  <li key={item.id} className="org-ahead-item">
                    <button
                      type="button"
                      className="org-ahead-row"
                      aria-label={`Show ${item.label}`}
                      onClick={() => {
                        onClose?.();
                        onShow(item);
                      }}
                    >
                      <Icon size={16} aria-hidden />
                      <span className="org-ahead-row-main">
                        <span className="org-ahead-row-name" title={item.name}>
                          {item.label}
                        </span>
                        {what === "loading" && <span className="org-ahead-skeleton" aria-hidden="true" />}
                        {what && what !== "loading" && what.text && (
                          <span className={"org-ahead-row-what" + ("none" in what ? " none" : "")} title={what.all.length > 1 ? what.all.join("\n") : undefined}>
                            {what.text}
                          </span>
                        )}
                        <span className="org-ahead-row-meta">
                          {kindLabel(item.kind)} · {whoWhen(item)}
                        </span>
                      </span>
                      <ChevronRight size={14} aria-hidden className="org-ahead-chev" />
                    </button>
                    {more && (
                      <button
                        type="button"
                        className="org-ahead-more"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Hide" : "Show"} all ${what.all.length} changes to ${item.label}`}
                        onClick={() =>
                          setExpanded((cur) => {
                            const next = new Set(cur);
                            if (!next.delete(item.id)) next.add(item.id);
                            return next;
                          })
                        }
                      >
                        <ChevronDown size={14} aria-hidden />
                      </button>
                    )}
                    {more && isOpen && (
                      <ul className="org-ahead-changes">
                        {what.all.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <ul className="org-ahead-legend" aria-label="What the outlines mean">
        <li>
          <span className="org-ahead-swatch published" aria-hidden="true" /> {ORG_AHEAD_LEGEND.published}
        </li>
        <li>
          <span className="org-ahead-swatch org" aria-hidden="true" /> {ORG_AHEAD_LEGEND.org}
        </li>
        <li>
          <span className="org-ahead-swatch tray" aria-hidden="true" /> {ORG_AHEAD_LEGEND.tray}
        </li>
      </ul>
      <div className="org-ahead-foot">
        <span className="org-ahead-muted org-ahead-text" title={NOT_LISTED}>{publishedAt ? `Last published ${timeAgo(publishedAt)}` : "Not published yet"}</span>
        {onPublish && (
          <button
            type="button"
            className="studio-btn primary"
            title={`Publish to iPad for ${profile}`}
            onClick={() => {
              onClose?.();
              onPublish();
            }}
          >
            <CloudUpload aria-hidden="true" /> Publish to iPad
          </button>
        )}
      </div>
    </>
  );
}
