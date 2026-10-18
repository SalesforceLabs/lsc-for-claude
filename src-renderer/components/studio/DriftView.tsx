import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { DriftChange, DriftDiff, DriftList, RecentChange, SnapshotMeta } from "./drift-types";
import {
  askAboutChange,
  askAboutRecent,
  describeActive,
  formatValue,
  groupByFeature,
  RECENT_KIND_LABEL,
  summaryText,
  when,
} from "./drift-format";
import { ArrowRight, Camera, ExternalLink, GitCompare, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import StatusIcon from "../ui/StatusIcon";
import StateView from "../ui/StateView";
import { Limited } from "../ui/Limited";
import "./readiness.css";
import "./drift.css";
import { AssistantName } from "../../hooks/useAssistantName";

export interface DriftViewProps {
  onAskClaude: (prompt: string) => void;
  onOpenFeature: (featureId: string) => void;
}

type DiffState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; diff: DriftDiff };

type Called<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(input: Parameters<typeof window.lscApi.studioDrift>[0]): Promise<Called<T>> {
  const res = await window.lscApi.studioDrift(input);
  const error = res.error || (res.data as { error?: string } | undefined)?.error;
  return error ? { ok: false, error } : { ok: true, data: res.data as T };
}

/** "What changed" — the org's LSC configuration now against a saved snapshot. */
export default function DriftView({ onAskClaude, onOpenFeature }: DriftViewProps) {
  const [list, setList] = useState<DriftList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffState | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setList(null);
    setError(null);
    const res = await call<DriftList>({ action: "list" });
    if (res.ok) setList(res.data);
    else setError(res.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const compare = useCallback(async (id: string) => {
    setSelected(id);
    setDiff({ status: "loading" });
    const res = await call<DriftDiff>({ action: "diff", id });
    setDiff(res.ok ? { status: "ready", diff: res.data } : { status: "error", error: res.error });
  }, []);

  const save = async () => {
    if (naming === null) return;
    setBusy(true);
    const res = await call<{ snapshot: SnapshotMeta }>({ action: "save", label: naming.trim() || undefined });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNaming(null);
    setList((l) => (l ? { ...l, snapshots: [res.data.snapshot, ...l.snapshots] } : l));
  };

  const remove = async (id: string) => {
    setBusy(true);
    const res = await call<{ deleted: string }>({ action: "delete", id });
    setBusy(false);
    setConfirmDelete(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setList((l) => (l ? { ...l, snapshots: l.snapshots.filter((s) => s.id !== id) } : l));
    if (selected === id) {
      setSelected(null);
      setDiff(null);
    }
  };

  if (error && !list) {
    return (
      <div className="studio-drift-fill">
        <StateView
          kind="error"
          title="Couldn't load what changed"
          detail={error}
          actions={
            <button className="studio-btn" onClick={load}>
              <RefreshCw aria-hidden="true" /> Try again
            </button>
          }
        />
      </div>
    );
  }
  if (!list) {
    return (
      <div className="studio-drift-fill">
        <StateView
          kind="loading"
          title="Looking for recent changes…"
          detail="Reading when your configuration was last modified. Every query is read-only."
        />
      </div>
    );
  }

  const snapshot = list.snapshots.find((s) => s.id === selected) ?? null;
  return (
    <div className="studio-drift">
      <aside className="studio-drift-side">
        <div className="studio-drift-side-head">
          <h3 className="ui-section-title">Snapshots</h3>
          {naming === null && (
            <button className="studio-btn primary" onClick={() => setNaming("")}>
              <Camera aria-hidden="true" /> Save snapshot
            </button>
          )}
        </div>
        {naming !== null && (
          <form
            className="studio-drift-name"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              autoFocus
              className="studio-input"
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              placeholder="Label, e.g. Go-live baseline"
              aria-label="Snapshot label"
              disabled={busy}
            />
            <button className="studio-btn primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className="studio-btn" type="button" onClick={() => setNaming(null)} disabled={busy}>
              Cancel
            </button>
          </form>
        )}
        {error && <div className="studio-drift-error">{error}</div>}
        {list.snapshots.length === 0 ? (
          <div className="studio-drift-empty">
            <Camera size={16} aria-hidden="true" />
            <p>No snapshots yet. Save one now (before go-live, or before a risky change) and compare against it later.</p>
          </div>
        ) : (
          <ul className="studio-drift-snaps">
            {list.snapshots.map((s) => (
              <li key={s.id} className={s.id === selected ? "selected" : ""}>
                <div className="studio-drift-snap-label">{s.label}</div>
                <div className="studio-drift-meta">
                  {when(s.createdAt)} · {s.counts.dbSchema} DB Schema · {s.counts.adminSettings} settings · {s.counts.actions} actions ·{" "}
                  {s.counts.triggerHandlers} handlers
                </div>
                <div className="studio-drift-snap-actions">
                  <button className="studio-btn sm" onClick={() => compare(s.id)} disabled={busy}>
                    <GitCompare aria-hidden="true" /> Compare
                  </button>
                  {confirmDelete === s.id ? (
                    <>
                      <button className="studio-btn sm danger" onClick={() => remove(s.id)} disabled={busy}>
                        Delete for good
                      </button>
                      <button className="studio-btn sm" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      className="ui-icon-btn sm studio-drift-delete"
                      onClick={() => setConfirmDelete(s.id)}
                      disabled={busy}
                      title="Delete snapshot"
                      aria-label={`Delete snapshot ${s.label}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <button
            className="studio-btn"
            onClick={() => {
              setSelected(null);
              setDiff(null);
            }}
          >
            Show recent changes instead
          </button>
        )}
      </aside>

      <div className="studio-drift-main">
        <div className="studio-drift-page ui-enter" key={snapshot && diff ? snapshot.id : "recent"}>
        {snapshot && diff ? (
          <DiffPanel
            snapshot={snapshot}
            state={diff}
            onRetry={() => compare(snapshot.id)}
            onAskClaude={onAskClaude}
            onOpenFeature={onOpenFeature}
          />
        ) : (
          <RecentPanel recent={list.recent} onAskClaude={onAskClaude} onOpenFeature={onOpenFeature} onRefresh={load} />
        )}
        </div>
      </div>
    </div>
  );
}

function DiffPanel({
  snapshot,
  state,
  onRetry,
  onAskClaude,
  onOpenFeature,
}: {
  snapshot: SnapshotMeta;
  state: DiffState;
  onRetry: () => void;
  onAskClaude: (prompt: string) => void;
  onOpenFeature: (featureId: string) => void;
}) {
  const diff = state.status === "ready" ? state.diff : null;
  const groups = useMemo(() => (diff ? groupByFeature(diff.changes) : []), [diff]);
  if (state.status === "loading") {
    return <StateView kind="loading" layout="inline" title={`Comparing the org now with “${snapshot.label}”…`} />;
  }
  if (state.status === "error") {
    return (
      <StateView
        kind="error"
        layout="inline"
        title="Couldn't compare"
        detail={state.error}
        actions={
          <button className="studio-btn" onClick={onRetry}>
            <RefreshCw aria-hidden="true" /> Try again
          </button>
        }
      />
    );
  }
  const d = state.diff;
  return (
    <>
      <header className="studio-drift-head">
        <div>
          <h2>Since “{snapshot.label}”</h2>
          <p>
            Saved {when(snapshot.createdAt)} · {summaryText(d.counts)}
          </p>
        </div>
      </header>
      {d.changes.length === 0 ? (
        <div className="studio-drift-clear">
          <StatusIcon tone="pass" size={20} />
          Nothing in Admin Console settings, DB Schema, actions or trigger handlers has changed since this snapshot.
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.featureId ?? "other"} className="studio-drift-group">
            <div className="studio-section-head">
              <h3 className="ui-section-title">
                {g.title}
                <span className="count">{g.items.length}</span>
              </h3>
              {g.featureId && (
                <button className="studio-btn sm" onClick={() => onOpenFeature(g.featureId!)}>
                  <ExternalLink aria-hidden="true" /> Open feature
                </button>
              )}
            </div>
            <Limited
              items={g.items}
              limit={50}
              render={(c) => <ChangeCard key={c.key} change={c} onAsk={() => onAskClaude(askAboutChange(c, snapshot))} />}
            />
          </section>
        ))
      )}
    </>
  );
}

const KIND_TONE = { added: "pass", removed: "error", changed: "warning" } as const;
const KIND_LABEL = { added: "Added", removed: "Removed", changed: "Changed" } as const;

function ChangeCard({ change: c, onAsk }: { change: DriftChange; onAsk: () => void }) {
  const active = describeActive(c.active);
  return (
    <article className={`studio-drift-card ${c.kind}`}>
      <div className="studio-drift-card-head">
        <span className={`ui-pill ${KIND_TONE[c.kind]}`}>{KIND_LABEL[c.kind]}</span>
        <strong>{c.label || c.developerName}</strong>
        <span className="studio-drift-meta">
          {c.category}
          {c.label && c.label !== c.developerName ? ` · ${c.developerName}` : ""}
        </span>
        <button className="studio-btn sm" onClick={onAsk}>
          <Sparkles aria-hidden="true" /> Ask <AssistantName />
        </button>
      </div>
      {(c.modifiedBy || c.modifiedAt) && (
        <div className="studio-drift-meta">
          Last modified {c.modifiedBy ? `by ${c.modifiedBy} ` : ""}
          {c.modifiedAt ? `on ${when(c.modifiedAt)}` : ""}
        </div>
      )}
      {active && c.kind === "changed" && <div className="studio-drift-line">Active: {active}</div>}
      {c.kind === "added" && active && <div className="studio-drift-line">Starts {c.active?.after ? "active" : "inactive"}</div>}
      {c.kind !== "removed" || c.fields.length > 0 ? (
        <ul className="studio-drift-fields">
          {c.fields.slice(0, 20).map((f) => (
            <li key={f.name}>
              <span className="studio-drift-field">{f.name}</span>
              {c.kind === "changed" && (
                <>
                  <span className="studio-drift-before">{formatValue(f.before)}</span>
                  <ArrowRight size={12} aria-hidden="true" className="studio-drift-arrow" />
                  <span className="studio-drift-after">{formatValue(f.after)}</span>
                </>
              )}
              {c.kind === "added" && <span className="studio-drift-after">{formatValue(f.after)}</span>}
              {c.kind === "removed" && <span className="studio-drift-before">{formatValue(f.before)}</span>}
            </li>
          ))}
          {c.fields.length > 20 && <li className="studio-drift-meta">…and {c.fields.length - 20} more fields</li>}
        </ul>
      ) : null}
      {c.assignmentsAdded.length > 0 && <div className="studio-drift-line">Now assigned to {c.assignmentsAdded.join(", ")}</div>}
      {c.assignmentsRemoved.length > 0 && <div className="studio-drift-line">No longer assigned to {c.assignmentsRemoved.join(", ")}</div>}
    </article>
  );
}

function RecentPanel({
  recent,
  onAskClaude,
  onOpenFeature,
  onRefresh,
}: {
  recent: DriftList["recent"];
  onAskClaude: (prompt: string) => void;
  onOpenFeature: (featureId: string) => void;
  onRefresh: () => void;
}) {
  const groups = useMemo(() => groupByFeature(recent.changes), [recent]);
  return (
    <>
      <header className="studio-drift-head">
        <div>
          <h2>Recent changes</h2>
          <p>
            {recent.changes.length} {recent.changes.length === 1 ? "item" : "items"} modified in the last {recent.days} days. Save a snapshot to see exactly which settings changed, and how.
          </p>
        </div>
        <button className="studio-btn" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" /> Refresh
        </button>
      </header>
      {recent.errors.length > 0 && (
        <div className="studio-drift-error">Some sources couldn't be read: {recent.errors.join("; ")}</div>
      )}
      {recent.changes.length === 0 && recent.errors.length === 0 && (
        <div className="studio-drift-clear">
          <StatusIcon tone="pass" size={20} />
          No LSC configuration was modified in the last {recent.days} days.
        </div>
      )}
      {groups.map((g) => (
        <section key={g.featureId ?? "other"} className="studio-drift-group">
          <div className="studio-section-head">
            <h3 className="ui-section-title">
              {g.title}
              <span className="count">{g.items.length}</span>
            </h3>
            {g.featureId && (
              <button className="studio-btn sm" onClick={() => onOpenFeature(g.featureId!)}>
                <ExternalLink aria-hidden="true" /> Open feature
              </button>
            )}
          </div>
          <ul className="studio-drift-recent">
            <Limited as="li" items={g.items} render={(c: RecentChange, i) => (
              <li key={`${c.kind}-${c.name}-${i}`}>
                <span className="ui-pill">{RECENT_KIND_LABEL[c.kind]}</span>
                <strong>{c.name}</strong>
                {c.detail && <span className="studio-drift-meta">{c.detail}</span>}
                <span className="studio-drift-meta studio-drift-when">
                  {c.modifiedBy ? `${c.modifiedBy} · ` : ""}
                  {when(c.modifiedAt)}
                </span>
                <button className="studio-btn sm" onClick={() => onAskClaude(askAboutRecent(c))}>
                  <Sparkles aria-hidden="true" /> Ask <AssistantName />
                </button>
              </li>
            )} />
          </ul>
        </section>
      ))}
    </>
  );
}
