import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowDown, ArrowUp, FileDiff, RotateCw, Sparkles, Square, SquarePen, TriangleAlert, X } from "lucide-react";
import { useAssistantName } from "../../../hooks/useAssistantName";
import Spinner from "../../ui/Spinner";
import {
  FIX_TEST_PROMPT,
  canRetry,
  describeDiff,
  diffStats,
  extractCode,
  fixProblemsPrompt,
  isSendKey,
  problemCount,
  replySummary,
  splitReply,
  starterPrompts,
  testFailed,
  type AssistDiagnostic,
  type AssistMessage,
  type AssistScript,
  type AssistTest,
} from "./script-assist-logic";
import {
  markProposed,
  resetAssist,
  retryAssist,
  sendAssistMessage,
  stopAssist,
  useAssistConversation,
} from "./script-assist-store";
import "./script-assist.css";

export interface ScriptAssistPanelProps {
  /** The conversation is kept per script (and per draft). */
  scriptKey: string;
  script: AssistScript;
  diagnostics?: AssistDiagnostic[];
  lastTest?: AssistTest;
  /** Whether the editor has a proposal on screen. */
  proposal: "none" | "pending";
  onPropose: (code: string, summary: string) => void;
  onClose: () => void;
}

/** Other parts of the page can ask the composer to take focus (⌘K). */
export const FOCUS_ASSIST_EVENT = "roz:focus-assist";

/** Text waiting to go in the message box; kept here so a panel that is still opening picks it up when it mounts. */
let pendingPrefill: string | null = null;
const PREFILL_ASSIST_EVENT = "roz:prefill-assist";

/** Puts text in the message box without sending it (after anything already there) and focuses it. */
export function prefillAssist(text: string): void {
  pendingPrefill = text;
  window.dispatchEvent(new Event(PREFILL_ASSIST_EVENT));
}

