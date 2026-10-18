/**
 * Studio "Testing → Test plans": a plain-language readiness report for the
 * customer, from a performance assessment and any first-sync simulations, with
 * the detailed reports as an appendix. Doesn't touch the org.
 */

import { z } from "zod";
import { renderAssessment, type AssessmentResult, type PersonaResult } from "../perf/assessment.js";
import { METRICS, type EvalStatus, type MetricEvaluation, type MetricKey } from "../perf/nfr.js";
import type { SimulationResult } from "../perf/simulate.js";
import { renderSimulation } from "../tools/perf-simulate.js";
import { renderRunsSection, type SimRunsSummary } from "./sim-runs.js";

export const signoffReportInput = {
  assessment: z.object({}).passthrough(),
  simulations: z.array(z.object({}).passthrough()).max(50).optional(),
  baseline: z.object({}).passthrough().optional(),
  days: z.number().int().min(1).max(365).optional(),
};

export interface SignoffReportInput {
  assessment: Record<string, unknown>;
  simulations?: Record<string, unknown>[];
  baseline?: Record<string, unknown>;
  days?: number;
}

type Sim = SimulationResult & { runs?: SimRunsSummary };

const DEFAULT_DAYS = 30;
const TOP_RISKS = 6;
const SLOWEST_TABLES = 5;
const MAX_APPENDIX_SIMS = 5;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ---- validation -----------------------------------------------------------

function checkAssessment(value: unknown, what: string): AssessmentResult {
  if (!isObject(value)) throw new Error(`${what} must be an object.`);
  if (!Array.isArray(value.personas)) throw new Error(`${what} is not a performance run result (no personas).`);
  if (typeof value.profile !== "string") throw new Error(`${what} has no plan name (profile).`);
  value.personas.forEach((p, i) => {
    const at = `${what} persona ${i + 1}`;
    if (!isObject(p) || !isObject(p.persona) || typeof p.persona.name !== "string") throw new Error(`${at} has no name.`);
    if (!Array.isArray(p.evaluations)) throw new Error(`${at} (${p.persona.name}) has no evaluations.`);
    if (!Array.isArray(p.volumes)) throw new Error(`${at} (${p.persona.name}) has no volumes.`);
    for (const e of p.evaluations) {
      if (!isObject(e) || typeof e.metric !== "string" || typeof e.status !== "string") {
        throw new Error(`${at} (${p.persona.name}) has an evaluation without a metric and status.`);
      }
    }
  });
  return value as unknown as AssessmentResult;
}

function checkSimulation(value: unknown, i: number): Sim {
  const at = `Simulation ${i + 1}`;
  if (!isObject(value)) throw new Error(`${at} must be an object.`);
  if (!isObject(value.user) || typeof value.user.username !== "string") throw new Error(`${at} is not a first-sync result (no user).`);
  if (!isObject(value.metadata) || typeof value.metadata.seconds !== "number") throw new Error(`${at} has no metadata timing.`);
  if (!isObject(value.totals) || typeof value.totals.seconds !== "number" || typeof value.totals.records !== "number") {
    throw new Error(`${at} has no totals.`);
  }
  if (!Array.isArray(value.tables)) throw new Error(`${at} has no tables.`);
  if (!isObject(value.org) || !Array.isArray(value.notes)) throw new Error(`${at} is missing its org or notes.`);
  return value as unknown as Sim;
}

// ---- wording --------------------------------------------------------------

const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(1));

/** Seconds as "45 s", "2.3 min" or "1.2 h". */
export function plainSeconds(s: number): string {
  if (s < 120) return `${num(Math.round(s * 10) / 10)} s`;
  if (s < 7200) return `${(s / 60).toFixed(1).replace(/\.0$/, "")} min`;
  return `${(s / 3600).toFixed(1).replace(/\.0$/, "")} h`;
}

const metricLabel = (m: string) => (m in METRICS ? METRICS[m as MetricKey].label : m);

function plainValue(metric: string, v: number): string {
  const unit = metric in METRICS ? METRICS[metric as MetricKey].unit : "";
  if (unit === "s") return plainSeconds(v);
  if (unit === "%") return `${num(v)}%`;
  if (unit === "GB") return `${num(v)} GB`;
  return num(v);
}

/** A measure with a target that couldn't be measured is still a target: unproven, not absent. */
const isUnmeasured = (e: MetricEvaluation) => (e.status === "no-data" || e.status === "incomplete") && !!e.threshold;
const isTarget = (e: MetricEvaluation) => e.status === "pass" || e.status === "warn" || e.status === "fail" || isUnmeasured(e);

