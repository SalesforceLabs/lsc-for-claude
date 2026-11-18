import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  FileCode,
  Info,
  Presentation,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Spinner from "../../ui/Spinner";
import StateView from "../../ui/StateView";
import StatusIcon from "../../ui/StatusIcon";
import ContentPlayStage from "../screens/ContentPlayStage";
import type { PublishedContentCard } from "../screens/content-types";
import { draftRunning, slideCount, slidesLabel } from "./content-logic";
import type { ContentDraft, ContentDraftTurn } from "./content-types";
import { REVIEW_NOTICE } from "./PresentationEditor";
import "../builder/builder.css";

export interface WritingNote {
  turnId: string;
  path: string;
  chars: number;
}

interface ContentDraftPaneProps {
  draft: ContentDraft;
  writing?: WritingNote;
  onChange: (draft: ContentDraft) => void;
  /** Start a new presentation holding this page. */
  onAddToPresentation: () => void;
  onDeleted: () => void;
}

const chars = (n: number) => (n < 1000 ? `${n} chars` : `${(n / 1000).toFixed(1)}k chars`);

/** A page Roz is drafting: the conversation on the left, the page running in the CLM player on the right. */
export default function ContentDraftPane({
  draft,
  writing,
  onChange,
  onAddToPresentation,
  onDeleted,
}: ContentDraftPaneProps) {
  const running = draftRunning(draft);
  const errors = draft.checks.filter((c) => c.level === "error");
  const slides = slideCount(draft);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // The player loads again when the draft is written, or when the user asks.
  const [reload, setReload] = useState(0);

  const card: PublishedContentCard = {
    id: `draft-${draft.id}`,
    name: draft.name,
    type: "ZIP",
    pages: 1,
    date: "",
    isCustom: false,
    ownedByViewer: false,
    shareable: false,
  };

  const addBlocked = running
    ? "Wait for Roz to finish."
    : !draft.files.length
      ? "Roz hasn't written any slides yet."
      : errors.length
        ? "Fix the errors in the checks first."
        : null;

  const remove = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await window.lscApi.contentDraftDelete(draft.id);
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  return (
    <div className="content-editor">
      <header className="studio-header">
        <div className="studio-heading">
          <h1 className="studio-title" title={draft.name}>
            {draft.name}
          </h1>
          <div className="studio-subtitle">
            Drafted by Roz · {slides ? slidesLabel(slides) : "no slides yet"} · on this computer,
            not in the org
          </div>
        </div>
        <div className="studio-header-actions">
          {confirmDelete ? (
            <>
              <button
                className="studio-btn ghost"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Keep it
              </button>
              <button
                className="studio-btn danger"
                onClick={() => void remove()}
                disabled={deleting}
              >
                {deleting ? <Spinner size={14} /> : <Trash2 size={14} aria-hidden="true" />}
                Delete draft
              </button>
            </>
          ) : (
            <>
              <button
                className="studio-btn ghost collapsible"
                onClick={() => setConfirmDelete(true)}
                disabled={running}
                aria-label="Delete draft"
                title="Delete this draft from this computer"
              >
                <Trash2 size={14} aria-hidden="true" />
                <span className="studio-btn-label">Delete</span>
              </button>
              <button
                className="studio-btn primary"
                onClick={onAddToPresentation}
                disabled={!!addBlocked}
                title={addBlocked ?? "Start a new presentation with this page"}
              >
                <Presentation size={14} aria-hidden="true" />
                Add to a new presentation
              </button>
            </>
          )}
        </div>
      </header>
      {deleteError && (
        <div className="content-banner" role="alert">
          Couldn't delete the draft: {deleteError}
        </div>
      )}
      <div className="content-note content-review-note" role="note">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>{REVIEW_NOTICE}</span>
      </div>
      <div className="content-draft-body">
        <DraftConversation draft={draft} writing={writing} running={running} onChange={onChange} />
        <div className="content-draft-preview">
          <DraftName draft={draft} disabled={running} onChange={onChange} />
          {draft.files.length ? (
            <ContentPlayStage
              card={card}
              load={() => window.lscApi.contentDraftPreview(draft.id)}
              loadKey={`${draft.revision}:${reload}`}
              onClose={() => setReload((n) => n + 1)}
            />
          ) : (
            <StateView
              kind={running ? "loading" : "empty"}
              icon={Sparkles}
              title={running ? "Roz is drafting the slides…" : "No slides yet"}
              detail={
                running
                  ? "They show here, running in the player, once the first version is written."
                  : "Ask Roz for the page on the left."
              }
            />
          )}
          <DraftChecks draft={draft} />
        </div>
      </div>
    </div>
  );
}

function DraftName({
  draft,
  disabled,
  onChange,
}: {
  draft: ContentDraft;
  disabled: boolean;
  onChange: (d: ContentDraft) => void;
}) {
  const [text, setText] = useState(draft.name);
  const [error, setError] = useState("");
  useEffect(() => setText(draft.name), [draft.name]);
  const problem = !text.trim()
    ? "The page needs a name."
    : text.trim().length > 80
      ? "The name is over 80 characters."
      : "";
  const commit = async () => {
    if (problem || text.trim() === draft.name) return;
    setError("");
    const r = await window.lscApi
      .contentDraftRename(draft.id, text.trim())
      .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    if ("error" in r) setError(r.error);
    else onChange(r);
  };
  return (
    <label className="ui-label content-draft-name">
      Page name
      <input
        className="ui-field"
        value={text}
        maxLength={120}
        disabled={disabled}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") setText(draft.name);
        }}
      />
      {(problem || error) && <span className="content-problem">{problem || error}</span>}
    </label>
  );
}

