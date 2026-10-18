/**
 * NFR (non-functional requirement) profiles for LSC performance assessments.
 *
 * A profile names the personas to test (representative users, listed or
 * selected by profile) and the thresholds each measured metric is evaluated
 * against. Every metric is "lower is better": a value above `fail` fails,
 * above `warn` warns.
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
  deviceSoqlRequests: { label: "Estimated device requests (initial sync download)", unit: "requests" },
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

/** "The N heaviest active standard users with this profile" — most territories in the active model first. */
const selectSchema = z.object({
  profile: z.string().min(1),
  count: z.number().int().min(1).max(10).optional(),
  /** Put the profile's users who synced in the telemetry window first, so field telemetry has data. */
  preferSynced: z.boolean().optional(),
});

const personaSchema = z
  .object({
    name: z.string(),
    /** Usernames or User Ids. Tested before any users `select` picks. */
    users: z.array(z.string()).default([]),
    select: selectSchema.optional(),
    territory: z.string().optional(),
    thresholds: thresholdsSchema.optional(),
  })
  .refine((p) => p.users.some((u) => u.trim()) || p.select !== undefined, {
    message: "persona needs users or a select (profile) to pick them",
    path: ["users"],
  });

/** Days of field telemetry a plan reads when it doesn't say. */
export const DEFAULT_TELEMETRY_DAYS = 30;

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

/** "incomplete": the value is a minimum or missing parts, so it can't be called a pass. */
export type EvalStatus = "pass" | "warn" | "fail" | "no-data" | "no-threshold" | "incomplete";

export interface MetricEvaluation {
  metric: MetricKey;
  value: number | undefined;
  threshold: Threshold | undefined;
  status: EvalStatus;
  detail?: string;
  /** Why the value may be understated (tables that couldn't be counted in full). */
  incomplete?: string;
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

/**
 * Note that a value is built from data that is missing or a minimum. A value
 * already over a limit stays warn/fail (more data only raises it); one that
 * would pass or has no limit becomes "incomplete".
 */
export function markIncomplete(e: MetricEvaluation, reason: string): MetricEvaluation {
  const status = e.status === "pass" || e.status === "no-threshold" ? "incomplete" : e.status;
  return { ...e, status, incomplete: reason };
}

/** Worst status wins; no-data / no-threshold never fail an assessment, and incomplete never passes. */
export function overallStatus(evals: MetricEvaluation[]): "pass" | "warn" | "fail" {
  if (evals.some((e) => e.status === "fail")) return "fail";
  if (evals.some((e) => e.status === "warn" || e.status === "incomplete")) return "warn";
  return "pass";
}
