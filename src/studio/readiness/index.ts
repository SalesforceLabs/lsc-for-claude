/**
 * collectReadiness() — is one LSC feature ready for the field?
 *
 * A feature's readiness is its rules from knowledge/validation-rules (the same
 * YAML `audit_mobile_config` runs) plus the TypeScript checks in its module
 * under `features/` — data health, cross-object checks, and checks that come
 * with one-click fixes. Every check lands in a stage (switched on → access →
 * data → settings → iPad) so the Readiness view reads top to bottom.
 *
 * A check that can't run is "unknown", never a failure: a missing object or a
 * query the admin can't run says nothing about whether the feature works.
 */

import { sharedReadsActive } from "../../config/read-cache.js";
import { executeCheck } from "../../validation/rules-executor.js";
import { getRulesFromFiles, type Category, type ValidationRule } from "../../validation/rules-loader.js";
import type { FeatureDefinition } from "../features.js";
import { query, type Row } from "../helpers.js";
import type { FeatureReadiness, ReadinessCheck, ReadinessStage } from "../types.js";
import { currentMapTracker, readinessKey, trackMap } from "../map-progress.js";
import { MODULES } from "./modules.js";
import { hasProfileFocus, trackFocusUse, withProfileFocus } from "../profile-focus.js";

/** What a feature contributes to readiness. */
export interface ReadinessModule {
  /** File names under knowledge/validation-rules whose rules apply to this feature. */
  ruleFiles: string[];
  /** TypeScript checks; each should come from `runCheck` so one failing query doesn't sink the rest. */
  checks?: (org: string) => Promise<ReadinessCheck[]>;
}

export const STAGES: { id: ReadinessStage; title: string }[] = [
  { id: "enabled", title: "Switched on" },
  { id: "access", title: "Access" },
  { id: "data", title: "Data" },
  { id: "config", title: "Settings & rules" },
  { id: "mobile", title: "iPad" },
];

const STAGE_FOR_CATEGORY: Record<Category, ReadinessStage> = {
  deployment: "enabled",
  permissions: "access",
  territory: "data",
  "mobile-login": "mobile",
  "metadata-cache": "mobile",
  sync: "mobile",
  configuration: "config",
};

/** Rules run against the org a few at a time — each is an sf CLI call. */
const CONCURRENCY = 4;
const MAX_EXAMPLES = 5;

/** One feature's readiness, for every profile or (`profile`, a profile name) for one. */
export function collectReadiness(feature: FeatureDefinition, org: string, profile?: string): Promise<FeatureReadiness> {
  return trackMap(readinessKey(feature.id), feature.id, feature.title, () =>
    withProfileFocus(profile, async () => ({ ...(await gatherReadiness(feature, org)), ...(profile ? { profile } : {}) }))
  );
}

async function gatherReadiness(feature: FeatureDefinition, org: string): Promise<FeatureReadiness> {
  const mod = MODULES[feature.id] ?? { ruleFiles: [] };
  const tracker = currentMapTracker();
  if (mod.checks) tracker?.plan([{ key: "studio-checks", label: "Studio's checks" }]);
  const [rules, custom] = await Promise.all([
    runRules(getRulesFromFiles(mod.ruleFiles), org),
    mod.checks
      ? (async () => {
          tracker?.start("studio-checks", "Studio's checks");
          try {
            const out = await mod.checks!(org);
            tracker?.end("studio-checks", { count: out.length, noun: "check" });
            return out;
          } catch (err: unknown) {
            tracker?.end("studio-checks", { error: err instanceof Error ? err.message : String(err) });
            return [crashed(feature.id, err)];
          }
        })()
      : Promise.resolve([]),
  ]);
  const order = new Map(STAGES.map((s, i) => [s.id, i]));
  // Stable sort: within a stage, rules keep their file order, then Studio checks.
  const checks = [...rules, ...custom].sort((a, b) => (order.get(a.stage) ?? 0) - (order.get(b.stage) ?? 0));
  return { featureId: feature.id, title: feature.title, org, collectedAt: new Date().toISOString(), checks };
}

function crashed(featureId: string, err: unknown): ReadinessCheck {
  return {
    id: `${featureId}.checks`,
    stage: "enabled",
    title: "Studio's checks for this feature couldn't run",
    status: "unknown",
    severity: "info",
    detail: err instanceof Error ? err.message : String(err),
    source: "studio",
  };
}

// ─── Rules ──────────────────────────────────────────────────────────────────

/**
 * Run rules a few at a time; a rule waits for its prerequisites and is skipped
 * if one failed, or can't be checked if one couldn't be (or the prerequisites loop).
 */
export async function runRules(rules: ValidationRule[], org: string): Promise<ReadinessCheck[]> {
  warmSlowRules(rules, org);
  currentMapTracker()?.plan(rules.map((r) => ({ key: `rule:${r.id}`, label: r.name })));
  const ids = new Set(rules.map((r) => r.id));
  const results = new Map<string, Promise<ReadinessCheck>>();
  const limit = semaphore(CONCURRENCY);
  const run = (rule: ValidationRule, path: string[]): Promise<ReadinessCheck> => {
    let p = results.get(rule.id);
    if (p) return p;
    const prereqs = (rule.prerequisites ?? []).filter((id) => ids.has(id));
    const loop = prereqs.find((id) => id === rule.id || path.includes(id));
    p = loop
      ? Promise.resolve({ ...ruleBase(rule), status: "unknown", detail: `Its prerequisites loop back through "${loop}".` })
      : (async (): Promise<ReadinessCheck> => {
          const done = await Promise.all(prereqs.map((id) => run(rules.find((r) => r.id === id)!, [...path, rule.id])));
          const failed = done.find((d) => d.status === "fail" || d.status === "skipped");
          if (failed) return { ...ruleBase(rule), status: "skipped", detail: `Depends on "${failed.title}", which didn't pass.` };
          const unknown = done.find((d) => d.status !== "pass");
          if (unknown) return { ...ruleBase(rule), status: "unknown", detail: `Depends on "${unknown.title}", which couldn't be checked.` };
          return limit(() => checkRule(rule, org));
        })();
    results.set(rule.id, p);
    return p;
  };
  return Promise.all(rules.map((r) => run(r, [])));
}

