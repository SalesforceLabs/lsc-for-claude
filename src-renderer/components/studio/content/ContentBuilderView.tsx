import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers, Plus, Presentation, Search, Sparkles } from "lucide-react";
import { useSelectedOrgId } from "../../../hooks/useOrgs";
import { usePersistedState } from "../../../hooks/usePersistedState";
import Menu from "../../ui/Menu";
import ResizeHandle from "../../ui/ResizeHandle";
import Spinner from "../../ui/Spinner";
import StateView from "../../ui/StateView";
import { pendingFor, queueChange, type PendingChange } from "../changes";
import { useLazyStudio } from "../useLazyStudio";
import ContentDraftPane, { type WritingNote } from "./ContentDraftPane";
import {
  applyDraftEvent,
  blankPresentation,
  changedParts,
  draftedPage,
  draftRunning,
  editLabel,
  isDraftedPage,
  newPresentationFix,
  sameDraft,
  slideCount,
  slidesLabel,
} from "./content-logic";
import type {
  ContentDraft,
  CreatePresentationFix,
  EditPresentationFix,
  NewPresentationOptions,
  PresentationDetail,
  PresentationDraft,
  PresentationLibrary,
  PresentationSummary,
} from "./content-types";
import NewDraftDialog from "./NewDraftDialog";
import PresentationEditor, { draftReady, type EditorTab } from "./PresentationEditor";
import "./content-builder.css";

interface ContentBuilderViewProps {
  pending: PendingChange[];
  onPendingChange: (next: PendingChange[]) => void;
  /** Open the review dialog for the tray. */
  onReview: () => void;
  /** Bumps after changes are applied to the org. */
  writeVersion: number;
  /** The page is the one on screen (it stays mounted when it isn't). */
  active: boolean;
  tray: React.ReactNode;
}

const number = (raw: string) => (Number.isFinite(Number(raw)) ? Number(raw) : undefined);

function toLibrary(data: unknown): PresentationLibrary {
  const lib = data as PresentationLibrary | undefined;
  if (!lib || !Array.isArray(lib.presentations))
    throw new Error("Studio couldn't read the presentations.");
  return lib;
}

type Selection =
  | { kind: "presentation"; id: string }
  | { kind: "new"; key: string }
  | { kind: "draft"; id: string }
  | null;

type Loaded<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

const newKey = () => crypto.randomUUID();

/** A new presentation's editor works on the same shape as an existing one's: made up from the org's lists. */
function newDetail(
  o: NewPresentationOptions,
  fix: CreatePresentationFix,
  images: Record<string, string>
): PresentationDetail {
  return {
    id: "",
    type: "ZIP",
    usageType: "IntelligentContent",
    isCustom: false,
    lastModified: "",
    lastModifiedBy: "",
    draft: blankPresentation(""),
    statusValues: o.statusValues,
    gestureValues: o.gestureValues,
    sharedPages: Object.fromEntries(
      fix.draft.pages
        .filter((p) => !isDraftedPage(p.pageId))
        .map((p) => [p.pageId, o.options.pages.find((x) => x.id === p.pageId)?.presentations ?? []])
    ),
    pageThumbnails: images,
    otherShares: 0,
    options: o.options,
    production: o.production,
  };
}

type DetailState =
  | { status: "loading" }
  | { status: "ready"; data: PresentationDetail }
  | { status: "error"; message: string };

