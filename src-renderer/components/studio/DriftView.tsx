import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { DriftChange, DriftDiff, DriftList, RecentChange, SnapshotMeta } from "./drift-types";
import {
  askAboutBatch,
  askAboutChange,
  askAboutRecent,
  batchRecent,
  batchType,
  describeActive,
  formatValue,
  groupByFeature,
  recentContext,
  recentType,
  splitRecentErrors,
  summaryText,
  when,
  type RecentRow,
} from "./drift-format";
import {
  ArrowRight,
  Camera,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  GitCompare,
  Info,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import Segmented from "../ui/Segmented";
import Spinner from "../ui/Spinner";
import StatusIcon from "../ui/StatusIcon";
import StateView from "../ui/StateView";
import { Limited } from "../ui/Limited";
import "./readiness.css";
import "./drift.css";

export interface DriftViewProps {
  onAskClaude: (prompt: string) => void;
  onOpenFeature: (featureId: string) => void;
}

const PERIODS = ["1", "7", "14", "30", "90"] as const;
type Period = (typeof PERIODS)[number];

type DiffState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; diff: DriftDiff };

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
  const [period, setPeriod] = useState<Period>("14");
  // A refresh or a new period keeps the page on screen; only the first load shows the loading state.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const load = useCallback(async (days: Period) => {
    setRefreshing(true);
    setRefreshError(null);
    const res = await call<DriftList>({ action: "list", days: Number(days) });
    setRefreshing(false);
    if (res.ok) {
      setList(res.data);
      setError(null);
    } else {
      setRefreshError(res.error);
      setError(res.error);
    }
  }, []);

  useEffect(() => {
    load(period);
  }, [load, period]);

  const compare = useCallback(async (id: string) => {
    setSelected(id);
    setDiff({ status: "loading" });
    const res = await call<DriftDiff>({ action: "diff", id });
    setDiff(res.ok ? { status: "ready", diff: res.data } : { status: "error", error: res.error });
  }, []);

  const save = async () => {
    if (naming === null) return;
    setBusy(true);
    const res = await call<{ snapshot: SnapshotMeta }>({
      action: "save",
      label: naming.trim() || undefined,
    });
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
            <button className="studio-btn" onClick={() => load(period)}>
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
    <div className="studio-drift-wrap">
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
              <button
                className="studio-btn"
                type="button"
                onClick={() => setNaming(null)}
                disabled={busy}
              >
                Cancel
              </button>
            </form>
          )}
          {error && !refreshError && <div className="studio-drift-error">{error}</div>}
          {list.snapshots.length === 0 ? (
            <div className="studio-drift-empty">
              <Camera size={16} aria-hidden="true" />
              <p>
                No snapshots yet. Save one now (before go-live, or before a risky change) and
                compare against it later.
              </p>
            </div>
          ) : (
            <ul className="studio-drift-snaps">
              {list.snapshots.map((s) => (
                <li key={s.id} className={s.id === selected ? "selected" : ""}>
                  <div className="studio-drift-snap-label">{s.label}</div>
                  <div className="studio-drift-meta">
                    {when(s.createdAt)} · {s.counts.dbSchema} DB Schema · {s.counts.adminSettings}{" "}
                    settings · {s.counts.actions} actions · {s.counts.triggerHandlers} handlers
                  </div>
                  <div className="studio-drift-snap-actions">
                    <button className="studio-btn sm" onClick={() => compare(s.id)} disabled={busy}>
                      <GitCompare aria-hidden="true" /> Compare
                    </button>
                    {confirmDelete === s.id ? (
                      <>
                        <button
                          className="studio-btn sm danger"
                          onClick={() => remove(s.id)}
                          disabled={busy}
                        >
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
          <div
            className="studio-drift-page ui-enter"
            key={snapshot && diff ? snapshot.id : "recent"}
          >
            {snapshot && diff ? (
              <DiffPanel
                snapshot={snapshot}
                state={diff}
                onRetry={() => compare(snapshot.id)}
                onAskClaude={onAskClaude}
                onOpenFeature={onOpenFeature}
              />
            ) : (
              <RecentPanel
                recent={list.recent}
                period={period}
                onPeriod={setPeriod}
                refreshing={refreshing}
                refreshError={refreshError}
                onAskClaude={onAskClaude}
                onOpenFeature={onOpenFeature}
                onRefresh={() => load(period)}
              />
            )}
          </div>
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
    return (
      <StateView
        kind="loading"
        layout="inline"
        title={`Comparing the org now with “${snapshot.label}”…`}
      />
    );
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
          Nothing in Admin Console settings, DB Schema, actions or trigger handlers has changed
          since this snapshot.
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
              render={(c) => (
                <ChangeCard
                  key={c.key}
                  change={c}
                  onAsk={() => onAskClaude(askAboutChange(c, snapshot))}
                />
              )}
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
        <span
          className="studio-drift-name-cell"
          title={`${c.label || c.developerName} · ${c.category}`}
        >
          <strong className="studio-drift-row-name">{c.label || c.developerName}</strong>
          <span className="studio-drift-context">
            {c.category}
            {c.label && c.label !== c.developerName ? ` · ${c.developerName}` : ""}
          </span>
        </span>
        <AskButton onAsk={onAsk} about={c.label || c.developerName} />
      </div>
      {(c.modifiedBy || c.modifiedAt) && (
        <div className="studio-drift-meta">
          Last modified {c.modifiedBy ? `by ${c.modifiedBy} ` : ""}
          {c.modifiedAt ? `on ${when(c.modifiedAt)}` : ""}
        </div>
      )}
      {active && c.kind === "changed" && <div className="studio-drift-line">Active: {active}</div>}
      {c.kind === "added" && active && (
        <div className="studio-drift-line">Starts {c.active?.after ? "active" : "inactive"}</div>
      )}
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
              {c.kind === "added" && (
                <span className="studio-drift-after">{formatValue(f.after)}</span>
              )}
              {c.kind === "removed" && (
                <span className="studio-drift-before">{formatValue(f.before)}</span>
              )}
            </li>
          ))}
          {c.fields.length > 20 && (
            <li className="studio-drift-meta">…and {c.fields.length - 20} more fields</li>
          )}
        </ul>
      ) : null}
      {c.assignmentsAdded.length > 0 && (
        <div className="studio-drift-line">Now assigned to {c.assignmentsAdded.join(", ")}</div>
      )}
      {c.assignmentsRemoved.length > 0 && (
        <div className="studio-drift-line">
          No longer assigned to {c.assignmentsRemoved.join(", ")}
        </div>
      )}
    </article>
  );
}

