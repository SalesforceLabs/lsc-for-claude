import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  FileText,
  MapPin,
  Package,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Tag,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import SearchPicker, { type PickerOption } from "../../ui/SearchPicker";
import Segmented from "../../ui/Segmented";
import StateView from "../../ui/StateView";
import ContentPlayStage from "../screens/ContentPlayStage";
import type { PublishedContentCard } from "../screens/content-types";
import {
  addNamed,
  addPage,
  addShare,
  FIELD_LABEL,
  fieldProblem,
  GESTURE_LABEL,
  draftedPage,
  holdsDraftedPages,
  isDraftedPage,
  movePage,
  pageLabel,
  partKey,
  removeNamed,
  removePage,
  removeShare,
  setField,
  shareFor,
  shareName,
  showField,
  slideCount,
  slidesLabel,
  updatePage,
  type FieldKey,
} from "./content-logic";
import type {
  ContentDraft,
  DraftPage,
  PresentationDetail,
  PresentationDraft,
} from "./content-types";

export type EditorTab = "details" | "pages" | "topics" | "territories" | "play";

interface PresentationEditorProps {
  detail: PresentationDetail;
  /** What the editor shows: the queued change's `to`, else the org's. */
  draft: PresentationDraft;
  /** What the edits are measured against (the org as it was read when they were first queued). */
  from: PresentationDraft;
  queued: boolean;
  /** The org changed after the edits were queued. */
  stale: boolean;
  /** Some presentation in the org has topics (else topics may not be switched on for presentations). */
  topicsInUse: boolean;
  tab: EditorTab;
  onTab: (tab: EditorTab) => void;
  onChange: (next: PresentationDraft) => void;
  onDiscard: () => void;
  onReview: () => void;
  onRefresh: () => void;
  /**
   * A presentation that isn't in the org yet (`detail` is made up from the org's lists): no Play tab, and the
   * pages Roz drafted can be added to it.
   */
  create?: { drafts: ContentDraft[] };
}

/** Shown wherever a presentation holds pages Roz drafted. */
export const REVIEW_NOTICE =
  "Roz drafted some of these pages. They're saved inactive and not given to any territory. Have them through medical, legal and regulatory review before anyone switches the presentation on.";

/** Drafts that can go into a presentation: written, not being changed, and with no errors. */
export const draftReady = (d: ContentDraft, running: boolean) =>
  !running && d.files.length > 0 && !d.checks.some((c) => c.level === "error");

type Picker =
  | { kind: "page" }
  | { kind: "product"; pageId: string }
  | { kind: "topic" }
  | { kind: "territory" }
  | null;

const changedDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

