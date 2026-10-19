import React from "react";
import type { SetupLink } from "./setup-link";
import {
  Asterisk,
  CircleMinus,
  Columns2,
  Heading,
  Lock,
  Pencil,
  Undo2,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CircleDot,
  CloudOff,
  Copy,
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
  PanelTopOpen,
  SquarePlus,
  Star,
  type LucideIcon,
} from "lucide-react";
import type { TargetInfo, SyncAction } from "./edit-targets";
import type { Verb, VerbId } from "./edit-draft";
import type { LayoutStatus } from "./usePreviewEdit";
import type { PropertyEdit } from "./flexipage-draft";
import Spinner from "../ui/Spinner";
import { inspectorNote, type UnpublishedItem } from "./org-ahead";
import PropertiesSheet from "./PropertiesSheet";
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
  addTab: PanelTopOpen,
};

/**
 * What / Why / How for the block selected in edit mode: where it comes from,
 * why this profile's iPad shows it, the changes Studio can queue from here, and
 * Setup steps (with Open in Setup) for the ones it can't.
 */
/** The inspector's "copy just for this profile" row: an offer, the queued copy, or why a copy isn't possible. */
export type CopyAction =
  | { kind: "offer"; onCopy: () => void }
  | { kind: "queued"; onTakeOut: () => void }
  | { kind: "explain"; text: string };

