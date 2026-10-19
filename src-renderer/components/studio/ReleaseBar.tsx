import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, CircleAlert, CircleCheck, Cloud, CloudUpload, ListChecks, Redo2, RotateCcw, RotateCw, Tablet, Undo2, X } from "lucide-react";
import Spinner from "../ui/Spinner";
import { UnpublishedList } from "./UnpublishedList";
import { timeAgo, type UnpublishedItem, type UnpublishedState } from "./org-ahead";
import { reachLabel, reachOfChange } from "./reach";
import { ipadStepLabel, orgWideNote, primaryAction, profileOrgStep, sessionOrgStep, type OrgStep } from "./release-bar-logic";
import type { PendingChange } from "./changes";
import type { PublishedIpad } from "./published-types";
import type { PublishJob } from "./usePublishJob";
import "./release-bar.css";

/** The previewed profile's side of "In the org": its unpublished items, read from the org. */
export interface ProfileScope {
  profile: string;
  state: UnpublishedState | undefined;
  snapshot: PublishedIpad | null;
  onRetry: () => void;
  onShow: (item: UnpublishedItem) => void;
}

interface ReleaseBarProps {
  pending: PendingChange[];
  onPendingChange: (next: PendingChange[]) => void;
  onReview: () => void;
  /** Review needs an org Studio has read. */
  canReview: boolean;
  history: { undo: () => void; redo: () => void; undoLabel: string | null; redoLabel: string | null };
  /** In the iPad preview: the previewed profile. Elsewhere "In the org" is what this session applied. */
  scope: ProfileScope | null;
  /** Applied this session and waiting for a publish (every profile). */
  awaiting: PendingChange[];
  job: PublishJob;
  /** Open Publish to iPad with these profiles ticked (null: let the admin choose). */
  onPublish: (profiles: string[] | null) => void;
  /** The last apply can be taken back: opens the review with its undos. */
  onUndoLastApply?: () => void;
  /** A step after "On iPads" (source control: applied changes not yet saved as source files), drawn like the others. */
  extraStep?: ReactNode;
}

type Open = "tray" | "org" | null;

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
const UNDO_KEYS = isMac ? "⌘Z" : "Ctrl+Z";
const REDO_KEYS = isMac ? "⇧⌘Z" : "Ctrl+Shift+Z";

/**
 * Where a change is on its way to reps: **Your changes** (the tray) → **In the org** (applied, not on iPads yet)
 * → **On iPads** (the last publish, or one running). Each count opens its list; one primary button says what to
 * do next — review the tray, publish, or nothing ("Reps have everything").
 */
