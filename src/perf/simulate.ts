/**
 * First-sync simulation: replays, from Node and as the end user, the network
 * part of what the LSC iOS app downloads during an initial sync, and reports
 * per-table records, requests, bytes and seconds plus the metadata download
 * time. Device-only work (SQLCipher writes, indexes, file binaries, freeze
 * time) is not simulated, so the numbers are network time only.
 *
 * Read-only: the calls made are the user-info GET, the metadata-download POST
 * (a read), Range GETs for the archive, and sobject/query or REST queries.
 */

import { ContentCollector, CONTENT_NOTES, downloadContent, type ContentOptions, type ContentResult } from "./content.js";
import { DEFAULT_MAX_LOCAL_IDS, simulateDelta, type DeltaResult } from "./device/delta.js";
import { chunkBytesForRam, DEFAULT_DEVICE_RAM_GB, downloadMetadata } from "./device/metadata.js";
import {
  describeNetwork,
  NETWORK_LIMITATION,
  NetworkShaper,
  realLinkNote,
  resolveNetwork,
  type NetworkOptions,
  type NetworkSettings,
} from "./device/network.js";
import { LocalIdStore, replayInitialSync, schedulingNote, type Flow, type TableResult } from "./device/replay.js";
import { buildSchema } from "./device/schema.js";
import { createDeviceSession, shapeHttp, type DeviceSession } from "./device/session.js";
import {
  ACCESS_CHECK_SERVER_HANDLES_CONTENT_IN_LIST,
  fetchUserInfo,
  resolveFlow,
  selectTerritory,
  type UserInfo,
} from "./device/user-info.js";
import type { SyncSample } from "./telemetry.js";

export interface SimulateOptions {
  /** sf CLI alias or username of the END USER (already authenticated). Ignored when `session` is given. */
  username: string;
  /** Pre-built session (tests). */
  session?: DeviceSession;
  apiVersion?: string;
  forceFlow?: Flow;
  /** Territory name, id or developer name. Default: first leaf territory, depth-first. */
  territory?: string;
  /** Sent as userDeviceId on user-info. Omitted by default so no device is registered. */
  userDeviceId?: string;
  include?: string[];
  exclude?: string[];
  maxSeconds?: number;
  tableTimeoutSeconds?: number;
  maxRecordsPerTable?: number;
  maxTotalRecords?: number;
  concurrency?: number;
  /** Metadata Range chunk size; default follows `deviceRamGB` (FileDownloadContext.chunkSizeForDevice). */
  chunkBytes?: number;
  /** RAM of the simulated iPad in GB (default 8). Sizes the metadata chunks and the legacy dynamic batches. */
  deviceRamGB?: number;
  /** The app's dynamicBatchRequestSize setting for legacy composite batches (default on, as the app's default). */
  dynamicBatchSize?: boolean;
  /** Network conditions to simulate on top of this machine's connection; default none. */
  network?: NetworkOptions;
  legacyPaging?: "batch" | "sequential";
  fixedBatchSize?: boolean;
  /** After the initial sync, simulate a delta sync as if the device last synced `sinceHours` ago (enhanced flow only). */
  delta?: { sinceHours: number };
  /** Local ids kept for the delta simulation across all tables (default 2,000,000). */
  maxDeltaLocalIds?: number;
  /** Opt-in file downloads after the sync (attachments, CLM presentations); never part of the sync totals. */
  content?: ContentOptions;
  signal?: AbortSignal;
  now?: () => number;
  /** Progress: the phase in progress and, while downloading data, tables finished out of the total. */
  onStep?: (step: string, tables?: { done: number; total: number; records: number }) => void;
}

export interface SimulationTotals {
  records: number;
  requests: number;
  bytes: number;
  /** Wall-clock seconds for the table download phase. */
  seconds: number;
  tablesDownloaded: number;
  tablesSkipped: number;
  tablesFailed: number;
}

export interface SimulationResult {
  user: { username: string; id: string; profile?: string; territory?: string };
  org: { instanceUrl: string; orgId?: string; apiVersion: string };
  flow: Flow;
  /** Network conditions the run was shaped to; absent for none, and on older results. */
  network?: NetworkSettings;
  metadata: { bytes: number; seconds: number; version: string; requests: number };
  tables: TableResult[];
  totals: SimulationTotals;
  /** Present when a delta simulation was requested and ran. */
  delta?: DeltaResult;
  startedAt: string;
  finishedAt: string;
  notes: string[];
  /** Present when content downloads ran. Outside the sync window: not in `totals`. */
  content?: ContentResult;
}

export function totalsOf(tables: TableResult[], seconds: number): SimulationTotals {
  return {
    records: tables.reduce((s, t) => s + t.records, 0),
    requests: tables.reduce((s, t) => s + t.requests, 0),
    bytes: tables.reduce((s, t) => s + t.bytes, 0),
    seconds,
    tablesDownloaded: tables.filter((t) => !t.skipped && !t.error).length,
    tablesSkipped: tables.filter((t) => t.skipped).length,
    tablesFailed: tables.filter((t) => t.error).length,
  };
}

