import React, { useEffect, useState } from "react";
import {
  Asterisk,
  CircleMinus,
  Columns2,
  Heading,
  Lock,
  Undo2,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
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
  ListPlus,
  TextCursorInput,
  SquarePlus,
  Star,
  type LucideIcon,
} from "lucide-react";
import type { TargetInfo, SyncAction } from "./edit-targets";
import type { Verb, VerbId } from "./edit-draft";
import type { LayoutStatus } from "./usePreviewEdit";
import type { PropertyEdit } from "./flexipage-draft";
import Spinner from "../ui/Spinner";
import StatusIcon from "../ui/StatusIcon";

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
  addField: TextCursorInput,
  addRelated: ListPlus,
  default: Star,
  insertComponent: SquarePlus,
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
  horizontal,
  layout,
  onRetryLayout,
  properties,
  onProperty,
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
  /** Moves go left / right (tabs, header fields). */
  horizontal?: boolean;
  /** The page layout behind the block, as read from the org. */
  layout?: LayoutStatus;
  onRetryLayout?: () => void;
  /** Lightning page properties the block's inspector can set (a tab's title, an inline LWC's height). */
  properties?: PropertyEdit[];
  onProperty?: (edit: PropertyEdit, value: string) => void;
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
          {layout?.loading && (
            <p className="studio-block-reach" role="status">
              <Spinner size={14} />
              <span>Reading the {layout.noun ?? "layout"} from the org…</span>
            </p>
          )}
          {layout?.problem && (
            <div className="studio-block-reach" role="status">
              <StatusIcon tone="warning" size={16} />
              <span>
                {layout.problem}
                {layout.canRetry && onRetryLayout && (
                  <>
                    {" "}
                    <button type="button" className="studio-btn ghost sm" onClick={onRetryLayout}>
                      Retry
                    </button>
                  </>
                )}
              </span>
            </div>
          )}
          {layout?.production && (
            <span className="ui-pill warning" title={`Changes to this ${layout.noun ?? "layout"} deploy to a production org`}>
              Production org
            </span>
          )}
          {layout?.note && (
            <p className="studio-block-reach" role="status">
              <StatusIcon tone="warning" size={16} />
              <span>{layout.note}</span>
            </p>
          )}
          {verbs.length > 0 && (
            <div className="studio-block-verbs">
              {verbs.map((v) => {
                const Icon =
                  horizontal && v.id === "up"
                    ? ArrowLeft
                    : horizontal && v.id === "down"
                      ? ArrowRight
                      : ICONS[v.id];
                const why = !draft
                  ? "Switch to Draft to queue changes"
                  : v.run || v.pick
                    ? v.title
                    : v.reason;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className="studio-btn sm"
                    disabled={!draft || (!v.run && !v.pick)}
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
          {properties && properties.length > 0 && onProperty && (
            <div className="studio-form">
              {properties.map((p) => (
                <PropertyField key={p.property} edit={p} draft={draft} onSet={(value) => onProperty(p, value)} />
              ))}
            </div>
          )}
          {(layout?.profiles || layout?.reach || info.reach) && (
            <p className="studio-block-reach">
              <UsersRound size={14} aria-hidden />
              <span>{layout?.profiles ? layoutReach(layout.profiles) : (layout?.reach ?? info.reach)}</span>
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

/** One Lightning page property: queued when the field is left or Enter is pressed, if the value is valid and changed. */
function PropertyField({ edit, draft, onSet }: { edit: PropertyEdit; draft: boolean; onSet: (value: string) => void }) {
  const [value, setValue] = useState(edit.value);
  useEffect(() => setValue(edit.value), [edit.value]);
  const { problem, warning } = edit.check(value);
  const commit = () => {
    if (value !== edit.value && !problem) onSet(value);
  };
  return (
    <label className="studio-form-row">
      <span className="studio-form-label">{edit.label}</span>
      <span className="studio-form-field">
        <input
          className="studio-input"
          type={edit.kind === "number" ? "number" : "text"}
          min={edit.kind === "number" ? 1 : undefined}
          value={value}
          disabled={!draft}
          title={draft ? undefined : "Switch to Draft to queue changes"}
          aria-invalid={!!problem}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setValue(edit.value);
          }}
        />
        {(problem || warning) && (
          <span className="studio-form-help" role="status">
            <StatusIcon tone={problem ? "error" : "warning"} size={14} />
            {problem ?? warning}
          </span>
        )}
      </span>
    </label>
  );
}

/** Who a Lightning page change reaches, from the apps that assign it (profile overrides and app defaults). */
export function pageReach(profiles: string[], apps: string[]): string {
  const list = (xs: string[]) => `${xs.slice(0, 4).join(", ")}${xs.length > 4 ? ` and ${xs.length - 4} more` : ""}`;
  const parts = [
    profiles.length && `assigned to ${profiles.length === 1 ? "1 profile" : `${profiles.length} profiles`} (${list(profiles)})`,
    apps.length && `the default for ${apps.length === 1 ? "1 app" : `${apps.length} apps`} (${list(apps)})`,
  ].filter(Boolean);
  if (!parts.length) return "No app assigns this page to a profile; it may be the org default. A change reaches everyone who gets it.";
  return `The page is ${parts.join(" and ")}. A change reaches everyone who gets it.`;
}

/** Who a layout change reaches, from the layout's profile assignments. */
export function layoutReach(profiles: string[]): string {
  if (!profiles.length) return "No profile is assigned this layout.";
  const shown = profiles.slice(0, 4).join(", ");
  const more = profiles.length > 4 ? ` and ${profiles.length - 4} more` : "";
  return `The layout for ${profiles.length === 1 ? "1 profile" : `${profiles.length} profiles`} (${shown}${more}). A change reaches them all.`;
}

/** Who a compact layout change reaches, from the record types assigned it. */
export function compactReach(recordTypes: string[]): string {
  if (!recordTypes.length) return "No record type is assigned this compact layout.";
  const shown = recordTypes.slice(0, 4).join(", ");
  const more = recordTypes.length > 4 ? ` and ${recordTypes.length - 4} more` : "";
  const n = recordTypes.length === 1 ? "1 record type" : `${recordTypes.length} record types`;
  return `The compact layout for ${n} (${shown}${more}), for every profile. A change reaches them all.`;
}