/** One presentation: its settings, pages, topics and territories, and a Play tab that runs it as the iPad does. */
export default function PresentationEditor({
  detail,
  draft,
  from,
  queued,
  stale,
  topicsInUse,
  tab,
  onTab,
  onChange,
  onDiscard,
  onReview,
  onRefresh,
  create,
}: PresentationEditorProps) {
  const [picker, setPicker] = useState<Picker>(null);
  const drafted = holdsDraftedPages(draft);
  const subtitle = create
    ? "New presentation · not in the org yet"
    : [
        detail.type,
        detail.lastModified &&
          `Changed ${changedDate(detail.lastModified)}${detail.lastModifiedBy ? ` by ${detail.lastModifiedBy}` : ""}`,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <div className="content-editor">
      <header className="studio-header">
        <div className="studio-heading">
          <h1 className="studio-title" title={draft.fields.name}>
            {draft.fields.name || detail.draft.fields.name || "New presentation"}
          </h1>
          <div className="studio-subtitle" title={subtitle}>
            {subtitle}
          </div>
        </div>
        <div className="studio-header-actions">
          {detail.production && <span className="ui-pill warning">Production</span>}
          {queued && (
            <>
              <button
                className="studio-btn ghost collapsible"
                onClick={onDiscard}
                title={
                  create
                    ? "Take this new presentation out of the tray"
                    : "Take this presentation's changes out of the tray"
                }
                aria-label={create ? "Discard" : "Discard changes"}
              >
                {create ? (
                  <Trash2 size={14} aria-hidden="true" />
                ) : (
                  <RotateCcw size={14} aria-hidden="true" />
                )}
                <span className="studio-btn-label">{create ? "Discard" : "Discard changes"}</span>
              </button>
              <button className="studio-btn primary" onClick={onReview}>
                Review changes…
              </button>
            </>
          )}
        </div>
      </header>
      {stale && (
        <div className="content-banner" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          Someone changed this presentation in the org after these edits were queued. Applying them
          may be refused; discard them and edit again.
          <button className="studio-link-btn" onClick={onRefresh}>
            Read it again
          </button>
        </div>
      )}
      {drafted && (
        <div className="content-note content-review-note" role="note">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>{REVIEW_NOTICE}</span>
        </div>
      )}
      <div className="content-tabs">
        <Segmented<EditorTab>
          aria-label="Presentation"
          value={tab}
          onChange={onTab}
          options={[
            { value: "details", label: "Details" },
            { value: "pages", label: "Pages", count: draft.pages.length },
            { value: "topics", label: "Topics", count: draft.topics.length },
            { value: "territories", label: "Territories", count: draft.shares.length },
            ...(create ? [] : [{ value: "play" as const, label: "Play", icon: Play }]),
          ]}
        />
      </div>
      <div className={`content-body${tab === "play" ? " playing" : ""}`} key={tab}>
        {tab === "details" && (
          <DetailsTab
            detail={detail}
            draft={draft}
            from={from}
            isNew={!!create}
            onChange={onChange}
          />
        )}
        {tab === "pages" && (
          <PagesTab
            detail={detail}
            draft={draft}
            from={from}
            drafts={create?.drafts}
            onChange={onChange}
            onPick={setPicker}
          />
        )}
        {tab === "topics" && (
          <TopicsTab
            draft={draft}
            from={from}
            topicsInUse={topicsInUse}
            onChange={onChange}
            onPick={setPicker}
          />
        )}
        {tab === "territories" && (
          <TerritoriesTab
            detail={detail}
            draft={draft}
            from={from}
            onChange={onChange}
            onPick={setPicker}
          />
        )}
        {tab === "play" && !create && (
          <PlayTab detail={detail} queued={queued} onClose={() => onTab("pages")} />
        )}
      </div>
      {picker && (
        <PickerDialog
          picker={picker}
          detail={detail}
          draft={draft}
          drafts={create?.drafts}
          onChange={onChange}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// --- Details ---------------------------------------------------------------------------------

function DetailsTab({
  detail,
  draft,
  from,
  isNew,
  onChange,
}: {
  detail: PresentationDetail;
  draft: PresentationDraft;
  from: PresentationDraft;
  isNew: boolean;
  onChange: (d: PresentationDraft) => void;
}) {
  const f = draft.fields;
  const locked = holdsDraftedPages(draft);
  const was = (k: FieldKey) =>
    partKey(from, `field:${k}`) !== partKey(draft, `field:${k}`)
      ? showField(k, from.fields[k])
      : null;
  const statuses =
    detail.statusValues.includes(f.status) || !f.status
      ? detail.statusValues
      : [f.status, ...detail.statusValues];
  const gestures =
    !f.gesture || detail.gestureValues.includes(f.gesture)
      ? detail.gestureValues
      : [f.gesture, ...detail.gestureValues];

  return (
    <div className="content-scroll">
      <div className="content-form">
        <NameField
          value={f.name}
          was={was("name")}
          onCommit={(name) => onChange(setField(draft, "name", name))}
        />
        <label className="ui-label">
          {FIELD_LABEL.status}
          <select
            className="ui-field"
            value={f.status}
            disabled={locked}
            onChange={(e) => onChange(setField(draft, "status", e.target.value))}
          >
            {statuses.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {locked ? (
            <span className="content-muted">
              Inactive until the pages Roz drafted have been reviewed.
            </span>
          ) : (
            <Was text={was("status")} />
          )}
        </label>
        <div className="content-form-row">
          {(["activationDate", "deactivationDate"] as const).map((k) => (
            <label className="ui-label" key={k}>
              {FIELD_LABEL[k]}
              <input
                className="ui-field"
                type="date"
                value={f[k] ?? ""}
                onChange={(e) => onChange(setField(draft, k, e.target.value || null))}
              />
              <Was text={was(k)} />
            </label>
          ))}
        </div>
        <p className="content-muted">
          Reps see an active presentation only between these dates. Leave them empty for no limit.
        </p>

        <h2 className="ui-section-title">In the player</h2>
        <label className="ui-label">
          {FIELD_LABEL.gesture}
          <select
            className="ui-field"
            value={f.gesture ?? ""}
            onChange={(e) => onChange(setField(draft, "gesture", e.target.value || null))}
          >
            <option value="">Not set</option>
            {gestures.map((v) => (
              <option key={v} value={v}>
                {GESTURE_LABEL[v] ?? v}
              </option>
            ))}
          </select>
          <Was text={was("gesture")} />
        </label>
        {(["pinchZoom", "doubleTapZoom", "canEmail", "locked"] as const).map((k) => (
          <label className="ui-check content-check" key={k}>
            <input
              type="checkbox"
              checked={f[k]}
              onChange={(e) => onChange(setField(draft, k, e.target.checked))}
            />
            <span>
              {FIELD_LABEL[k]}
              {k === "locked" && (
                <span className="content-muted">
                  {" "}
                  — reps can't skip pages or change their order
                </span>
              )}
              <Was text={was(k)} />
            </span>
          </label>
        ))}

        {!isNew && <AboutIt detail={detail} />}
      </div>
    </div>
  );
}

function AboutIt({ detail }: { detail: PresentationDetail }) {
  return (
    <>
      <h2 className="ui-section-title">About it</h2>
      <dl className="content-facts">
        <dt>Type</dt>
        <dd>{detail.type || "Not set"}</dd>
        {detail.usageType && (
          <>
            <dt>Used for</dt>
            <dd>{detail.usageType.replace(/([a-z])([A-Z])/g, "$1 $2")}</dd>
          </>
        )}
        <dt>Made by</dt>
        <dd>{detail.isCustom ? "A rep (custom presentation)" : "An admin"}</dd>
      </dl>
    </>
  );
}

function NameField({
  value,
  was,
  onCommit,
}: {
  value: string;
  was: string | null;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const problem = fieldProblem("name", text);
  const commit = () => {
    if (text !== value && !problem) onCommit(text);
  };
  return (
    <label className="ui-label">
      {FIELD_LABEL.name}
      <input
        className="ui-field"
        value={text}
        maxLength={120}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setText(value);
        }}
      />
      {problem ? <span className="content-problem">{problem}</span> : <Was text={was} />}
    </label>
  );
}

function Was({ text }: { text: string | null }) {
  return text === null ? null : <span className="content-was">Was {text}</span>;
}

// --- Pages -----------------------------------------------------------------------------------

function PagesTab({
  detail,
  draft,
  from,
  drafts,
  onChange,
  onPick,
}: {
  detail: PresentationDetail;
  draft: PresentationDraft;
  from: PresentationDraft;
  /** Set for a new presentation: Roz's drafts that can be added. */
  drafts?: ContentDraft[];
  onChange: (d: PresentationDraft) => void;
  onPick: (p: Picker) => void;
}) {
  const fromIds = new Set(from.pages.map((p) => p.pageId));
  const removed = from.pages.filter((p) => !draft.pages.some((q) => q.pageId === p.pageId));
  const inDraft = new Set(draft.pages.map((p) => p.pageId));
  const addable =
    detail.options.pages.filter((p) => !inDraft.has(p.id)).length +
    removed.length +
    (drafts ?? []).filter((d) => !inDraft.has(draftedPage(d).pageId)).length;
  return (
    <div className="content-scroll">
      <div className="content-toolbar">
        <span className="content-muted">
          Reps see the pages in this order. Required pages have to be shown before a visit can be
          saved.
        </span>
        <button className="studio-btn" onClick={() => onPick({ kind: "page" })} disabled={!addable}>
          <Plus size={14} aria-hidden="true" />
          Add page…
        </button>
      </div>
      {!draft.pages.length ? (
        <StateView
          kind="empty"
          layout="inline"
          icon={FileText}
          title="No pages"
          detail={
            addable
              ? "Add pages from the org's library."
              : drafts
                ? "The org has no HTML pages to add. Draft one with Roz, or upload slides from chat."
                : "The org has no other pages to add. Upload slides from chat first."
          }
        />
      ) : (
        <ol className="content-pages">
          {draft.pages.map((p, i) => (
            <PageRow
              key={p.pageId}
              page={p}
              index={i}
              count={draft.pages.length}
              isNew={!drafts && !fromIds.has(p.pageId)}
              thumbnail={
                detail.pageThumbnails[p.pageId] ??
                drafts?.find((d) => draftedPage(d).pageId === p.pageId)?.thumbnail
              }
              alsoIn={detail.sharedPages[p.pageId] ?? []}
              onMove={(to) => onChange(movePage(draft, i, to))}
              onRemove={() => onChange(removePage(draft, p.pageId))}
              onUpdate={(change) => onChange(updatePage(draft, p.pageId, change))}
              onAddProduct={() => onPick({ kind: "product", pageId: p.pageId })}
            />
          ))}
        </ol>
      )}
      {removed.length > 0 && (
        <p className="content-muted content-removed">
          Taken out: {removed.map((p) => p.name).join(", ")}. The pages stay in the org; only their
          place here goes.
        </p>
      )}
    </div>
  );
}

function PageRow({
  page,
  index,
  count,
  isNew,
  thumbnail,
  alsoIn,
  onMove,
  onRemove,
  onUpdate,
  onAddProduct,
}: {
  page: DraftPage;
  index: number;
  count: number;
  isNew: boolean;
  thumbnail?: string;
  alsoIn: string[];
  onMove: (to: number) => void;
  onRemove: () => void;
  onUpdate: (change: Partial<Pick<DraftPage, "mandatory" | "products">>) => void;
  onAddProduct: () => void;
}) {
  return (
    <li className="content-page-row">
      <span className="content-page-num">{index + 1}</span>
      <span className="content-page-thumb">
        {thumbnail ? (
          <img src={thumbnail} alt="" />
        ) : isDraftedPage(page.pageId) ? (
          <Sparkles size={16} aria-hidden="true" />
        ) : (
          <FileText size={16} aria-hidden="true" />
        )}
      </span>
      <div className="content-page-main">
        <div className="content-page-name">
          <span title={page.name}>{page.name}</span>
          {isNew && <span className="ui-pill info">New here</span>}
          {isDraftedPage(page.pageId) && <span className="ui-pill info">Drafted by Roz</span>}
        </div>
        {alsoIn.length > 0 && (
          <div className="content-muted content-page-also" title={alsoIn.join(", ")}>
            Also in {alsoIn.length === 1 ? alsoIn[0] : `${alsoIn.length} other presentations`}; its
            required setting and products are shared with them.
          </div>
        )}
        <div className="content-page-settings">
          <label className="ui-check">
            <input
              type="checkbox"
              checked={page.mandatory}
              onChange={(e) => onUpdate({ mandatory: e.target.checked })}
            />
            Required
          </label>
          <span className="content-chips" aria-label="Products">
            {page.products.map((pr) => (
              <span className="content-chip" key={pr.id}>
                {pr.name}
                <button
                  className="content-chip-x"
                  aria-label={`Take ${pr.name} off this page`}
                  onClick={() =>
                    onUpdate({ products: page.products.filter((x) => x.id !== pr.id) })
                  }
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <button className="studio-link-btn" onClick={onAddProduct}>
              <Package size={12} aria-hidden="true" />
              Add product
            </button>
          </span>
        </div>
      </div>
      <div className="content-page-actions">
        <button
          className="ui-icon-btn"
          aria-label="Move up"
          title="Move up"
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
        >
          <ArrowUp size={14} />
        </button>
        <button
          className="ui-icon-btn"
          aria-label="Move down"
          title="Move down"
          disabled={index === count - 1}
          onClick={() => onMove(index + 1)}
        >
          <ArrowDown size={14} />
        </button>
        <button
          className="ui-icon-btn"
          aria-label={`Take ${page.name} out`}
          title="Take out of this presentation"
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}

// --- Topics ----------------------------------------------------------------------------------

function TopicsTab({
  draft,
  from,
  topicsInUse,
  onChange,
  onPick,
}: {
  draft: PresentationDraft;
  from: PresentationDraft;
  topicsInUse: boolean;
  onChange: (d: PresentationDraft) => void;
  onPick: (p: Picker) => void;
}) {
  const adding = draft.topics.some((t) => !from.topics.some((x) => x.id === t.id));
  return (
    <div className="content-scroll">
      <div className="content-toolbar">
        <span className="content-muted">
          Topics are the sections reps browse by on the iPad's Content tab.
        </span>
        <button className="studio-btn" onClick={() => onPick({ kind: "topic" })}>
          <Plus size={14} aria-hidden="true" />
          Add topic…
        </button>
      </div>
      {!topicsInUse && (
        <div className="content-note">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>
            No presentation in this org has topics yet. Salesforce only takes them once Topics for
            Objects is on for Presentation (Setup → Topics for Objects).
            {adding ? " If it's off, applying this change is refused and nothing is written." : ""}
          </span>
        </div>
      )}
      {!draft.topics.length ? (
        <StateView
          kind="empty"
          layout="inline"
          icon={Tag}
          title="No topics"
          detail="Without a topic the presentation sits in the untitled section."
        />
      ) : (
        <div className="content-chips content-chips-lg">
          {draft.topics.map((t) => (
            <span className="content-chip" key={t.id}>
              {t.name}
              <button
                className="content-chip-x"
                aria-label={`Remove topic ${t.name}`}
                onClick={() => onChange({ ...draft, topics: removeNamed(draft.topics, t.id) })}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Territories -----------------------------------------------------------------------------

function TerritoriesTab({
  detail,
  draft,
  from,
  onChange,
  onPick,
}: {
  detail: PresentationDetail;
  draft: PresentationDraft;
  from: PresentationDraft;
  onChange: (d: PresentationDraft) => void;
  onPick: (p: Picker) => void;
}) {
  const fromGroups = new Set(from.shares.map((s) => s.groupId));
  const held = holdsDraftedPages(draft);
  return (
    <div className="content-scroll">
      <div className="content-toolbar">
        <span className="content-muted">
          Reps in these territories get the presentation and its pages on their next sync.
        </span>
        <button
          className="studio-btn"
          onClick={() => onPick({ kind: "territory" })}
          disabled={!detail.options.territories.length || held}
          title={held ? "Not until the pages Roz drafted have been reviewed" : undefined}
        >
          <Plus size={14} aria-hidden="true" />
          Add territory…
        </button>
      </div>
      {held && draft.shares.length > 0 && (
        <div className="content-note" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>
            A presentation with pages Roz drafted can't be given to territories yet. Take these off,
            or applying is refused.
          </span>
        </div>
      )}
      {!draft.shares.length ? (
        <StateView
          kind="empty"
          layout="inline"
          icon={MapPin}
          title="Not distributed"
          detail={
            held
              ? "It stays with no territory until the pages Roz drafted have been reviewed."
              : detail.options.territories.length
                ? "No rep sees it until it's given to a territory."
                : detail.options.notes.join(" ") || "The org has no territories."
          }
        />
      ) : (
        <ul className="content-shares">
          {draft.shares.map((s) => (
            <li className="content-share" key={s.groupId}>
              <MapPin size={16} aria-hidden="true" />
              <span className="content-share-name" title={shareName(s)}>
                {shareName(s)}
              </span>
              {!fromGroups.has(s.groupId) && <span className="ui-pill info">New</span>}
              <button
                className="ui-icon-btn"
                aria-label={`Stop sharing with ${shareName(s)}`}
                title="Remove"
                onClick={() => onChange(removeShare(draft, s.groupId))}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {detail.otherShares > 0 && (
        <p className="content-muted content-removed">
          It's also shared with {detail.otherShares}{" "}
          {detail.otherShares === 1 ? "user or group" : "users or groups"} outside territories.
          Studio leaves those alone.
        </p>
      )}
    </div>
  );
}

// --- Play ------------------------------------------------------------------------------------

function PlayTab({
  detail,
  queued,
  onClose,
}: {
  detail: PresentationDetail;
  queued: boolean;
  onClose: () => void;
}) {
  const card: PublishedContentCard = {
    id: detail.id,
    name: detail.draft.fields.name,
    type: detail.type,
    pages: detail.draft.pages.length,
    date: "",
    isCustom: detail.isCustom,
    ownedByViewer: false,
    shareable: detail.draft.fields.canEmail,
    thumbnail: detail.draft.pages[0]
      ? detail.pageThumbnails[detail.draft.pages[0].pageId]
      : undefined,
  };
  return (
    <>
      <p className="content-muted content-play-note">
        {queued
          ? "This plays the presentation as it is in the org. Your queued changes show here once they're applied."
          : "This plays the presentation as reps see it, with the pages running live."}
      </p>
      {detail.draft.pages.length ? (
        <ContentPlayStage card={card} onClose={onClose} />
      ) : (
        <StateView
          kind="empty"
          icon={Play}
          title="Nothing to play"
          detail="The presentation has no pages in the org yet."
        />
      )}
    </>
  );
}

// --- Pickers ---------------------------------------------------------------------------------

function PickerDialog({
  picker,
  detail,
  draft,
  drafts,
  onChange,
  onClose,
}: {
  picker: NonNullable<Picker>;
  detail: PresentationDetail;
  draft: PresentationDraft;
  drafts?: ContentDraft[];
  onChange: (d: PresentationDraft) => void;
  onClose: () => void;
}) {
  const o = detail.options;
  const done = (d: PresentationDraft) => {
    onChange(d);
    onClose();
  };
  const note = o.notes.length ? o.notes.join(" ") : undefined;

  const view = useMemo(() => {
    switch (picker.kind) {
      case "page": {
        const inDraft = new Set(draft.pages.map((p) => p.pageId));
        // Pages taken out in this draft can go back; they keep their own settings.
        const removed = detail.draft.pages.filter((p) => !inDraft.has(p.pageId));
        const fresh = (drafts ?? []).filter((d) => !inDraft.has(draftedPage(d).pageId));
        const options: PickerOption[] = [
          ...fresh.map((d) => ({
            value: draftedPage(d).pageId,
            label: d.name,
            detail: `Drafted by Roz · ${slidesLabel(slideCount(d))}`,
          })),
          ...removed.map((p) => ({
            value: p.pageId,
            label: p.name,
            detail: "Was in this presentation",
          })),
          ...o.pages
            .filter((p) => !inDraft.has(p.id))
            .map((p) => ({
              value: p.id,
              label: pageLabel(p),
              detail: [
                p.type,
                p.status,
                p.presentations.length
                  ? `in ${p.presentations.length === 1 ? p.presentations[0] : `${p.presentations.length} presentations`}`
                  : "in no presentation",
              ]
                .filter(Boolean)
                .join(" · "),
            })),
        ];
        return {
          title: "Add a page",
          description: "It goes at the end; move it from there.",
          options,
          empty: "No other pages",
          pick: (id: string) => {
            const mine = fresh.find((d) => draftedPage(d).pageId === id);
            if (mine) return done(addPage(draft, draftedPage(mine)));
            const back = removed.find((p) => p.pageId === id);
            const opt = o.pages.find((p) => p.id === id);
            const page =
              back ??
              (opt
                ? {
                    pageId: opt.id,
                    // As the picker named it: "Deck — page 2", not "2".
                    name: pageLabel(opt),
                    mandatory: opt.mandatory,
                    products: opt.products,
                  }
                : null);
            if (page) done(addPage(draft, page));
          },
        };
      }
      case "product": {
        const page = draft.pages.find((p) => p.pageId === picker.pageId);
        const has = new Set(page?.products.map((x) => x.id));
        return {
          title: "Add a product",
          description: page ? `Reps can find ${page.name} by this product.` : undefined,
          options: o.products
            .filter((p) => !has.has(p.id))
            .map((p) => ({ value: p.id, label: p.name })),
          empty: "No products to add",
          pick: (id: string) => {
            const product = o.products.find((p) => p.id === id);
            if (page && product)
              done(updatePage(draft, page.pageId, { products: addNamed(page.products, product) }));
          },
        };
      }
      case "topic": {
        const has = new Set(draft.topics.map((t) => t.id));
        return {
          title: "Add a topic",
          description: undefined,
          options: o.topics
            .filter((t) => !has.has(t.id))
            .map((t) => ({ value: t.id, label: t.name })),
          empty: "No topics to add",
          pick: (id: string) => {
            const topic = o.topics.find((t) => t.id === id);
            if (topic) done({ ...draft, topics: addNamed(draft.topics, topic) });
          },
        };
      }
      case "territory": {
        const has = new Set(draft.shares.map((s) => s.groupId));
        const parents = new Set(o.territories.map((t) => t.parentId).filter(Boolean));
        const names = new Map(o.territories.map((t) => [t.territoryId, t.name]));
        const options: PickerOption[] = o.territories.flatMap((t) => {
          const under = t.parentId
            ? `under ${names.get(t.parentId) ?? "another territory"}`
            : "top level";
          const out: PickerOption[] = [];
          if (
            parents.has(t.territoryId) &&
            t.subordinatesGroupId &&
            !has.has(t.subordinatesGroupId)
          ) {
            out.push({
              value: `${t.territoryId}:below`,
              label: `${t.name} and below`,
              detail: under,
            });
          }
          if ((t.groupId || !parents.has(t.territoryId)) && !(t.groupId && has.has(t.groupId))) {
            out.push({
              value: `${t.territoryId}:only`,
              label: parents.has(t.territoryId) ? `${t.name} only` : t.name,
              detail: under,
            });
          }
          return out;
        });
        return {
          title: "Distribute to a territory",
          description:
            "Reps in the territory get it on their next sync. A territory with others under it can include them.",
          options,
          empty: "No territories to add",
          pick: (value: string) => {
            const [id, scope] = value.split(":");
            const t = o.territories.find((x) => x.territoryId === id);
            const share = t && shareFor(t, scope === "below");
            if (share) done(addShare(draft, share));
          },
        };
      }
    }
  }, [picker, detail, draft, drafts, o]);

  return (
    <SearchPicker
      title={view.title}
      description={view.description}
      options={view.options}
      emptyTitle={view.empty}
      emptyDetail={note}
      onPick={view.pick}
      onCancel={onClose}
    />
  );
}
