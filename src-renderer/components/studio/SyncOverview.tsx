import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SurfaceId } from "./types";
import { formatNumber } from "./perf-plan";
import { formatSeconds } from "./sim-types";
import { Activity, ExternalLink, Play, RefreshCw, Sparkles, UserRoundSearch } from "lucide-react";
import "./sync-overview.css";
import { AssistantName } from "../../hooks/useAssistantName";
import Segmented from "../ui/Segmented";
import Spinner from "../ui/Spinner";
import StateView from "../ui/StateView";
import { Callout, Disclosure as DisclosureButton, Metric } from "./PerfParts";

export interface SyncOverviewProps {
  onAskClaude: (prompt: string) => void;
  onOpenSetup: (featureId: string, surface?: SurfaceId | null, item?: string | null) => void;
  /** Open a user in Investigate. */
  onInvestigateUser: (userId: string) => void;
  /** Start a Sign-off test plan with these users. */
  onTestUsers: (userIds: string[]) => void;
}

interface Distribution {
  n: number;
  p50?: number;
  p90?: number;
  p95?: number;
  max?: number;
}

interface Telemetry {
  samples: number;
  outcomes: Record<string, number>;
  failureRatePct?: number;
  initial: { total: Distribution };
  delta: { total: Distribution };
  dbSizeGb: Distribution;
  byNetwork: Array<{ key: string; n: number; deltaP95?: number }>;
  byAppVersion: Array<{ key: string; n: number; deltaP95?: number; failureRatePct: number }>;
}

interface DailyPoint {
  day: string;
  syncs: number;
  failures: number;
  initialP90?: number;
  deltaP90?: number;
}

interface AtRiskUser {
  username: string;
  userId: string | null;
  name: string;
  profile: string;
  territories: number;
  score: number;
  reasons: string[];
  syncs: number;
  failedSyncs: number;
  deltaP90Sec?: number;
  initialP90Sec?: number;
}

interface SchemaRisk {
  developerName: string;
  sobject: string;
  itemId: string;
  severity: "warning" | "info";
  title: string;
  detail: string;
}

type Status = "healthy" | "struggling" | "failing" | "no-data";

interface OverviewData {
  days: number;
  totals?: { syncs: number; failed: number; failureRatePct?: number } | null;
  rowsCoverage?: { rows: number; from: string | null; truncated: boolean } | null;
  telemetry: Telemetry | null;
  verdict: { status: Status; headline: string } | null;
  reps: number;
  needAttention: number;
  daily: DailyPoint[];
  usersAtRisk: AtRiskUser[];
  schemaRisks: SchemaRisk[];
  notes: string[];
}

const WINDOWS = [7, 30, 90];
const BANNER_TONE: Record<Status, "pass" | "warning" | "error" | "info"> = { healthy: "pass", struggling: "warning", failing: "error", "no-data": "info" };
/** Reps pre-selected for "Test these reps". */
const DEFAULT_TEST_COUNT = 3;
const SPARK_W = 360;
const SPARK_H = 56;

const seconds = (v: number | undefined) => (v === undefined ? "—" : formatSeconds(v));

/** Bars of one value per day; the title carries the exact numbers. */
function Trend({ daily, pick, label }: { daily: DailyPoint[]; pick: (d: DailyPoint) => number | undefined; label: string }) {
  const values = daily.map(pick);
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const bar = SPARK_W / Math.max(1, daily.length);
  return (
    <figure className="sync-overview-trend">
      <figcaption className="studio-perf-meta">{label}</figcaption>
      <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} role="img" aria-label={`${label}, by day`} preserveAspectRatio="none">
        {daily.map((d, i) => {
          const v = values[i];
          const h = v === undefined ? 0 : Math.max(2, (v / max) * (SPARK_H - 4));
          return (
            <rect key={d.day} x={i * bar + bar * 0.15} y={SPARK_H - h} width={bar * 0.7} height={h} rx={1}>
              <title>{`${d.day}: ${v === undefined ? "no data" : formatNumber(v)}`}</title>
            </rect>
          );
        })}
      </svg>
    </figure>
  );
}

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sync-overview-section">
      <DisclosureButton open={open} onToggle={() => setOpen(!open)}>
        {title}
      </DisclosureButton>
      {open && children}
    </div>
  );
}

export function askPrompt(data: OverviewData): string {
  const t = data.telemetry;
  const lines = [
    `Mobile sync health for the last ${data.days} days: ${data.verdict?.headline ?? "no data"}.`,
    t
      ? `${data.reps} reps synced; delta sync p95 ${seconds(t.delta.total.p95)}, first sync p95 ${seconds(t.initial.total.p95)}, failure rate ${
          t.failureRatePct === undefined ? "unknown" : `${formatNumber(t.failureRatePct)}%`
        }.`
      : "There is no field sync data.",
  ];
  const worst = data.usersAtRisk.slice(0, 5);
  if (worst.length) {
    lines.push("Reps who need attention:", ...worst.map((u) => `- ${u.name} (${u.profile || "no profile"}): ${u.reasons.join("; ")}`));
  }
  const risks = data.schemaRisks.slice(0, 5);
  if (risks.length) lines.push("Sync settings worth a look:", ...risks.map((r) => `- ${r.title} (${r.developerName})`));
  lines.push("What is most likely causing this, and what should I change first?");
  return lines.join("\n");
}

