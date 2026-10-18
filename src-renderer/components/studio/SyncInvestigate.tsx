import React, { useCallback, useEffect, useState } from "react";
import type { SurfaceId, StudioFix } from "./types";
import { isQueued, queueChange, type PendingChange } from "./changes";
import "./sync-investigate.css";

export interface SyncInvestigateProps {
  userId: string | null;
  onUserChange: (userId: string | null) => void;
  onAskClaude: (prompt: string) => void;
  onOpenSetup: (featureId: string, surface?: SurfaceId | null, item?: string | null) => void;
  pending: PendingChange[];
  onPendingChange: (pending: PendingChange[]) => void;
}

// Renderer copies of the `studio_sync_user` result (src/studio/sync-user.ts, src/perf/table-hints.ts).
interface HintSuggestion {
  field: string;
  from: string | null;
  to: string;
  label: string;
}
interface TableHint {
  id: string;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  suggestion?: HintSuggestion;
}
interface SchemaRecordRef {
  developerName: string;
  recordId: string | null;
  itemId: string;
  active: boolean;
  fields: {
    SObject: string;
    Type: string | null;
    WhereSoql: string | null;
    OneWaySync: boolean;
    AttachmentsSupport: string | null;
    DeltaDateField: string | null;
  };
  profiles: string[];
}
interface SyncTable {
  sobject: string;
  developerName: string;
  status: "counted" | "not-estimated" | "error";
  records: number;
  sharePct: number;
  deviceRequests: number | null;
  idTag?: string;
  note?: string;
  scope?: "user" | "org-wide";
  sharingModel?: string;
  mayOvercount: boolean;
  schema: SchemaRecordRef | null;
  hints: TableHint[];
}
interface SyncTerritory {
  territory: { id: string; name: string } | null;
  totalRecords: number;
  totalDeviceRequests: number;
  upperBoundRecords: number;
  tables: SyncTable[];
}
interface Dist {
  n: number;
  p50?: number;
  p90?: number;
}
interface SyncUserDetail {
  generatedAt: string;
  days: number;
  user: { id: string; username: string; name: string; profileName: string; permissionSetCount: number; territories: Array<{ id: string; name: string }> };
  schemaSource: "compiled" | "db-schema" | "user-download";
  schemaNotes: string[];
  tableCount: number;
  territories: SyncTerritory[];
  telemetry?: {
    summary: { samples: number; failureRatePct?: number; initial: { total: Dist }; delta: { total: Dist } };
    recent: Array<{ id: string; createdDate: string; kind: "initial" | "delta"; outcome: string; totalSec?: number; downloadedRecords?: number }>;
  };
  telemetryError?: string;
}
interface PerfUser {
  id: string;
  username: string;
  name: string;
  profile: string;
  territories: number;
  syncs?: number;
}

type Load = { status: "idle" } | { status: "loading" } | { status: "error"; error: string } | { status: "ready"; detail: SyncUserDetail };

const WINDOW_DAYS = 30;
const SEARCH_DEBOUNCE_MS = 350;
/** Verdict thresholds: a delta p90 over this many seconds, or a failure rate over this share, is called out. */
const SLOW_DELTA_SEC = 120;
const FAILURE_PCT = 5;
const TOP_TABLES_IN_PROMPT = 5;

const SCHEMA_SOURCE: Record<SyncUserDetail["schemaSource"], string> = {
  "user-download": "the rep's own metadata download",
  compiled: "the profile's compiled metadata schema",
  "db-schema": "DB Schema records",
};

const fmt = (n: number | undefined | null) => (n === undefined || n === null ? "—" : n.toLocaleString("en-US"));
const fmtSec = (n: number | undefined) => (n === undefined ? "—" : n < 90 ? `${Math.round(n)}s` : `${(n / 60).toFixed(1)} min`);
const errorOf = (res: { data?: unknown; error?: string }) => res.error || (res.data as { error?: string } | undefined)?.error;

/** The setConfigField fix a hint's suggestion becomes — the same shape Inspector and the collectors build for a DB Schema field. */
function suggestionFix(schema: SchemaRecordRef, s: HintSuggestion): StudioFix {
  return {
    kind: "setConfigField",
    label: s.label,
    category: "DbSchema",
    developerName: schema.developerName,
    recordLabel: schema.fields.SObject || schema.developerName,
    field: s.field,
    from: s.from,
    to: s.to,
  };
}