/** Studio → Build → Intelligent Content: the org's presentations, and an editor whose changes wait in the tray. */
export default function ContentBuilderView({
  pending,
  onPendingChange,
  onReview,
  writeVersion,
  active,
  tray,
}: ContentBuilderViewProps) {
  const loads = useRef(0);
  const { state, retry } = useLazyStudio(
    `content:${writeVersion}`,
    () => window.lscApi.studioContentLibrary(loads.current++ > 0),
    toLibrary
  );
  // The last good library stays on screen while a refresh runs.
  const [library, setLibrary] = useState<PresentationLibrary | null>(null);
  useEffect(() => {
    if (state.status === "ready") setLibrary(state.data);
  }, [state]);

  const [sel, setSel] = useState<Selection>(null);
  const selectedId = sel?.kind === "presentation" ? sel.id : null;
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<EditorTab>("details");
  const [libWidth, setLibWidth] = usePersistedState("roz.content.libWidth", 300, number, String);
  const [dragging, setDragging] = useState(false);
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  const loadDetail = useCallback(async (id: string) => {
    setDetails((d) => ({ ...d, [id]: { status: "loading" } }));
    try {
      const res = await window.lscApi.studioContentPresentation(id);
      const data = res.data as (PresentationDetail & { error?: string }) | undefined;
      if (res.error || !data || data.error)
        throw new Error(res.error || data?.error || "No answer from Studio.");
      setDetails((d) => ({ ...d, [id]: { status: "ready", data } }));
    } catch (err) {
      setDetails((d) => ({
        ...d,
        [id]: { status: "error", message: err instanceof Error ? err.message : String(err) },
      }));
    }
  }, []);

  // After an apply the org has moved on: read the open presentation again, and forget the others.
  const lastWrite = useRef(writeVersion);
  useEffect(() => {
    if (lastWrite.current === writeVersion) return;
    lastWrite.current = writeVersion;
    setDetails({});
    if (selectedId) void loadDetail(selectedId);
  }, [writeVersion, selectedId, loadDetail]);

  const select = (id: string) => {
    setSel({ kind: "presentation", id });
    if (!details[id] || details[id].status === "error") void loadDetail(id);
  };

  const presentations = library?.presentations ?? [];
  // Open the newest one when the page first has a library.
  useEffect(() => {
    if (!sel && presentations.length) select(presentations[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentations.length]);

  // --- Roz's drafts: kept on this computer per org, streamed while Roz works on them. ---
  const orgId = useSelectedOrgId();
  const [drafts, setDrafts] = useState<Loaded<ContentDraft[]>>({ status: "loading" });
  const [writing, setWriting] = useState<Record<string, WritingNote>>({});
  const loadDrafts = useCallback(async () => {
    try {
      const list = await window.lscApi.contentDraftList();
      setDrafts({ status: "ready", data: list });
    } catch (err) {
      setDrafts({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);
  useEffect(() => {
    if (orgId === undefined) return;
    setSel((s) => (s?.kind === "presentation" ? s : null));
    void loadDrafts();
  }, [orgId, loadDrafts]);
  useEffect(
    () =>
      window.lscApi.onContentDraftEvent(({ draftId, event }) => {
        if (event.type === "writing")
          setWriting((w) => ({
            ...w,
            [draftId]: { turnId: event.turnId, path: event.path, chars: event.chars },
          }));
        else if (
          event.type === "draft" ||
          (event.type === "turn" && event.turn.status !== "running")
        )
          setWriting((w) => {
            const { [draftId]: _gone, ...rest } = w;
            return rest;
          });
        setDrafts((d) =>
          d.status === "ready"
            ? { status: "ready", data: applyDraftEvent(d.data, draftId, event) }
            : d
        );
      }),
    []
  );
  const draftList = drafts.status === "ready" ? drafts.data : [];
  const upsertDraft = (draft: ContentDraft) =>
    setDrafts((d) => ({
      status: "ready",
      data: applyDraftEvent(d.status === "ready" ? d.data : [], draft.id, { type: "draft", draft }),
    }));
  const [briefOpen, setBriefOpen] = useState(false);
  const startDraft = async (brief: string): Promise<string | null> => {
    try {
      const r = await window.lscApi.contentDraftCreate(brief);
      if ("error" in r) return r.error;
      upsertDraft(r);
      setBriefOpen(false);
      setSel({ kind: "draft", id: r.id });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  // --- New presentations: they live in the tray until they're applied. ---
  const newFixes = useMemo(
    () => pending.flatMap((p) => (p.fix.kind === "createPresentation" ? [p.fix] : [])),
    [pending]
  );
  const [newOptions, setNewOptions] = useState<Loaded<NewPresentationOptions> | null>(null);
  const loadNewOptions = useCallback(async () => {
    setNewOptions({ status: "loading" });
    try {
      const res = await window.lscApi.studioContentNew();
      const data = res.data as (NewPresentationOptions & { error?: string }) | undefined;
      if (res.error || !data || data.error)
        throw new Error(res.error || data?.error || "No answer from Studio.");
      setNewOptions({ status: "ready", data });
    } catch (err) {
      setNewOptions({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);
  // Applying reads the org's pages again (a new presentation's pages are in it now).
  useEffect(() => setNewOptions(null), [writeVersion, orgId]);
  useEffect(() => {
    if (sel?.kind === "new" && !newOptions) void loadNewOptions();
  }, [sel, newOptions, loadNewOptions]);

  // The first image of each org page put in a new presentation.
  const [pageImages, setPageImages] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const selectedNew = sel?.kind === "new" ? newFixes.find((f) => f.key === sel.key) : undefined;
  useEffect(() => {
    const ids = (selectedNew?.draft.pages ?? [])
      .map((p) => p.pageId)
      .filter((id) => !isDraftedPage(id) && !asked.current.has(id));
    if (!ids.length) return;
    ids.forEach((id) => asked.current.add(id));
    void window.lscApi
      .studioContentPageImages(ids)
      .then((res) => {
        const images = (res.data as { images?: Record<string, string> } | undefined)?.images;
        if (images) setPageImages((m) => ({ ...m, ...images }));
      })
      .catch(() => ids.forEach((id) => asked.current.delete(id)));
  }, [selectedNew]);

  // A drafted page goes up from its folder in the temp folder, which the system may have cleaned: lay the
  // drafts out again when their presentation is opened and before it's reviewed.
  const draftedIds = (selectedNew?.newPages ?? []).map((n) => n.draftId).join(",");
  const syncDrafted = useCallback(
    (ids: string[]) =>
      Promise.all(ids.map((id) => window.lscApi.contentDraftPreview(id).catch(() => undefined))),
    []
  );
  useEffect(() => {
    if (draftedIds) void syncDrafted(draftedIds.split(","));
  }, [draftedIds, syncDrafted]);
  const reviewNew = async () => {
    if (draftedIds) await syncDrafted(draftedIds.split(","));
    onReview();
  };

  const queueNew = (key: string, draft: PresentationDraft) =>
    onPendingChange(queueChange(pending, { fix: newPresentationFix(key, draft, draftList) }));
  const uniqueName = (base: string) => {
    const taken = new Set([
      ...presentations.map((p) => p.name),
      ...newFixes.map((f) => f.draft.fields.name),
    ]);
    for (let i = 1; ; i++) {
      const name = i === 1 ? base : `${base} ${i}`;
      if (!taken.has(name)) return name;
    }
  };
  const startNew = (pages: ContentDraft[] = []) => {
    const key = newKey();
    const base = blankPresentation(uniqueName(pages[0]?.name ?? "New presentation"));
    queueNew(key, { ...base, pages: pages.map(draftedPage) });
    setTab("pages");
    setSel({ kind: "new", key });
  };

  const queuedIds = useMemo(
    () =>
      new Set(
        pending.flatMap((p) => (p.fix.kind === "editPresentation" ? [p.fix.presentationId] : []))
      ),
    [pending]
  );
  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const matches = useCallback(
    (text: string) => words.every((w) => text.toLowerCase().includes(w)),
    [words]
  );
  const shown = useMemo(
    () => presentations.filter((p) => matches(`${p.name} ${p.status} ${p.type}`)),
    [presentations, matches]
  );
  const shownNew = newFixes.filter((f) => matches(f.draft.fields.name));
  const shownDrafts = draftList.filter((d) => matches(d.name));
  const topicsInUse = presentations.some((p) => p.topics.length > 0);

  const detail = selectedId ? details[selectedId] : undefined;
  const ready = detail?.status === "ready" ? detail.data : null;
  const queued = ready ? pendingFor(pending, editFix(ready, ready.draft, ready.draft)) : undefined;
  const queuedFix = queued?.fix.kind === "editPresentation" ? queued.fix : undefined;
  const draft = queuedFix?.to ?? ready?.draft ?? null;
  // The org moved since the edits were queued: applying will be refused for the parts that moved.
  const stale = !!(ready && queuedFix && !sameDraft(queuedFix.from, ready.draft));

  const edit = (next: PresentationDraft) => {
    if (!ready) return;
    const from = queuedFix?.from ?? ready.draft;
    onPendingChange(queueChange(pending, { fix: editFix(ready, from, next) }));
  };
  const discard = () => {
    if (!ready || !queuedFix) return;
    onPendingChange(pending.filter((p) => p !== queued));
  };

  let body: React.ReactNode;
  if (!library && state.status !== "error") {
    body = (
      <StateView
        kind="loading"
        title="Reading presentations…"
        detail="The first time takes a few seconds while page images are drawn."
      />
    );
  } else if (!library) {
    body = (
      <StateView
        kind="error"
        title="Couldn't read the presentations"
        detail={state.status === "error" ? state.message : undefined}
        actions={
          <button className="studio-btn" onClick={retry}>
            Retry
          </button>
        }
      />
    );
  } else if (library.unavailable) {
    body = (
      <StateView
        kind="empty"
        icon={Presentation}
        title="This org doesn't have Intelligent Content"
        detail={library.unavailable}
        actions={
          <button className="studio-btn" onClick={retry}>
            Check again
          </button>
        }
      />
    );
  } else {
    body = (
      <div className={`content-shell${dragging ? " dragging" : ""}`}>
        <div className="content-library-col" style={{ width: libWidth }}>
          <aside className="content-library" aria-label="Presentations">
            <div className="content-library-head">
              <div className="content-search">
                <Search size={14} aria-hidden="true" />
                <input
                  className="ui-field"
                  type="search"
                  value={query}
                  placeholder="Search"
                  aria-label="Search presentations"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Menu
                label="New presentation"
                title="New presentation"
                className="content-new-menu"
                trigger={
                  <>
                    <Plus size={14} aria-hidden="true" />
                    New
                  </>
                }
                items={[
                  { label: "From pages in the org…", icon: Layers, onSelect: () => startNew() },
                  {
                    label: "Draft pages with Roz…",
                    icon: Sparkles,
                    onSelect: () => setBriefOpen(true),
                  },
                ]}
              />
            </div>
            <div className="content-library-list">
              {shownNew.length > 0 && (
                <>
                  <h2 className="ui-section-title">
                    New presentations<span className="count">{shownNew.length}</span>
                  </h2>
                  <ul>
                    {shownNew.map((f) => (
                      <li key={f.key}>
                        <NewRow
                          fix={f}
                          selected={sel?.kind === "new" && sel.key === f.key}
                          onSelect={() => setSel({ kind: "new", key: f.key })}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {(shownDrafts.length > 0 || drafts.status === "error") && (
                <>
                  <h2 className="ui-section-title">
                    Drafted pages<span className="count">{shownDrafts.length}</span>
                  </h2>
                  {drafts.status === "error" && (
                    <p className="content-muted content-none" role="alert">
                      Couldn't read the drafts: {drafts.message}{" "}
                      <button className="studio-link-btn" onClick={() => void loadDrafts()}>
                        Retry
                      </button>
                    </p>
                  )}
                  <ul>
                    {shownDrafts.map((d) => (
                      <li key={d.id}>
                        <DraftRow
                          draft={d}
                          selected={sel?.kind === "draft" && sel.id === d.id}
                          onSelect={() => setSel({ kind: "draft", id: d.id })}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h2 className="ui-section-title">
                Presentations
                <span className="count">
                  {query ? `${shown.length} of ${presentations.length}` : presentations.length}
                </span>
              </h2>
              <ul>
                {shown.map((p) => (
                  <li key={p.id}>
                    <LibraryRow
                      p={p}
                      selected={p.id === selectedId}
                      queued={queuedIds.has(p.id)}
                      onSelect={() => select(p.id)}
                    />
                  </li>
                ))}
              </ul>
              {query && !shown.length && (
                <p className="content-muted content-none">No presentation matches “{query}”.</p>
              )}
              {!query && !presentations.length && (
                <p className="content-muted content-none">
                  The org has no presentations yet.{" "}
                  <button className="studio-link-btn" onClick={retry}>
                    Check again
                  </button>
                </p>
              )}
              {library.note && <p className="content-muted content-none">{library.note}</p>}
            </div>
          </aside>
          <ResizeHandle
            value={libWidth}
            min={240}
            max={440}
            onChange={setLibWidth}
            onReset={() => setLibWidth(300)}
            onDragging={setDragging}
            label="Resize the presentation list"
          />
        </div>
        <div className="content-center">
          {sel?.kind === "draft" ? (
            (() => {
              const d = draftList.find((x) => x.id === sel.id);
              return d ? (
                <ContentDraftPane
                  key={d.id}
                  draft={d}
                  writing={writing[d.id]}
                  onChange={upsertDraft}
                  onAddToPresentation={() => startNew([d])}
                  onDeleted={() => {
                    setDrafts((s) =>
                      s.status === "ready"
                        ? { status: "ready", data: s.data.filter((x) => x.id !== d.id) }
                        : s
                    );
                    setSel(null);
                  }}
                />
              ) : drafts.status === "loading" ? (
                <StateView kind="loading" title="Opening the draft…" />
              ) : (
                <StateView
                  kind="empty"
                  icon={Sparkles}
                  title="That draft is gone"
                  detail="It was deleted, or it belongs to another org."
                />
              );
            })()
          ) : sel?.kind === "new" ? (
            !selectedNew ? (
              <StateView
                kind="empty"
                icon={Presentation}
                title="Not in the tray any more"
                detail="It was applied or discarded. Applied presentations are in the list once the org has been read again."
              />
            ) : newOptions?.status === "ready" ? (
              <PresentationEditor
                key={selectedNew.key}
                detail={newDetail(newOptions.data, selectedNew, pageImages)}
                draft={selectedNew.draft}
                from={blankPresentation("")}
                queued
                stale={false}
                topicsInUse={topicsInUse}
                tab={tab === "play" ? "pages" : tab}
                onTab={setTab}
                onChange={(next) => queueNew(selectedNew.key, next)}
                onDiscard={() => {
                  onPendingChange(
                    pending.filter(
                      (p) => !(p.fix.kind === "createPresentation" && p.fix.key === selectedNew.key)
                    )
                  );
                  setSel(null);
                }}
                onReview={() => void reviewNew()}
                onRefresh={() => void loadNewOptions()}
                create={{ drafts: draftList.filter((d) => draftReady(d, draftRunning(d))) }}
              />
            ) : newOptions?.status === "error" ? (
              <StateView
                kind="error"
                title="Couldn't read the org's pages"
                detail={newOptions.message}
                actions={
                  <button className="studio-btn" onClick={() => void loadNewOptions()}>
                    Retry
                  </button>
                }
              />
            ) : (
              <StateView kind="loading" title="Reading the org's pages…" />
            )
          ) : ready && draft ? (
            <PresentationEditor
              key={ready.id}
              detail={ready}
              draft={draft}
              from={queuedFix?.from ?? ready.draft}
              queued={!!queuedFix}
              stale={stale}
              topicsInUse={topicsInUse}
              tab={tab}
              onTab={setTab}
              onChange={edit}
              onDiscard={discard}
              onReview={onReview}
              onRefresh={() => selectedId && loadDetail(selectedId)}
            />
          ) : detail?.status === "error" ? (
            <StateView
              kind="error"
              title="Couldn't open this presentation"
              detail={detail.message}
              actions={
                <button className="studio-btn" onClick={() => selectedId && loadDetail(selectedId)}>
                  Retry
                </button>
              }
            />
          ) : selectedId ? (
            <StateView kind="loading" title="Opening the presentation…" />
          ) : (
            <StateView
              kind="empty"
              icon={Presentation}
              title={presentations.length ? "Pick a presentation" : "No presentations yet"}
              detail={
                presentations.length
                  ? "Choose one from the list to arrange its pages, settings and territories."
                  : "Put one together from the org's HTML pages, or have Roz draft the pages. You can also upload a PowerPoint, PDF or HTML ZIP from chat."
              }
              actions={
                <>
                  <button className="studio-btn" onClick={() => startNew()}>
                    <Layers size={14} aria-hidden="true" />
                    From pages in the org…
                  </button>
                  <button className="studio-btn" onClick={() => setBriefOpen(true)}>
                    <Sparkles size={14} aria-hidden="true" />
                    Draft pages with Roz…
                  </button>
                </>
              }
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="studio-main content-page ui-enter" hidden={!active}>
      {library && state.status === "error" && (
        <div className="content-banner" role="alert">
          Couldn't refresh the presentations: {state.message}
          <button className="studio-link-btn" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      {body}
      {briefOpen && <NewDraftDialog onStart={startDraft} onCancel={() => setBriefOpen(false)} />}
      {tray}
    </section>
  );
}

function editFix(
  detail: PresentationDetail,
  from: PresentationDraft,
  to: PresentationDraft
): EditPresentationFix {
  const name = detail.draft.fields.name;
  return {
    kind: "editPresentation",
    label: editLabel(to.fields.name.trim() || name, changedParts(from, to)),
    presentationId: detail.id,
    presentationName: name,
    from,
    to,
  };
}

function LibraryRow({
  p,
  selected,
  queued,
  onSelect,
}: {
  p: PresentationSummary;
  selected: boolean;
  queued: boolean;
  onSelect: () => void;
}) {
  const meta = [
    p.status,
    `${p.pages} ${p.pages === 1 ? "page" : "pages"}`,
    p.territories
      ? `${p.territories} ${p.territories === 1 ? "territory" : "territories"}`
      : "Not distributed",
  ].join(" · ");
  return (
    <button
      className={`content-row${selected ? " selected" : ""}`}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      title={`${p.name} — ${meta}`}
    >
      <span className="content-thumb">
        {p.thumbnail ? (
          <img src={p.thumbnail} alt="" />
        ) : (
          <Presentation size={16} aria-hidden="true" />
        )}
      </span>
      <span className="content-row-text">
        <span className="content-row-name">{p.name}</span>
        <span className="content-row-meta">{meta}</span>
      </span>
      {queued && <span className="ui-pill warning">Queued</span>}
    </button>
  );
}

function NewRow({
  fix,
  selected,
  onSelect,
}: {
  fix: CreatePresentationFix;
  selected: boolean;
  onSelect: () => void;
}) {
  const n = fix.draft.pages.length;
  const name = fix.draft.fields.name || "New presentation";
  const meta = `Not in the org yet · ${n} ${n === 1 ? "page" : "pages"}`;
  return (
    <button
      className={`content-row${selected ? " selected" : ""}`}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      title={`${name} — ${meta}`}
    >
      <span className="content-thumb">
        <Presentation size={16} aria-hidden="true" />
      </span>
      <span className="content-row-text">
        <span className="content-row-name">{name}</span>
        <span className="content-row-meta">{meta}</span>
      </span>
      <span className="ui-pill warning">Queued</span>
    </button>
  );
}

function DraftRow({
  draft,
  selected,
  onSelect,
}: {
  draft: ContentDraft;
  selected: boolean;
  onSelect: () => void;
}) {
  const running = draftRunning(draft);
  const slides = slideCount(draft);
  const errors = draft.checks.filter((c) => c.level === "error").length;
  const meta = running
    ? "Roz is drafting…"
    : [
        slides ? slidesLabel(slides) : "No slides yet",
        errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
  return (
    <button
      className={`content-row${selected ? " selected" : ""}`}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      title={`${draft.name} — ${meta}`}
    >
      <span className="content-thumb">
        {running ? (
          <Spinner size={14} />
        ) : draft.thumbnail ? (
          <img src={draft.thumbnail} alt="" />
        ) : (
          <Sparkles size={16} aria-hidden="true" />
        )}
      </span>
      <span className="content-row-text">
        <span className="content-row-name">{draft.name}</span>
        <span className="content-row-meta">{meta}</span>
      </span>
    </button>
  );
}
