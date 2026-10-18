import React, { useState } from "react";
import type { AssessmentResult, Distribution, PersonaResult, TableVolume, TelemetrySummary, TerritoryVolume, UserVolume } from "./perf-types";
import {
  STATUS_CHIP,
  STATUS_LABEL,
  deltaKey,
  formatNumber,
  formatValue,
  mayOvercount,
  metricDeltas,
  metricInfo,
  incompleteTables,
  planChanges,
  upperBoundRecords,
} from "./perf-plan";
import { sparkPoints, type TrendRow } from "./perf-history";
import { DIFF_PCT, compareVolume, simulatedSeconds, type TableFlag, type VolumeComparison } from "./perf-compare";
import { formatSeconds } from "./sim-types";
import type { RunSim, RunSims } from "./useRunSims";
import { personaVerdict } from "./signoff-verdict";
import { AssistantName } from "../../hooks/useAssistantName";
import { Download, FileText, Sparkles, Target } from "lucide-react";
import StatusIcon, { type StatusTone } from "../ui/StatusIcon";
import { Callout, Disclosure } from "./PerfParts";

interface RunReportProps {
  result: AssessmentResult;
  previous?: AssessmentResult | null;
  /** Values across this run and the ones before it. */
  trend?: TrendRow[];
  onAskClaude?: () => void;
  onExport?: () => void;
  onExportReport?: () => void;
  /** Save the customer-facing sign-off report (verdict, targets, risks, appendix). */
  onExportSignoff?: () => void;
  /** Newest finished First sync per tested user (lower-cased username), to check the prediction against. */
  sims?: RunSims;
  /** Set the plan's targets from this run's values plus a margin. */
  onBaseline?: (margin: { warnPct: number; failPct: number }) => void;
}

const SPARK_W = 120;
const SPARK_H = 24;

const BANNER: Record<AssessmentResult["status"], { tone: StatusTone; title: string; text: string }> = {
  pass: { tone: "pass", title: "Passed", text: "Every persona met the customer's targets" },
  warn: { tone: "warning", title: "Warning", text: "Some measures are close to their limits" },
  fail: { tone: "error", title: "Failed", text: "Some measures are over their limits" },
};

/** Pill tone for a metric or persona status (STATUS_CHIP's names are for the old chips). */
const PILL: Record<string, string> = { ok: " pass", warning: " warning", error: " error", info: " info", muted: "" };
const pill = (status: keyof typeof STATUS_CHIP) => `ui-pill${PILL[STATUS_CHIP[status]] ?? ""}`;

const VERDICT_TONE: Record<string, StatusTone> = { success: "pass", warning: "warning", error: "error", info: "info" };

function Delta({ value, unit }: { value: number | undefined; unit: string }) {
  if (value === undefined) return <span className="studio-perf-meta">—</span>;
  if (value === 0) return <span className="studio-perf-meta">no change</span>;
  // Every metric is "lower is better".
  return (
    <span className={`studio-perf-delta ${value > 0 ? "worse" : "better"}`}>
      {value > 0 ? "+" : "−"}
      {formatNumber(Math.abs(value))}
      {unit === "records" || unit === "requests" ? "" : ` ${unit}`}
    </span>
  );
}

function flaggedLabel(t: TableVolume): string {
  if (t.status === "error") return "Query failed";
  if (t.status === "timed-out") return "Timed out";
  return t.sourceFailed ? "Not counted" : "Not estimated";
}

