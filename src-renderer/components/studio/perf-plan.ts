import { stringify } from "yaml";
import type { AssessmentResult, EvalStatus, MetricEvaluation, MetricKey, PerfPlan, Persona, TableVolume, TerritoryVolume, Thresholds } from "./perf-types";

/** Same keys, labels, and units as src/perf/nfr.ts METRICS, in report order. */
export const METRICS: Array<{ key: MetricKey; label: string; unit: string; source: "config" | "telemetry" }> = [
  { key: "predictedRecordsTotal", label: "Predicted records synced (total)", unit: "records", source: "config" },
  { key: "predictedRecordsPerTable", label: "Predicted records synced (largest table)", unit: "records", source: "config" },
  { key: "deviceSoqlRequests", label: "Estimated device SOQL requests (visibility pass)", unit: "requests", source: "config" },
  { key: "initialSyncP95Sec", label: "Initial sync p95", unit: "s", source: "telemetry" },
  { key: "deltaSyncP95Sec", label: "Delta sync p95", unit: "s", source: "telemetry" },
  { key: "metadataDownloadP95Sec", label: "Metadata cache download p95", unit: "s", source: "telemetry" },
  { key: "syncFailureRatePct", label: "Sync failure rate", unit: "%", source: "telemetry" },
  { key: "dbSizeP95Gb", label: "Device DB size p95", unit: "GB", source: "telemetry" },
];

export const metricInfo = (key: MetricKey) => METRICS.find((m) => m.key === key) ?? { key, label: key, unit: "", source: "config" as const };

/** Mirrors DEFAULT_THRESHOLDS in src/perf/nfr.ts — the only target with a published source. */
export const DEFAULT_THRESHOLDS: Thresholds = { metadataDownloadP95Sec: { warn: 5, fail: 10 } };
export const DEFAULT_SOURCE = "lsc-metadata-svc SLO";

export const DEFAULT_TELEMETRY_DAYS = 30;

export function emptyPersona(index: number): Persona {
  return { name: `Persona ${index + 1}`, users: [] };
}

export function emptyPlan(): PerfPlan {
  return { name: "New test plan", telemetry: { days: DEFAULT_TELEMETRY_DAYS }, personas: [emptyPersona(0)] };
}

/** The threshold a persona inherits for a metric before its own override. */
export function inheritedThreshold(plan: PerfPlan, key: MetricKey) {
  return plan.thresholds?.[key] ?? DEFAULT_THRESHOLDS[key];
}

