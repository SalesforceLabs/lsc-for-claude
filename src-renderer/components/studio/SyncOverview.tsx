import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SurfaceId } from "./types";
import { formatNumber } from "./perf-plan";
import { formatSeconds } from "./sim-types";
import "./sync-overview.css";
import { AssistantName } from "../../hooks/useAssistantName";

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
const BANNER_CLASS: Record<Status, string> = { healthy: "success", struggling: "warning", failing: "error", "no-data": "info" };
/** Reps pre-selected for "Test these reps". */
const DEFAULT_TEST_COUNT = 3;
const SPARK_W = 360;
const SPARK_H = 56;

const seconds = (v: number | undefined) => (v === undefined ? "—" : formatSeconds(v));

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="sync-overview-tile">
      <div className="sync-overview-tile-value">{value}</div>
      <div className="sync-overview-tile-label">{label}</div>
      {hint && <div className="studio-perf-hint">{hint}</div>}
    </div>
  );
}

/** Bars of one value per day; the title carries the exact numbers. */
function Trend({ daily, pick, label }: { daily: DailyPoint[]; pick: (d: DailyPoint) => number | undefined; label: string }) {
  const values = daily.map(pick);
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const bar = SPARK_W / Math.max(1, daily.length);
  return (
    <figure className="sync-overview-trend">
      <figcaption className="studio-perf-hint">{label}</figcaption>
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
      <button type="button" className="studio-perf-disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {title}
      </button>
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
        <div className="studio-ipad-mode" role="group" aria-label="Time window">
          {WINDOWS.map((d) => (
            <button key={d} type="button" className={`studio-btn${days === d ? " active" : ""}`} aria-pressed={days === d} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
        <button type="button" className="studio-btn" disabled={loading} onClick={() => void load(days)}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        {data && (
          <button type="button" className="studio-btn" onClick={() => onAskClaude(askPrompt(data))}>
            Ask <AssistantName />
          </button>
        )}
      </div>

      {loading && !data && (
        <div className="studio-perf-progress" role="status">
          <div className="studio-spinner" />
          <span>Reading sync data from the org…</span>
        </div>
      )}
      {error && (
        <div className="studio-finding error" role="alert">
          {error}
        </div>
      )}

      {data && (
        <div className="sync-overview-body" aria-busy={loading}>
          {data.verdict && (
            <div className={`studio-finding ${BANNER_CLASS[data.verdict.status]} sync-overview-banner`}>
              <strong>{data.verdict.headline}</strong>
              {t && data.needAttention > 0 && (
                <span className="studio-perf-hint">
                  {" "}
                  {data.needAttention} of {data.reps} reps need attention.
                </span>
              )}
              <div className="studio-finding-detail">
                Judged against Studio's rules of thumb (failures: warn at 2%, fail at 10%; metadata download p95: warn at 5 s, fail at 10 s), not the
                customer's targets — set those in Sign-off.
              </div>
            </div>
          )}

          {!t && (
            <div className="studio-perf-hint">
              <p>
                Sync health comes from DeviceSyncSummary, a record each rep's iPad writes to Salesforce after every sync. It holds how long the sync took,
                how many records came down and whether it finished. Nothing has been recorded for this window yet, so there are no sync numbers to show.
              </p>
            </div>
          )}

          {t && (
            <>
              {data.rowsCoverage?.truncated && (
                <div className="studio-finding warning" role="note">
                  This window has too many syncs to read in full. Sync times and the rep list cover only the most recent part
                  {data.rowsCoverage.from ? `, from ${data.rowsCoverage.from} on` : ""}. Failure totals and the daily trend cover the whole window.
                </div>
              )}
              <div className="sync-overview-tiles">
                <Tile label="Typical slow update" value={seconds(t.delta.total.p95)} hint="Delta sync, 19 in 20 are faster" />
                <Tile label="Typical slow first sync" value={seconds(t.initial.total.p95)} hint="19 in 20 are faster" />
                <Tile label="Syncs that failed" value={t.failureRatePct === undefined ? "—" : `${formatNumber(t.failureRatePct)}%`} />
                <Tile label="Device database size" value={t.dbSizeGb.p95 === undefined ? "—" : `${formatNumber(t.dbSizeGb.p95, 2)} GB`} hint="19 in 20 are smaller" />
                <Tile label="Reps who synced" value={formatNumber(data.reps)} hint={`${formatNumber(data.totals?.syncs ?? t.samples)} syncs`} />
              </div>

              {data.daily.length > 1 && (
                <div className="sync-overview-section">
                  <h3 className="studio-perf-section-title">Trend</h3>
                  <div className="sync-overview-trends">
                    <Trend daily={data.daily} pick={(d) => d.deltaP90} label="Update sync time, seconds (slowest 10%)" />
                    <Trend daily={data.daily} pick={(d) => d.failures} label="Failed syncs per day" />
                    <Trend daily={data.daily} pick={(d) => d.syncs} label="Syncs per day" />
                  </div>
                </div>
              )}

              <div className="sync-overview-section">
                <div className="sync-overview-section-head">
                  <h3 className="studio-perf-section-title">Reps who need attention</h3>
                  {testable.length > 0 && (
                    <button type="button" className="studio-btn" disabled={selected.size === 0} onClick={() => onTestUsers([...selected])}>
                      Test these reps ({selected.size})
                    </button>
                  )}
                </div>
                {data.usersAtRisk.length === 0 ? (
                  <div className="studio-perf-hint">No rep stands out. Every rep's syncs are in line with the rest of the org.</div>
                ) : (
                  <table className="studio-change-table studio-perf-table">
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
                          <td>
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
                            <div className="studio-picker-meta">{u.username}</div>
                          </td>
                          <td className="studio-picker-meta">{u.profile || "—"}</td>
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
                              <button type="button" className="studio-btn" onClick={() => onInvestigateUser(u.userId as string)}>
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
              <h3 className="studio-perf-section-title">Sync settings worth a look</h3>
              <div className="sync-overview-risks">
                {data.schemaRisks.slice(0, 12).map((r) => (
                  <div key={`${r.developerName}:${r.title}`} className={`studio-finding ${r.severity} sync-overview-risk`}>
                    <div>
                      <strong>{r.title}</strong>
                      <div className="studio-perf-hint">{r.detail}</div>
                    </div>
                    <button type="button" className="studio-btn" onClick={() => onOpenSetup("mobile-sync", "syncedObjects", r.itemId)}>
                      Open in Setup
                    </button>
                  </div>
                ))}
                {data.schemaRisks.length > 12 && <div className="studio-perf-hint">and {data.schemaRisks.length - 12} more in Mobile Sync setup.</div>}
              </div>
            </div>
          )}

          {t && t.byAppVersion.length > 0 && (
            <Disclosure title="By app version">
              <table className="studio-change-table studio-perf-table">
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
              <table className="studio-change-table studio-perf-table">
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
