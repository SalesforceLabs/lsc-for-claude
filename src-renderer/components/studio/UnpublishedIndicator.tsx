import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, CircleDot, CloudUpload, RotateCw } from "lucide-react";
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
  type UnpublishedState,
} from "./org-ahead";
import "./org-ahead.css";

interface Props {
  profile: string;
  state: UnpublishedState | undefined;
  onRetry: () => void;
  onShow: (item: UnpublishedItem) => void;
  onPublish: () => void;
}

/**
 * The preview's answer to "does what I see match what reps will get?": a quiet line when the iPads are
 * up to date, an amber pill when the org is ahead (with a popover that lists what and offers Publish),
 * and a retry when the check itself failed — never a false "up to date".
 */
export default function UnpublishedIndicator({ profile, state, onRetry, onShow, onPublish }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const ind = indicatorFor(state);
  const popover = useRef<HTMLDivElement>(null);
  // Keep the popover inside the window: slide it left by however far it would run off the right edge.
  useLayoutEffect(() => {
    const el = popover.current;
    if (!open || !el) return;
    el.style.left = "0px";
    const over = el.getBoundingClientRect().right - (window.innerWidth - 16);
    if (over > 0) el.style.left = `${-over}px`;
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
  const result = state?.status === "ready" ? state.result : undefined;
  const groups = result ? groupItems(result.items) : [];
  return (
    <div className="org-ahead-root" ref={root}>
      <button
        type="button"
        className="org-ahead-pill"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        title="The org has changes the iPads don't have yet"
      >
        <CircleDot size={14} aria-hidden />
        <span className="org-ahead-text">{indicatorLabel(ind)}</span>
      </button>
      {open && (
        <div className="org-ahead-popover" ref={popover} role="dialog" aria-label="Changes not on iPads yet">
          <div className="org-ahead-scroll">
            {ind.incomplete && (
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
                <h3 className="ui-section-title">{g.title}</h3>
                {g.note && <p className="org-ahead-note">{g.note}</p>}
                <ul>
                  {g.items.map((item) => (
                    <li key={item.id} className="org-ahead-row">
                      <div className="org-ahead-row-main">
                        <span className="org-ahead-row-name" title={item.name}>
                          {item.label}
                        </span>
                        <span className="org-ahead-row-meta">
                          {kindLabel(item.kind)} · {whoWhen(item)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="studio-btn ghost sm"
                        onClick={() => {
                          setOpen(false);
                          onShow(item);
                        }}
                      >
                        Show
                      </button>
                    </li>
                  ))}
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
            <span className="org-ahead-muted">{ind.publishedAt ? `Last published ${timeAgo(ind.publishedAt)}` : "Not published yet"}</span>
            <button
              type="button"
              className="studio-btn primary"
              onClick={() => {
                setOpen(false);
                onPublish();
              }}
            >
              <CloudUpload aria-hidden="true" /> Publish to iPad for {profile}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