export function filterTables<T extends { sobject: string }>(tables: T[], include?: string[], exclude?: string[]): T[] {
  const inc = include?.length ? new Set(include.map((s) => s.toLowerCase())) : undefined;
  const exc = new Set((exclude ?? []).map((s) => s.toLowerCase()));
  return tables.filter((t) => (!inc || inc.has(t.sobject.toLowerCase())) && !exc.has(t.sobject.toLowerCase()));
}

export const STANDING_NOTES = [
  "Network time only: SQLCipher writes, index/FTS/trigger creation, file binaries and freeze time are not simulated, so a real device is slower.",
  "Byte counts are on-the-wire bytes: what the server sent after gzip/deflate/br compression (the app advertises compression and decodes transparently). Connect request bodies of 4 KB or more are gzipped, as the app does.",
  "Attachment is always postponed and queried plainly; related-name fields (isRelatedRecordRetrieve) are not requested.",
  "{USER.TEAMS} and {STI.OBJ.IDS} are empty, as on a fresh device.",
];

export async function simulateInitialSync(opts: SimulateOptions): Promise<SimulationResult> {
  const startedAt = new Date();
  const now = opts.now ?? (() => performance.now());
  const notes: string[] = [...STANDING_NOTES];
  const baseSession = opts.session ?? (await createDeviceSession(opts.username, { apiVersion: opts.apiVersion }));
  const network = resolveNetwork(opts.network);
  const shaper = network ? new NetworkShaper(network) : undefined;
  const session: DeviceSession = shaper ? { ...baseSession, http: shapeHttp(baseSession.http, shaper) } : baseSession;
  if (network) notes.push(`Network: ${describeNetwork(network)}.`, NETWORK_LIMITATION);
  const ramGB = opts.deviceRamGB ?? DEFAULT_DEVICE_RAM_GB;

  opts.onStep?.("Fetching user info");
  const info: UserInfo = await fetchUserInfo(session, { userDeviceId: opts.userDeviceId, signal: opts.signal });
  if (info.isOrgInMaintenance) notes.push("user-info reports the org is in maintenance; a device would not sync.");
  const entity = info.metadataEntities[0];
  if (!entity) throw new Error("user-info returned no metadataEntities, so there is no metadata record to download for this user.");
  if (info.apiVersion) {
    const v = info.apiVersion.startsWith("v") ? info.apiVersion : `v${info.apiVersion}`;
    if (v !== session.apiVersion) notes.push(`user-info advertises API ${v}; this run used ${session.apiVersion} (override with apiVersion).`);
  }

  const resolved = resolveFlow(info);
  const flow = opts.forceFlow ?? resolved;
  if (opts.forceFlow && opts.forceFlow !== resolved) notes.push(`Flow forced to ${flow}; the org's settings select ${resolved}.`);

  opts.onStep?.(`Downloading metadata (${entity.name})`);
  const md = await downloadMetadata(session, entity.id, { chunkBytes: opts.chunkBytes ?? chunkBytesForRam(ramGB), signal: opts.signal, now });
  if (network) {
    const slow = realLinkNote(network, md.bytes, md.seconds);
    if (slow) notes.push(slow);
  }
  const schema = buildSchema({ files: md.files, usp: md.info.userSpecificPermissions, assignedPermissionSets: info.permissionSets });
  notes.push(...schema.notes);

  const territory = selectTerritory(info.territories, opts.territory);
  if (opts.territory && !territory) throw new Error(`Territory "${opts.territory}" is not in the user's territory hierarchy.`);
  if (!territory) notes.push("The user has no territories; {USER.TERRITORY} and {USER.TERRITORYID} are empty.");
  else if (!opts.territory) notes.push(`Territory not specified; used "${territory.name}" (first leaf territory).`);

  const tables = filterTables(schema.tables, opts.include, opts.exclude);
  if (tables.length < schema.tables.length) notes.push(`${schema.tables.length - tables.length} table(s) excluded by include/exclude.`);

  const deltaHours = opts.delta?.sinceHours;
  const wantDelta = typeof deltaHours === "number" && Number.isFinite(deltaHours) && deltaHours > 0;
  const idStore = wantDelta && flow === "enhanced" ? new LocalIdStore(opts.maxDeltaLocalIds ?? DEFAULT_MAX_LOCAL_IDS) : undefined;
  const wantContent = !!(opts.content?.attachments || opts.content?.clm);
  const collector = wantContent
    ? new ContentCollector({ attachments: !!opts.content?.attachments, clm: !!opts.content?.clm }, tables)
    : undefined;

  const t0 = now();
  const progress = { done: 0, total: tables.length, records: 0 };
  opts.onStep?.(`Downloading data (${flow} flow)`, { ...progress });
  const results = await replayInitialSync({
    session,
    flow,
    tables,
    context: {
      userId: info.user.id,
      territoryName: territory?.name ?? "",
      territoryId: territory?.id ?? "",
      serverHandlesContentInList: info.accessChecks[ACCESS_CHECK_SERVER_HANDLES_CONTENT_IN_LIST] === true,
    },
    syncStart: startedAt,
    concurrency: opts.concurrency,
    maxSeconds: opts.maxSeconds,
    tableTimeoutSeconds: opts.tableTimeoutSeconds,
    maxRecordsPerTable: opts.maxRecordsPerTable,
    maxTotalRecords: opts.maxTotalRecords,
    legacyPaging: opts.legacyPaging,
    dynamicBatchSize: opts.dynamicBatchSize,
    deviceRamGB: ramGB,
    fixedBatchSize: opts.fixedBatchSize,
    idStore,
    signal: opts.signal,
    now,
    onRecords: collector ? (table, records) => collector.observe(table, records) : undefined,
    onTable: (r) => {
      progress.done++;
      progress.records += r.records;
      opts.onStep?.(`Downloading data (${flow} flow): ${r.sobject} done`, { ...progress });
    },
  });
  const seconds = (now() - t0) / 1000;
  notes.push(schedulingNote(flow, opts.concurrency));
  if (results.some((t) => t.truncated)) notes.push("Some tables were cut short by a limit; their numbers are lower bounds.");
  if (opts.signal?.aborted) notes.push("The run was cancelled.");

  let delta: DeltaResult | undefined;
  if (wantDelta && flow !== "enhanced") {
    notes.push("Delta sync is simulated for the enhanced (Connect) flow only; the legacy flow's delta was not simulated.");
  } else if (idStore && !opts.signal?.aborted) {
    opts.onStep?.("Simulating delta sync");
    delta = await simulateDelta({
      session,
      tables,
      initial: results,
      store: idStore,
      context: {
        userId: info.user.id,
        territoryName: territory?.name ?? "",
        territoryId: territory?.id ?? "",
        serverHandlesContentInList: info.accessChecks[ACCESS_CHECK_SERVER_HANDLES_CONTENT_IN_LIST] === true,
      },
      sinceHours: deltaHours as number,
      requestTimeoutSeconds: opts.tableTimeoutSeconds,
      signal: opts.signal,
      now,
      onStep: (step) => opts.onStep?.(step),
    });
  } else if (idStore) {
    notes.push("Delta sync was not simulated because the run was cancelled.");
  }

  let content: ContentResult | undefined;
  if (collector && opts.content && !opts.signal?.aborted) {
    opts.onStep?.("Downloading content (outside the sync window)");
    if (results.some((t) => t.truncated || t.skipped || t.error)) {
      notes.push("Content downloads use the records the sync fetched; tables that were cut short, skipped or failed may hide files.");
    }
    content = await downloadContent(session, collector.plan(session.apiVersion), {
      ...opts.content,
      maxSeconds: opts.content.maxSeconds ?? opts.maxSeconds,
      signal: opts.signal,
      now,
      onStep: (step) => opts.onStep?.(step),
    });
    content.notes.unshift(...CONTENT_NOTES);
  }

  return {
    user: { username: session.username, id: info.user.id, profile: info.user.profileName, territory: territory?.name },
    org: { instanceUrl: session.instanceUrl, orgId: session.orgId, apiVersion: session.apiVersion },
    flow,
    ...(network ? { network } : {}),
    metadata: { bytes: md.bytes, seconds: md.seconds, version: entity.name, requests: md.requests },
    tables: results,
    totals: totalsOf(results, seconds),
    ...(delta ? { delta } : {}),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    notes,
    ...(content ? { content } : {}),
  };
}