function RecentPanel({
  recent,
  period,
  onPeriod,
  refreshing,
  refreshError,
  onAskClaude,
  onOpenFeature,
  onRefresh,
}: {
  recent: DriftList["recent"];
  period: Period;
  onPeriod: (p: Period) => void;
  refreshing: boolean;
  refreshError: string | null;
  onAskClaude: (prompt: string) => void;
  onOpenFeature: (featureId: string) => void;
  onRefresh: () => void;
}) {
  const groups = useMemo(
    () => groupByFeature(recent.changes).map((g) => ({ ...g, rows: batchRecent(g.items) })),
    [recent]
  );
  const { failed, limited } = splitRecentErrors(recent.errors, recent.limited);
  const n = recent.changes.length;
  const count = `${limited.length ? "At least " : ""}${n.toLocaleString("en-US")} ${n === 1 ? "item" : "items"}`;
  const summary = `${count} modified in the last ${recent.days === 1 ? "day" : `${recent.days} days`}`;
  return (
    <>
      <header className="studio-drift-head">
        <div className="studio-drift-title">
          <h2>Recent changes</h2>
          <p title={summary}>{summary}</p>
        </div>
        <div className="studio-drift-head-actions">
          <Segmented
            size="sm"
            aria-label="Period"
            value={period}
            onChange={onPeriod}
            options={PERIODS.map((p) => ({ value: p, label: p === "1" ? "1 day" : `${p} days` }))}
          />
          <button
            className="ui-icon-btn"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh"
            title="Refresh"
          >
            {refreshing ? <Spinner size={14} /> : <RefreshCw size={14} aria-hidden="true" />}
          </button>
        </div>
      </header>
      {refreshError && (
        <div className="studio-drift-note error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <span>Couldn't refresh: {refreshError}</span>
          <button className="studio-link-btn" onClick={onRefresh}>
            Retry
          </button>
        </div>
      )}
      {failed.length > 0 && (
        <div className="studio-drift-note error">
          <CircleAlert size={16} aria-hidden="true" />
          <span>Some sources couldn't be read, so they aren't listed. {failed.join(" · ")}</span>
        </div>
      )}
      {limited.length > 0 && (
        <div className="studio-drift-note warning">
          <Info size={16} aria-hidden="true" />
          <span>
            Only the newest changes are listed for {limited.join(" and ")}. More changed in this
            period
            {period !== "1" ? "; pick a shorter one to see them all." : "."}
          </span>
        </div>
      )}
      {n === 0 && failed.length === 0 && (
        <div className="studio-drift-clear">
          <StatusIcon tone="pass" size={20} />
          No LSC configuration was modified in the last{" "}
          {recent.days === 1 ? "day" : `${recent.days} days`}.
        </div>
      )}
      <div
        className={`studio-drift-groups${refreshing ? " refreshing" : ""}`}
        aria-busy={refreshing}
      >
        {groups.map((g) => (
          <section key={g.featureId ?? "other"} className="studio-drift-group">
            <div className="studio-section-head">
              <h3 className="ui-section-title">
                {g.title}
                <span className="count">{g.items.length}</span>
              </h3>
              {g.featureId && (
                <button className="studio-btn sm ghost" onClick={() => onOpenFeature(g.featureId!)}>
                  <ExternalLink size={14} aria-hidden="true" /> Open feature
                </button>
              )}
            </div>
            <ul className="studio-drift-recent">
              <Limited
                as="li"
                items={g.rows}
                limit={100}
                render={(r: RecentRow) =>
                  r.kind === "one" ? (
                    <li key={r.key}>
                      <RecentLine
                        change={r.change}
                        onAsk={() => onAskClaude(askAboutRecent(r.change))}
                      />
                    </li>
                  ) : (
                    <BatchRow
                      key={r.key}
                      row={r}
                      onAskClaude={onAskClaude}
                      featureTitle={g.title}
                    />
                  )
                }
              />
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function AskButton({ onAsk, about }: { onAsk: () => void; about: string }) {
  return (
    <button
      className="ui-icon-btn sm studio-drift-ask"
      onClick={onAsk}
      title="Ask about this change"
      aria-label={`Ask about ${about}`}
    >
      <Sparkles size={14} aria-hidden="true" />
    </button>
  );
}

function RecentLine({
  change: c,
  onAsk,
  inBatch,
}: {
  change: RecentChange;
  onAsk: () => void;
  inBatch?: { sameType: boolean };
}) {
  const type = recentType(c);
  const context = recentContext(c) === type ? undefined : recentContext(c);
  const by = `${c.modifiedBy ? `${c.modifiedBy} · ` : ""}${when(c.modifiedAt)}`;
  return (
    <div className="studio-drift-row">
      <span className="studio-drift-type" title={type}>
        {inBatch?.sameType ? "" : type}
      </span>
      <span className="studio-drift-name-cell" title={context ? `${c.name} · ${context}` : c.name}>
        <span className="studio-drift-row-name">{c.name}</span>
        {context && <span className="studio-drift-context">{context}</span>}
      </span>
      <span className="studio-drift-when" title={by}>
        {inBatch ? "" : by}
      </span>
      <AskButton onAsk={onAsk} about={c.name} />
    </div>
  );
}

function BatchRow({
  row,
  onAskClaude,
  featureTitle,
}: {
  row: Extract<RecentRow, { kind: "batch" }>;
  onAskClaude: (p: string) => void;
  featureTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const by = `${row.by ? `${row.by} · ` : ""}${when(row.at)}`;
  const type = batchType(row.changes);
  const sameType = new Set(row.changes.map(recentType)).size === 1;
  return (
    <li className={`studio-drift-batch${open ? " open" : ""}`}>
      <div className="studio-drift-row">
        <button
          className="studio-drift-disclosure"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={14} aria-hidden="true" />
          <span className="studio-drift-type" title={type}>
            {type}
          </span>
          <span className="studio-drift-name-cell">
            <span className="studio-drift-row-name">{row.changes.length} changed together</span>
          </span>
        </button>
        <span className="studio-drift-when" title={by}>
          {by}
        </span>
        <AskButton
          onAsk={() => onAskClaude(askAboutBatch(row.changes, featureTitle))}
          about={`these ${row.changes.length} changes`}
        />
      </div>
      {open && (
        <ul className="studio-drift-batch-items">
          <Limited
            as="li"
            items={row.changes}
            limit={100}
            render={(c, i) => (
              <li key={`${c.kind}-${c.name}-${i}`}>
                <RecentLine
                  change={c}
                  inBatch={{ sameType }}
                  onAsk={() => onAskClaude(askAboutRecent(c))}
                />
              </li>
            )}
          />
        </ul>
      )}
    </li>
  );
}
