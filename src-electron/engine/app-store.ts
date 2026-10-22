import { randomUUID } from "crypto";
import { getDb } from "./history.js";
import type { AppProject } from "./app-types.js";

/**
 * LSC App Builder projects, kept per org — a project's name and files belong to the org it was
 * built against. Each row holds the whole project (turns and versions) as JSON; a project is
 * small enough that saving it whole is simpler than child tables.
 */

export type { AppProject };

/** What the builder and IPC layer need from storage; tests substitute an in-memory one. */
export interface AppStore {
  list(org: string): AppProject[];
  get(id: string): AppProject | null;
  /** Save the whole project (insert or replace). */
  save(project: AppProject): void;
  delete(id: string): void;
  /** Mark turns left "running" by a closed app as stopped; returns how many projects changed. */
  recoverInterrupted(): number;
}

export const INTERRUPTED_MESSAGE = "Roz was closed during this build";

/** Stop any turn still running in `project` (nothing is running after a restart); true when it changed. */
export function stopInterrupted(project: AppProject): boolean {
  let changed = false;
  for (const turn of project.turns) {
    if (turn.status !== "running") continue;
    turn.status = "stopped";
    turn.error = INTERRUPTED_MESSAGE;
    for (const step of turn.steps) if (step.status === "running") Object.assign(step, { status: "failed", endedAt: step.endedAt ?? new Date().toISOString() });
    changed = true;
  }
  return changed;
}

let initialized = false;

function db() {
  const d = getDb();
  if (!initialized) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS app_projects (
        id TEXT PRIMARY KEY,
        org TEXT NOT NULL,
        name TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_projects_org ON app_projects(org, updated_at);
    `);
    initialized = true;
  }
  return d;
}

export const newProjectId = (): string => randomUUID();

export const sqliteAppStore: AppStore = {
  list(org) {
    const rows = db().prepare("SELECT data FROM app_projects WHERE org = ? ORDER BY updated_at DESC").all(org.toLowerCase()) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as AppProject);
  },
  get(id) {
    const row = db().prepare("SELECT data FROM app_projects WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as AppProject) : null;
  },
  save(project) {
    db()
      .prepare(
        `INSERT INTO app_projects (id, org, name, updated_at, data) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET org = excluded.org, name = excluded.name, updated_at = excluded.updated_at, data = excluded.data`
      )
      .run(project.id, project.org.toLowerCase(), project.name, project.updatedAt, JSON.stringify(project));
  },
  delete(id) {
    db().prepare("DELETE FROM app_projects WHERE id = ?").run(id);
  },
  recoverInterrupted() {
    const rows = db().prepare("SELECT data FROM app_projects WHERE data LIKE '%\"status\":\"running\"%'").all() as Array<{ data: string }>;
    let n = 0;
    for (const r of rows) {
      const project = JSON.parse(r.data) as AppProject;
      if (stopInterrupted(project)) {
        this.save(project);
        n++;
      }
    }
    return n;
  },
};

/** In-memory store for tests. */
export function memoryAppStore(): AppStore {
  const rows = new Map<string, string>();
  return {
    list: (org) =>
      [...rows.values()]
        .map((r) => JSON.parse(r) as AppProject)
        .filter((p) => p.org === org.toLowerCase())
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    get: (id) => (rows.has(id) ? (JSON.parse(rows.get(id)!) as AppProject) : null),
    save: (p) => void rows.set(p.id, JSON.stringify(p)),
    delete: (id) => void rows.delete(id),
    recoverInterrupted() {
      let n = 0;
      for (const [id, r] of rows) {
        const project = JSON.parse(r) as AppProject;
        if (stopInterrupted(project)) {
          rows.set(id, JSON.stringify(project));
          n++;
        }
      }
      return n;
    },
  };
}
