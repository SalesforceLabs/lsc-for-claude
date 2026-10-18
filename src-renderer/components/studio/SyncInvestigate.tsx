import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SurfaceId, StudioFix } from "./types";
import { isQueued, queueChange, type PendingChange } from "./changes";
import { ExternalLink, RefreshCw, Sparkles, UserRoundSearch } from "lucide-react";
import "./sync-investigate.css";
import { AssistantName } from "../../hooks/useAssistantName";
import StateView from "../ui/StateView";
import StatusIcon from "../ui/StatusIcon";
import UpdatedAgo from "../ui/UpdatedAgo";
import { Callout, Metric } from "./PerfParts";

import { useOrgs } from "../../hooks/useOrgs";
import { useMobileLogins } from "../../hooks/useMobileLogins";
import { testUserName, testUsersFor } from "../../test-users";

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
  status: "counted" | "not-estimated" | "error" | "timed-out";
  records: number;
  sharePct: number;
  deviceRequests: number | null;
  idTag?: string;
  note?: string;
  scope?: "user" | "org-wide";
  sharingModel?: string;
  mayOvercount: boolean;
  lowerBound?: boolean;
  sourceFailed?: boolean;
  schema: SchemaRecordRef | null;
  hints: TableHint[];
}
interface SyncTerritory {
  territory: { id: string; name: string } | null;
  totalRecords: number;
  totalDeviceRequests: number;
  upperBoundRecords: number;
  incompleteCount?: number;
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
    summary: { samples: number; coverage?: { mode: "all" | "sampled"; limit: number; oldest?: string; newest?: string }; failureRatePct?: number; initial: { total: Dist }; delta: { total: Dist } };
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

type Load = { status: "idle" } | { status: "loading" } | { status: "error"; error: string } | { status: "ready"; detail: SyncUserDetail; cachedAt?: string };

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
function notCountedLabel(t: SyncTable): string {
  if (t.status === "error") return "Filter fails";
  if (t.status === "timed-out") return "Timed out";
  return t.sourceFailed ? "Not counted" : "Not estimated";
}
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

function UserPicker({ onPick }: { onPick: (userId: string) => void }) {
  const [search, setSearch] = useState("");
  // The org's test users are offered before anything is typed.
  const { current: currentOrg } = useOrgs();
  const mobile = useMobileLogins();
  const testUsers = testUsersFor(mobile.logins, currentOrg?.orgId);
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
      <label className="ui-label" htmlFor="sync-investigate-search">
        Find a rep
      </label>
      <input
        id="sync-investigate-search"
        className="studio-filter"
        placeholder="Search users by name or username…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {state.error && <Callout tone="error">{state.error}</Callout>}
      {!search.trim() && testUsers.length > 0 && (
        <ul className="studio-picker-list studio-perf-user-list" aria-label="Test users">
          <li className="studio-picker-meta">Test users</li>
          {testUsers.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className="studio-picker-row studio-perf-user-row"
                // Logins made before user Ids were recorded are found by username instead.
                onClick={() => (l.userId ? onPick(l.userId) : setSearch(l.username))}
              >
                <span className="studio-picker-name">
                  {testUserName(l)} {l.displayName && <span className="studio-picker-meta">{l.username}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {search.trim() && !state.error && (
        <ul className="studio-picker-list studio-perf-user-list">
          {state.loading && state.users.length === 0 && <li className="studio-picker-meta" role="status">Searching…</li>}
          {!state.loading && state.users.length === 0 && <li className="studio-picker-meta">No active users match.</li>}
          {state.users.map((u) => (
            <li key={u.id}>
              <button type="button" className="studio-picker-row studio-perf-user-row" onClick={() => onPick(u.id)}>
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
            <ExternalLink size={14} aria-hidden="true" />
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
                <StatusIcon tone={h.severity} size={18} />
                <div className="sync-investigate-hint-body">
                  <div className="sync-investigate-hint-title">{h.title}</div>
                  <div className="studio-perf-hint">{h.detail}</div>
                  {s && schema && (
                    <button
                      type="button"
                      className="studio-btn primary sm"
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
  // Bumped by Refresh to reload the same user, skipping the main process's cache.
  const [reload, setReload] = useState(0);
  const refreshNext = useRef(false);
  const refresh = () => {
    refreshNext.current = true;
    setReload((n) => n + 1);
  };

  useEffect(() => {
    if (!userId) {
      setLoad({ status: "idle" });
      return;
    }
    let stale = false;
    setLoad({ status: "loading" });
    setTerritoryIdx(0);
    setSelected(null);
    const skipCache = refreshNext.current;
    refreshNext.current = false;
    window.lscApi
      .studioSyncUser(userId, WINDOW_DAYS, skipCache)
      .then((res) => {
        if (stale) return;
        const error = errorOf(res);
        setLoad(error ? { status: "error", error } : { status: "ready", detail: res.data as SyncUserDetail, cachedAt: res.cachedAt });
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
      <UserPicker onPick={onUserChange} />

      {load.status === "idle" && (
        <StateView
          layout="inline"
          kind="empty"
          icon={UserRoundSearch}
          title="Pick a rep"
          detail="Pick a test user or search above to see what their iPad downloads and what to change."
        />
      )}

      {load.status === "loading" && (
        <StateView
          layout="inline"
          kind="loading"
          title="Counting what this rep's iPad downloads"
          detail="Table by table. This can take a minute."
        />
      )}

      {load.status === "error" && (
        <StateView
          layout="inline"
          kind="error"
          title="Couldn't read this rep's sync"
          detail={load.error}
          actions={
            <button type="button" className="studio-btn" onClick={refresh}>
              <RefreshCw size={14} aria-hidden="true" />
              Try again
            </button>
          }
        />
      )}

      {detail && terr && sync && (
        <>
          <section className="studio-perf-section" aria-label="Rep summary">
            <div className="sync-investigate-head">
              <h2 className="studio-perf-section-title">
                {detail.user.name} <span className="studio-perf-meta">{detail.user.username}</span>
              </h2>
              <div className="sync-investigate-head-actions">
                <UpdatedAgo at={load.status === "ready" ? load.cachedAt : null} />
                <button type="button" className="studio-btn" onClick={refresh}>
                  <RefreshCw size={14} aria-hidden="true" />
                  Refresh
                </button>
                <button type="button" className="studio-btn primary" onClick={() => onAskClaude(askPrompt(detail, terr))}>
                  <Sparkles size={14} aria-hidden="true" />
                  Ask <AssistantName /> how to make this lighter
                </button>
              </div>
            </div>
            <div className="studio-perf-hint">
              {detail.user.profileName} · {detail.user.territories.length} {detail.user.territories.length === 1 ? "territory" : "territories"}
            </div>
            {detail.territories.length > 1 && (
              <label className="sync-investigate-territory">
                <span className="ui-label">Territory</span>
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
            {(terr.incompleteCount ?? 0) > 0 && (
              <Callout tone="warning">
                {terr.incompleteCount} {terr.incompleteCount === 1 ? "table" : "tables"} could not be counted in full, so the totals below are minimums.
              </Callout>
            )}
            <div className="sync-investigate-stats">
              <Metric
                label="Records to download"
                value={`${(terr.incompleteCount ?? 0) > 0 ? "≥ " : ""}${fmt(terr.totalRecords)}`}
                hint={terr.upperBoundRecords > 0 ? `Up to ${fmt(terr.upperBoundRecords)} may be over-counted` : undefined}
              />
              <Metric label="Estimated requests" value={fmt(terr.totalDeviceRequests)} />
              {detail.telemetry && detail.telemetry.summary.samples > 0 && (
                <>
                  <Metric label="Daily sync, slow end (p90)" value={fmtSec(detail.telemetry.summary.delta.total.p90)} />
                  <Metric label="First sync, slow end (p90)" value={fmtSec(detail.telemetry.summary.initial.total.p90)} />
                  <Metric label="Syncs failing" value={`${Math.round(detail.telemetry.summary.failureRatePct ?? 0)}%`} />
                </>
              )}
            </div>
            <Callout tone={sync.tone === "ok" ? "pass" : sync.tone}>{sync.text}</Callout>
          </section>

          <section className="studio-perf-section" aria-label="Tables">
            <h3 className="ui-section-title">What the iPad downloads, heaviest first</h3>
            {terr.tables.length === 0 ? (
              <StateView
                layout="inline"
                kind="empty"
                title="No tables sync for this rep"
                detail="Check that their profile has DB Schema records."
                className="sync-overview-empty"
              />
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
                        {queuedFor(t) && <span className="ui-pill info">Queued</span>}
                        {t.status !== "counted" && <span className={`ui-pill${t.status === "error" || t.status === "timed-out" ? " error" : ""}`}>{notCountedLabel(t)}</span>}
                        {t.status === "counted" && t.lowerBound && <span className="ui-pill warning">At least</span>}
                        {t.hints.some((h) => h.severity === "warning") && t.status === "counted" && <span className="ui-pill warning">Can be lighter</span>}
                      </span>
                      <span className="sync-investigate-row-count">{t.status === "counted" ? `${t.lowerBound ? "≥ " : ""}${fmt(t.records)} · ${t.sharePct < 1 && t.records > 0 ? "<1" : Math.round(t.sharePct)}%` : "—"}</span>
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
              {detail.telemetry?.summary.coverage?.mode === "sampled" && (
                <li>
                  Sync history is a sample: more than {fmt(detail.telemetry.summary.coverage.limit)} syncs matched
                  {detail.telemetry.summary.coverage.oldest ? `, so it reads syncs back to ${detail.telemetry.summary.coverage.oldest.slice(0, 10)}` : ""}.
                </li>
              )}
              <li>Predicted at {new Date(detail.generatedAt).toLocaleString()}; sync history covers the last {detail.days} days.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