/** "Delta sync p95 is 2.3 min against a 2 min target" for an evaluation that didn't pass. */
function overLimit(e: MetricEvaluation): string {
  const value = e.value === undefined ? "not measured" : plainValue(e.metric, e.value);
  const limit = e.status === "fail" ? e.threshold?.fail : e.threshold?.warn;
  const word = e.status === "fail" ? "limit" : "target";
  const label = metricLabel(e.metric);
  return limit === undefined ? `${label} is ${value}` : `${label} is ${value} against a ${plainValue(e.metric, limit)} ${word}`;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

const STATUS_WORD: Record<EvalStatus, string> = {
  pass: "Met",
  warn: "Close to limit",
  fail: "Missed",
  "no-data": "Not measured",
  "no-threshold": "No target set",
  incomplete: "Not proven (some tables could not be counted)",
};

function counts(personas: PersonaResult[]) {
  const evals = personas.flatMap((p) => p.evaluations).filter(isTarget);
  return {
    total: evals.length,
    met: evals.filter((e) => e.status === "pass").length,
    close: evals.filter((e) => e.status === "warn").length,
    missed: evals.filter((e) => e.status === "fail").length,
    unmeasured: evals.filter(isUnmeasured).length,
  };
}

function verdict(a: AssessmentResult): string {
  const c = counts(a.personas);
  const n = a.personas.length;
  const personas = `${n} persona${n === 1 ? "" : "s"}`;
  if (c.total === 0) {
    return "**No verdict yet.** No customer targets were set for this plan, so nothing could be met or missed. Add the customer's targets and run again.";
  }
  const notMeasured = c.unmeasured ? ` ${c.unmeasured} could not be measured, so they are unproven.` : "";
  if (c.missed > 0) {
    const failing = a.personas.filter((p) => p.evaluations.some((e) => e.status === "fail")).map((p) => p.persona.name);
    return `**Not ready for sign-off.** ${c.missed} of ${c.total} targets were missed across ${personas} (${failing.join(", ")}). ${c.met} were met${c.close ? ` and ${c.close} are close to their limits` : ""}.${notMeasured}`;
  }
  if (c.unmeasured > 0) {
    return `**Not proven yet.** ${c.met} of ${c.total} targets were met across ${personas}, but ${c.unmeasured} could not be measured${c.close ? ` and ${c.close} are close to their limits` : ""}. Fix what blocked the measurement and run again before signing off.`;
  }
  if (c.close > 0) {
    return `**Ready, with items to watch.** All ${personas} are within their limits, but ${c.close} of ${c.total} targets are close to the limit. ${c.met} were comfortably met.`;
  }
  return `**Ready for sign-off.** All ${c.total} targets were met across ${personas}.`;
}

// ---- risks ----------------------------------------------------------------

interface Risk {
  rank: number;
  text: string;
}

/** How far over its reference an evaluation is, so the worst miss sorts first. */
function overshoot(e: MetricEvaluation): number {
  const ref = e.status === "fail" ? e.threshold?.fail : e.threshold?.warn;
  return ref && e.value !== undefined ? e.value / ref : 0;
}

function risksOf(a: AssessmentResult, sims: Sim[]): string[] {
  const risks: Risk[] = [];
  for (const p of a.personas) {
    const name = p.persona.name;
    for (const e of p.evaluations) {
      if (e.status === "fail") risks.push({ rank: 1000 + overshoot(e), text: `${name}: ${overLimit(e)}.${e.detail ? ` Driven by ${e.detail}.` : ""}` });
      else if (e.status === "warn") risks.push({ rank: 500 + overshoot(e), text: `${name}: ${overLimit(e)}. This is close to the limit.` });
      else if (e.status === "no-data" && e.threshold) {
        risks.push({ rank: 700, text: `${name}: ${metricLabel(e.metric)} has a target but could not be measured, so it is unproven.` });
      }
    }
    if (p.telemetryError) risks.push({ rank: 90, text: `${name}: real-device sync history was not available (${p.telemetryError}), so sync times were not checked against real use.` });
    else if (p.telemetry && p.telemetry.samples === 0) risks.push({ rank: 90, text: `${name}: no syncs were recorded for these reps in the telemetry window, so sync times were not checked against real use.` });
    for (const v of p.volumes) {
      if (v.error) risks.push({ rank: 300, text: `${name}: ${v.user.username || v.user.profileName || "a rep"} could not be assessed (${v.error}).` });
    }
    const broken = new Set(p.volumes.flatMap((v) => v.territories.flatMap((t) => t.tables.filter((x) => x.status === "error").map((x) => x.sobject))));
    if (broken.size) risks.push({ rank: 200, text: `${name}: the sync filters for ${[...broken].join(", ")} failed to run, so the record counts are incomplete.` });
  }
  for (const s of sims) {
    const bad = s.tables.filter((t) => t.error);
    if (bad.length) risks.push({ rank: 400, text: `First sync for ${s.user.username}: ${bad.length} table${bad.length === 1 ? "" : "s"} failed to download (${bad.slice(0, 3).map((t) => t.sobject).join(", ")}${bad.length > 3 ? ", …" : ""}).` });
    const cut = s.tables.filter((t) => t.truncated);
    if (cut.length) risks.push({ rank: 150, text: `First sync for ${s.user.username}: ${cut.length} table${cut.length === 1 ? " was" : "s were"} cut short by a limit, so the totals understate a real sync.` });
  }
  return risks.sort((x, y) => y.rank - x.rank).map((r) => r.text);
}

// ---- sections -------------------------------------------------------------

function targetsSection(a: AssessmentResult): string {
  let out = `## Targets by persona\n\nA persona is a type of rep (for example, a field rep) tested with representative users from the customer's org.\n\n`;
  out += `| Persona | Reps tested | Result | Targets met | Close to limit | Missed | Not measured |\n|---|---|---|---|---|---|---|\n`;
  for (const p of a.personas) {
    const c = counts([p]);
    const result = c.total === 0 ? "No targets" : c.missed ? "Not ready" : c.unmeasured ? "Not proven" : c.close ? "Ready, watch" : "Ready";
    const users = (p.users ?? []).length || p.volumes.filter((v) => !v.error).length;
    out += `| ${cell(p.persona.name)} | ${users} | ${result} | ${c.met} of ${c.total} | ${c.close} | ${c.missed} | ${c.unmeasured} |\n`;
  }
  for (const p of a.personas) {
    const rows = p.evaluations.filter((e) => e.status !== "no-threshold");
    if (!rows.length) continue;
    out += `\n### ${p.persona.name}\n\n| Measure | Result | Target | Limit | Outcome |\n|---|---|---|---|---|\n`;
    for (const e of rows) {
      const value = e.value === undefined ? "—" : plainValue(e.metric, e.value);
      const t = e.threshold;
      out += `| ${cell(metricLabel(e.metric))} | ${value} | ${t?.warn === undefined ? "—" : plainValue(e.metric, t.warn)} | ${t?.fail === undefined ? "—" : plainValue(e.metric, t.fail)} | ${STATUS_WORD[e.status]} |\n`;
    }
  }
  out += `\nA result at or below the target is met. Above the target but at or below the limit is close to the limit. Above the limit is missed.\n`;
  return out;
}

function risksSection(risks: string[]): string {
  let out = `## Top risks\n\n`;
  if (!risks.length) return out + `No risks found. Every target with data was met.\n`;
  out += risks.slice(0, TOP_RISKS).map((r) => `- ${r}`).join("\n") + "\n";
  if (risks.length > TOP_RISKS) out += `\n${risks.length - TOP_RISKS} more in the appendix.\n`;
  return out;
}

const mbOf = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function simsSection(sims: Sim[]): string {
  let out = `## First sync results\n\nA first sync is what a rep's iPad downloads the first time they sign in. These figures are simulated from the network side only; a real device also spends time saving the data, so real first syncs run longer.\n\n`;
  out += `| Rep | Total time | Metadata | Records | Tables | Data downloaded |\n|---|---|---|---|---|---|\n`;
  for (const s of sims) {
    const total = s.metadata.seconds + s.totals.seconds;
    const spread = s.runs && s.runs.count > 1 ? ` (${plainSeconds(s.runs.total.min)} to ${plainSeconds(s.runs.total.max)} over ${s.runs.count} runs)` : "";
    out += `| ${cell(s.user.username)}${s.user.territory ? ` (${cell(s.user.territory)})` : ""} | ${plainSeconds(total)}${spread} | ${plainSeconds(s.metadata.seconds)} | ${num(s.totals.records)} | ${s.totals.tablesDownloaded} | ${mbOf(s.totals.bytes + s.metadata.bytes)} |\n`;
  }
  for (const s of sims) {
    const slow = [...s.tables].filter((t) => !t.skipped).sort((x, y) => y.seconds - x.seconds || y.records - x.records).slice(0, SLOWEST_TABLES);
    if (!slow.length) continue;
    out += `\nSlowest tables for ${s.user.username}: ${slow.map((t) => `${t.sobject} (${plainSeconds(t.seconds)}, ${num(t.records)} records)`).join("; ")}.\n`;
    if (s.delta) out += `Delta sync after ${s.delta.sinceHours} h away: ${plainSeconds(s.delta.totals.seconds)}.\n`;
  }
  return out;
}

function changesSection(now: AssessmentResult, base: AssessmentResult): string {
  const byName = new Map(base.personas.map((p) => [p.persona.name.trim().toLowerCase(), p]));
  const rows: string[] = [];
  for (const p of now.personas) {
    const before = byName.get(p.persona.name.trim().toLowerCase());
    if (!before) continue;
    for (const e of p.evaluations) {
      const old = before.evaluations.find((x) => x.metric === e.metric);
      if (!old || e.value === undefined || old.value === undefined) continue;
      const diff = e.value - old.value;
      const change = diff === 0 ? "no change" : `${diff > 0 ? "worse by" : "better by"} ${plainValue(e.metric, Math.abs(diff))}`;
      const outcome = old.status === e.status ? STATUS_WORD[e.status] : `${STATUS_WORD[old.status]} to ${STATUS_WORD[e.status]}`;
      rows.push(`| ${cell(p.persona.name)} | ${cell(metricLabel(e.metric))} | ${plainValue(e.metric, old.value)} | ${plainValue(e.metric, e.value)} | ${change} | ${outcome} |`);
    }
  }
  let out = `## Changes since the baseline\n\nCompared with the run of ${base.generatedAt}.\n\n`;
  if (!rows.length) return out + `No measure appears in both runs, so there is nothing to compare.\n`;
  out += `| Persona | Measure | Baseline | Now | Change | Outcome |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
  return out;
}

/** Shift a rendered report's headings down so they nest under the appendix. */
function demote(md: string, by = 3): string {
  return md.replace(/^(#{1,6}) /gm, (_, h: string) => `${"#".repeat(Math.min(6, h.length + by))} `);
}

function appendix(a: AssessmentResult, sims: Sim[], days: number): string {
  let out = `## Appendix: detailed results\n\n### Performance assessment\n\n${demote(renderAssessment(a, days))}`;
  sims.slice(0, MAX_APPENDIX_SIMS).forEach((s) => {
    out += `\n\n### First sync: ${s.user.username}\n\n${demote(renderSimulation(s))}`;
    const runs = renderRunsSection(s);
    if (runs) out += `\n${demote(runs)}`;
  });
  if (sims.length > MAX_APPENDIX_SIMS) out += `\n\n${sims.length - MAX_APPENDIX_SIMS} more first-sync result(s) are summarised above but not detailed here.\n`;
  return out;
}

export function renderSignoffReport(input: SignoffReportInput): string {
  if (!isObject(input)) throw new Error("Sign-off input must be an object.");
  const a = checkAssessment(input.assessment, "The assessment");
  const baseline = input.baseline === undefined ? undefined : checkAssessment(input.baseline, "The baseline");
  if (input.simulations !== undefined && !Array.isArray(input.simulations)) throw new Error("Simulations must be a list.");
  const sims = (input.simulations ?? []).map(checkSimulation);
  const days = input.days ?? DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1) throw new Error("Days must be a whole number of at least 1.");

  const date = Number.isNaN(Date.parse(a.generatedAt)) ? a.generatedAt : new Date(a.generatedAt).toISOString().slice(0, 10);
  let out = `# Go-live sign-off: ${a.profile}\n\n`;
  out += `**Date:** ${date}  \n`;
  if (a.org) out += `**Org:** ${a.org}  \n`;
  out += `**Test plan:** ${a.profile}\n\n`;
  out += `## Verdict\n\n${verdict(a)}\n\n`;
  out += `${targetsSection(a)}\n`;
  out += `${risksSection(risksOf(a, sims))}\n`;
  if (sims.length) out += `${simsSection(sims)}\n`;
  if (baseline) out += `${changesSection(a, baseline)}\n`;
  out += `---\n\n${appendix(a, sims, days)}\n`;
  return out;
}