// ---------- comparison with real-device telemetry (not wired into a tool yet) ----------

export interface MetricComparison {
  simulated: number;
  deviceMedian: number | undefined;
  /** simulated / deviceMedian, when both are positive. */
  ratio: number | undefined;
}

export interface TelemetryComparison {
  /** Successful initial syncs compared against. */
  sampleCount: number;
  download: MetricComparison;
  metadata: MetricComparison;
  records: MetricComparison;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function compare(simulated: number, values: (number | undefined)[]): MetricComparison {
  const deviceMedian = median(values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)));
  return { simulated, deviceMedian, ratio: deviceMedian && deviceMedian > 0 && simulated > 0 ? simulated / deviceMedian : undefined };
}

/**
 * Compare a simulation with real devices' DeviceSyncSummary rows (successful
 * initial syncs only): download phase seconds, metadata download seconds and
 * downloaded record counts.
 */
export function compareToTelemetry(result: Pick<SimulationResult, "metadata" | "totals">, samples: SyncSample[]): TelemetryComparison {
  const initial = samples.filter((s) => s.kind === "initial" && !s.failed);
  return {
    sampleCount: initial.length,
    download: compare(result.totals.seconds, initial.map((s) => s.downloadSec)),
    metadata: compare(result.metadata.seconds, initial.map((s) => s.metadataSec)),
    records: compare(result.totals.records, initial.map((s) => s.downloadedRecords)),
  };
}
