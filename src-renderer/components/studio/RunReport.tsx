import React, { useState } from "react";
import type { AssessmentResult, Distribution, PersonaResult, TerritoryVolume, UserVolume } from "./perf-types";
import {
  STATUS_CHIP,
  STATUS_LABEL,
  deltaKey,
  formatNumber,
  formatValue,
  mayOvercount,
  metricDeltas,
  metricInfo,
  planChanges,
  upperBoundRecords,
} from "./perf-plan";
import { sparkPoints, type TrendRow } from "./perf-history";

interface RunReportProps {
  result: AssessmentResult;
  previous?: AssessmentResult | null;
  /** Values across this run and the ones before it. */
  trend?: TrendRow[];
  onAskClaude?: () => void;
  onExport?: () => void;
  onExportReport?: () => void;
  /** Set the plan's targets from this run's values plus a margin. */
  onBaseline?: (margin: { warnPct: number; failPct: number }) => void;
}

const SPARK_W = 120;
const SPARK_H = 24;

const BANNER: Record<AssessmentResult["status"], { cls: string; text: string }> = {
  pass: { cls: "success", text: "Every persona met its targets" },
  warn: { cls: "warning", text: "Some metrics are close to their limits" },
  fail: { cls: "error", text: "Some metrics exceed their limits" },
};

function Delta({ value, unit }: { value: number | undefined; unit: string }) {
  if (value === undefined) return <span className="studio-picker-meta">—</span>;
  if (value === 0) return <span className="studio-picker-meta">no change</span>;
  // Every metric is "lower is better".
  return (
    <span className={`studio-perf-delta ${value > 0 ? "worse" : "better"}`}>
      {value > 0 ? "+" : "−"}
      {formatNumber(Math.abs(value))}
      {unit === "records" || unit === "requests" ? "" : ` ${unit}`}
    </span>
  );
}

