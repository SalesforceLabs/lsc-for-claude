import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowDown, ArrowUp, ExternalLink, FileCode, Info, Square } from "lucide-react";
import Spinner from "../../ui/Spinner";
import StatusIcon from "../../ui/StatusIcon";
import { builderApi } from "./api";
import { chars, elapsed, fileName, isBuilding, versionSummary, versionTone } from "./logic";
import type { WritingNote } from "./useAppProjects";
import type { AppProject, AppStep, AppTurn } from "./types";

/** Re-renders every half second while `on`, so running steps show their time. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

interface ConversationProps {
  project: AppProject;
  writing: WritingNote | undefined;
  /** The version the preview shows. */
  shownVersionId: string | null;
  onShowVersion: (versionId: string) => void;
}

export default function Conversation({ project, writing, shownVersionId, onShowVersion }: ConversationProps) {
  const building = isBuilding(project);
  const now = useNow(building);
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [away, setAway] = useState(false);
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  const last = project.turns[project.turns.length - 1];
  const signal = `${project.turns.length}:${last?.steps.length ?? 0}:${last?.reply.length ?? 0}:${last?.status}:${writing?.chars ?? 0}`;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [signal]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stuck.current = nearEnd;
    setAway(!nearEnd);
  };

  return (
    <div className="bld-conv">
      <div className="bld-conv-scroll" ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-label="Conversation">
        {project.starter && (
          <StarterIntro
            project={project}
            shownVersionId={shownVersionId}
            onShowVersion={onShowVersion}
            onTry={(prompt) => {
              setText(prompt);
              box.current?.focus();
            }}
          />
        )}
        {project.turns.map((t) => (
          <TurnView key={t.id} project={project} turn={t} now={now} writing={writing?.turnId === t.id ? writing : undefined} shownVersionId={shownVersionId} onShowVersion={onShowVersion} />
        ))}
      </div>
      {away && (
        <button
          type="button"
          className="bld-jump studio-btn sm"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
        >
          <ArrowDown size={14} aria-hidden="true" />
          {building ? "Follow the build" : "Latest"}
        </button>
      )}
      <Composer project={project} building={building} text={text} setText={setText} box={box} />
    </div>
  );
}

function TurnView({ project, turn, now, writing, shownVersionId, onShowVersion }: { project: AppProject; turn: AppTurn; now: number; writing?: WritingNote; shownVersionId: string | null; onShowVersion: (id: string) => void }) {
  const version = turn.versionId ? project.versions.find((v) => v.id === turn.versionId) : undefined;
  const running = turn.status === "running";
  return (
    <article className="bld-turn" aria-label="Turn">
      <div className="bld-prompt">{turn.prompt}</div>
      {turn.steps.length > 0 && (
        <ol className="bld-steps" aria-label="Steps">
          {turn.steps.map((s) => (
            <StepRow key={s.id} step={s} now={now} />
          ))}
        </ol>
      )}
      {running && writing && (
        <div className="bld-writing" role="status">
          <FileCode size={14} aria-hidden="true" />
          <span>
            Writing <code>{fileName(writing.path)}</code>
          </span>
          <span className="bld-writing-n ui-num">{chars(writing.chars)}</span>
        </div>
      )}
      {turn.reply && (
        <div className="bld-reply bld-md">
          <Markdown remarkPlugins={[remarkGfm]}>{turn.reply}</Markdown>
        </div>
      )}
      {running && !turn.reply && turn.steps.length === 0 && (
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
          <span>Stopped. The last version that worked is still in the preview.</span>
        </div>
      )}
      {version && (
        <button type="button" className="bld-version-chip" aria-pressed={shownVersionId === version.id} onClick={() => onShowVersion(version.id)} title="Show this version in the preview">
          <StatusIcon tone={versionTone(version)} size={14} />
          {versionSummary(project, version)}
        </button>
      )}
    </article>
  );
}

/** Where a starter project came from, its first version, and prompts to try while nothing's been asked yet. */
function StarterIntro({ project, shownVersionId, onShowVersion, onTry }: { project: AppProject; shownVersionId: string | null; onShowVersion: (id: string) => void; onTry: (prompt: string) => void }) {
  const starter = project.starter!;
  const version = project.versions.find((v) => v.source === "starter");
  return (
    <article className="bld-turn bld-starter-intro" aria-label="Started from a sample">
      <div className="bld-reply">
        <p>
          Started from the <strong>{starter.label}</strong> sample. {starter.description}
        </p>
        <p className="bld-starter-from">
          Copied from{" "}
          <button type="button" className="bld-link bld-starter-repo" title={starter.url} onClick={() => void window.lscApi.openExternal(starter.url)}>
            {starter.repo} @ {starter.sha.slice(0, 7)}
            <ExternalLink size={12} aria-hidden="true" />
          </button>
        </p>
        <p className="bld-starter-from">Ask for a change below. Nothing reaches the org until you deploy.</p>
      </div>
      {version && (
        <button type="button" className="bld-version-chip" aria-pressed={shownVersionId === version.id} onClick={() => onShowVersion(version.id)} title="Show this version in the preview">
          <StatusIcon tone={versionTone(version)} size={14} />
          {versionSummary(project, version)}
        </button>
      )}
      {project.turns.length === 0 && starter.tryNext.length > 0 && (
        <div className="bld-try" role="list" aria-label="Try asking">
          <span className="ui-label">Try asking</span>
          {starter.tryNext.map((t) => (
            <button key={t} type="button" role="listitem" className="bld-chip" onClick={() => onTry(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function StepRow({ step, now }: { step: AppStep; now: number }) {
  return (
    <li className={`bld-step ${step.status}`}>
      <span className="bld-step-icon">{step.status === "running" ? <Spinner size={14} /> : <StatusIcon tone={step.status === "done" ? "pass" : "error"} size={16} />}</span>
      <span className="bld-step-text">
        <span className="bld-step-label">{step.status === "failed" && step.kind === "write" ? "Couldn't save that version. The previous one is kept." : step.label}</span>
        {step.detail && step.status === "failed" ? (
          <details className="bld-step-more">
            <summary>Details</summary>
            <p>{step.detail}</p>
          </details>
        ) : (
          step.detail && (
            <span className="bld-step-detail" title={step.detail}>
              {step.detail}
            </span>
          )
        )}
      </span>
      <span className="bld-step-time ui-num">{elapsed(step, now)}</span>
    </li>
  );
}

function Composer({ project, building, text, setText, box }: { project: AppProject; building: boolean; text: string; setText: (t: string) => void; box: React.RefObject<HTMLTextAreaElement> }) {
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const canSend = text.trim().length > 0 && !building && !sending;
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError("");
    const r = await builderApi().appSend(project.id, text.trim()).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    setSending(false);
    if (!r.ok) setError(r.error ?? "Couldn't send that.");
    else setText("");
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
          placeholder={building ? "Roz is building…" : "Ask for a change…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="bld-composer-bar">
          <span className="bld-composer-hint">{building ? "You can keep reading while it builds." : "⌘↵ to send"}</span>
          <span className="bld-composer-spacer" />
          {building ? (
            <button type="button" className="studio-btn" onClick={() => void builderApi().appStop(project.id)} aria-label="Stop building">
              <Square size={12} aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button type="button" className="studio-btn primary" disabled={!canSend} onClick={send} aria-label="Send">
              {sending ? <Spinner size={14} /> : <ArrowUp size={14} aria-hidden="true" />}
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