export default function SyncOverview({ onAskClaude, onOpenSetup, onInvestigateUser, onTestUsers }: SyncOverviewProps) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Only the newest request may update the screen, so a slow 90-day answer can't replace a 7-day one.
  const latest = useRef(0);

  const load = useCallback(async (span: number) => {
    const request = ++latest.current;
    setLoading(true);
    setError(null);
    let res: Awaited<ReturnType<typeof window.lscApi.studioSyncOverview>>;
    try {
      res = await window.lscApi.studioSyncOverview(span);
    } catch (e) {
      if (request === latest.current) {
        setError((e as Error).message || "Couldn't load sync health.");
        setLoading(false);
      }
      return;
    }
    if (request !== latest.current) return;
    setLoading(false);
    if (res.error || !res.data) {
      setError(res.error || "Couldn't load sync health.");
      return;
    }
    const next = res.data as OverviewData;
    setData(next);
    setSelected(
      new Set(
        next.usersAtRisk
          .filter((u) => u.userId)
          .slice(0, DEFAULT_TEST_COUNT)
          .map((u) => u.userId as string)
      )
    );
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const t = data?.telemetry ?? null;
  const testable = useMemo(() => (data?.usersAtRisk ?? []).filter((u) => u.userId), [data]);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="sync-overview">
      <div className="sync-overview-toolbar">
        <Segmented
          aria-label="Time window"
          size="sm"
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
          options={WINDOWS.map((d) => ({ value: String(d), label: `${d} days` }))}
        />
        <span className="sync-overview-toolbar-spacer" />
        <button type="button" className="studio-btn" disabled={loading} onClick={() => void load(days)}>
          {loading ? <Spinner size={14} /> : <RefreshCw size={14} aria-hidden="true" />}
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        {data && (
          <button type="button" className="studio-btn" onClick={() => onAskClaude(askPrompt(data))}>
            <Sparkles size={14} aria-hidden="true" />
            Ask <AssistantName />
          </button>
        )}
      </div>

      {loading && !data && <StateView layout="inline" kind="loading" title="Reading sync data from the org…" />}
      {error && !data && (
        <StateView
          layout="inline"
          kind="error"
          title="Couldn't load sync health"
          detail={error}
          actions={
            <button type="button" className="studio-btn" onClick={() => void load(days)}>
              <RefreshCw size={14} aria-hidden="true" />
              Try again
            </button>
          }
        />
      )}
      {error && data && <Callout tone="error">{error}</Callout>}

      {data && (
        <div className="sync-overview-body" aria-busy={loading}>
          {data.verdict && (
            <Callout tone={BANNER_TONE[data.verdict.status]} title={data.verdict.headline}>
              {t && data.needAttention > 0 && (
                <div>
                  {data.needAttention} of {data.reps} reps need attention.
                </div>
              )}
              <div className="studio-perf-hint">
                Judged against Studio's rules of thumb (failures: warn at 2%, fail at 10%; metadata download p95: warn at 5 s, fail at 10 s), not the
                customer's targets — set those in Sign-off.
              </div>
            </Callout>
          )}

          {!t && (
            <StateView
              layout="inline"
              kind="empty"
              icon={Activity}
              title="No sync data for this window"
              detail="Sync health comes from DeviceSyncSummary, a record each rep's iPad writes to Salesforce after every sync. It holds how long the sync took, how many records came down and whether it finished. Nothing has been recorded for this window yet."
            />
          )}

          {t && (
            <>
              {data.rowsCoverage?.truncated && (
                <Callout tone="warning" role="note">
                  This window has too many syncs to read in full. Sync times and the rep list cover only the most recent part
                  {data.rowsCoverage.from ? `, from ${data.rowsCoverage.from} on` : ""}. Failure totals and the daily trend cover the whole window.
                </Callout>
              )}
              <div className="studio-metrics">
                <Metric label="Typical slow update" value={seconds(t.delta.total.p95)} hint="Delta sync, 19 in 20 are faster" />
                <Metric label="Typical slow first sync" value={seconds(t.initial.total.p95)} hint="19 in 20 are faster" />
                <Metric label="Syncs that failed" value={t.failureRatePct === undefined ? "—" : `${formatNumber(t.failureRatePct)}%`} />
                <Metric label="Device database size" value={t.dbSizeGb.p95 === undefined ? "—" : `${formatNumber(t.dbSizeGb.p95, 2)} GB`} hint="19 in 20 are smaller" />
                <Metric label="Reps who synced" value={formatNumber(data.reps)} hint={`${formatNumber(data.totals?.syncs ?? t.samples)} syncs`} />
              </div>

              {data.daily.length > 1 && (
                <div className="sync-overview-section">
                  <h3 className="ui-section-title">Trend</h3>
                  <div className="sync-overview-trends">
                    <Trend daily={data.daily} pick={(d) => d.deltaP90} label="Update sync time, seconds (slowest 10%)" />
                    <Trend daily={data.daily} pick={(d) => d.failures} label="Failed syncs per day" />
                    <Trend daily={data.daily} pick={(d) => d.syncs} label="Syncs per day" />
                  </div>
                </div>
              )}

              <div className="sync-overview-section">
                <div className="sync-overview-section-head">
                  <h3 className="ui-section-title">
                    Reps who need attention
                    {data.usersAtRisk.length > 0 && <span className="count">{data.usersAtRisk.length}</span>}
                  </h3>
                  {testable.length > 0 && (
                    <button type="button" className="studio-btn" disabled={selected.size === 0} onClick={() => onTestUsers([...selected])}>
                      <Play size={14} aria-hidden="true" />
                      Test these reps ({selected.size})
                    </button>
                  )}
                </div>
                {data.usersAtRisk.length === 0 ? (
                  <StateView
                    layout="inline"
                    kind="empty"
                    icon={Activity}
                    title="No rep stands out"
                    detail="Every rep's syncs are in line with the rest of the org."
                    className="sync-overview-empty"
                  />
                ) : (
                  <table className="studio-perf-table sync-overview-table">
                    <thead>
                      <tr>
                        <th aria-label="Select" />
                        <th>Rep</th>
                        <th>Profile</th>
                        <th className="num">Territories</th>
                        <th className="num">Update sync</th>
                        <th className="num">Failed</th>
                        <th>Why</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.usersAtRisk.map((u) => (
                        <tr key={u.username}>
                          <td className="check">
                            {u.userId && (
                              <input
                                type="checkbox"
                                aria-label={`Select ${u.name}`}
                                checked={selected.has(u.userId)}
                                onChange={() => toggle(u.userId as string)}
                              />
                            )}
                          </td>
                          <td>
                            {u.name}
                            <div className="studio-perf-meta">{u.username}</div>
                          </td>
                          <td className="meta">{u.profile || "—"}</td>
                          <td className="num">{u.territories}</td>
                          <td className="num">{seconds(u.deltaP90Sec)}</td>
                          <td className="num">
                            {u.failedSyncs} of {u.syncs}
                          </td>
                          <td>
                            <ul className="sync-overview-reasons">
                              {u.reasons.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                          </td>
                          <td>
                            {u.userId && (
                              <button type="button" className="studio-btn sm" onClick={() => onInvestigateUser(u.userId as string)}>
                                <UserRoundSearch size={14} aria-hidden="true" />
                                Investigate
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {data.schemaRisks.length > 0 && (
            <div className="sync-overview-section">
              <h3 className="ui-section-title">
                Sync settings worth a look
                <span className="count">{data.schemaRisks.length}</span>
              </h3>
              <div className="sync-overview-risks">
                {data.schemaRisks.slice(0, 12).map((r) => (
                  <Callout
                    key={`${r.developerName}:${r.title}`}
                    tone={r.severity}
                    title={r.title}
                    actions={
                      <button type="button" className="studio-btn" onClick={() => onOpenSetup("mobile-sync", "syncedObjects", r.itemId)}>
                        <ExternalLink size={14} aria-hidden="true" />
                        Open in Setup
                      </button>
                    }
                  >
                    <div className="studio-perf-hint">{r.detail}</div>
                  </Callout>
                ))}
                {data.schemaRisks.length > 12 && <div className="studio-perf-hint">and {data.schemaRisks.length - 12} more in Mobile Sync setup.</div>}
              </div>
            </div>
          )}

          {t && t.byAppVersion.length > 0 && (
            <Disclosure title="By app version">
              <table className="studio-perf-table">
                <thead>
                  <tr>
                    <th>App version</th>
                    <th className="num">Syncs</th>
                    <th className="num">Slow update syncs</th>
                    <th className="num">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {t.byAppVersion.map((v) => (
                    <tr key={v.key}>
                      <td>{v.key}</td>
                      <td className="num">{formatNumber(v.n)}</td>
                      <td className="num">{seconds(v.deltaP95)}</td>
                      <td className="num">{formatNumber(v.failureRatePct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Disclosure>
          )}
          {t && t.byNetwork.length > 0 && (
            <Disclosure title="By network">
              <table className="studio-perf-table">
                <thead>
                  <tr>
                    <th>Network</th>
                    <th className="num">Syncs</th>
                    <th className="num">Slow update syncs</th>
                  </tr>
                </thead>
                <tbody>
                  {t.byNetwork.map((v) => (
                    <tr key={v.key}>
                      <td>{v.key}</td>
                      <td className="num">{formatNumber(v.n)}</td>
                      <td className="num">{seconds(v.deltaP95)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Disclosure>
          )}

          {data.notes.length > 0 && (
            <ul className="studio-perf-hint sync-overview-notes">
              {data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
