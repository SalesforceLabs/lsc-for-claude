import { randomUUID } from "crypto";
import { getDb } from "./history.js";

/**
 * Studio performance test plans and run history, kept per org — plans name the
 * org's own users, so a plan from one org doesn't carry over to another.
 */

export interface PerfPlanRecord {
  id: string;
  org: string;
  name: string;
  /** The NFR profile as JSON (same shape as run_perf_assessment's YAML). */
  plan: unknown;
  updatedAt: string;
}

export interface PerfRunRecord {
  id: string;
  org: string;
  planId: string;
  planName: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  /** Per-metric values and the worst metric, for the runs list and trends; null for runs saved before it existed. */
  summary?: unknown;
  /** AssessmentResult JSON; omitted from list results. */
  result?: unknown;
}

let initialized = false;

function db() {
  const d = getDb();
  if (!initialized) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS perf_plans (
        id TEXT PRIMARY KEY,
        org TEXT NOT NULL,
        name TEXT NOT NULL,
        plan TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS perf_runs (
        id TEXT PRIMARY KEY,
        org TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        result TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_perf_runs_plan ON perf_runs(org, plan_id, started_at);
    `);
    const columns = d.prepare("PRAGMA table_info(perf_runs)").all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "summary")) d.exec("ALTER TABLE perf_runs ADD COLUMN summary TEXT");
    initialized = true;
  }
  return d;
}

interface PlanRow {
  id: string;
  org: string;
  name: string;
  plan: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  org: string;
  plan_id: string;
  plan_name: string;
  status: string;
  started_at: string;
  finished_at: string;
  summary?: string | null;
  result?: string;
}

const toPlan = (r: PlanRow): PerfPlanRecord => ({
  id: r.id,
  org: r.org,
  name: r.name,
  plan: JSON.parse(r.plan),
  updatedAt: r.updated_at,
});

const toRun = (r: RunRow): PerfRunRecord => ({
  id: r.id,
  org: r.org,
  planId: r.plan_id,
  planName: r.plan_name,
  status: r.status,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  summary: r.summary ? JSON.parse(r.summary) : null,
  ...(r.result !== undefined ? { result: JSON.parse(r.result) } : {}),
});

/**
 * Plans and runs saved before the org was known (no org picked in Settings) are filed
 * under "". They were made against the tools' connected org, so they move to it.
 */
export function adoptUnassigned(org: string): void {
  if (!org) return;
  const d = db();
  d.prepare("UPDATE perf_plans SET org = ? WHERE org = ''").run(org);
  d.prepare("UPDATE perf_runs SET org = ? WHERE org = ''").run(org);
}

export function listPerfPlans(org: string): PerfPlanRecord[] {
  const rows = db().prepare("SELECT * FROM perf_plans WHERE org = ? ORDER BY name COLLATE NOCASE").all(org) as PlanRow[];
  return rows.map(toPlan);
}

export function savePerfPlan(input: { id?: string; org: string; name: string; plan: unknown }): PerfPlanRecord {
  const id = input.id || randomUUID();
  const updatedAt = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO perf_plans (id, org, name, plan, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, plan = excluded.plan, updated_at = excluded.updated_at`
    )
    .run(id, input.org, input.name, JSON.stringify(input.plan), updatedAt);
  return { id, org: input.org, name: input.name, plan: input.plan, updatedAt };
}

export function deletePerfPlan(id: string): void {
  const d = db();
  d.prepare("DELETE FROM perf_runs WHERE plan_id = ?").run(id);
  d.prepare("DELETE FROM perf_plans WHERE id = ?").run(id);
}

/** Runs for a plan, newest first, with their summaries but not their (large) results. */
export function listPerfRuns(org: string, planId: string): PerfRunRecord[] {
  const rows = db()
    .prepare(
      "SELECT id, org, plan_id, plan_name, status, started_at, finished_at, summary FROM perf_runs WHERE org = ? AND plan_id = ? ORDER BY started_at DESC"
    )
    .all(org, planId) as RunRow[];
  return rows.map(toRun);
}

export function getPerfRun(id: string): PerfRunRecord | null {
  const row = db().prepare("SELECT * FROM perf_runs WHERE id = ?").get(id) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function savePerfRun(input: Omit<PerfRunRecord, "id"> & { result: unknown }): PerfRunRecord {
  const id = randomUUID();
  db()
    .prepare(
      "INSERT INTO perf_runs (id, org, plan_id, plan_name, status, started_at, finished_at, summary, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      id,
      input.org,
      input.planId,
      input.planName,
      input.status,
      input.startedAt,
      input.finishedAt,
      input.summary == null ? null : JSON.stringify(input.summary),
      JSON.stringify(input.result)
    );
  return { ...input, summary: input.summary ?? null, id };
}

export function deletePerfRun(id: string): void {
  db().prepare("DELETE FROM perf_runs WHERE id = ?").run(id);
}