function TerritoryTables({ terr }: { terr: TerritoryVolume }) {
  const [all, setAll] = useState(false);
  // Counted tables are sorted by size; errors and estimates that couldn't run are always shown.
  const counted = terr.tables.filter((t) => t.status === "counted").sort((a, b) => b.records - a.records);
  const flagged = terr.tables.filter((t) => t.status !== "counted");
  const shown = all ? counted : counted.slice(0, 8);
  const upper = upperBoundRecords(terr);
  return (
    <div className="studio-perf-territory">
      <div className="studio-perf-territory-title">
        {terr.territory?.name ?? "No territory"} · {formatNumber(terr.totalRecords)} records ·{" "}
        {formatNumber(terr.totalDeviceRequests)} device requests
      </div>
      {upper > 0 && (
        <div className="studio-perf-hint">
          Up to {formatNumber(upper)} of these come from tables whose filter isn't scoped to the user, on objects with
          restricted sharing. They were counted org-wide, so this user may download fewer.
        </div>
      )}
      <table className="studio-change-table studio-perf-table">
        <thead>
          <tr>
            <th>Object</th>
            <th>DB Schema record</th>
            <th className="num">Records</th>
            <th className="num">Requests</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => (
            <tr key={t.developerName}>
              <td>{t.sobject}</td>
              <td className="studio-picker-meta">
                {t.developerName}
                {t.matchedBy === "permissionSet" ? " (permission set)" : ""}
                {mayOvercount(t) && (
                  <span
                    className="studio-chip warning studio-perf-scope"
                    title="The filter doesn't depend on the user or territory, so every record you can see was counted. The user only gets the ones shared with them."
                  >
                    org-wide · {t.sharingModel ?? "sharing unknown"}
                  </span>
                )}
              </td>
              <td className="num">{formatNumber(t.records)}</td>
              <td className="num">{t.deviceRequests === null ? "—" : formatNumber(t.deviceRequests)}</td>
            </tr>
          ))}
          {flagged.map((t) => (
            <tr key={t.developerName} className={`studio-perf-flagged ${t.status}`}>
              <td>{t.sobject}</td>
              <td colSpan={3}>
                <span className={`studio-chip ${t.status === "error" ? "error" : "muted"}`}>
                  {t.status === "error" ? "Query failed" : "Not estimated"}
                </span>{" "}
                {t.note}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {counted.length > 8 && (
        <button className="studio-perf-disclosure" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${counted.length} tables`}
        </button>
      )}
    </div>
  );
}

function UserVolumes({ v }: { v: UserVolume }) {
  const [open, setOpen] = useState(false);
  const total = v.territories.reduce((n, t) => n + t.totalRecords, 0);
  return (
    <div className="studio-perf-user">
      <button className="studio-perf-disclosure" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {v.user.name} <span className="studio-picker-meta">{v.user.username}</span>
        {v.error ? (
          <span className="studio-chip error">{v.error}</span>
        ) : (
          <span className="studio-picker-meta">
            {" "}
            · {v.user.profileName} · {v.tableCount} tables · {v.territories.length}{" "}
            {v.territories.length === 1 ? "territory" : "territories"} · {formatNumber(total)} records
          </span>
        )}
      </button>
      {open && v.territories.map((t) => <TerritoryTables key={t.territory?.id ?? "none"} terr={t} />)}
    </div>
  );
}

function DistributionRow({ label, d, unit }: { label: string; d: Distribution; unit: string }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{d.n}</td>
      <td className="num">{formatNumber(d.p50)}</td>
      <td className="num">{formatNumber(d.p90)}</td>
      <td className="num">{formatNumber(d.p95)}</td>
      <td className="num">{formatNumber(d.max)}</td>
      <td className="studio-picker-meta">{unit}</td>
    </tr>
  );
}

function Telemetry({ p }: { p: PersonaResult }) {
  if (p.telemetryError) return <div className="studio-perf-hint">Field telemetry unavailable: {p.telemetryError}</div>;
  const t = p.telemetry;
  if (!t || t.samples === 0) return <div className="studio-perf-hint">No syncs recorded for these users in the telemetry window.</div>;
  return (
    <>
      <table className="studio-change-table studio-perf-table">
        <thead>
          <tr>
            <th>From {t.samples} syncs</th>
            <th className="num">n</th>
            <th className="num">p50</th>
            <th className="num">p90</th>
            <th className="num">p95</th>
            <th className="num">max</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <DistributionRow label="Initial sync" d={t.initial.total} unit="s" />
          <DistributionRow label="Initial sync records (excl. files)" d={t.initial.records} unit="records" />
          <DistributionRow label="Delta sync" d={t.delta.total} unit="s" />
          <DistributionRow label="Metadata download" d={t.metadataDownload} unit="s" />
          <DistributionRow label="Device DB size" d={t.dbSizeGb} unit="GB" />
        </tbody>
      </table>
      {t.outcomes && (
        <div className="studio-perf-hint">
          {t.outcomes.completed} completed · {t.outcomes.failed} failed downloads · {t.outcomes.cancelled} cancelled ·{" "}
          {t.outcomes["stopped-early"]} stopped before downloading. Timings use completed syncs; the failure rate leaves out
          cancelled and stopped-early syncs.
        </div>
      )}
      {t.byNetwork.length > 1 && (
        <div className="studio-perf-hint">
          Delta p95 by network: {t.byNetwork.map((n) => `${n.key} ${formatNumber(n.deltaP95)} s (${n.n})`).join(" · ")}
        </div>
      )}
      {t.byAppVersion.length > 1 && (
        <div className="studio-perf-hint">
          By app version:{" "}
          {t.byAppVersion
            .map((a) => `${a.key} delta p95 ${formatNumber(a.deltaP95)} s, ${formatNumber(a.failureRatePct)}% failed (${a.n})`)
            .join(" · ")}
        </div>
      )}
    </>
  );
}

function BaselinePanel({ onApply, onClose }: { onApply: (margin: { warnPct: number; failPct: number }) => void; onClose: () => void }) {
  const [warn, setWarn] = useState("10");
  const [fail, setFail] = useState("25");
  const warnPct = Number(warn);
  const failPct = Number(fail);
  const valid = warn.trim() !== "" && fail.trim() !== "" && warnPct >= 0 && failPct >= warnPct;
  return (
    <div className="studio-perf-baseline">
      <div className="studio-finding-title">Use this run as the baseline</div>
      <div className="studio-perf-hint">
        Each persona's targets become this run's values plus a margin, so a later run that grows past the margin is flagged.
      </div>
      <div className="studio-perf-baseline-fields">
        <label>
          Warn above
          <input className="studio-input" type="number" min={0} value={warn} onChange={(e) => setWarn(e.target.value)} />%
        </label>
        <label>
          Fail above
          <input className="studio-input" type="number" min={0} value={fail} onChange={(e) => setFail(e.target.value)} />%
        </label>
        <button className="studio-btn primary" disabled={!valid} onClick={() => onApply({ warnPct, failPct })}>
          Apply to plan
        </button>
        <button className="studio-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
      {!valid && <div className="studio-perf-hint">Fail must be at least as large as warn.</div>}
    </div>
  );
}

function Trend({ rows }: { rows: TrendRow[] }) {
  return (
    <section className="studio-perf-section">
      <div className="studio-perf-section-header">
        <h2 className="studio-perf-section-title">Trend</h2>
        <span className="studio-picker-meta">last {Math.max(...rows.map((r) => r.values.length))} runs, oldest on the left</span>
      </div>
      <table className="studio-change-table studio-perf-table">
        <thead>
          <tr>
            <th>Persona</th>
            <th>Metric</th>
            <th />
            <th className="num">Latest</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.persona}::${r.metric}`}>
              <td>{r.persona}</td>
              <td>{metricInfo(r.metric).label}</td>
              <td>
                <svg className="studio-perf-spark" width={SPARK_W} height={SPARK_H} viewBox={`-2 -2 ${SPARK_W + 4} ${SPARK_H + 4}`} aria-hidden>
                  <polyline points={sparkPoints(r.values, SPARK_W, SPARK_H)} />
                </svg>
              </td>
              <td className="num">{formatValue({ metric: r.metric, value: r.latest.value })}</td>
              <td>
                <span className={`studio-chip ${STATUS_CHIP[r.latest.status]}`}>{STATUS_LABEL[r.latest.status]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function RunReport({ result, previous, trend, onAskClaude, onExport, onExportReport, onBaseline }: RunReportProps) {
  const [baselineOpen, setBaselineOpen] = useState(false);
  const deltas = metricDeltas(result, previous);
  // Differences between the two runs' plans, so a jump in a metric isn't read as the org changing.
  const changes = previous ? planChanges(result, previous) : new Map<string, string[]>();
  const banner = BANNER[result.status];
  return (
    <div className="studio-perf-report">
      <div className={`studio-finding ${banner.cls} studio-perf-banner`}>
        <div>
          <div className="studio-finding-title">
            {result.status.toUpperCase()} — {banner.text}
          </div>
          <div className="studio-finding-detail">
            {result.profile} · {result.org} · {new Date(result.generatedAt).toLocaleString()}
            {previous ? ` · compared with the run of ${new Date(previous.generatedAt).toLocaleString()}` : ""}
          </div>
        </div>
        <div className="studio-header-actions">
          {onAskClaude && result.status !== "pass" && (
            <button className="studio-btn primary" onClick={onAskClaude}>
              Ask Claude how to fix
            </button>
          )}
          {onBaseline && (
            <button className="studio-btn" onClick={() => setBaselineOpen(!baselineOpen)} title="Set the plan's targets from this run">
              Use as baseline
            </button>
          )}
          {onExportReport && (
            <button className="studio-btn" onClick={onExportReport} title="Save a Markdown report to share">
              Export report
            </button>
          )}
          {onExport && (
            <button className="studio-btn" onClick={onExport}>
              Export JSON
            </button>
          )}
        </div>
      </div>

      {baselineOpen && onBaseline && (
        <BaselinePanel
          onApply={(margin) => {
            setBaselineOpen(false);
            onBaseline(margin);
          }}
          onClose={() => setBaselineOpen(false)}
        />
      )}

      {changes.size > 0 && (
        <div className="studio-finding info studio-perf-notice">
          <div className="studio-finding-title">The previous run tested something different</div>
          <ul className="studio-perf-issues">
            {[...changes].map(([persona, notes]) => (
              <li key={persona}>
                {result.personas.find((p) => p.persona.name.trim().toLowerCase() === persona)?.persona.name ?? persona}: {notes.join(", ")}
              </li>
            ))}
          </ul>
          <div className="studio-finding-detail">Differences against it may come from the plan rather than the org.</div>
        </div>
      )}

      {trend && trend.length > 0 && <Trend rows={trend} />}

      {result.personas.map((p) => (
        <section key={p.persona.name} className="studio-perf-section">
          <div className="studio-perf-section-header">
            <h2 className="studio-perf-section-title">{p.persona.name}</h2>
            <span className={`studio-chip ${STATUS_CHIP[p.status]}`}>{STATUS_LABEL[p.status]}</span>
            {changes.has(p.persona.name.trim().toLowerCase()) && (
              <span className="studio-picker-meta" title={changes.get(p.persona.name.trim().toLowerCase())?.join(", ")}>
                plan differs from the previous run
              </span>
            )}
          </div>
          <table className="studio-change-table studio-perf-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="num">Value</th>
                <th className="num">Warn</th>
                <th className="num">Fail</th>
                <th>Status</th>
                {previous && <th className="num">vs previous</th>}
              </tr>
            </thead>
            <tbody>
              {p.evaluations.map((e) => {
                const info = metricInfo(e.metric);
                return (
                  <tr key={e.metric}>
                    <td>
                      <div>{info.label}</div>
                      {e.detail && <div className="studio-perf-metric-meta">{e.detail}</div>}
                    </td>
                    <td className="num">{formatValue(e)}</td>
                    <td className="num">{formatNumber(e.threshold?.warn)}</td>
                    <td className="num">{formatNumber(e.threshold?.fail)}</td>
                    <td>
                      <span className={`studio-chip ${STATUS_CHIP[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                    </td>
                    {previous && (
                      <td className="num">
                        <Delta value={deltas.get(deltaKey(p.persona.name, e.metric))} unit={info.unit} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="studio-perf-subtitle">Predicted sync volume</h3>
          {p.volumes.map((v) => (
            <UserVolumes key={v.user.username} v={v} />
          ))}

          <h3 className="studio-perf-subtitle">Field telemetry</h3>
          <Telemetry p={p} />
        </section>
      ))}
    </div>
  );
}
