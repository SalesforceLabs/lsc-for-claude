import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SurfaceId, StudioFix } from "./types";
import { isQueued, queueChange, type PendingChange } from "./changes";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Plus, RefreshCw, Sparkles } from "lucide-react";
import "./rep-sync-detail.css";
import { AssistantName } from "../../hooks/useAssistantName";
import StateView from "../ui/StateView";
import StatusIcon from "../ui/StatusIcon";
import Spinner from "../ui/Spinner";
import UpdatedAgo from "../ui/UpdatedAgo";
import { Limited } from "../ui/Limited";
import { Bar, Callout, Metric } from "./PerfParts";

/**
 * One rep's mobile sync, in plain language: what their iPad downloads (heaviest tables first, with why and a
 * safe fix), how their real syncs have gone, and how that compares with the org. Opened from Sync health;
 * `onBack` draws the breadcrumb back to it. Data: `studio_sync_user` (src/studio/sync-user.ts).
 */
export interface RepSyncDetailProps {
  userId: string;
  /** Typical (median) sync times across the org, to say whether this rep is slower than most. */
  orgTypical?: { deltaSec?: number; initialSec?: number };
  /** Draws "Sync health › Name" and calls this on the first crumb. */
  onBack?: () => void;
  backLabel?: string;
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
interface RecentSync {
  id: string;
  createdDate: string;
  kind: "initial" | "delta";
  outcome: "completed" | "failed" | "cancelled" | "stopped-early" | string;
  totalSec?: number;
  downloadedRecords?: number;
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
    recent: RecentSync[];
  };
  telemetryError?: string;
}
/** Renderer copy of SyncUserProgress (src/studio/sync-user.ts). */
interface Progress {
  startedAt: number;
  phase: "reading" | "counting" | "finishing" | "done" | "failed";
  tablesDone: number;
  tablesTotal: number;
  territories: Array<{ name: string | null; done: number; total: number; state: "waiting" | "running" | "done" }>;
}

type Load = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; detail: SyncUserDetail; cachedAt?: string };

const WINDOW_DAYS = 30;
/** Tables drawn before "Show more": the rest of a 100-table list is rarely what makes a sync heavy. */
const TOP_TABLES = 10;
const PROGRESS_POLL_MS = 700;
/** A sync history is only worth drawing as bars once there are a few. */
const FAILURE_PCT = 5;
const SLOW_DELTA_SEC = 120;
/** At least this many times the org's median to call a rep slower than most. */
const SLOWER_RATIO = 1.5;
const MUCH_SLOWER_RATIO = 2;
const TOP_TABLES_IN_PROMPT = 5;
const STRIP_HEIGHT = 40;

const SCHEMA_SOURCE: Record<SyncUserDetail["schemaSource"], string> = {
  "user-download": "the rep's own metadata download",
  compiled: "the profile's compiled metadata schema",
  "db-schema": "DB Schema records",
};

const fmt = (n: number | undefined | null) => (n === undefined || n === null ? "—" : n.toLocaleString("en-US"));
const fmtSec = (n: number | undefined) => (n === undefined ? "—" : n < 90 ? `${Math.round(n)} s` : `${(n / 60).toFixed(1)} min`);
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const errorOf = (res: { data?: unknown; error?: string }) => res.error || (res.data as { error?: string } | undefined)?.error;

function notCountedLabel(t: SyncTable): string {
  if (t.status === "error") return "Filter fails";
  if (t.status === "timed-out") return "Timed out";
  return t.sourceFailed ? "Not counted" : "Not estimated";
}

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

/** How the rep's real syncs compare with the org's, in words. */
function comparison(detail: SyncUserDetail, orgTypical: RepSyncDetailProps["orgTypical"]): { ratio?: number; text: string } | null {
  const mine = detail.telemetry?.summary.delta.total.p50;
  const org = orgTypical?.deltaSec;
  if (mine === undefined || org === undefined || org <= 0) return null;
  const ratio = mine / org;
  if (ratio >= SLOWER_RATIO) return { ratio, text: `Their typical daily sync takes ${fmtSec(mine)}, ${ratio.toFixed(1)} times the org median of ${fmtSec(org)}.` };
  if (ratio <= 1 / SLOWER_RATIO) return { ratio, text: `Their typical daily sync takes ${fmtSec(mine)}, faster than the org median of ${fmtSec(org)}.` };
  return { ratio, text: `Their typical daily sync takes ${fmtSec(mine)}, about the same as the org median of ${fmtSec(org)}.` };
}

