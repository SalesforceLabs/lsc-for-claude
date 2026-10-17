// Structural copy of src/perf/simulate.ts, src/perf/device/replay.ts and src/studio/simulate.ts
// result types — the renderer bundle cannot import from src/. Keep in sync.

export type SimFlow = "enhanced" | "legacy";

export interface SimTable {
  sobject: string;
  developerName: string;
  records: number;
  requests: number;
  bytes: number;
  seconds: number;
  skipped?: string;
  error?: string;
  truncated?: string;
}

export interface SimulationResult {
  user: { username: string; id: string; profile?: string; territory?: string };
  org: { instanceUrl: string; orgId?: string; apiVersion: string };
  flow: SimFlow;
  metadata: { bytes: number; seconds: number; version: string; requests: number };
  tables: SimTable[];
  totals: {
    records: number;
    requests: number;
    bytes: number;
    seconds: number;
    tablesDownloaded: number;
    tablesSkipped: number;
    tablesFailed: number;
  };
  startedAt: string;
  finishedAt: string;
  notes: string[];
}

export interface SimRunOptions {
  territory?: string;
  forceFlow?: SimFlow;
  include?: string[];
  exclude?: string[];
  maxSeconds?: number;
  maxRecordsPerTable?: number;
  maxTotalRecords?: number;
}

export interface SimJobStatus {
  jobId: string;
  connection: string;
  state: "running" | "done" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  step: string;
  tables?: { done: number; total: number; records: number };
  result?: SimulationResult;
  error?: string;
}

/** An sf CLI connection, as listSfOrgs returns it. */
export interface SfConnection {
  alias?: string;
  username: string;
  orgId: string;
  instanceUrl: string;
  isDefault?: boolean;
}

/** What the history list shows, stored beside the full result. */
export interface SimSummary {
  username: string;
  profile?: string;
  flow: SimFlow;
  records: number;
  /** Metadata download plus data download, network time only. */
  seconds: number;
  failed: number;
  truncated: boolean;
}

export function simSummary(r: SimulationResult): SimSummary {
  return {
    username: r.user.username,
    profile: r.user.profile,
    flow: r.flow,
    records: r.totals.records,
    seconds: r.metadata.seconds + r.totals.seconds,
    failed: r.totals.tablesFailed,
    truncated: r.tables.some((t) => t.truncated),
  };
}

export function asSimSummary(x: unknown): SimSummary | null {
  const s = x as Partial<SimSummary> | null;
  return s && typeof s.username === "string" && typeof s.records === "number" && typeof s.seconds === "number" ? (s as SimSummary) : null;
}

/** "rep1 · rep@x.com" when the connection has an alias, else the username. */
export function connectionLabel(c: Pick<SfConnection, "alias" | "username">): string {
  return c.alias ? `${c.alias} · ${c.username}` : c.username;
}

/** The value studio_sim_start takes for a connection: its alias when it has one. */
export const connectionRef = (c: Pick<SfConnection, "alias" | "username">) => c.alias || c.username;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatSeconds(s: number): string {
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

/** Downloaded tables slowest first, then the skipped and failed ones in schema order. */
export function rankTables(tables: SimTable[]): { downloaded: SimTable[]; flagged: SimTable[] } {
  const downloaded = tables.filter((t) => !t.skipped && !t.error).sort((a, b) => b.seconds - a.seconds || b.records - a.records);
  return { downloaded, flagged: tables.filter((t) => t.skipped || t.error) };
}

/** Comma- or newline-separated SObject names, trimmed and de-duplicated; undefined when empty. */
export function parseSObjectList(text: string): string[] | undefined {
  const names = [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
  return names.length ? names : undefined;
}

/** Connections that weren't in `before`, by username — how a finished browser login is spotted. */
export function newConnections(before: SfConnection[], after: SfConnection[]): SfConnection[] {
  const known = new Set(before.map((c) => c.username.toLowerCase()));
  return after.filter((c) => !known.has(c.username.toLowerCase()));
}