/**
 * FlowDefinitionView answers take 12-24 s each on the server, and rules that wait behind prerequisites
 * (or the concurrency limit) would start them one after another. Inside a shared read scope, start those
 * rules' queries now: the rule's own run then finds the read in flight or done. Results are ignored here.
 */
function warmSlowRules(rules: ValidationRule[], org: string): void {
  if (!sharedReadsActive()) return;
  for (const rule of rules) {
    const q = (rule.check as { query?: unknown }).query;
    if (typeof q === "string" && /\bFlowDefinitionView\b/i.test(q)) executeCheck(rule.check, org).catch(() => undefined);
  }
}

function ruleBase(rule: ValidationRule): Omit<ReadinessCheck, "status"> {
  return {
    id: rule.id,
    stage: rule.stage ?? STAGE_FOR_CATEGORY[rule.category] ?? "config",
    title: rule.name,
    severity: rule.severity,
    why: rule.description?.replace(/\s+/g, " ").trim(),
    steps: rule.resolution?.steps,
    uiPath: rule.resolution?.ui_path,
    ...(rule.studio_surface ? { surface: rule.studio_surface } : {}),
    // Rules are org-wide queries; with a profile picked they still answer for everyone.
    ...(hasProfileFocus() ? { everyProfile: true } : {}),
    source: "rule",
  };
}

async function checkRule(rule: ValidationRule, org: string): Promise<ReadinessCheck> {
  const tracker = currentMapTracker();
  const key = `rule:${rule.id}`;
  tracker?.start(key, rule.name);
  try {
    const check = await checkRuleNow(rule, org);
    tracker?.end(key, check.status === "unknown" ? { detail: "Couldn't check" } : { detail: check.status === "pass" ? "Passed" : "Needs attention" });
    return check;
  } catch (err) {
    tracker?.end(key, { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

async function checkRuleNow(rule: ValidationRule, org: string): Promise<ReadinessCheck> {
  const base = ruleBase(rule);
  const outcome = await executeCheck(rule.check, org);
  if (outcome.unavailable) return { ...base, status: "unknown", detail: outcome.message };
  const details = (outcome.details ?? {}) as { count?: number; records?: Row[] };
  const found =
    typeof details.count === "number" ? `Found ${details.count}.` : Array.isArray(details.records) ? `Found ${details.records.length}.` : undefined;
  if (outcome.passed) return { ...base, status: "pass", ...(found ? { detail: found } : {}) };

  let rows = details.records ?? [];
  if (rule.check.error_detail_query) {
    try {
      rows = await query(rule.check.error_detail_query, org, rule.check.type.startsWith("tooling"));
    } catch {
      // Examples are a nicety; the failure stands on its own.
    }
  }
  const examples = rows.slice(0, MAX_EXAMPLES).map(rowLabel);
  return { ...base, status: "fail", ...(found ? { detail: found } : {}), ...(examples.length ? { examples } : {}) };
}

/** A record's name for people: its Name-like field, else its Id. */
export function rowLabel(row: Row): string {
  for (const key of ["Name", "MasterLabel", "DeveloperName", "Label", "Username", "Subject"]) {
    if (typeof row[key] === "string" && row[key]) return row[key] as string;
  }
  return String(row.Id ?? JSON.stringify(row));
}

function semaphore(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    // A finished run hands its slot straight to the next waiter, so a newcomer can't take it in between.
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

// ─── Studio checks ──────────────────────────────────────────────────────────

/** What a Studio check function returns; `pass` decides pass/fail. */
export interface StudioCheckResult {
  pass: boolean;
  detail?: string;
  examples?: string[];
  fixes?: ReadinessCheck["fixes"];
  /** Not applicable to this org (e.g. the feature's optional part isn't used) — shown as skipped. */
  skip?: boolean;
}

/**
 * Run one Studio check. A thrown error (query failed, object missing) makes it
 * "unknown" with the error as its detail, not a failure.
 */
export async function runCheck(
  meta: Omit<ReadinessCheck, "status" | "source" | "detail" | "examples" | "fixes">,
  fn: () => Promise<StudioCheckResult>
): Promise<ReadinessCheck> {
  const focused = hasProfileFocus();
  try {
    const { value: r, used } = await trackFocusUse(fn);
    const status = r.skip ? "skipped" : r.pass ? "pass" : "fail";
    return {
      ...meta,
      status,
      source: "studio",
      ...(focused && !used ? { everyProfile: true } : {}),
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.examples?.length ? { examples: r.examples.slice(0, MAX_EXAMPLES) } : {}),
      ...(!r.pass && r.fixes?.length ? { fixes: r.fixes } : {}),
    };
  } catch (err) {
    return { ...meta, status: "unknown", source: "studio", detail: err instanceof Error ? err.message : String(err) };
  }
}
