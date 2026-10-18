import React from "react";
import {
  Asterisk,
  CircleMinus,
  Columns2,
  Heading,
  Lock,
  Undo2,
  ArrowDown,
  ArrowUp,
  CloudOff,
  ExternalLink,
  Eye,
  EyeOff,
  Power,
  PowerOff,
  SquareArrowOutUpRight,
  Trash2,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import type { TargetInfo, SyncAction } from "./edit-targets";
import type { Verb, VerbId } from "./edit-draft";

const ICONS: Record<VerbId, LucideIcon> = {
  up: ArrowUp,
  down: ArrowDown,
  hide: EyeOff,
  show: Eye,
  off: PowerOff,
  on: Power,
  discard: Trash2,
  remove: CircleMinus,
  restore: Undo2,
  column: Columns2,
  heading: Heading,
  required: Asterisk,
  readonly: Lock,
};

/**
 * What / Why / How for the block selected in edit mode: where it comes from,
 * why this profile's iPad shows it, the changes Studio can queue from here, and
 * Setup steps (with Open in Setup) for the ones it can't.
 */
export default function BlockInspector({
  info,
  profile,
  verbs,
  draft,
  onRun,
  sync,
  onSync,
  onSetup,
  onStudio,
  onClose,
}: {
  info: TargetInfo;
  profile: string;
  verbs: Verb[];
  /** Verbs only run in Draft; Published explains. */
  draft: boolean;
  onRun: (verb: Verb) => void;
  /** Shown when the block's records aren't synced to this profile's iPad. */
  sync: SyncAction | null;
  onSync: () => void;
  onSetup?: () => void;
  onStudio?: () => void;
  onClose: () => void;
}) {
  return (
    <aside
      className="studio-inspector studio-block-inspector"
      aria-label={`${info.kind}: ${info.title}`}
    >
      <div className="studio-inspector-header">
        <span className="studio-inspector-eyebrow">{info.kind}</span>
        <button type="button" className="ui-icon-btn" aria-label="Close" onClick={onClose}>
          <X size={14} aria-hidden />
        </button>
      </div>
      <div className="studio-inspector-body">
        <h2 className="studio-inspector-title">{info.title}</h2>
        {info.draftOnly && <span className="ui-pill info">In Draft only</span>}

        <section className="studio-block-section">
          <h3 className="ui-section-title">What</h3>
          <ol className="studio-block-crumbs">
            {info.what.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ol>
        </section>

        <section className="studio-block-section">
          <h3 className="ui-section-title">Why {profile} sees it</h3>
          <ul className="studio-block-list">
            {info.why.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>

        {sync && (
          <div className="studio-block-sync" role="status">
            <CloudOff size={16} aria-hidden />
            <div>
              <div className="studio-block-sync-title">Not synced to this iPad</div>
              <div className="studio-inspector-desc">
                {profile}'s metadata cache has no DB Schema table for {info.syncObject}, so the iPad
                has none of its records to show.
              </div>
              {sync.kind === "queued" ? (
                <div className="studio-inspector-desc">{sync.label}.</div>
              ) : (
                <button
                  type="button"
                  className="studio-btn sm"
                  onClick={onSync}
                  disabled={!draft}
                  title={draft ? undefined : "Switch to Draft to queue changes"}
                >
                  {sync.label}
                </button>
              )}
            </div>
          </div>
        )}

        <section className="studio-block-section">
          <h3 className="ui-section-title">How to change it</h3>
          {verbs.length > 0 && (
            <div className="studio-block-verbs">
              {verbs.map((v) => {
                const Icon = ICONS[v.id];
                const why = !draft
                  ? "Switch to Draft to queue changes"
                  : v.run
                    ? v.title
                    : v.reason;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className="studio-btn sm"
                    disabled={!draft || !v.run}
                    title={why}
                    onClick={() => onRun(v)}
                  >
                    <Icon size={14} aria-hidden />
                    {v.label}
                  </button>
                );
              })}
            </div>
          )}
          {info.reach && (
            <p className="studio-block-reach">
              <UsersRound size={14} aria-hidden />
              <span>{info.reach}</span>
            </p>
          )}
          <ol className="studio-block-steps">
            {info.how.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
          <div className="studio-block-verbs">
            {info.setup && onSetup && (
              <button
                type="button"
                className="studio-btn sm"
                onClick={onSetup}
                title={`Open ${info.setup.label} in Salesforce`}
              >
                <ExternalLink size={14} aria-hidden />
                Open in Setup
              </button>
            )}
            {info.studio && onStudio && (
              <button
                type="button"
                className="studio-btn ghost sm"
                onClick={onStudio}
                title="Open the record on its Studio board"
              >
                <SquareArrowOutUpRight size={14} aria-hidden />
                Open in Studio
              </button>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