/** A plain-language read of how the rep's real syncs are going. */
function verdict(detail: SyncUserDetail): { tone: "ok" | "warning" | "info"; text: string } {
  const t = detail.telemetry;
  if (!t) return { tone: "info", text: detail.telemetryError ? "Sync history couldn't be read." : "No sync history." };
  if (t.summary.samples === 0) return { tone: "info", text: `No syncs in the last ${detail.days} days, so there is nothing measured to compare with the prediction.` };
  const problems: string[] = [];
  if ((t.summary.failureRatePct ?? 0) > FAILURE_PCT) problems.push(`${Math.round(t.summary.failureRatePct ?? 0)}% of syncs fail`);
  if ((t.summary.delta.total.p90 ?? 0) > SLOW_DELTA_SEC) problems.push(`delta syncs take ${fmtSec(t.summary.delta.total.p90)} at the slow end`);
  return problems.length
    ? { tone: "warning", text: `This rep is struggling: ${problems.join(" and ")}.` }
    : { tone: "ok", text: "This rep's syncs look healthy." };
}

function askPrompt(detail: SyncUserDetail, terr: SyncTerritory): string {
  const top = terr.tables.filter((t) => t.status === "counted").slice(0, TOP_TABLES_IN_PROMPT);
  const lines = top.map((t) => {
    const hints = t.hints.filter((h) => h.severity !== "info").map((h) => h.title);
    return `- ${t.sobject}: ${fmt(t.records)} records (${Math.round(t.sharePct)}%)${t.schema?.fields.WhereSoql ? `, filter: ${t.schema.fields.WhereSoql}` : ", no filter"}${hints.length ? ` — ${hints.join("; ")}` : ""}`;
  });
  return [
    `${detail.user.name} (${detail.user.username}, profile ${detail.user.profileName}) has a heavy mobile sync${terr.territory ? ` in territory ${terr.territory.name}` : ""}: about ${fmt(terr.totalRecords)} predicted records and ${fmt(terr.totalDeviceRequests)} device requests.`,
    "Heaviest tables:",
    ...lines,
    "How can I make this sync lighter without hiding data the rep needs? Propose specific DB Schema changes.",
  ].join("\n");
}

