import type { AssessmentResult, EvalStatus, MetricKey } from "./perf-types";

/** One metric's outcome in a run. */
export interface MetricPoint {
  value?: number;
  status: EvalStatus;
  warn?: number;
  fail?: number;
}

/** What the runs list and trends need from a run, stored beside its full result. */
export interface RunSummary {
  personas: Array<{ name: string; metrics: Partial<Record<MetricKey, MetricPoint>> }>;
  /** The metric furthest past (or closest to) its limit; absent when no metric has a target and a value. */
  worst?: { persona: string; metric: MetricKey; status: EvalStatus; value?: number };
}

const SEVERITY: Record<EvalStatus, number> = { fail: 3, warn: 2, pass: 1, "no-threshold": 0, "no-data": 0, incomplete: 1 };

/** How far a value is toward its limit: 1 means at the fail (or, without one, warn) threshold. */
function loadRatio(p: MetricPoint): number {
  const limit = p.fail ?? p.warn;
  if (p.value === undefined || limit === undefined) return 0;
  return limit > 0 ? p.value / limit : p.value > 0 ? Infinity : 0;
}

export function runSummary(result: AssessmentResult): RunSummary {
  const summary: RunSummary = { personas: [] };
  let worst: { persona: string; metric: MetricKey; point: MetricPoint } | undefined;
  for (const p of result.personas) {
    const metrics: Partial<Record<MetricKey, MetricPoint>> = {};
    for (const e of p.evaluations) {
      const point: MetricPoint = { value: e.value, status: e.status, warn: e.threshold?.warn, fail: e.threshold?.fail };
      metrics[e.metric] = point;
      if (SEVERITY[point.status] === 0) continue;
      if (
        !worst ||
        SEVERITY[point.status] > SEVERITY[worst.point.status] ||
        (SEVERITY[point.status] === SEVERITY[worst.point.status] && loadRatio(point) > loadRatio(worst.point))
      ) {
        worst = { persona: p.persona.name, metric: e.metric, point };
      }
    }
    summary.personas.push({ name: p.persona.name, metrics });
  }
  if (worst) summary.worst = { persona: worst.persona, metric: worst.metric, status: worst.point.status, value: worst.point.value };
  return summary;
}

/** Narrow an unknown stored summary (null for runs saved before summaries existed). */
export function asRunSummary(raw: unknown): RunSummary | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as RunSummary).personas)) return null;
  return raw as RunSummary;
}

export interface TrendRow {
  persona: string;
  metric: MetricKey;
  /** Oldest first; undefined where a run had no value. */
  values: Array<number | undefined>;
  latest: MetricPoint;
}

export const TREND_RUNS = 10;

/**
 * Per persona and metric, the values across the newest runs (given newest first),
 * keeping only rows with at least two values to compare.
 */
export function trendRows(runs: Array<{ summary?: unknown }>, limit = TREND_RUNS): TrendRow[] {
  const summaries = runs
    .map((r) => asRunSummary(r.summary))
    .filter((s): s is RunSummary => s !== null)
    .slice(0, limit)
    .reverse();
  if (summaries.length < 2) return [];
  const latest = summaries[summaries.length - 1];
  const rows: TrendRow[] = [];
  for (const persona of latest.personas) {
    const key = persona.name.toLowerCase();
    for (const [metric, point] of Object.entries(persona.metrics) as Array<[MetricKey, MetricPoint]>) {
      const values = summaries.map((s) => s.personas.find((p) => p.name.toLowerCase() === key)?.metrics[metric]?.value);
      if (values.filter((v) => v !== undefined).length >= 2) rows.push({ persona: persona.name, metric, values, latest: point });
    }
  }
  return rows;
}

/** SVG polyline points for a sparkline of `values` in a `width` × `height` box; gaps are skipped. */
export function sparkPoints(values: Array<number | undefined>, width: number, height: number): string {
  const known = values.filter((v): v is number => v !== undefined);
  if (known.length === 0) return "";
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => (v === undefined ? null : `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`))
    .filter((p): p is string => p !== null)
    .join(" ");
}