function TerritoryTables({ terr }: { terr: TerritoryVolume }) {
  const [all, setAll] = useState(false);
  // Counted tables are sorted by size; errors and estimates that couldn't run are always shown.
  const counted = terr.tables.filter((t) => t.status === "counted").sort((a, b) => b.records - a.records);
  const flagged = terr.tables.filter((t) => t.status !== "counted");
  const shown = all ? counted : counted.slice(0, 8);
  const upper = upperBoundRecords(terr);
  const gaps = incompleteTables(terr).length;
  return (
    <div className="studio-perf-territory">
      <div className="studio-perf-territory-title">
        {terr.territory?.name ?? "No territory"} · {gaps > 0 ? "at least " : ""}{formatNumber(terr.totalRecords)} records ·{" "}
        {formatNumber(terr.totalDeviceRequests)} device requests
      </div>
      {gaps > 0 && (
        <div className="studio-perf-hint">
          {gaps} {gaps === 1 ? "table" : "tables"} could not be counted in full, so these totals are minimums.
        </div>
      )}
      {upper > 0 && (
        <div className="studio-perf-hint">
          Up to {formatNumber(upper)} of these come from tables whose filter isn't scoped to the user, on objects with
          restricted sharing. They were counted org-wide, so this user may download fewer.
        </div>
      )}
      <table className="studio-perf-table">
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
              <td className="meta">
                {t.developerName}
                {t.matchedBy === "permissionSet" ? " (permission set)" : ""}
                {mayOvercount(t) && (
                  <span
                    className="ui-pill warning studio-perf-scope"
                    title="The filter doesn't depend on the user or territory, so every record you can see was counted. The user only gets the ones shared with them."
                  >
                    org-wide · {t.sharingModel ?? "sharing unknown"}
                  </span>
                )}
              </td>
              <td className="num">
                {t.lowerBound ? "≥ " : ""}
                {formatNumber(t.records)}
              </td>
              <td className="num">{t.deviceRequests === null ? "—" : formatNumber(t.deviceRequests)}</td>
            </tr>
          ))}
          {flagged.map((t) => (
            <tr key={t.developerName} className={`studio-perf-flagged ${t.status}`}>
              <td>{t.sobject}</td>
              <td colSpan={3}>
                <span className={`ui-pill${t.status === "error" || t.status === "timed-out" ? " error" : ""}`}>
                  {flaggedLabel(t)}
                </span>{" "}
                {t.note}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {counted.length > 8 && (
        <Disclosure open={all} onToggle={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${counted.length} tables`}
        </Disclosure>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<NonNullable<UserVolume["schemaSource"]>, string> = {
  "user-download": "the user's own metadata download",
  compiled: "compiled metadata schema",
  "db-schema": "DB Schema records",
};

const FLAG_LABEL: Record<Exclude<TableFlag, "match">, string> = {
  differs: `Differs by more than ${DIFF_PCT}%`,
  "only-predicted": "Predicted only",
  "only-simulated": "Simulated only",
  unreliable: "Not comparable",
};

function pct(n: number | undefined): string {
  return n === undefined ? "" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(0)}%`;
}

function PredictedVsSimulated({ cmp, sim }: { cmp: VolumeComparison; sim: RunSim }) {
  const [all, setAll] = useState(false);
  const flagged = cmp.tables.filter((t) => t.flag !== "match");
  const shown = all ? cmp.tables : flagged;
  return (
    <div className="studio-perf-territory">
      <div className="studio-perf-territory-title">
        Predicted vs simulated · {cmp.territory ?? "No territory"} · {formatNumber(cmp.predictedTotal)} predicted,{" "}
        {formatNumber(cmp.simulatedTotal)} simulated
        {cmp.totalDiffPct !== undefined ? ` (${pct(cmp.totalDiffPct)})` : ""}
        {cmp.totalDiffers && <span className="ui-pill warning studio-perf-scope">total differs by more than {DIFF_PCT}%</span>}
      </div>
      <div className="studio-perf-hint">
        First sync of {new Date(sim.startedAt).toLocaleString()} as {sim.result.user.username}
        {sim.result.user.territory ? ` in ${sim.result.user.territory}` : ""}.
        {!cmp.territoryMatched && " The simulation's territory has no prediction in this run, so another territory's was used."}
        {cmp.partial && " Some tables were not counted, skipped, failed or cut short, so the totals are partial."}
      </div>
      {shown.length > 0 && (
        <table className="studio-perf-table">
          <thead>
            <tr>
              <th>Object</th>
              <th className="num">Predicted</th>
              <th className="num">Simulated</th>
              <th className="num">Gap</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.sobject}>
                <td>{t.sobject}</td>
                <td className="num">{t.predicted === undefined ? "—" : formatNumber(t.predicted)}</td>
                <td className="num">{t.simulated === undefined ? "—" : formatNumber(t.simulated)}</td>
                <td className="num">{pct(t.diffPct)}</td>
                <td>
                  {t.flag !== "match" && (
                    <span className={`ui-pill${t.flag === "unreliable" ? "" : " warning"}`} title={t.reason}>
                      {FLAG_LABEL[t.flag]}
                    </span>
                  )}
                  {t.reason && <span className="studio-perf-meta"> {t.reason}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {flagged.length === 0 && <div className="studio-perf-hint">Every table is within {DIFF_PCT}% of its simulated count.</div>}
      {cmp.tables.length > flagged.length && (
        <Disclosure open={all} onToggle={() => setAll(!all)}>
          {all ? "Show only differences" : `Show all ${cmp.tables.length} tables`}
        </Disclosure>
      )}
    </div>
  );
}

function UserVolumes({ v, sim }: { v: UserVolume; sim?: RunSim }) {
  const [open, setOpen] = useState(false);
  const total = v.territories.reduce((n, t) => n + t.totalRecords, 0);
  const cmp = sim ? compareVolume(v, sim.result) : null;
  return (
    <div className="studio-perf-user">
      <Disclosure open={open} onToggle={() => setOpen(!open)}>
        {v.user.name} <span className="studio-perf-meta">{v.user.username}</span>
        {v.error ? (
          <span className="ui-pill error">{v.error}</span>
        ) : (
          <span className="studio-perf-meta">
            {" "}
            · {v.user.profileName} · {v.tableCount} tables
            {v.schemaSource ? ` (${SOURCE_LABEL[v.schemaSource]})` : ""} ·{" "}
            {v.territories.length} {v.territories.length === 1 ? "territory" : "territories"} · {formatNumber(total)} records
          </span>
        )}
        {cmp && (
          <span
            className={`ui-pill ${cmp.flagged === 0 && !cmp.totalDiffers ? "pass" : "warning"} studio-perf-scope`}
            title="Predicted records against the user's most recent First sync simulation"
          >
            {cmp.flagged === 0 && !cmp.totalDiffers ? "matches simulation" : `${cmp.flagged} table${cmp.flagged === 1 ? "" : "s"} differ from simulation`}
          </span>
        )}
      </Disclosure>
      {open && v.territoryNote && <div className="studio-perf-hint">{v.territoryNote}</div>}
      {open &&
        v.schemaNotes?.map((n) => (
          <div key={n} className="studio-perf-hint">
            {n}
          </div>
        ))}
      {open && cmp && sim && <PredictedVsSimulated cmp={cmp} sim={sim} />}
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
      <td className="meta">{unit}</td>
    </tr>
  );
}

function SimulatedTiming({ sims }: { sims: RunSim[] }) {
  if (sims.length === 0) return null;
  return (
    <>
      {sims.map((s) => (
        <div key={s.id} className="studio-perf-hint">
          Simulated first sync, network only — {s.result.user.username}, {new Date(s.startedAt).toLocaleString()}:{" "}
          {formatSeconds(simulatedSeconds(s.result))} (metadata {formatSeconds(s.result.metadata.seconds)}, data{" "}
          {formatSeconds(s.result.totals.seconds)}). A device also spends time writing its database, so real initial syncs run longer.
        </div>
      ))}
    </>
  );
}

function coverageNote(t: TelemetrySummary): string {
  const c = t.coverage;
  const span = c?.oldest && c.newest ? `, from ${c.oldest.slice(0, 10)} to ${c.newest.slice(0, 10)}` : "";
  return `More than ${formatNumber(c?.limit)} syncs matched, so this is a sample of the newest syncs in each part of the window${span}. Percentiles describe the sample, not every sync.`;
}

function Telemetry({ p, sims = [] }: { p: PersonaResult; sims?: RunSim[] }) {
  const timing = <SimulatedTiming sims={sims} />;
  if (p.telemetryError) {
    return (
      <>
        <div className="studio-perf-hint">Field telemetry unavailable: {p.telemetryError}</div>
        {timing}
      </>
    );
  }
  const t = p.telemetry;
  if (!t || t.samples === 0) {
    return (
      <>
        <div className="studio-perf-hint">No syncs recorded for these users in the telemetry window.</div>
        {timing}
      </>
    );
  }
  return (
    <>
      {t.coverage?.mode === "sampled" && <div className="studio-perf-hint">{coverageNote(t)}</div>}
      <table className="studio-perf-table">
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
      {timing}
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
      <div className="studio-perf-baseline-title">Use this run as the baseline</div>
      <div className="studio-perf-hint">
        Each persona's targets become this run's values plus a margin, so a later run that grows past the margin is flagged.
      </div>
      <div className="studio-perf-baseline-fields">
        <label className="ui-label">
          Warn above (%)
          <input className="studio-input" type="number" min={0} value={warn} onChange={(e) => setWarn(e.target.value)} />
        </label>
        <label className="ui-label">
          Fail above (%)
          <input className="studio-input" type="number" min={0} value={fail} onChange={(e) => setFail(e.target.value)} />
        </label>
        <button type="button" className="studio-btn primary" disabled={!valid} onClick={() => onApply({ warnPct, failPct })}>
          Apply to plan
        </button>
        <button type="button" className="studio-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
      {!valid && <div className="studio-perf-hint">Fail must be at least as large as warn.</div>}
    </div>
  );
}

/** Distinct tables, across every persona, user and territory, whose count is missing or a minimum. */
function countUncounted(result: AssessmentResult): number {
  const names = new Set<string>();
  for (const p of result.personas) for (const v of p.volumes) for (const terr of v.territories) for (const t of incompleteTables(terr)) names.add(t.sobject);
  return names.size;
}

function Trend({ rows }: { rows: TrendRow[] }) {
  return (
    <section className="studio-perf-section">
      <div className="studio-perf-section-header">
        <h2 className="studio-perf-section-title">Trend</h2>
        <span className="studio-perf-meta">last {Math.max(...rows.map((r) => r.values.length))} runs, oldest on the left</span>
      </div>
      <table className="studio-perf-table">
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
                <span className={pill(r.latest.status)}>{STATUS_LABEL[r.latest.status]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function RunReport({ result, previous, trend, onAskClaude, onExport, onExportReport, onExportSignoff, onBaseline, sims }: RunReportProps) {
  const [baselineOpen, setBaselineOpen] = useState(false);
  const deltas = metricDeltas(result, previous);
  // Differences between the two runs' plans, so a jump in a metric isn't read as the org changing.
  const changes = previous ? planChanges(result, previous) : new Map<string, string[]>();
  const banner = BANNER[result.status];
  const uncounted = countUncounted(result);
  return (
    <div className="studio-perf-report">
      <div className="studio-perf-summary">
        <div className="studio-perf-summary-main">
          <StatusIcon tone={banner.tone} size={32} />
          <div>
            <div className="studio-perf-summary-title">
              {banner.title} — {banner.text}
            </div>
            <div className="studio-perf-summary-detail">
              {result.profile} · {result.org} · {new Date(result.generatedAt).toLocaleString()}
              {previous ? ` · compared with the run of ${new Date(previous.generatedAt).toLocaleString()}` : ""}
            </div>
          </div>
        </div>
        <div className="studio-perf-summary-actions">
          {onAskClaude && result.status !== "pass" && (
            <button type="button" className="studio-btn" onClick={onAskClaude}>
              <Sparkles size={14} aria-hidden="true" />
              Ask <AssistantName /> how to fix
            </button>
          )}
          {onBaseline && (
            <button type="button" className="studio-btn" onClick={() => setBaselineOpen(!baselineOpen)} title="Set the plan's targets from this run">
              <Target size={14} aria-hidden="true" />
              Use as baseline
            </button>
          )}
          {onExportReport && (
            <button type="button" className="studio-btn" onClick={onExportReport} title="Save the detailed results as Markdown">
              <FileText size={14} aria-hidden="true" />
              Detailed report
            </button>
          )}
          {onExport && (
            <button type="button" className="studio-btn" onClick={onExport} title="Save the raw results as JSON">
              <Download size={14} aria-hidden="true" />
              JSON
            </button>
          )}
          {onExportSignoff && (
            <button
              type="button"
              className="studio-btn primary"
              onClick={onExportSignoff}
              title="Save a plain-language report for the customer, with the detailed results as an appendix"
            >
              <Download size={14} aria-hidden="true" />
              Export sign-off report
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

      {uncounted > 0 && (
        <Callout tone="warning" title={`${uncounted} ${uncounted === 1 ? "table" : "tables"} could not be counted`}>
          Predicted volumes that include them are minimums, and measures built on them cannot pass until they are counted.
        </Callout>
      )}

      <ul className="studio-perf-verdicts">
        {result.personas.map((p) => {
          const v = personaVerdict(p);
          return (
            <li key={p.persona.name} className={`studio-perf-verdict ${v.tone}`}>
              <StatusIcon tone={VERDICT_TONE[v.tone] ?? "info"} size={20} />
              <span>{v.text}</span>
            </li>
          );
        })}
      </ul>

      {changes.size > 0 && (
        <Callout tone="info" title="The previous run tested something different">
          <ul className="studio-perf-issues">
            {[...changes].map(([persona, notes]) => (
              <li key={persona}>
                {result.personas.find((p) => p.persona.name.trim().toLowerCase() === persona)?.persona.name ?? persona}: {notes.join(", ")}
              </li>
            ))}
          </ul>
          <div className="studio-perf-hint">Differences against it may come from the plan rather than the org.</div>
        </Callout>
      )}

      {trend && trend.length > 0 && <Trend rows={trend} />}

      {result.personas.map((p) => (
        <section key={p.persona.name} className="studio-perf-section">
          <div className="studio-perf-section-header">
            <h2 className="studio-perf-section-title">{p.persona.name}</h2>
            <span className={pill(p.status)}>{STATUS_LABEL[p.status]}</span>
            {changes.has(p.persona.name.trim().toLowerCase()) && (
              <span className="studio-perf-meta" title={changes.get(p.persona.name.trim().toLowerCase())?.join(", ")}>
                plan differs from the previous run
              </span>
            )}
          </div>
          <table className="studio-perf-table">
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
                      {e.incomplete && <div className="studio-perf-metric-meta">Incomplete: {e.incomplete}</div>}
                    </td>
                    <td className="num">
                      {e.incomplete && e.value !== undefined ? "≥ " : ""}
                      {formatValue(e)}
                    </td>
                    <td className="num">{formatNumber(e.threshold?.warn)}</td>
                    <td className="num">{formatNumber(e.threshold?.fail)}</td>
                    <td>
                      <span className={pill(e.status)}>{STATUS_LABEL[e.status]}</span>
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
            <UserVolumes key={v.user.username} v={v} sim={sims?.get(v.user.username.toLowerCase())} />
          ))}

          <h3 className="studio-perf-subtitle">Field telemetry</h3>
          <Telemetry p={p} sims={p.volumes.flatMap((v) => sims?.get(v.user.username.toLowerCase()) ?? [])} />
        </section>
      ))}
    </div>
  );
}