function UserPicker({ onPick }: { onPick: (u: PerfUser) => void }) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<{ loading: boolean; users: PerfUser[]; error?: string }>({ loading: false, users: [] });

  useEffect(() => {
    if (!search.trim()) {
      setState({ loading: false, users: [] });
      return;
    }
    let stale = false;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      const res = await window.lscApi.studioPerfUsers(search.trim(), undefined, WINDOW_DAYS);
      if (stale) return;
      const error = errorOf(res);
      setState(error ? { loading: false, users: [], error } : { loading: false, users: (res.data as PerfUser[]) ?? [] });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [search]);

  return (
    <div className="studio-perf-user-search">
      <label className="studio-perf-field-label" htmlFor="sync-investigate-search">
        Find a rep
      </label>
      <input
        id="sync-investigate-search"
        className="studio-filter"
        placeholder="Search users by name or username…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {state.error && <div className="studio-placeholder-error">{state.error}</div>}
      {search.trim() && !state.error && (
        <ul className="studio-picker-list studio-perf-user-list">
          {state.loading && state.users.length === 0 && <li className="studio-picker-meta">Searching…</li>}
          {!state.loading && state.users.length === 0 && <li className="studio-picker-meta">No active users match.</li>}
          {state.users.map((u) => (
            <li key={u.id}>
              <button type="button" className="studio-picker-row studio-perf-user-row" onClick={() => onPick(u)}>
                <span className="studio-picker-name">
                  {u.name} <span className="studio-picker-meta">{u.username}</span>
                </span>
                <span className="studio-picker-meta">
                  {u.profile} · {u.territories} {u.territories === 1 ? "territory" : "territories"}
                  {u.syncs !== undefined && ` · ${fmt(u.syncs)} ${u.syncs === 1 ? "sync" : "syncs"}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface TableDetailProps {
  table: SyncTable;
  pending: PendingChange[];
  onQueue: (schema: SchemaRecordRef, hint: HintSuggestion) => void;
  onOpenSetup: SyncInvestigateProps["onOpenSetup"];
}

function TableDetail({ table, pending, onQueue, onOpenSetup }: TableDetailProps) {
  const schema = table.schema;
  const f = schema?.fields;
  return (
    <div className="studio-perf-card sync-investigate-detail">
      <div className="studio-perf-card-header">
        <span className="studio-perf-name">{table.sobject}</span>
        {schema && (
          <button type="button" className="studio-btn" onClick={() => onOpenSetup("mobile-sync", "syncedObjects", schema.itemId)}>
            Open in Setup
          </button>
        )}
      </div>

      {table.hints.length === 0 ? (
        <div className="studio-perf-hint">Nothing stands out about this table.</div>
      ) : (
        <ul className="sync-investigate-hints">
          {table.hints.map((h) => {
            const s = h.suggestion;
            const fix = schema && s ? suggestionFix(schema, s) : null;
            const queued = fix ? isQueued(pending, fix) : false;
            return (
              <li key={h.id} className="sync-investigate-hint">
                <span className={`studio-sev-dot ${h.severity}`} aria-hidden="true" />
                <div className="sync-investigate-hint-body">
                  <div className="sync-investigate-hint-title">{h.title}</div>
                  <div className="studio-perf-hint">{h.detail}</div>
                  {s && schema && (
                    <button
                      type="button"
                      className="studio-btn primary studio-perf-small"
                      disabled={queued}
                      onClick={() => onQueue(schema, s)}
                    >
                      {queued ? "Queued" : "Queue this change"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {schema && f ? (
        <dl className="sync-investigate-props">
          <dt>DB Schema record</dt>
          <dd>{schema.developerName}</dd>
          <dt>Filter</dt>
          <dd>{f.WhereSoql ? <code>{f.WhereSoql}</code> : "None — all records the rep can access"}</dd>
          <dt>One-way sync</dt>
          <dd>{f.OneWaySync ? "Yes" : "No"}</dd>
          <dt>Attachments</dt>
          <dd>{f.AttachmentsSupport || "Off"}</dd>
          <dt>Delta date field</dt>
          <dd>{f.DeltaDateField || "None"}</dd>
        </dl>
      ) : (
        <div className="studio-perf-hint">DB Schema record not identified for this rep (it may come only from the profile's compiled schema, or belong to another profile).</div>
      )}
    </div>
  );
}

export default function SyncInvestigate({ userId, onUserChange, onAskClaude, onOpenSetup, pending, onPendingChange }: SyncInvestigateProps) {
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const [territoryIdx, setTerritoryIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  // Bumped by Refresh to reload the same user.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!userId) {
      setLoad({ status: "idle" });
      return;
    }
    let stale = false;
    setLoad({ status: "loading" });
    setTerritoryIdx(0);
    setSelected(null);
    window.lscApi
      .studioSyncUser(userId, WINDOW_DAYS)
      .then((res) => {
        if (stale) return;
        const error = errorOf(res);
        setLoad(error ? { status: "error", error } : { status: "ready", detail: res.data as SyncUserDetail });
      })
      .catch((e) => {
        if (!stale) setLoad({ status: "error", error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      stale = true;
    };
  }, [userId, reload]);

  const queue = useCallback(
    (schema: SchemaRecordRef, s: HintSuggestion) => {
      const affects = schema.profiles.length ? schema.profiles : undefined;
      onPendingChange(queueChange(pending, { fix: suggestionFix(schema, s), affects }));
    },
    [pending, onPendingChange]
  );

  const detail = load.status === "ready" ? load.detail : null;
  const terr = detail?.territories[Math.min(territoryIdx, (detail?.territories.length ?? 1) - 1)];
  const maxRecords = Math.max(1, ...(terr?.tables.map((t) => t.records) ?? [0]));
  const selectedTable = terr?.tables.find((t) => t.sobject === selected) ?? null;
  const sync = detail ? verdict(detail) : null;
  const queuedFor = (t: SyncTable) =>
    !!t.schema && pending.some((p) => p.fix.kind === "setConfigField" && p.fix.category === "DbSchema" && p.fix.developerName === t.schema!.developerName);

  return (
    <div className="studio-perf-body sync-investigate">
      <UserPicker onPick={(u) => onUserChange(u.id)} />

      {load.status === "idle" && <div className="studio-perf-hint">Pick a rep to see what their iPad downloads and what to change.</div>}

      {load.status === "loading" && (
        <div className="studio-perf-progress" role="status">
          <div className="studio-spinner" />
          <div className="studio-perf-progress-text">Counting what this rep's iPad downloads, table by table. This can take a minute.</div>
        </div>
      )}

      {load.status === "error" && (
        <div className="studio-placeholder-error" role="alert">
          {load.error}{" "}
          <button type="button" className="studio-btn studio-perf-small" onClick={() => setReload((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}

      {detail && terr && sync && (
        <>
          <section className="studio-perf-section" aria-label="Rep summary">
            <div className="studio-perf-section-header">
              <h2 className="studio-perf-section-title">
                {detail.user.name} <span className="studio-picker-meta">{detail.user.username}</span>
              </h2>
              <div className="studio-perf-row">
                <button type="button" className="studio-btn" onClick={() => setReload((n) => n + 1)}>
                  Refresh
                </button>
                <button type="button" className="studio-btn primary" onClick={() => onAskClaude(askPrompt(detail, terr))}>
                  Ask Claude how to make this lighter
                </button>
              </div>
            </div>
            <div className="studio-perf-hint">
              {detail.user.profileName} · {detail.user.territories.length} {detail.user.territories.length === 1 ? "territory" : "territories"}
            </div>
            {detail.territories.length > 1 && (
              <label className="sync-investigate-territory">
                <span className="studio-perf-field-label">Territory</span>
                <select
                  className="studio-filter"
                  value={territoryIdx}
                  onChange={(e) => {
                    setTerritoryIdx(Number(e.target.value));
                    setSelected(null);
                  }}
                >
                  {detail.territories.map((t, i) => (
                    <option key={t.territory?.id ?? "none"} value={i}>
                      {t.territory?.name ?? "No territory"} — {fmt(t.totalRecords)} records
                    </option>
                  ))}
                </select>
              </label>
            )}
            {detail.user.territories.length > detail.territories.length && (
              <div className="studio-perf-hint">Showing the first {detail.territories.length} of {detail.user.territories.length} territories.</div>
            )}
            <div className="sync-investigate-stats">
              <div>
                <div className="sync-investigate-stat-value">{fmt(terr.totalRecords)}</div>
                <div className="studio-perf-metric-meta">records to download{terr.upperBoundRecords > 0 ? ` (up to ${fmt(terr.upperBoundRecords)} may be over-counted)` : ""}</div>
              </div>
              <div>
                <div className="sync-investigate-stat-value">{fmt(terr.totalDeviceRequests)}</div>
                <div className="studio-perf-metric-meta">estimated requests</div>
              </div>
              {detail.telemetry && detail.telemetry.summary.samples > 0 && (
                <>
                  <div>
                    <div className="sync-investigate-stat-value">{fmtSec(detail.telemetry.summary.delta.total.p90)}</div>
                    <div className="studio-perf-metric-meta">daily sync, slow end (p90)</div>
                  </div>
                  <div>
                    <div className="sync-investigate-stat-value">{fmtSec(detail.telemetry.summary.initial.total.p90)}</div>
                    <div className="studio-perf-metric-meta">first sync, slow end (p90)</div>
                  </div>
                  <div>
                    <div className="sync-investigate-stat-value">{Math.round(detail.telemetry.summary.failureRatePct ?? 0)}%</div>
                    <div className="studio-perf-metric-meta">syncs failing</div>
                  </div>
                </>
              )}
            </div>
            <div className={`studio-chip ${sync.tone} sync-investigate-verdict`}>{sync.text}</div>
          </section>

          <section className="studio-perf-section" aria-label="Tables">
            <h3 className="studio-perf-section-title">What the iPad downloads, heaviest first</h3>
            {terr.tables.length === 0 ? (
              <div className="studio-perf-hint">No tables sync for this rep. Check that their profile has DB Schema records.</div>
            ) : (
              <ul className="sync-investigate-tables">
                {terr.tables.map((t) => (
                  <li key={t.sobject}>
                    <button
                      type="button"
                      className={`sync-investigate-row${selected === t.sobject ? " selected" : ""}`}
                      aria-pressed={selected === t.sobject}
                      onClick={() => setSelected(selected === t.sobject ? null : t.sobject)}
                    >
                      <span className="sync-investigate-row-name">
                        {t.sobject}
                        {queuedFor(t) && <span className="studio-chip info">Queued</span>}
                        {t.status !== "counted" && <span className={`studio-chip ${t.status === "error" ? "error" : "muted"}`}>{t.status === "error" ? "Filter fails" : "Not estimated"}</span>}
                        {t.hints.some((h) => h.severity === "warning") && t.status === "counted" && <span className="studio-chip warning">Can be lighter</span>}
                      </span>
                      <span className="sync-investigate-row-count">{t.status === "counted" ? `${fmt(t.records)} · ${t.sharePct < 1 && t.records > 0 ? "<1" : Math.round(t.sharePct)}%` : "—"}</span>
                      <span className="studio-perf-bar" aria-hidden="true">
                        <span className="studio-perf-bar-fill sync-investigate-fill" style={{ width: `${(t.records / maxRecords) * 100}%` }} />
                      </span>
                    </button>
                    {selected === t.sobject && selectedTable && (
                      <TableDetail table={selectedTable} pending={pending} onQueue={queue} onOpenSetup={onOpenSetup} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="sync-investigate-details">
            <summary>Details</summary>
            <ul className="studio-perf-hint">
              <li>Table list from {SCHEMA_SOURCE[detail.schemaSource]} ({detail.tableCount} tables).</li>
              {detail.schemaNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {terr.tables
                .filter((t) => t.status === "counted" && (t.note || t.mayOvercount || t.idTag))
                .map((t) => (
                  <li key={t.sobject}>
                    {t.sobject}: {fmt(t.deviceRequests)} requests
                    {t.idTag ? `, matched by ${t.idTag}` : ""}
                    {t.mayOvercount ? `, org-wide count on ${t.sharingModel ?? "unknown"} sharing (upper bound)` : ""}
                    {t.note ? `. ${t.note}` : ""}
                  </li>
                ))}
              {detail.telemetryError && <li>Sync history: {detail.telemetryError}</li>}
              <li>Predicted at {new Date(detail.generatedAt).toLocaleString()}; sync history covers the last {detail.days} days.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