/** A plain-language read of how the rep's real syncs are going, versus the org when we know it. */
function verdict(detail: SyncUserDetail, cmp: ReturnType<typeof comparison>): { tone: "pass" | "warning" | "info"; title: string; detail?: string } {
  const t = detail.telemetry;
  if (!t) return { tone: "info", title: detail.telemetryError ? "Sync history couldn't be read" : "No sync history", detail: detail.telemetryError };
  if (t.summary.samples === 0) {
    return { tone: "info", title: `No syncs in the last ${detail.days} days`, detail: "Nothing has been measured for this rep, so the figures below are predictions only." };
  }
  const problems: string[] = [];
  if ((t.summary.failureRatePct ?? 0) > FAILURE_PCT) problems.push(`${Math.round(t.summary.failureRatePct ?? 0)}% of their syncs fail`);
  if ((t.summary.delta.total.p90 ?? 0) > SLOW_DELTA_SEC) problems.push(`their slowest daily syncs take ${fmtSec(t.summary.delta.total.p90)}`);
  if (cmp?.ratio !== undefined && cmp.ratio >= MUCH_SLOWER_RATIO && !problems.length) problems.push("they sync much slower than most reps");
  return problems.length
    ? { tone: "warning", title: `This rep is struggling: ${problems.join(" and ")}`, detail: cmp?.text }
    : { tone: "pass", title: "This rep's syncs look healthy", detail: cmp?.text };
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

// ── Loading: progress when the server can say, a skeleton otherwise ──

function CountingProgress({ progress }: { progress: Progress | null }) {
  const counting = progress && progress.tablesTotal > 0;
  const territories = progress?.territories ?? [];
  return (
    <div className="rep-sync-loading">
      <StateView
        layout="inline"
        kind="loading"
        title="Counting what this rep's iPad downloads"
        detail={
          counting
            ? `${fmt(progress.tablesDone)} of ${fmt(progress.tablesTotal)} tables counted${progress.phase === "finishing" ? ", checking who can see them…" : "…"}`
            : "Finding their sync settings and territories…"
        }
      />
      {counting && <Bar value={progress.tablesDone} max={progress.tablesTotal} label="Tables counted" />}
      {territories.length > 1 && (
        <ul className="rep-sync-territory-progress" aria-label="Territories">
          {territories.map((t, i) => (
            <li key={`${t.name ?? "none"}-${i}`}>
              {t.state === "done" ? <StatusIcon tone="pass" size={16} /> : t.state === "running" ? <Spinner size={14} /> : <span className="rep-sync-wait" aria-hidden="true" />}
              <span className="rep-sync-territory-name">{t.name ?? "No territory"}</span>
              <span className="ui-num rep-sync-muted">{t.state === "waiting" ? "Waiting" : `${fmt(t.done)} of ${fmt(t.total)}`}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="rep-sync-skeleton" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="ui-skeleton rep-sync-skeleton-row" />
        ))}
      </div>
    </div>
  );
}

// ── Recent syncs strip ──

function RecentSyncs({ detail }: { detail: SyncUserDetail }) {
  const t = detail.telemetry;
  if (!t || t.summary.samples === 0) return null;
  const recent = [...t.recent].reverse();
  const max = Math.max(1, ...recent.map((s) => s.totalSec ?? 0));
  const failed = recent.filter((s) => s.outcome === "failed").length;
  const slowest = recent.reduce<RecentSync | null>((a, s) => ((s.totalSec ?? 0) > (a?.totalSec ?? -1) ? s : a), null);
  return (
    <section className="rep-sync-section" aria-label="Recent syncs">
      <h3 className="ui-section-title">
        Recent syncs<span className="count">{recent.length}</span>
      </h3>
      <div className="rep-sync-strip">
        <ul className="rep-sync-bars" aria-label="Sync time per sync, oldest to newest">
          {recent.map((s) => {
            const tone = s.outcome === "failed" ? "error" : s.outcome === "completed" ? "ok" : "warning";
            const what = `${s.kind === "initial" ? "First sync" : "Daily sync"}, ${new Date(s.createdDate).toLocaleDateString()}: ${fmtSec(s.totalSec)}${s.downloadedRecords !== undefined ? `, ${fmt(s.downloadedRecords)} records` : ""}${s.outcome === "completed" ? "" : `, ${s.outcome.replace("-", " ")}`}`;
            return (
              <li key={s.id} className={`rep-sync-bar ${tone}${s.kind === "initial" ? " initial" : ""}`} title={what} aria-label={what}>
                <span style={{ height: Math.max(4, ((s.totalSec ?? 0) / max) * STRIP_HEIGHT) }} />
              </li>
            );
          })}
        </ul>
        <p className="rep-sync-strip-text">
          {failed > 0 ? `${failed} of the last ${recent.length} failed. ` : `All of the last ${recent.length} finished. `}
          {slowest?.totalSec !== undefined && `Slowest took ${fmtSec(slowest.totalSec)}.`}
          <span className="rep-sync-muted"> Oldest to newest; taller is slower.</span>
        </p>
      </div>
    </section>
  );
}

// ── Tables ──

interface TableRowProps {
  table: SyncTable;
  maxRecords: number;
  pending: PendingChange[];
  expanded: boolean;
  onToggle: () => void;
  onQueue: (schema: SchemaRecordRef, hint: HintSuggestion) => void;
  onOpenSetup: RepSyncDetailProps["onOpenSetup"];
}

function TableRow({ table, maxRecords, pending, expanded, onToggle, onQueue, onOpenSetup }: TableRowProps) {
  const schema = table.schema;
  const f = schema?.fields;
  const counted = table.status === "counted";
  // Warnings first; "nothing stands out" hints would only repeat down a long list.
  const hints = [...table.hints].sort((a, b) => Number(b.severity !== "info") - Number(a.severity !== "info"));
  const share = table.sharePct < 1 && table.records > 0 ? "<1%" : `${Math.round(table.sharePct)}%`;
  return (
    <li className="rep-sync-table">
      <div className="rep-sync-table-main">
        <span className="rep-sync-table-name">
          {table.sobject}
          {!counted && <span className={`ui-pill${table.status === "error" || table.status === "timed-out" ? " error" : ""}`}>{notCountedLabel(table)}</span>}
          {counted && table.lowerBound && <span className="ui-pill warning">At least</span>}
        </span>
        <span className="rep-sync-table-count ui-num">{counted ? `${table.lowerBound ? "≥ " : ""}${fmt(table.records)}` : "—"}</span>
        <span className="rep-sync-table-share ui-num">{counted ? share : ""}</span>
      </div>
      <Bar value={counted ? table.records : 0} max={maxRecords} label={`${table.sobject} share of the largest table`} />
      {hints.map((h) => {
        const s = h.suggestion;
        const fix = schema && s ? suggestionFix(schema, s) : null;
        const queued = fix ? isQueued(pending, fix) : false;
        return (
          <div key={h.id} className="rep-sync-hint">
            <StatusIcon tone={h.severity} size={16} />
            <p className="rep-sync-hint-text">
              <strong>{h.title}.</strong> {h.detail}
            </p>
            {s && schema && (
              <button
                type="button"
                className={`studio-btn sm${queued ? "" : " primary"}`}
                disabled={queued}
                onClick={() => onQueue(schema, s)}
                title={queued ? "Waiting in the tray to be reviewed and applied" : `${s.label} (added to the tray, not applied yet)`}
              >
                {queued ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                {queued ? "In tray" : s.label}
              </button>
            )}
          </div>
        );
      })}
      <button type="button" className="studio-link-btn rep-sync-more" aria-expanded={expanded} onClick={onToggle}>
        <ChevronRight size={12} aria-hidden="true" className={`rep-sync-chevron${expanded ? " open" : ""}`} />
        {expanded ? "Hide sync settings" : "Sync settings"}
      </button>
      {expanded && (
        <div className="rep-sync-settings">
          {schema && f ? (
            <>
              <dl className="rep-sync-props">
                <dt>Setting record</dt>
                <dd>{schema.developerName}</dd>
                <dt>Filter</dt>
                <dd>{f.WhereSoql ? <code>{f.WhereSoql}</code> : "None. Every record the rep can access."}</dd>
                <dt>One-way sync</dt>
                <dd>{f.OneWaySync ? "Yes" : "No"}</dd>
                <dt>Attachments</dt>
                <dd>{f.AttachmentsSupport || "Off"}</dd>
                <dt>Delta date field</dt>
                <dd>{f.DeltaDateField || "None"}</dd>
              </dl>
              <button type="button" className="studio-btn sm" onClick={() => onOpenSetup("mobile-sync", "syncedObjects", schema.itemId)}>
                <ExternalLink size={14} aria-hidden="true" />
                Open in Setup
              </button>
            </>
          ) : (
            <p className="rep-sync-muted">
              No setting record of this rep's profile controls this table. It may come only from the profile's compiled schema, or belong to another profile.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export default function RepSyncDetail({ userId, orgTypical, onBack, backLabel = "Sync health", onAskClaude, onOpenSetup, pending, onPendingChange }: RepSyncDetailProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [territoryIdx, setTerritoryIdx] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Bumped by Refresh to reload the same rep, skipping the main process's cache.
  const [reload, setReload] = useState(0);
  const refreshNext = useRef(false);
  const refresh = () => {
    refreshNext.current = true;
    setReload((n) => n + 1);
  };

  useEffect(() => {
    let stale = false;
    setLoad({ status: "loading" });
    setProgress(null);
    setTerritoryIdx(0);
    setExpanded(new Set());
    const skipCache = refreshNext.current;
    refreshNext.current = false;
    const requestedAt = Date.now();
    let timer: ReturnType<typeof setInterval> | undefined;
    window.lscApi
      .studioSyncUser(userId, WINDOW_DAYS, skipCache)
      .then((res) => {
        clearInterval(timer);
        if (stale) return;
        const error = errorOf(res);
        setLoad(error ? { status: "error", error } : { status: "ready", detail: res.data as SyncUserDetail, cachedAt: res.cachedAt });
      })
      .catch((e) => {
        clearInterval(timer);
        if (!stale) setLoad({ status: "error", error: e instanceof Error ? e.message : String(e) });
      });
    // The server counts table by table and can say where it is; a cached answer returns before the first poll.
    // Polling stops when the load settles (this view stays mounted, hidden, inside Sync health).
    timer = setInterval(async () => {
      try {
        const res = await window.lscApi.studioSyncUserProgress(userId);
        const p = (res.data as { progress?: Progress | null } | undefined)?.progress;
        // An entry from an earlier load of the same rep doesn't count.
        if (!stale && p && p.startedAt >= requestedAt - 2000) setProgress(p);
      } catch {
        /* progress is a nicety; the load itself reports errors */
      }
    }, PROGRESS_POLL_MS);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [userId, reload]);

  const queue = useCallback(
    (schema: SchemaRecordRef, s: HintSuggestion) => {
      const affects = schema.profiles.length ? schema.profiles : undefined;
      onPendingChange(queueChange(pending, { fix: suggestionFix(schema, s), affects }));
    },
    [pending, onPendingChange]
  );
  const toggle = (name: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  const detail = load.status === "ready" ? load.detail : null;
  const terr = detail?.territories[Math.min(territoryIdx, (detail?.territories.length ?? 1) - 1)];
  const maxRecords = Math.max(1, ...(terr?.tables.map((t) => t.records) ?? [0]));
  const cmp = detail ? comparison(detail, orgTypical) : null;
  const sync = detail ? verdict(detail, cmp) : null;
  const incomplete = (terr?.incompleteCount ?? 0) > 0;

  return (
    <div className="rep-sync ui-enter" key={userId}>
      <div className="rep-sync-bar-top">
        {onBack ? (
          <nav className="rep-sync-crumbs" aria-label="Breadcrumb">
            <button type="button" className="studio-link-btn" onClick={onBack}>
              <ChevronLeft size={14} aria-hidden="true" />
              {backLabel}
            </button>
            <ChevronRight size={14} aria-hidden="true" className="rep-sync-muted" />
            <span aria-current="page" className="rep-sync-crumb-current">
              {detail?.user.name ?? "This rep"}
            </span>
          </nav>
        ) : (
          <span className="rep-sync-crumb-current">{detail?.user.name ?? "This rep"}</span>
        )}
        <span className="rep-sync-spacer" />
        {load.status === "ready" && <UpdatedAgo at={load.cachedAt} />}
        <button type="button" className="studio-btn" disabled={load.status === "loading"} onClick={refresh}>
          {load.status === "loading" ? <Spinner size={14} /> : <RefreshCw size={14} aria-hidden="true" />}
          {load.status === "loading" ? "Counting…" : "Refresh"}
        </button>
        {detail && terr && (
          <button type="button" className="studio-btn" onClick={() => onAskClaude(askPrompt(detail, terr))}>
            <Sparkles size={14} aria-hidden="true" />
            Ask <AssistantName />
          </button>
        )}
      </div>

      {load.status === "loading" && <CountingProgress progress={progress} />}

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
          <header className="rep-sync-head">
            <h2 className="rep-sync-name">
              {detail.user.name} <span className="rep-sync-muted">{detail.user.username}</span>
            </h2>
            <p className="rep-sync-sub">
              {detail.user.profileName} · {plural(detail.user.territories.length, "territory", "territories")}
            </p>
          </header>

          <Callout tone={sync.tone} title={sync.title}>
            <div className="studio-perf-hint">
              {incomplete ? "At least " : "About "}
              {plural(terr.totalRecords, "record")} from {plural(terr.tables.filter((t) => t.status === "counted").length, "table")} download to their iPad
              {terr.territory ? ` in ${terr.territory.name}` : ""}.
              {sync.detail ? ` ${sync.detail}` : ""}
            </div>
          </Callout>

          <div className="studio-metrics">
            <Metric label="Records to download" value={`${incomplete ? "≥ " : ""}${fmt(terr.totalRecords)}`} hint={terr.upperBoundRecords > 0 ? `Up to ${fmt(terr.upperBoundRecords)} may be over-counted` : undefined} />
            <Metric label="Estimated requests" value={fmt(terr.totalDeviceRequests)} />
            {detail.telemetry && detail.telemetry.summary.samples > 0 && (
              <>
                <Metric
                  label="Typical daily sync"
                  value={fmtSec(detail.telemetry.summary.delta.total.p50)}
                  hint={orgTypical?.deltaSec !== undefined ? `Org median ${fmtSec(orgTypical.deltaSec)}` : `Slow end ${fmtSec(detail.telemetry.summary.delta.total.p90)}`}
                />
                <Metric
                  label="Syncs that failed"
                  value={`${Math.round(detail.telemetry.summary.failureRatePct ?? 0)}%`}
                  tone={(detail.telemetry.summary.failureRatePct ?? 0) > FAILURE_PCT ? "warning" : undefined}
                  hint={plural(detail.telemetry.summary.samples, "sync")}
                />
              </>
            )}
          </div>

          <RecentSyncs detail={detail} />

          {incomplete && (
            <Callout tone="warning">
              {plural(terr.incompleteCount ?? 0, "table")} could not be counted in full, so the totals are minimums.
            </Callout>
          )}

          <section className="rep-sync-section" aria-label="Tables">
            <div className="rep-sync-section-head">
              <h3 className="ui-section-title">
                What the iPad downloads, heaviest first<span className="count">{terr.tables.length}</span>
              </h3>
              {detail.territories.length > 1 && (
                <label className="rep-sync-territory">
                  <span className="ui-label">Territory</span>
                  <select
                    className="studio-select"
                    value={territoryIdx}
                    onChange={(e) => {
                      setTerritoryIdx(Number(e.target.value));
                      setExpanded(new Set());
                    }}
                  >
                    {detail.territories.map((t, i) => (
                      <option key={t.territory?.id ?? "none"} value={i}>
                        {t.territory?.name ?? "No territory"} ({fmt(t.totalRecords)} records)
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {detail.user.territories.length > detail.territories.length && (
              <p className="rep-sync-muted">
                Showing the {detail.territories.length} largest of {detail.user.territories.length} territories.
              </p>
            )}
            {terr.tables.length === 0 ? (
              <StateView layout="inline" kind="empty" title="No tables sync for this rep" detail="Check that their profile has sync settings in Mobile Sync setup." />
            ) : (
              <ul className="rep-sync-tables" key={terr.territory?.id ?? "none"}>
                <Limited
                  as="li"
                  items={terr.tables}
                  limit={TOP_TABLES}
                  render={(t) => (
                    <TableRow
                      key={t.sobject}
                      table={t}
                      maxRecords={maxRecords}
                      pending={pending}
                      expanded={expanded.has(t.sobject)}
                      onToggle={() => toggle(t.sobject)}
                      onQueue={queue}
                      onOpenSetup={onOpenSetup}
                    />
                  )}
                />
              </ul>
            )}
          </section>

          <details className="rep-sync-details">
            <summary>How this was worked out</summary>
            <ul className="studio-perf-hint">
              <li>Table list from {SCHEMA_SOURCE[detail.schemaSource]} ({plural(detail.tableCount, "table")}).</li>
              {detail.schemaNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {terr.tables
                .filter((t) => t.status === "counted" && (t.note || t.mayOvercount || t.idTag))
                .map((t) => (
                  <li key={t.sobject}>
                    {t.sobject}: {plural(t.deviceRequests ?? 0, "request")}
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