export default function ReleaseBar({
  pending,
  onPendingChange,
  onReview,
  canReview,
  history,
  scope,
  awaiting,
  job,
  onPublish,
  onUndoLastApply,
  extraStep,
}: ReleaseBarProps) {
  const [open, setOpen] = useState<Open>(null);
  const root = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const org: OrgStep = scope ? profileOrgStep(scope.state) : sessionOrgStep(awaiting);
  const profile = scope?.profile ?? null;
  const primary = primaryAction({ pending: pending.length, org, profile, awaiting, job: job.status });
  const wide = orgWideNote(profile, awaiting);
  const publishedAt = org.kind === "count" ? org.publishedAt : undefined;
  const ipad = ipadStepLabel(job.status, job.error, publishedAt, (iso) => timeAgo(iso));

  // An emptied list closes its popover.
  useEffect(() => {
    if (open === "tray" && pending.length === 0) setOpen(null);
    if (open === "org" && !scope && awaiting.length === 0) setOpen(null);
  }, [open, pending.length, scope, awaiting.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
  }, [open, scope?.state, pending.length]);

  const toggle = (which: Exclude<Open, null>) => setOpen((o) => (o === which ? null : which));
  const publish = (profiles: string[] | null) => {
    setOpen(null);
    onPublish(profiles);
  };

  const trayStep = (
    <div className="release-step-root">
      <button
        type="button"
        className="release-step"
        aria-expanded={open === "tray"}
        aria-haspopup="dialog"
        disabled={pending.length === 0}
        onClick={() => toggle("tray")}
        title={pending.length ? `${pending.length} ${pending.length === 1 ? "change" : "changes"} not applied yet` : "No changes waiting to be applied"}
      >
        <ListChecks size={14} aria-hidden="true" />
        <span className="release-step-label">Your changes</span>
        <span className={`release-count${pending.length ? " pending" : ""}`}>{pending.length}</span>
      </button>
      {open === "tray" && (
        <div className="org-ahead-popover release-popover" ref={popover} role="dialog" aria-label="Your changes">
          <div className="org-ahead-scroll">
            <h3 className="ui-section-title">
              Not applied yet<span className="count">· {pending.length}</span>
            </h3>
            <ul className="release-list">
              {pending.map((c, i) => (
                <li key={`${i}:${c.fix.label}`} className="release-row">
                  <span className="release-row-main">
                    <span className="release-row-name" title={c.fix.label}>
                      {c.fix.label}
                    </span>
                    <span className="release-row-meta">{reachLabel(reachOfChange(c))}</span>
                  </span>
                  <button
                    type="button"
                    className="ui-icon-btn sm"
                    aria-label={`Remove ${c.fix.label}`}
                    title="Remove from your changes"
                    onClick={() => onPendingChange(pending.filter((_, j) => j !== i))}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="org-ahead-foot">
            <button type="button" className="studio-btn ghost" onClick={() => onPendingChange([])}>
              Discard all
            </button>
            <button
              type="button"
              className="studio-btn primary"
              disabled={!canReview}
              onClick={() => {
                setOpen(null);
                onReview();
              }}
            >
              Review & apply…
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const orgCount =
    org.kind === "loading" ? (
      <Spinner size={12} />
    ) : org.kind === "error" ? (
      <CircleAlert size={14} aria-hidden="true" className="release-warn" />
    ) : org.kind === "neverPublished" ? (
      <span className="release-count ahead">all</span>
    ) : (
      <span className={`release-count${org.count ? " ahead" : ""}`}>{org.count}</span>
    );
  const orgTitle =
    org.kind === "loading"
      ? "Checking what's in the org but not on iPads…"
      : org.kind === "error"
        ? `Couldn't check what's not on iPads yet — ${org.message}`
        : org.kind === "neverPublished"
          ? `${profile ?? "This profile"} has never been published to iPads`
          : org.count
            ? `${org.count} ${org.count === 1 ? "change" : "changes"} in the org but not on iPads yet${org.incomplete ? " (some kinds couldn't be read)" : ""}`
            : "Nothing in the org is waiting for a publish";
  const orgOpenable = scope ? org.kind === "count" && (org.count > 0 || org.incomplete) : awaiting.length > 0;
  const orgStep = (
    <div className="release-step-root">
      <button
        type="button"
        className="release-step"
        aria-expanded={open === "org"}
        aria-haspopup="dialog"
        disabled={!orgOpenable}
        onClick={() => toggle("org")}
        title={orgTitle}
        aria-label={`In the org: ${orgTitle}`}
      >
        <Cloud size={14} aria-hidden="true" />
        <span className="release-step-label">In the org</span>
        {orgCount}
      </button>
      {org.kind === "error" && scope && (
        <button type="button" className="ui-icon-btn sm" onClick={scope.onRetry} aria-label="Check again" title="Check again">
          <RotateCw size={14} aria-hidden="true" />
        </button>
      )}
      {open === "org" && (
        <div className="org-ahead-popover release-popover" ref={popover} role="dialog" aria-label="In the org, not on iPads yet">
          {scope ? (
            <UnpublishedList
              profile={scope.profile}
              state={scope.state}
              snapshot={scope.snapshot}
              onRetry={scope.onRetry}
              onShow={scope.onShow}
              onPublish={() => publish([scope.profile])}
              onClose={() => setOpen(null)}
            />
          ) : (
            <>
              <div className="org-ahead-scroll">
                <h3 className="ui-section-title">
                  Applied, not on iPads yet<span className="count">· {awaiting.length}</span>
                </h3>
                <ul className="release-list">
                  {awaiting.map((c, i) => (
                    <li key={`${i}:${c.fix.label}`} className="release-row">
                      <span className="release-row-main">
                        <span className="release-row-name" title={c.fix.label}>
                          {c.fix.label}
                        </span>
                        <span className="release-row-meta">
                          {reachLabel(reachOfChange(c))}
                          {c.affects?.length ? ` · ${c.affects.join(", ")}` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="org-ahead-foot">
                <span className="org-ahead-muted org-ahead-text">Reps get these after a publish</span>
                {primary.kind === "publish" && (
                  <button type="button" className="studio-btn primary" title={primary.title} onClick={() => publish(primary.profiles)}>
                    <CloudUpload aria-hidden="true" /> Publish to iPad…
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );

  const ipadStep = (
    <div className="release-step-root">
      <button
        type="button"
        className={`release-step ipad ${ipad.tone}`}
        onClick={() => publish(job.status?.state === "running" ? job.status.profiles : null)}
        title={
          ipad.tone === "running"
            ? `${job.status?.profiles.join(", ")} — ${job.status?.status ?? "generating"}${job.error ? ` (couldn't check: ${job.error})` : ""}`
            : ipad.tone === "failed"
              ? (job.status?.error ?? job.error ?? "Publish failed")
              : "Publish to iPad — regenerate the mobile metadata cache"
        }
      >
        {ipad.tone === "running" ? (
          <Spinner size={12} />
        ) : ipad.tone === "failed" ? (
          <CircleAlert size={14} aria-hidden="true" />
        ) : ipad.tone === "done" ? (
          <CircleCheck size={14} aria-hidden="true" />
        ) : (
          <Tablet size={14} aria-hidden="true" />
        )}
        <span className="release-step-label" aria-live="polite">
          {ipad.text}
        </span>
      </button>
      {ipad.tone === "failed" && job.lastStart && (
        <button type="button" className="studio-btn ghost sm" onClick={() => job.start(job.lastStart!.profiles, job.lastStart!.org)} disabled={job.starting}>
          <RotateCw aria-hidden="true" /> Retry
        </button>
      )}
    </div>
  );

  const sep = <ChevronRight size={14} aria-hidden="true" className="release-sep" />;

  return (
    <div className="studio-tray release-bar" ref={root} role="region" aria-label="Release">
      <div className="release-steps">
        {trayStep}
        {sep}
        {orgStep}
        {sep}
        {ipadStep}
        {extraStep && (
          <>
            {sep}
            {extraStep}
          </>
        )}
      </div>
      <div className="release-actions">
        <button
          className="ui-icon-btn"
          onClick={history.undo}
          disabled={!history.undoLabel}
          aria-label="Undo"
          title={history.undoLabel ? `Undo ${history.undoLabel} (${UNDO_KEYS})` : `Nothing to undo (${UNDO_KEYS})`}
        >
          <Undo2 size={14} aria-hidden="true" />
        </button>
        <button
          className="ui-icon-btn"
          onClick={history.redo}
          disabled={!history.redoLabel}
          aria-label="Redo"
          title={history.redoLabel ? `Redo ${history.redoLabel} (${REDO_KEYS})` : `Nothing to redo (${REDO_KEYS})`}
        >
          <Redo2 size={14} aria-hidden="true" />
        </button>
        {onUndoLastApply && (
          <button
            className="studio-btn ghost collapsible undo-apply"
            onClick={() => {
              setOpen(null);
              onUndoLastApply();
            }}
            title="Undo last apply — review the changes that take it back">
            <RotateCcw aria-hidden="true" />
            <span className="studio-btn-label">Undo last apply</span>
          </button>
        )}
        {primary.kind === "review" && (
          <button
            className="studio-btn primary"
            onClick={() => {
              setOpen(null);
              onReview();
            }}
            disabled={!canReview}
          >
            Review & apply…
          </button>
        )}
        {primary.kind === "publish" && (
          <>
            {wide && <span className="release-note">· {wide}</span>}
            <button className="studio-btn primary collapsible" onClick={() => publish(primary.profiles)} title={wide ? `${primary.title} (${wide} wait for a publish)` : primary.title}>
              <CloudUpload aria-hidden="true" />
              <span className="studio-btn-label">{primary.label}</span>
            </button>
          </>
        )}
        {/* While publishing, the "On iPads" step says so; there's nothing to offer until it's done. */}
        {primary.kind === "calm" && (
          <span className="release-calm" role="status" title={primary.title}>
            <CircleCheck size={14} aria-hidden="true" />
            <span className="release-step-label">{primary.text}</span>
          </span>
        )}
      </div>
    </div>
  );
}
