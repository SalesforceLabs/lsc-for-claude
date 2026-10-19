import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CloudUpload,
  Database,
  LayoutDashboard,
  LayoutTemplate,
  List,
  PanelBottom,
  PanelsTopLeft,
  RotateCw,
  Rows3,
  Settings,
  SlidersHorizontal,
  Tag,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Spinner from "../ui/Spinner";
import {
  groupItems,
  indicatorFor,
  indicatorLabel,
  kindLabel,
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
        <span className="org-ahead-muted org-ahead-text">{publishedAt ? `Last published ${timeAgo(publishedAt)}` : "Not published yet"}</span>
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

interface Props {
  profile: string;
  state: UnpublishedState | undefined;
  snapshot: PublishedIpad | null;
  onRetry: () => void;
  onShow: (item: UnpublishedItem) => void;
  onPublish: () => void;
}

/**
 * The preview's answer to "does what I see match what reps will get?": a quiet line when the iPads are
 * up to date, an amber pill when the org is ahead (with a popover that lists what and offers Publish),
 * and a retry when the check itself failed — never a false "up to date".
 */
export default function UnpublishedIndicator({ profile, state, snapshot, onRetry, onShow, onPublish }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const ind = indicatorFor(state);
  const popover = useRef<HTMLDivElement>(null);
  // Keep the popover inside the window: slide it left by however far it would run off the right edge.
  useLayoutEffect(() => {
    const el = popover.current;
    if (!open || !el) return;
    const place = () => {
      el.style.left = "0px";
      const over = el.getBoundingClientRect().right - (window.innerWidth - 16);
      if (over > 0) el.style.left = `${-over}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, state]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (ind.kind === "loading") {
    return (
      <span className="ui-updated org-ahead-quiet" role="status">
        <Spinner size={12} /> <span className="org-ahead-text">Checking for unpublished changes…</span>
      </span>
    );
  }
  if (ind.kind === "error" || ind.kind === "partial") {
    return (
      <span className="org-ahead-quiet" role="status" title={ind.kind === "error" ? ind.message : `Couldn't read: ${ind.message}`}>
        <CircleAlert size={14} aria-hidden />
        <span className="org-ahead-text">Couldn't check for unpublished changes</span>
        <button type="button" className="studio-btn ghost sm" onClick={onRetry}>
          <RotateCw aria-hidden="true" /> Retry
        </button>
      </span>
    );
  }
  if (ind.kind === "upToDate") {
    return (
      <span className="org-ahead-quiet" role="status">
        <CircleCheck size={14} aria-hidden />
        <span className="org-ahead-text">{indicatorLabel(ind)}</span>
      </span>
    );
  }
  if (ind.kind === "neverPublished") {
    return (
      <span className="org-ahead-quiet" role="status">
        <CircleAlert size={14} aria-hidden />
        <span className="org-ahead-text">{indicatorLabel(ind)}</span>
      </span>
    );
  }

  // Changes waiting. `state` is ready here.
  return (
    <div className="org-ahead-root" ref={root}>
      <button
        type="button"
        className="org-ahead-pill"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        title={indicatorLabel(ind)}
      >
        <CircleDot size={14} aria-hidden />
        <span className="org-ahead-text">{ind.count} not on iPads</span>
      </button>
      {open && (
        <div className="org-ahead-popover" ref={popover} role="dialog" aria-label="Changes not on iPads yet">
          <UnpublishedList
            profile={profile}
            state={state}
            snapshot={snapshot}
            onRetry={onRetry}
            onShow={onShow}
            onPublish={onPublish}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
