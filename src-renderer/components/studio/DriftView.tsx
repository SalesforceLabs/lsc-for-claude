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
      <div className="studio-placeholder">
        <div className="studio-placeholder-error">Couldn't load what changed</div>
        <div className="studio-placeholder-sub">{error}</div>
        <button className="studio-btn" onClick={load}>
          Try again
        </button>
      </div>
    );
  }
  if (!list) {
    return (
      <div className="studio-placeholder">
        <div className="studio-spinner" />
        <div>Looking for recent changes…</div>
        <div className="studio-placeholder-sub">Reading when your configuration was last modified. Every query is read-only.</div>
      </div>
    );
  }

  const snapshot = list.snapshots.find((s) => s.id === selected) ?? null;
  return (
    <div className="studio-drift">
      <aside className="studio-drift-side">
        <div className="studio-drift-side-head">
          <h3 className="studio-lane-title">Snapshots</h3>
          {naming === null && (
            <button className="studio-btn primary" onClick={() => setNaming("")}>
              Save snapshot
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
          <p className="studio-drift-empty">
            No snapshots yet. Save one now (before go-live, or before a risky change) and compare against it later.
          </p>
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
                  <button className="studio-btn" onClick={() => compare(s.id)} disabled={busy}>
                    Compare
                  </button>
                  {confirmDelete === s.id ? (
                    <>
                      <button className="studio-btn danger" onClick={() => remove(s.id)} disabled={busy}>
                        Delete for good
                      </button>
                      <button className="studio-btn" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button className="studio-btn" onClick={() => setConfirmDelete(s.id)} disabled={busy}>
                      Delete
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
    return (
      <div className="studio-drift-status">
        <div className="studio-spinner" />
        <div>Comparing the org now with “{snapshot.label}”…</div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="studio-drift-status">
        <div className="studio-placeholder-error">Couldn't compare</div>
        <div className="studio-placeholder-sub">{state.error}</div>
        <button className="studio-btn" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  const d = state.diff;
  return (
    <>
      <header className="studio-drift-head">
        <h2>Since “{snapshot.label}”</h2>
        <div className="studio-drift-meta">
          Saved {when(snapshot.createdAt)} · {summaryText(d.counts)}
        </div>
      </header>
      {d.changes.length === 0 ? (
        <div className="studio-drift-clear">✓ Nothing in Admin Console settings, DB Schema, actions or trigger handlers has changed since this snapshot.</div>
      ) : (
        groups.map((g) => (
          <section key={g.featureId ?? "other"} className="studio-drift-group">
            <h3 className="studio-lane-title">
              {g.title}
              <span className="studio-drift-count">{g.items.length}</span>
              {g.featureId && (
                <button className="studio-btn" onClick={() => onOpenFeature(g.featureId!)}>
                  Open feature
                </button>
              )}
            </h3>
            {g.items.map((c) => (
              <ChangeCard key={c.key} change={c} onAsk={() => onAskClaude(askAboutChange(c, snapshot))} />
            ))}
          </section>
        ))
      )}
    </>
  );
}

function ChangeCard({ change: c, onAsk }: { change: DriftChange; onAsk: () => void }) {
  const active = describeActive(c.active);
  return (
    <article className={`studio-drift-card ${c.kind}`}>
      <div className="studio-drift-card-head">
        <span className={`studio-drift-kind ${c.kind}`}>{c.kind}</span>
        <strong>{c.label || c.developerName}</strong>
        <span className="studio-drift-meta">
          {c.category}
          {c.label && c.label !== c.developerName ? ` · ${c.developerName}` : ""}
        </span>
        <button className="studio-btn" onClick={onAsk}>
          Ask <AssistantName />
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
                  <span aria-hidden="true">→</span>
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
        <h2>Recent changes (last {recent.days} days)</h2>
        <div className="studio-drift-meta">
          {recent.changes.length} items modified. Save a snapshot to see exactly which settings changed, and how.
          <button className="studio-btn" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </header>
      {recent.errors.length > 0 && (
        <div className="studio-drift-error">Some sources couldn't be read: {recent.errors.join("; ")}</div>
      )}
      {recent.changes.length === 0 && recent.errors.length === 0 && (
        <div className="studio-drift-clear">✓ No LSC configuration was modified in the last {recent.days} days.</div>
      )}
      {groups.map((g) => (
        <section key={g.featureId ?? "other"} className="studio-drift-group">
          <h3 className="studio-lane-title">
            {g.title}
            <span className="studio-drift-count">{g.items.length}</span>
            {g.featureId && (
              <button className="studio-btn" onClick={() => onOpenFeature(g.featureId!)}>
                Open feature
              </button>
            )}
          </h3>
          <ul className="studio-drift-recent">
            {g.items.map((c: RecentChange, i) => (
              <li key={`${c.kind}-${c.name}-${i}`}>
                <span className="studio-drift-kind recent">{RECENT_KIND_LABEL[c.kind]}</span>
                <strong>{c.name}</strong>
                {c.detail && <span className="studio-drift-meta">{c.detail}</span>}
                <span className="studio-drift-meta studio-drift-when">
                  {c.modifiedBy ? `${c.modifiedBy} · ` : ""}
                  {when(c.modifiedAt)}
                </span>
                <button className="studio-btn" onClick={() => onAskClaude(askAboutRecent(c))}>
                  Ask <AssistantName />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
