// Structural copy of src/perf/simulate.ts, src/perf/device/replay.ts, src/studio/simulate.ts and
// src/studio/sim-runs.ts result types — the renderer bundle cannot import from src/. Keep in sync.

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

export interface SimDeltaTable {
  sobject: string;
  developerName: string;
  localIds: number;
  visibilityRequests: number;
  toDownload: number;
  toDelete: number;
  recordsFetched: number;
  fetchRequests: number;
  bytes: number;
  visibilitySeconds: number;
  fetchSeconds: number;
  seconds: number;
  skipped?: string;
  error?: string;
  truncated?: string;
}

export interface SimDelta {
  sinceHours: number;
  rangeStart: string;
  rangeEnd: string;
  tables: SimDeltaTable[];
  totals: {
    tablesChecked: number;
    tablesSkipped: number;
    tablesFailed: number;
    localIds: number;
    toDownload: number;
    toDelete: number;
    recordsFetched: number;
    visibilityRequests: number;
    fetchRequests: number;
    requests: number;
    bytes: number;
    uploadBytes: number;
    visibilitySeconds: number;
    fetchSeconds: number;
    seconds: number;
  };
  notes: string[];
}

/** The delta section when it is well formed; stored rows from before delta existed have none. */
export function deltaOf(r: Pick<SimulationResult, "delta">): SimDelta | null {
  const d = r.delta;
  return d && Array.isArray(d.tables) && d.totals && Array.isArray(d.notes) ? d : null;
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
  /** Present when a delta simulation was requested and ran. Absent on older history rows. */
  delta?: SimDelta;
  startedAt: string;
  finishedAt: string;
  notes: string[];
  /** Present when the job ran more than once; the times above are then medians. Absent on older history rows. */
  runs?: SimRunsSummary;
  /** Present when content downloads ran; outside the sync window and not in `totals`. Absent on older history rows. */
  content?: SimContent;
}

export interface SimContentKind {
  candidates: number;
  files: number;
  bytes: number;
  seconds: number;
  failures: number;
  skipped: number;
  largest: Array<{ name: string; bytes: number; seconds: number }>;
  truncated?: string;
  errors?: string[];
}

export interface SimContent {
  outsideSyncWindow: true;
  limits: { maxFiles: number; maxBytes: number };
  seconds: number;
  attachments?: SimContentKind;
  clm?: SimContentKind;
  notes: string[];
}

export interface SimSpread {
  median: number;
  min: number;
  max: number;
}

export interface SimRunsSummary {
  count: number;
  requested: number;
  perRun: Array<{ totalSeconds: number; metadataSeconds: number; dataSeconds: number }>;
  total: SimSpread;
  metadata: SimSpread;
  data: SimSpread;
}

export const MAX_SIM_RUNS = 5;

/** Runs worth showing as a median and spread. Tolerates stored rows without (or with malformed) run data. */
export function multiRuns(r: Pick<SimulationResult, "runs">): SimRunsSummary | null {
  const runs = r.runs;
  return runs && runs.count >= 2 && Array.isArray(runs.perRun) && runs.total && runs.metadata && runs.data ? runs : null;
}

export interface SimRunOptions {
  territory?: string;
  forceFlow?: SimFlow;
  include?: string[];
  exclude?: string[];
  maxSeconds?: number;
  maxRecordsPerTable?: number;
  maxTotalRecords?: number;
  runs?: number;
  delta?: { sinceHours: number };
  content?: { attachments?: boolean; clm?: boolean; maxFiles?: number; maxBytes?: number };
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
  /** Runs the times are medians of; absent for a single run and on older rows. */
  runs?: number;
}

export function simSummary(r: SimulationResult): SimSummary {
  const runs = multiRuns(r);
  return {
    username: r.user.username,
    profile: r.user.profile,
    flow: r.flow,
    records: r.totals.records,
    seconds: runs ? runs.total.median : r.metadata.seconds + r.totals.seconds,
    failed: r.totals.tablesFailed,
    truncated: r.tables.some((t) => t.truncated),
    ...(runs ? { runs: runs.count } : {}),
  };
}

export function asSimSummary(x: unknown): SimSummary | null {
  const s = x as Partial<SimSummary> | null;
  if (!s || typeof s.username !== "string" || typeof s.records !== "number" || typeof s.seconds !== "number") return null;
  return typeof s.runs === "number" ? (s as SimSummary) : ({ ...s, runs: undefined } as SimSummary);
}

/** "rep1 · rep@x.com" when the connection has an alias, else the username. */
export function connectionLabel(c: Pick<SfConnection, "alias" | "username">): string {
  return c.alias ? `${c.alias} · ${c.username}` : c.username;
}

/** Picker value for a login made through the LSC mobile app; sf CLI connections use connectionRef. */
export const mobileRef = (l: { id: string }) => `mobile:${l.id}`;

/** The mobile login id a picker value refers to, or null for an sf CLI connection. */
export function mobileLoginId(ref: string): string | null {
  return ref.startsWith("mobile:") ? ref.slice("mobile:".length) || null : null;
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