function cleanThresholds(t: Thresholds | undefined): Thresholds | undefined {
  if (!t) return undefined;
  const out: Thresholds = {};
  for (const m of METRICS) {
    const v = t[m.key];
    if (!v) continue;
    const entry: { warn?: number; fail?: number } = {};
    if (typeof v.warn === "number" && Number.isFinite(v.warn)) entry.warn = v.warn;
    if (typeof v.fail === "number" && Number.isFinite(v.fail)) entry.fail = v.fail;
    if (entry.warn !== undefined || entry.fail !== undefined) out[m.key] = entry;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The plan as the server expects it: trimmed, de-duplicated, no empty thresholds. */
export function normalizePlan(plan: PerfPlan): PerfPlan {
  const out: PerfPlan = {
    name: plan.name.trim() || "Untitled plan",
    personas: plan.personas.map((p) => {
      const persona: Persona = {
        name: p.name.trim() || "Persona",
        users: [...new Set(p.users.map((u) => u.trim()).filter(Boolean))],
      };
      if (p.territory?.trim()) persona.territory = p.territory.trim();
      const thresholds = cleanThresholds(p.thresholds);
      if (thresholds) persona.thresholds = thresholds;
      return persona;
    }),
  };
  const thresholds = cleanThresholds(plan.thresholds);
  if (thresholds) out.thresholds = thresholds;
  const days = plan.telemetry?.days;
  if (typeof days === "number" && Number.isFinite(days) && days > 0) out.telemetry = { days: Math.floor(days) };
  return out;
}

/** Problems that would make the run fail or mislead; empty when the plan can run. */
export function validatePlan(plan: PerfPlan): string[] {
  const issues: string[] = [];
  if (plan.personas.length === 0) issues.push("Add at least one persona.");
  const names = new Set<string>();
  plan.personas.forEach((p, i) => {
    const label = p.name.trim() || `Persona ${i + 1}`;
    if (p.users.filter((u) => u.trim()).length === 0) issues.push(`${label}: add at least one user.`);
    const key = label.toLowerCase();
    if (names.has(key)) issues.push(`Two personas are named “${label}” — runs are compared by persona name.`);
    names.add(key);
  });
  const checkThresholds = (t: Thresholds | undefined, where: string) => {
    for (const m of METRICS) {
      const v = t?.[m.key];
      if (!v) continue;
      if ((v.warn ?? 0) < 0 || (v.fail ?? 0) < 0) issues.push(`${where}${m.label}: thresholds can't be negative.`);
      if (v.warn !== undefined && v.fail !== undefined && v.warn > v.fail) {
        issues.push(`${where}${m.label}: warn (${v.warn}) is above fail (${v.fail}).`);
      }
    }
  };
  checkThresholds(plan.thresholds, "");
  plan.personas.forEach((p, i) => checkThresholds(p.thresholds, `${p.name.trim() || `Persona ${i + 1}`} — `));
  const days = plan.telemetry?.days;
  if (days !== undefined && (!Number.isFinite(days) || days < 1 || days > 365)) {
    issues.push("Telemetry window must be between 1 and 365 days.");
  }
  return issues;
}

export function planToYaml(plan: PerfPlan): string {
  return stringify(normalizePlan(plan));
}

export function planFileName(plan: PerfPlan, ext: string): string {
  const slug = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "test-plan";
  return `${slug}.${ext}`;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** Mirrors mayOvercount() in src/perf/sync-volume.ts. */
const OPEN_SHARING = new Set(["read", "readwrite", "readwritetransfer", "fullaccess"]);

/** An org-wide count on an object with restricted (or unknown) sharing — the user may download fewer. */
export function mayOvercount(t: TableVolume): boolean {
  return (
    t.status === "counted" &&
    t.scope === "org-wide" &&
    t.records > 0 &&
    !OPEN_SHARING.has((t.sharingModel ?? "").toLowerCase())
  );
}

export function upperBoundRecords(terr: TerritoryVolume): number {
  return terr.tables.filter(mayOvercount).reduce((n, t) => n + t.records, 0);
}

/** Measured value minus the previous run's, per persona name and metric. */
export function metricDeltas(current: AssessmentResult, previous: AssessmentResult | null | undefined) {
  const deltas = new Map<string, number>();
  if (!previous) return deltas;
  for (const p of current.personas) {
    const prev = previous.personas.find((q) => q.persona.name.toLowerCase() === p.persona.name.toLowerCase());
    if (!prev) continue;
    for (const e of p.evaluations) {
      const before = prev.evaluations.find((x) => x.metric === e.metric)?.value;
      if (e.value !== undefined && before !== undefined) deltas.set(deltaKey(p.persona.name, e.metric), e.value - before);
    }
  }
  return deltas;
}

export const deltaKey = (persona: string, metric: MetricKey) => `${persona.toLowerCase()}::${metric}`;

export function formatNumber(n: number | undefined | null, digits = 1): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(digits);
}

export function formatValue(e: Pick<MetricEvaluation, "metric" | "value">): string {
  if (e.value === undefined) return "—";
  const { unit } = metricInfo(e.metric);
  return unit === "records" || unit === "requests" ? formatNumber(e.value) : `${formatNumber(e.value)} ${unit}`;
}

export const STATUS_LABEL: Record<EvalStatus, string> = {
  pass: "Pass",
  warn: "Warn",
  fail: "Fail",
  "no-data": "No data",
  "no-threshold": "No target",
};

/** Studio chip class for a status (see .studio-chip variants). */
export const STATUS_CHIP: Record<EvalStatus, string> = {
  pass: "ok",
  warn: "warning",
  fail: "error",
  "no-data": "muted",
  "no-threshold": "info",
};

/** A prompt for "Ask Claude" that explains the failing metrics and their drivers. */
export function remediationPrompt(result: AssessmentResult): string {
  const lines: string[] = [];
  for (const p of result.personas) {
    const bad = p.evaluations.filter((e) => e.status === "fail" || e.status === "warn");
    for (const e of bad) {
      const t = e.threshold;
      lines.push(
        `- ${p.persona.name}: ${metricInfo(e.metric).label} ${e.status.toUpperCase()} — ${formatValue(e)}` +
          ` (warn ${formatNumber(t?.warn)}, fail ${formatNumber(t?.fail)})${e.detail ? `, driven by ${e.detail}` : ""}`
      );
    }
    const heavy = p.volumes
      .flatMap((v) => v.territories.flatMap((t) => t.tables.filter((x) => x.status === "counted").slice(0, 3).map((x) => `${x.sobject} ${formatNumber(x.records)}`)))
      .slice(0, 5);
    if (heavy.length) lines.push(`- ${p.persona.name}: largest tables ${heavy.join(", ")}`);
    const errors = p.volumes.flatMap((v) => v.territories.flatMap((t) => t.tables.filter((x) => x.status === "error").map((x) => x.sobject)));
    if (errors.length) lines.push(`- ${p.persona.name}: DB Schema filters that fail to execute: ${[...new Set(errors)].join(", ")}`);
    const unscoped = p.volumes.flatMap((v) => v.territories.flatMap((t) => t.tables.filter(mayOvercount).map((x) => `${x.sobject} (${x.sharingModel ?? "unknown"} sharing)`)));
    if (unscoped.length) lines.push(`- ${p.persona.name}: filters not scoped to the user, counted org-wide: ${[...new Set(unscoped)].join(", ")}`);
  }
  return [
    `A Studio performance run of "${result.profile}" on ${result.org} came back ${result.status.toUpperCase()}.`,
    "",
    ...(lines.length ? lines : ["- No metric warned or failed."]),
    "",
    "For each warning or failure, explain the likely cause and recommend specific configuration changes (DB Schema WhereSoql filters, profile/permission set assignments, territory alignment). Use get_db_schema and profile_sync_volume to inspect the drivers before recommending.",
  ].join("\n");
}