function DraftChecks({ draft }: { draft: ContentDraft }) {
  if (!draft.files.length) return null;
  if (!draft.checks.length)
    return (
      <div className="content-draft-checks ok" role="status">
        <StatusIcon tone="pass" size={16} />
        <span>No problems found. Claims, references and product names still need review.</span>
      </div>
    );
  return (
    <ul className="content-draft-checks" aria-label="Checks">
      {draft.checks.map((c, i) => (
        <li key={i}>
          <StatusIcon tone={c.level === "error" ? "error" : "warning"} size={16} />
          <span>
            {c.file && <code>{c.file}</code>} {c.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DraftConversation({
  draft,
  writing,
  running,
  onChange,
}: {
  draft: ContentDraft;
  writing?: WritingNote;
  running: boolean;
  onChange: (d: ContentDraft) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const last = draft.turns[draft.turns.length - 1];
  const signal = `${draft.turns.length}:${last?.steps.length ?? 0}:${last?.reply.length ?? 0}:${last?.status}:${writing?.chars ?? 0}`;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [signal]);

  return (
    <div className="bld-conv content-draft-conv">
      <div
        className="bld-conv-scroll"
        ref={scroller}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        onScroll={() => {
          const el = scroller.current;
          if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {draft.turns.map((t) => (
          <TurnView key={t.id} turn={t} writing={writing?.turnId === t.id ? writing : undefined} />
        ))}
      </div>
      <Composer draft={draft} running={running} onChange={onChange} />
    </div>
  );
}

function TurnView({ turn, writing }: { turn: ContentDraftTurn; writing?: WritingNote }) {
  const running = turn.status === "running";
  return (
    <article className="bld-turn" aria-label="Turn">
      <div className="bld-prompt">{turn.prompt}</div>
      {turn.steps.length > 0 && (
        <ol className="bld-steps" aria-label="Steps">
          {turn.steps.map((s) => (
            <li key={s.id} className={`bld-step ${s.status}`}>
              <span className="bld-step-icon">
                {s.status === "running" ? (
                  <Spinner size={14} />
                ) : (
                  <StatusIcon tone={s.status === "done" ? "pass" : "error"} size={16} />
                )}
              </span>
              <span className="bld-step-text">
                <span className="bld-step-label">{s.label}</span>
                {s.detail && (
                  <span className="bld-step-detail" title={s.detail}>
                    {s.detail}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {running && writing && (
        <div className="bld-writing" role="status">
          <FileCode size={14} aria-hidden="true" />
          <span>Writing {writing.path ? <code>{writing.path}</code> : "the slides"}</span>
          <span className="bld-writing-n ui-num">{chars(writing.chars)}</span>
        </div>
      )}
      {turn.reply && (
        <div className="bld-reply bld-md">
          <Markdown remarkPlugins={[remarkGfm]}>{turn.reply}</Markdown>
        </div>
      )}
      {running && !turn.reply && turn.steps.length === 0 && !writing && (
        <div className="bld-thinking" role="status">
          <Spinner size={14} /> Roz is getting started…
        </div>
      )}
      {turn.status === "failed" && (
        <div className="bld-turn-note error" role="alert">
          <StatusIcon tone="error" size={16} />
          <span>{turn.error ?? "This turn didn't finish."}</span>
        </div>
      )}
      {turn.status === "stopped" && (
        <div className="bld-turn-note">
          <Info size={16} aria-hidden="true" />
          <span>
            {turn.error ? `${turn.error}. ` : "Stopped. "}The last slides Roz wrote are still in the
            preview.
          </span>
        </div>
      )}
    </article>
  );
}

function Composer({
  draft,
  running,
  onChange,
}: {
  draft: ContentDraft;
  running: boolean;
  onChange: (d: ContentDraft) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const canSend = text.trim().length > 0 && !running && !sending;
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError("");
    try {
      const r = await window.lscApi.contentDraftSend(draft.id, text.trim());
      if ("error" in r) setError(r.error);
      else {
        setText("");
        onChange(r);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setSending(false);
  };

  return (
    <div className="bld-conv-composer">
      {error && (
        <div className="bld-inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="bld-composer compact">
        <textarea
          ref={box}
          className="bld-composer-input"
          rows={1}
          value={text}
          aria-label="Ask Roz for a change"
          placeholder={running ? "Roz is drafting…" : "Ask for a change…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="bld-composer-bar">
          <span className="bld-composer-hint">
            {running ? "You can keep reading while Roz works." : "⌘↵ to send"}
          </span>
          <span className="bld-composer-spacer" />
          {running ? (
            <button
              type="button"
              className="studio-btn"
              onClick={() => void window.lscApi.contentDraftStop(draft.id)}
              aria-label="Stop drafting"
            >
              <Square size={12} aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="studio-btn primary"
              disabled={!canSend}
              onClick={() => void send()}
              aria-label="Send"
            >
              {sending ? <Spinner size={14} /> : <ArrowUp size={14} aria-hidden="true" />}
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