export default function BlockInspector({
  info,
  profile,
  verbs,
  draft,
  onEditInDraft,
  onRun,
  horizontal,
  layout,
  orgAhead,
  onRetryLayout,
  properties,
  onProperty,
  onPropertyReset,
  propertiesLoading,
  propertiesNote,
  propertiesDynamic,
  propertiesComponentNote,
  propertiesNotDrawn,
  extra,
  sync,
  onSync,
  onSetup,
  onStudio,
  onClose,
  selection,
  copy,
}: {
  info: TargetInfo;
  profile: string;
  verbs: Verb[];
  /** Verbs only run in Next publish; On iPads now explains. */
  draft: boolean;
  /** On iPads now: switch to Next publish with this block still selected. */
  onEditInDraft?: () => void;
  onRun: (verb: Verb) => void;
  /** Moves go left / right (tabs, header fields). */
  horizontal?: boolean;
  /** The page layout behind the block, as read from the org. */
  layout?: LayoutStatus;
  /** The block's document changed in the org after the profile's last publish. */
  orgAhead?: UnpublishedItem;
  onRetryLayout?: () => void;
  /** Lightning page properties the block's inspector can set (a tab's title, an inline LWC's height). */
  properties?: PropertyEdit[];
  onProperty?: (edit: PropertyEdit, value: string) => void;
  onPropertyReset?: (edit: PropertyEdit) => void;
  /** The component's property definitions are still loading. */
  propertiesLoading?: boolean;
  propertiesNote?: string;
  propertiesDynamic?: string;
  /** Said once for the whole component: not drawn on the iPad, what an inline LWC is passed, or not traced. */
  propertiesComponentNote?: string;
  /** The iPad doesn't draw the component, so its fields don't each repeat "Not used on the iPad". */
  propertiesNotDrawn?: boolean;
  /** Editors only this kind of block has (a list view's filters). */
  extra?: React.ReactNode;
  /** Shown when the block's records aren't synced to this profile's iPad. */
  sync: SyncAction | null;
  onSync: () => void;
  onSetup?: (link: SetupLink) => void;
  onStudio?: () => void;
  onClose: () => void;
  /** "3 fields" when several blocks are selected: the inspector explains the last one clicked, its changes apply to all. */
  selection?: string;
  /** Making a copy of the shared layout or page just for this profile (see usePreviewEdit). */
  copy?: CopyAction;
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
        {info.draftOnly && <span className="ui-pill info" title="Added by a pending change; reps get it after you apply and publish">Not applied yet</span>}
        {selection && (
          <span className="ui-pill info" title="Changes below apply to every selected block; ⌘- or ⇧-click a block to add or drop it">
            {selection} selected
          </span>
        )}

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

        {orgAhead && (
          <p className="studio-block-reach studio-org-ahead-note" role="status">
            <CircleDot size={16} aria-hidden />
            <span>{inspectorNote(orgAhead)}</span>
          </p>
        )}

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
                  title={draft ? undefined : "Switch to Next publish to change it"}
                >
                  {sync.label}
                </button>
              )}
            </div>
          </div>
        )}

        <section className="studio-block-section">
          <h3 className="ui-section-title">How to change it</h3>
          {!draft && onEditInDraft && (
            <button type="button" className="studio-btn sm primary" onClick={onEditInDraft} title="Show what reps get after you apply and publish, with this selected, and change it there">
              <Pencil size={14} aria-hidden />
              Edit in Next publish
            </button>
          )}
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
                  ? "Switch to Next publish to change it"
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
          {properties && onProperty && onPropertyReset && (
            <PropertiesSheet properties={properties} draft={draft} loading={!!propertiesLoading} note={propertiesNote} dynamic={propertiesDynamic} componentNote={propertiesComponentNote} notDrawn={propertiesNotDrawn} onSet={onProperty} onReset={onPropertyReset} />
          )}
          {extra}
          {(layout?.profiles || layout?.reach || info.reach) && (
            <p className="studio-block-reach">
              <UsersRound size={14} aria-hidden />
              <span>{layout?.profiles ? layoutReach(layout.profiles) : (layout?.reach ?? info.reach)}</span>
            </p>
          )}
          {copy?.kind === "explain" && (
            <p className="studio-block-reach" role="status">
              <Copy size={14} aria-hidden />
              <span>{copy.text}</span>
            </p>
          )}
          {copy && copy.kind !== "explain" && (
            <div className="studio-block-verbs">
              {copy.kind === "offer" ? (
                <button
                  type="button"
                  className="studio-btn sm"
                  disabled={!draft}
                  title={draft ? `Copy this ${layout?.noun ?? "layout"} and point only ${profile} at the copy` : "Switch to Next publish to change it"}
                  onClick={copy.onCopy}
                >
                  <Copy size={14} aria-hidden />
                  Make a copy just for {profile}
                </button>
              ) : (
                <button type="button" className="studio-btn ghost sm" onClick={copy.onTakeOut} title="Take the copy out of the tray">
                  <Undo2 size={14} aria-hidden />
                  Take the copy out
                </button>
              )}
            </div>
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
                onClick={() => onSetup(info.setup!)}
                title={`Open ${info.setup.label} in Salesforce`}
              >
                <ExternalLink size={14} aria-hidden />
                Open in Setup
              </button>
            )}
            {onSetup &&
              info.setupMore?.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  className="studio-btn ghost sm"
                  onClick={() => onSetup(l)}
                  title={`Open ${l.label} in Salesforce`}
                >
                  <ExternalLink size={14} aria-hidden />
                  Open {l.label}
                </button>
              ))}
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

const SHARED_KINDS: Record<string, string> = {
  allInternalUsers: "all internal users",
  allPartnerUsers: "all partner users",
  group: "group",
  role: "role",
  roleAndSubordinates: "role and subordinates",
  roleAndSubordinatesInternal: "role and subordinates",
  territory: "territory",
  territoryAndSubordinates: "territory and subordinates",
};

/** Who sees a list view, from its `sharedTo` (null: no sharing set, so every user). */
export function listViewReach(sharedTo: { kind: string; name: string }[] | null): string {
  if (!sharedTo) return "Shared with all users. A change reaches them all.";
  if (!sharedTo.length) return "Not shared with anyone but its owner.";
  const shown = sharedTo.slice(0, 4).map((s) => (s.name ? `${SHARED_KINDS[s.kind] ?? s.kind} ${s.name}` : (SHARED_KINDS[s.kind] ?? s.kind)));
  const more = sharedTo.length > 4 ? ` and ${sharedTo.length - 4} more` : "";
  return `Shared with ${shown.join(", ")}${more}. A change reaches everyone it is shared with.`;
}