export default function ScriptAssistPanel({ scriptKey, script, diagnostics, lastTest, proposal, onPropose, onClose }: ScriptAssistPanelProps) {
  const name = useAssistantName();
  const conversation = useAssistConversation(scriptKey);
  const { messages, requestId } = conversation;
  const busy = requestId !== null;
  const [draft, setDraft] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [scrolledUp, setScrolledUp] = useState(false);
  const toLatest = () => {
    const el = scroller.current;
    if (!el) return;
    pinned.current = true;
    setScrolledUp(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  // What a new message is built from: the editor as it is right now.
  const context = useMemo(() => ({ script, diagnostics, lastTest }), [script, diagnostics, lastTest]);
  const contextRef = useRef(context);
  contextRef.current = context;

  const send = useCallback(
    (text: string) => {
      if (!text.trim() || busy) return;
      pinned.current = true;
      setDraft("");
      void sendAssistMessage(scriptKey, text, contextRef.current);
    },
    [scriptKey, busy]
  );

  // A finished reply with a script goes to the editor on its own, once.
  const onProposeRef = useRef(onPropose);
  onProposeRef.current = onPropose;
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant" || m.status !== "done" || m.proposed) continue;
      const code = extractCode(m.text);
      markProposed(scriptKey, m.id);
      if (code) onProposeRef.current(code, replySummary(m.text));
    }
  }, [messages, scriptKey]);

  // Keep the newest text in view unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Auto-grow the composer.
  useLayoutEffect(() => {
    const el = composer.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  // ⌘K focuses the composer.
  useEffect(() => {
    const focus = () => composer.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        focus();
      }
    };
    const prefill = () => {
      const text = pendingPrefill;
      if (text === null) return;
      pendingPrefill = null;
      setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, "")}\n${text}` : text));
      requestAnimationFrame(() => {
        const el = composer.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    };
    prefill();
    window.addEventListener(FOCUS_ASSIST_EVENT, focus);
    window.addEventListener(PREFILL_ASSIST_EVENT, prefill);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(FOCUS_ASSIST_EVENT, focus);
      window.removeEventListener(PREFILL_ASSIST_EVENT, prefill);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const problems = problemCount(diagnostics);
  const failedTest = testFailed(lastTest);
  const empty = messages.length === 0;

  return (
    <section className="assist" aria-label={`Ask ${name}`}>
      <header className="assist-head">
        <Sparkles size={16} aria-hidden="true" className="assist-head-icon" />
        <h2 className="assist-title">Ask {name}</h2>
        <button type="button" className="ui-icon-btn" aria-label="New conversation" title="New conversation" disabled={empty} onClick={() => resetAssist(scriptKey)}>
          <SquarePen size={14} aria-hidden="true" />
        </button>
        <button type="button" className="ui-icon-btn" aria-label={`Close Ask ${name}`} title="Close" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <div
        className="assist-body"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (scrolledUp === pinned.current) setScrolledUp(!pinned.current);
        }}
      >
        {empty ? (
          <div className="assist-empty ui-enter">
            <p className="assist-empty-lead">Describe what the script should check, or ask about it. I'll write it and show the change before anything is saved.</p>
            <div className="assist-starters" role="list">
              {starterPrompts(script.type, script.objectName).map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  role="listitem"
                  className="assist-starter"
                  title="Put this in the message box so you can edit it before sending"
                  onClick={() => {
                    setDraft(prompt);
                    requestAnimationFrame(() => {
                      const el = composer.current;
                      if (el) {
                        el.focus();
                        el.setSelectionRange(prompt.length, prompt.length);
                      }
                    });
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="assist-thread">
            {messages.map((m, i) => (
              <li key={m.id} className={`assist-msg ${m.role}`}>
                {m.role === "user" ? (
                  <div className="assist-user">{m.text}</div>
                ) : (
                  <AssistReply
                    message={m}
                    currentCode={script.code}
                    last={i === messages.length - 1}
                    onView={(code) => onPropose(code, replySummary(m.text))}
                    onRetry={() => void retryAssist(scriptKey, contextRef.current)}
                    canRetry={canRetry(messages) && i === messages.length - 1}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <footer className="assist-foot">
        {scrolledUp && !empty && (
          <button type="button" className="studio-btn sm assist-latest" onClick={toLatest}>
            <ArrowDown size={14} aria-hidden="true" />
            {busy ? "Follow the reply" : "Latest"}
          </button>
        )}
        {(problems > 0 || failedTest) && !busy && (
          <div className="assist-chips">
            {problems > 0 && (
              <button type="button" className="assist-chip" onClick={() => send(fixProblemsPrompt(problems))}>
                <TriangleAlert size={14} aria-hidden="true" />
                Fix {problems} {problems === 1 ? "problem" : "problems"}
              </button>
            )}
            {failedTest && (
              <button type="button" className="assist-chip" onClick={() => send(FIX_TEST_PROMPT)}>
                <TriangleAlert size={14} aria-hidden="true" />
                Fix this test failure
              </button>
            )}
          </div>
        )}
        {proposal === "pending" && !busy && <p className="assist-hint">A proposal is waiting in the editor. A new request builds on the code as it is there now.</p>}
        <div className="assist-composer">
          <textarea
            ref={composer}
            className="assist-input"
            rows={1}
            value={draft}
            placeholder={empty ? "Describe what the script should do" : "Ask for a change or a question"}
            aria-label={`Message ${name}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isSendKey({ key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, isComposing: e.nativeEvent.isComposing })) {
                e.preventDefault();
                send(draft);
              }
            }}
          />
          {busy ? (
            <button type="button" className="ui-icon-btn assist-send stop" aria-label="Stop" title="Stop" onClick={() => stopAssist(scriptKey)}>
              <Square size={14} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="ui-icon-btn assist-send" aria-label="Send" title="Send (Enter)" disabled={!draft.trim()} onClick={() => send(draft)}>
              <ArrowUp size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}

function AssistReply({
  message,
  currentCode,
  last,
  onView,
  onRetry,
  canRetry,
}: {
  message: AssistMessage;
  currentCode: string;
  last: boolean;
  onView: (code: string) => void;
  onRetry: () => void;
  canRetry: boolean;
}) {
  const segments = useMemo(() => splitReply(message.text), [message.text]);
  const streaming = message.status === "streaming";
  const running = message.tools.find((t) => t.status === "running");
  const looked = message.tools.filter((t) => t.status !== "running");

  return (
    <div className="assist-reply">
      {message.tools.length > 0 && (
        <div className="assist-tools" aria-live="polite">
          {looked.map((t) => (
            <span key={t.id} className={`assist-tool${t.status === "error" ? " error" : ""}`}>
              {t.status === "error" ? "Couldn't look that up" : t.detail.replace(/…$/, "")}
            </span>
          ))}
          {running && (
            <span className="assist-tool running">
              <Spinner size={12} />
              {running.detail}
            </span>
          )}
        </div>
      )}

      {segments.map((s, i) => {
        if (s.kind === "prose") {
          return (
            <div key={i} className="message-content assist-prose">
              <Markdown remarkPlugins={[remarkGfm]}>{s.text}</Markdown>
            </div>
          );
        }
        if (s.kind === "writing") {
          return (
            <div key={i} className="assist-card writing" role="status">
              <Spinner size={14} />
              <span className="assist-card-title">Writing the script…</span>
            </div>
          );
        }
        const stats = diffStats(currentCode, s.code);
        return (
          <div key={i} className="assist-card">
            <FileDiff size={16} aria-hidden="true" className="assist-card-icon" />
            <div className="assist-card-text">
              <span className="assist-card-title">Proposed change</span>
              <span className="assist-card-meta">{stats.added || stats.removed ? describeDiff(stats) : "Matches the editor"}</span>
            </div>
            <button type="button" className="studio-btn sm" onClick={() => onView(s.code)}>
              View in editor
            </button>
          </div>
        );
      })}

      {streaming && segments.length === 0 && !running && (
        <div className="assist-thinking" role="status">
          <Spinner size={12} />
          Thinking…
        </div>
      )}

      {message.status === "error" && (
        <div className="assist-error" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          <span className="assist-error-text">{message.error || "Something went wrong."}</span>
          {canRetry && last && message.error !== "Stopped." && (
            <button type="button" className="studio-btn sm" onClick={onRetry}>
              <RotateCw size={14} aria-hidden="true" />
              Retry
            </button>
          )}
          {canRetry && last && message.error === "Stopped." && (
            <button type="button" className="studio-btn sm ghost" onClick={onRetry}>
              <RotateCw size={14} aria-hidden="true" />
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
