/**
 * NFR (non-functional requirement) profiles for LSC performance assessments.
 *
 * A profile names the personas to test (representative users) and the
 * thresholds each measured metric is evaluated against. Every metric is
 * "lower is better": a value above `fail` fails, above `warn` warns.
 *
 * Only thresholds with a published source ship as defaults. Everything else
 * must come from the customer's NFR/SLA document — the harness reports the
 * measured value with status "no-threshold" rather than inventing a target.
 */

import * as fs from "fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const METRICS = {
  predictedRecordsTotal: { label: "Predicted records synced (total)", unit: "records" },
  predictedRecordsPerTable: { label: "Predicted records synced (largest table)", unit: "records" },
  deviceSoqlRequests: { label: "Estimated device SOQL requests (visibility pass)", unit: "requests" },
  initialSyncP95Sec: { label: "Initial sync p95", unit: "s" },
  deltaSyncP95Sec: { label: "Delta sync p95", unit: "s" },
  metadataDownloadP95Sec: { label: "Metadata cache download p95", unit: "s" },
  syncFailureRatePct: { label: "Sync failure rate", unit: "%" },
  dbSizeP95Gb: { label: "Device DB size p95", unit: "GB" },
} as const;

export type MetricKey = keyof typeof METRICS;

const thresholdSchema = z
  .object({
    warn: z.number().optional(),
    fail: z.number().optional(),
  })
  .refine((t) => t.warn !== undefined || t.fail !== undefined, {
    message: "threshold needs at least one of warn/fail",
  });

export type Threshold = z.infer<typeof thresholdSchema>;

const metricKeys = Object.keys(METRICS) as [MetricKey, ...MetricKey[]];
const thresholdsSchema = z.record(z.enum(metricKeys), thresholdSchema);

const personaSchema = z.object({
  name: z.string(),
  users: z.array(z.string()).min(1),
  territory: z.string().optional(),
  thresholds: thresholdsSchema.optional(),
});

export const nfrProfileSchema = z.object({
  name: z.string(),
  personas: z.array(personaSchema).min(1),
  thresholds: thresholdsSchema.optional(),
  telemetry: z
    .object({
      days: z.number().int().positive().optional(),
    })
    .optional(),
});

export type NfrProfile = z.infer<typeof nfrProfileSchema>;
export type Persona = z.infer<typeof personaSchema>;
export type Thresholds = Partial<Record<MetricKey, Threshold>>;

/**
 * Thresholds with a published source. The metadata download target is the
 * lsc-metadata-svc SLO (download p95 < 5s, alert at > 10s).
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  metadataDownloadP95Sec: { warn: 5, fail: 10 },
};

export function parseNfrProfile(yamlText: string): NfrProfile {
  const raw = parseYaml(yamlText);
  const parsed = nfrProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid NFR profile:\n${issues}`);
  }
  return parsed.data;
}

export function loadNfrProfile(filePath: string): NfrProfile {
  return parseNfrProfile(fs.readFileSync(filePath, "utf-8"));
}

/** Defaults, then profile-wide thresholds, then persona overrides. */
export function effectiveThresholds(profile: NfrProfile, persona: Persona): Thresholds {
  return {
    ...DEFAULT_THRESHOLDS,
    ...(profile.thresholds as Thresholds | undefined),
    ...(persona.thresholds as Thresholds | undefined),
  };
}

export type EvalStatus = "pass" | "warn" | "fail" | "no-data" | "no-threshold";

export interface MetricEvaluation {
  metric: MetricKey;
  value: number | undefined;
  threshold: Threshold | undefined;
  status: EvalStatus;
  detail?: string;
}

export function evaluateMetric(
  metric: MetricKey,
  value: number | undefined,
  threshold: Threshold | undefined,
  detail?: string
): MetricEvaluation {
  let status: EvalStatus;
  if (value === undefined || Number.isNaN(value)) status = "no-data";
  else if (!threshold) status = "no-threshold";
  else if (threshold.fail !== undefined && value > threshold.fail) status = "fail";
  else if (threshold.warn !== undefined && value > threshold.warn) status = "warn";
  else status = "pass";
  return { metric, value, threshold, status, detail };
}

/** Worst status wins; no-data / no-threshold never fail an assessment. */
export function overallStatus(evals: MetricEvaluation[]): "pass" | "warn" | "fail" {
  if (evals.some((e) => e.status === "fail")) return "fail";
  if (evals.some((e) => e.status === "warn")) return "warn";
  return "pass";
}
