/**
 * Replays the network part of an initial sync: tag resolution, table ordering
 * and dependencies, skip rules, pagination and IN-list chunking for both the
 * enhanced (Connect sobject/query) and legacy (REST query) flows. Only counts
 * and byte sizes are kept; ids needed for dependent tables are the one thing
 * retained in memory.
 */

import { connectPath, dataPath, jsonOrThrow, type DeviceSession } from "./session.js";
import type { SchemaTable } from "./schema.js";

export type Flow = "enhanced" | "legacy";

export interface TableResult {
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

export interface ReplayContext {
  userId: string;
  territoryName: string;
  territoryId: string;
  /** When true, content IN-lists are sent whole instead of in chunks of CONTENT_CHUNK. */
  serverHandlesContentInList: boolean;
}

/**
 * Record ids kept per table for a delta-sync simulation (the device's local ids). Bounded by a
 * total-id cap: once adding a table's ids would pass it, that table and every table still
 * downloading afterwards stop keeping ids and are marked overflowed.
 */
export class LocalIdStore {
  /** Ids per table, keyed by lower-case sobject name. */
  readonly ids = new Map<string, string[]>();
  /** Tables whose ids were not kept because of the cap (lower-case sobject name). */
  readonly overflowed = new Set<string>();
  /** ObjectTerritory2Association Id -> ObjectId, to rebuild {OT2A.OBJ.IDS} from the ids that survive a visibility check. */
  readonly ot2aObjectIds = new Map<string, string>();
  /** The id lists a device collects for the content tags (set when the replay ends). */
  collected: CollectedIds = emptyIds();
  total = 0;
  private exhausted = false;

  constructor(readonly cap: number) {}

  add(sobject: string, records: Record<string, unknown>[]): void {
    const key = sobject.toLowerCase();
    if (key === LAST || this.overflowed.has(key)) return;
    if (this.exhausted || this.total + records.length > this.cap) {
      this.exhausted = true;
      this.overflowed.add(key);
      this.total -= this.ids.get(key)?.length ?? 0;
      this.ids.delete(key);
      return;
    }
    let list = this.ids.get(key);
    if (!list) this.ids.set(key, (list = []));
    for (const r of records) {
      const id = r.Id ?? r.id;
      if (typeof id !== "string" || !id) continue;
      list.push(id);
      if (key === OT2A && typeof r.ObjectId === "string") this.ot2aObjectIds.set(id, r.ObjectId);
    }
    this.total += records.length;
  }
}

export interface ReplayOptions {
  session: DeviceSession;
  flow: Flow;
  tables: SchemaTable[];
  context: ReplayContext;
  syncStart: Date;
  /** Most tables downloaded at once; the device uses 4 (enhanced) and 3 (legacy), ramping up from 1. */
  concurrency?: number;
  maxSeconds?: number;
  tableTimeoutSeconds?: number;
  maxRecordsPerTable?: number;
  maxTotalRecords?: number;
  legacyPaging?: "batch" | "sequential";
  /** Disable the adaptive batch-size controller and keep the initial batch size. */
  fixedBatchSize?: boolean;
  signal?: AbortSignal;
  now?: () => number;
  /** When given, the ids of every downloaded record are kept here (enhanced and legacy flows) for a delta simulation. */
  idStore?: LocalIdStore;
  /** Called as each table finishes (downloaded, skipped or failed). */
  onTable?: (result: TableResult) => void;
  /** Called with each page of downloaded records, so a caller can keep the few fields it needs (the content-download phase). */
  onRecords?: (table: SchemaTable, records: Record<string, unknown>[]) => void;
}

export const CONTENT_CHUNK = 1500;
export const LEGACY_PAGE_BATCH = 15;
export const EPOCH_ISO_MS = "1970-01-01T00:00:00.000Z";
export const EPOCH_ISO = "1970-01-01T00:00:00Z";

const OT2A = "objectterritory2association";
const ACCOUNT = "account";
const OPT = "opt__c";
const OPT_LEGACY = "Opt__c";
const ATTACHMENT = "attachment";
const CDL = "contentdocumentlink";
const CONTENT_VERSION = "contentversion";
const CONTENT_DOCUMENT = "contentdocument";
const POSTPONED = new Set([ATTACHMENT, CDL, CONTENT_VERSION, CONTENT_DOCUMENT]);
const LAST = "devicesynctransactionrecord";

/** Open query locators the device allows across the tables downloading at once. */
export const MAX_OPEN_QUERY_LOCATORS = 7;
/** Most tables the device downloads at once. */
export const MAX_CONCURRENT_TABLES: Record<Flow, number> = { enhanced: 4, legacy: 3 };

// ---------- tags ----------

export const SCALAR_TAGS = ["{USER.ID}", "{USER.TERRITORY}", "{USER.TERRITORYID}", "{USER.TEAMS}", "{USER.ACCESS.ENTITIES}"] as const;
export const ID_TAGS = ["{ACCOUNT.IDS}", "{OT2A.OBJ.IDS}", "{STI.OBJ.IDS}"] as const;
export const CONTENT_TAGS = ["{RELATED.ENTITIES}", "{CONT.DOCS}"] as const;
const ALL_TAGS: readonly string[] = [...SCALAR_TAGS, ...ID_TAGS, ...CONTENT_TAGS];

/** Ids collected from tables downloaded earlier in this sync. */
export interface CollectedIds {
  accountIds: Set<string>;
  ot2aObjIds: Set<string>;
  stiObjIds: Set<string>;
  relatedEntities: Set<string>;
  contDocs: Set<string>;
}

export function emptyIds(): CollectedIds {
  return { accountIds: new Set(), ot2aObjIds: new Set(), stiObjIds: new Set(), relatedEntities: new Set(), contDocs: new Set() };
}

function listFor(tag: string, ids: CollectedIds): string[] {
  switch (tag) {
    case "{ACCOUNT.IDS}": return [...ids.accountIds];
    case "{OT2A.OBJ.IDS}": return [...ids.ot2aObjIds];
    case "{STI.OBJ.IDS}": return [...ids.stiObjIds];
    case "{RELATED.ENTITIES}": return [...ids.relatedEntities];
    case "{CONT.DOCS}": return [...ids.contDocs];
    default: return [];
  }
}

export function quoteIds(ids: string[]): string {
  return ids.map((i) => `'${i.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`).join(",");
}

/** Tags the WhereSoql references (case-insensitive), in canonical form. */
export function tagsInWhere(where: string | undefined): string[] {
  const lower = (where ?? "").toLowerCase();
  return ALL_TAGS.filter((t) => lower.includes(t.toLowerCase()));
}

export function scalarTagValue(tag: string, table: SchemaTable, ctx: ReplayContext): string {
  switch (tag) {
    case "{USER.ID}": return ctx.userId;
    case "{USER.TERRITORY}": return ctx.territoryName;
    case "{USER.TERRITORYID}": return ctx.territoryId;
    case "{USER.TEAMS}": return "";
    case "{USER.ACCESS.ENTITIES}": return table.userAccessEntities || "'*'";
    default: return "";
  }
}

export interface ResolvedTags {
  /** Tags present in the WHERE with a value; id/content tags hold their raw id lists. */
  scalars: Record<string, string>;
  lists: Record<string, string[]>;
  /** Id/content tags whose list is empty; a non-empty array means the table is skipped. */
  emptyLists: string[];
}

export function resolveTags(table: SchemaTable, ctx: ReplayContext, ids: CollectedIds): ResolvedTags {
  const out: ResolvedTags = { scalars: {}, lists: {}, emptyLists: [] };
  for (const tag of tagsInWhere(table.whereSoql)) {
    if ((SCALAR_TAGS as readonly string[]).includes(tag)) {
      out.scalars[tag] = scalarTagValue(tag, table, ctx);
    } else {
      const list = listFor(tag, ids);
      if (list.length === 0) out.emptyLists.push(tag);
      out.lists[tag] = list;
    }
  }
  return out;
}

/** Case-insensitive textual substitution of one tag. */
export function substituteTag(where: string, tag: string, value: string): string {
  const re = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return where.replace(re, () => value);
}

export function skipReason(table: SchemaTable, tags: ResolvedTags): string | undefined {
  if (tags.emptyLists.length > 0) return `no ids for ${tags.emptyLists.join(", ")} (a device skips the table)`;
  return undefined;
}

// ---------- chunking ----------

export function chunk<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

const MAX_QUERY_LEN = 14000;
const MAX_WHERE_LEN = 4000;
const REST_CHARS = 200;
const ID_LEN = 22;

/** Ids per query for the legacy flow (SyncKit formQuery limits). */
export function legacyChunkSize(templateLength: number, whereLength: number, tagOccurrences: number): number {
  let limit = MAX_QUERY_LEN - (templateLength + REST_CHARS) - REST_CHARS;
  if (whereLength > 0) limit = Math.min(limit, MAX_WHERE_LEN - whereLength - REST_CHARS);
  const perTag = Math.floor(Math.max(0, limit) / ID_LEN) / Math.max(1, tagOccurrences);
  return Math.max(1, Math.floor(perTag));
}

// ---------- ordering ----------

/** Query complexity of a table: 1 plus the number of "select" occurrences in its WHERE (MetadataDatabaseTable). */
export function tableComplexity(whereSoql: string | undefined): number {
  return 1 + (whereSoql ?? "").toLowerCase().split("select").length - 1;
}

/**
 * Phases run one after another; tables inside a phase go through the smart queue.
 * Follows SyncConnectDownloadManager / DownloadManager: OT2A, Account, every other table
 * (Opt__c last), then the finalize steps for the postponed content tables. A table can
 * appear in more than one phase (DeviceSyncTransactionRecord runs again in finalize).
 * The legacy flow downloads OT2A and Account up front only when some WHERE uses their id
 * tags, and runs DeviceSyncTransactionRecord after the main tables instead of inside them.
 */
export function orderPhases(tables: SchemaTable[], flow: Flow = "enhanced"): SchemaTable[][] {
  const named = (n: string) => tables.find((t) => t.sobject.toLowerCase() === n);
  const ot2a = named(OT2A);
  const account = named(ACCOUNT);
  const dstr = named(LAST);
  const usesTag = (tag: string) => tables.some((t) => tagsInWhere(t.whereSoql).includes(tag));
  const ot2aFirst = ot2a !== undefined && (flow === "enhanced" || usesTag("{OT2A.OBJ.IDS}"));
  const accountFirst = account !== undefined && (flow === "enhanced" || usesTag("{ACCOUNT.IDS}"));

  const others = tables.filter((t) => {
    const n = t.sobject.toLowerCase();
    return n !== LAST && !POSTPONED.has(n) && !(n === OT2A && ot2aFirst) && !(n === ACCOUNT && accountFirst);
  });
  if (flow === "legacy") {
    // Without id tags these two are plain tables, moved behind the others.
    for (const t of [ot2a, account]) {
      const i = t ? others.indexOf(t) : -1;
      if (i >= 0) others.push(others.splice(i, 1)[0]);
    }
  }
  const optIndex = others.findIndex((t) => (flow === "legacy" ? t.sobject === OPT_LEGACY : t.sobject.toLowerCase().includes(OPT)));
  if (optIndex >= 0) others.push(others.splice(optIndex, 1)[0]);

  const phases: SchemaTable[][] = [ot2aFirst ? [ot2a] : [], accountFirst ? [account] : []] as SchemaTable[][];
  phases.push(flow === "enhanced" ? [...others, ...(dstr ? [dstr] : [])] : others);
  if (flow === "legacy" && dstr) phases.push([dstr]);

  // finalizeInitialSync: Attachment and ContentDocumentLink, DSTR, then ContentVersion,
  // ContentDocument and DSTR again (ContentVersion/ContentDocument only follow a ContentDocumentLink).
  const attachment = named(ATTACHMENT);
  const cdl = named(CDL);
  const present = (...ts: (SchemaTable | undefined)[]) => ts.filter((t): t is SchemaTable => t !== undefined);
  if (cdl) {
    phases.push(present(attachment, cdl));
    if (dstr) phases.push([dstr]);
    phases.push(present(named(CONTENT_VERSION), named(CONTENT_DOCUMENT), dstr));
  } else {
    phases.push(present(attachment, dstr));
  }
  return phases.filter((p) => p.length > 0);
}

// ---------- smart queue ----------

export interface QueueTask<T> {
  complexity: number;
  run: () => Promise<T>;
}

export interface SmartQueueOptions {
  maxConcurrent: number;
  maxComplexity?: number;
  /**
   * Which operation the throttle treats as "next ready" when it recomputes. The device reads
   * `operations.first { $0.isReady }`, and an executing operation stays ready, so that is the
   * oldest unfinished one ("oldestUnfinished", the default). "firstPending" is the next operation
   * not yet started.
   */
  nextReady?: "firstPending" | "oldestUnfinished";
}

interface QueueOp {
  complexity: number;
  started: boolean;
  start: () => void;
}

/**
 * The device's SmartOperationQueue: operations start in FIFO order, up to a concurrency limit
 * that starts at 1, grows by 1 each time the throttle recomputes while the running complexity plus
 * the next operation's complexity fits maxComplexity, and shrinks by 1 (not below 1) when it does not.
 * The throttle recomputes when operations are added and each time one finishes. The limit persists
 * across run() calls, as the device reuses one queue for the whole sync.
 */
export class SmartQueue {
  readonly maxConcurrent: number;
  readonly maxComplexity: number;
  private readonly nextReady: "firstPending" | "oldestUnfinished";
  private desired = 1;
  private ops: QueueOp[] = [];
  private running = 0;
  private peak = 0;

  constructor(opts: SmartQueueOptions) {
    this.maxConcurrent = Math.max(1, Math.floor(opts.maxConcurrent));
    this.maxComplexity = opts.maxComplexity ?? MAX_OPEN_QUERY_LOCATORS;
    this.nextReady = opts.nextReady ?? "oldestUnfinished";
  }

  /** Current concurrency limit. */
  get concurrency(): number {
    return this.desired;
  }

  /** Most operations that ever ran at once. */
  get peakRunning(): number {
    return this.peak;
  }

  /** Enqueue the tasks, resolve when all have finished. Results keep the order of `tasks`. */
  async run<T>(tasks: QueueTask<T>[]): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let failure: { error: unknown } | undefined;
    const finished = tasks.map(
      (task, i) =>
        new Promise<void>((resolve) => {
          const op: QueueOp = {
            complexity: task.complexity,
            started: false,
            start: () => {
              op.started = true;
              this.running++;
              this.peak = Math.max(this.peak, this.running);
              task.run().then(
                (r) => void (results[i] = r),
                (e) => void (failure ??= { error: e })
              ).finally(() => {
                this.ops.splice(this.ops.indexOf(op), 1);
                this.running--;
                this.recompute();
                this.pump();
                resolve();
              });
            },
          };
          this.ops.push(op);
        })
    );
    this.pump();
    this.recompute();
    this.pump();
    await Promise.all(finished);
    if (failure) throw failure.error;
    return results;
  }

  private pump(): void {
    while (this.running < this.desired) {
      const op = this.ops.find((o) => !o.started);
      if (!op) return;
      op.start();
    }
  }

  private recompute(): void {
    if (this.ops.length === 0) return;
    const running = this.ops.filter((o) => o.started).reduce((sum, o) => sum + o.complexity, 0);
    const next = this.nextReady === "oldestUnfinished" ? this.ops[0] : this.ops.find((o) => !o.started);
    if (!next) return;
    this.desired =
      running + next.complexity <= this.maxComplexity ? Math.min(this.desired + 1, this.maxConcurrent) : Math.max(this.desired - 1, 1);
  }
}

// ---------- batch sizing ----------

export const MIN_BATCH = 25;
export const MAX_BATCH = 10000;

export function initialBatchSize(weight: number): number {
  if (weight <= 200) return 10000;
  if (weight <= 500) return 1000;
  return 500;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Adaptive page sizing: size from the first page's throughput, then AIMD on page time. */
export class AdaptiveBatch {
  size: number;
  private target = MAX_BATCH;
  private ewma: number | undefined;
  private pages = 0;

  constructor(
    weight: number,
    private readonly adaptive = true
  ) {
    this.size = initialBatchSize(weight);
  }

  update(seconds: number, bytes: number, records: number): void {
    if (!this.adaptive) return;
    this.pages++;
    if (this.pages === 1 && records > 0 && seconds > 0) {
      const mbps = bytes / (1024 * 1024) / seconds;
      const targetKB = clamp(mbps * 10, 15, 125) * 1024;
      const avgKB = bytes / records / 1024;
      this.size = Math.round(clamp(targetKB / Math.max(avgKB, 0.001), MIN_BATCH, MAX_BATCH));
      this.target = this.size;
      this.ewma = seconds;
      return;
    }
    this.ewma = this.ewma === undefined ? seconds : 0.3 * seconds + 0.7 * this.ewma;
    if (this.ewma > 30) this.size = Math.max(MIN_BATCH, Math.floor(this.size / 2));
    else if (this.ewma < 18 && this.size < this.target) {
      this.size = Math.min(this.target, MAX_BATCH, this.size + Math.max(100, this.size * 0.5));
    }
  }
}

// ---------- request builders ----------

export interface EnhancedTag {
  tagName: string;
  tagValue: string;
}

export function buildEnhancedBody(args: {
  table: SchemaTable;
  fields: string[];
  tags: EnhancedTag[];
  batchSize: number;
  syncStart: Date;
  queryLocator?: string;
}): Record<string, unknown> {
  const { table } = args;
  return {
    objectName: table.sobject,
    fields: args.fields,
    queryType: "GenericQuery",
    ...(args.queryLocator ? { queryLocator: args.queryLocator } : {}),
    ids: [],
    batchSize: args.batchSize,
    ...(table.whereSoql ? { where: table.whereSoql } : {}),
    tags: args.tags,
    timeStamp: [
      {
        fieldName: table.deltaDateField ?? "SystemModstamp",
        rangeStartTime: EPOCH_ISO_MS,
        rangeEndTime: args.syncStart.toISOString(),
      },
    ],
  };
}

/** Fields actually requested: VersionData is never downloaded inline. */
export function requestFields(table: SchemaTable): string[] {
  return table.sobject.toLowerCase() === "contentversion"
    ? table.fields.filter((f) => f.toLowerCase() !== "versiondata")
    : table.fields;
}

export function buildLegacyQuery(table: SchemaTable, fields: string[], condition: string | undefined, syncStart: Date): string {
  let q = `SELECT ${fields.join(",")} FROM ${table.sobject}`;
  const hasCondition = !!condition && condition.trim().length > 0;
  if (hasCondition) q += ` WHERE ${condition}`;
  const delta = table.deltaDateField;
  if (delta && table.sobject.toLowerCase() !== LAST && fields.some((f) => f.toLowerCase() === delta.toLowerCase())) {
    const end = syncStart.toISOString().replace(/\.\d{3}Z$/, "Z");
    q += ` ${hasCondition ? "AND" : "WHERE"} ${delta} > ${EPOCH_ISO} AND ${delta} <= ${end}`;
  }
  return q;
}

// ---------- execution ----------

interface Run {
  opts: ReplayOptions;
  ids: CollectedIds;
  now: () => number;
  deadline: number | undefined;
  totalRecords: number;
  aborted: boolean;
}

class StopTable extends Error {}

export function timeoutScope(parent: AbortSignal | undefined, ms: number | undefined): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  parent?.addEventListener("abort", onAbort, { once: true });
  const timer = ms && ms > 0 ? setTimeout(() => controller.abort(), ms) : undefined;
  return {
    signal: controller.signal,
    dispose() {
      if (timer) clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

function collectIds(table: SchemaTable, records: Record<string, unknown>[], ids: CollectedIds): void {
  const n = table.sobject.toLowerCase();
  const add = (set: Set<string>, key: string) => {
    for (const r of records) {
      const v = r[key];
      if (typeof v === "string" && v) set.add(v);
    }
  };
  if (n === OT2A) add(ids.ot2aObjIds, "ObjectId");
  if (n === ACCOUNT) add(ids.accountIds, "Id");
  if (n === "contentdocumentlink") add(ids.contDocs, "ContentDocumentId");
  if (table.attachmentsSupport !== "none") add(ids.relatedEntities, "Id");
}

function recordsOf(json: unknown): { records: Record<string, unknown>[]; o: Record<string, unknown> } {
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const records = Array.isArray(o.records) ? (o.records as Record<string, unknown>[]) : [];
  return { records, o };
}

class TableRunner {
  readonly result: TableResult;
  private signal!: AbortSignal;

  constructor(
    private readonly run: Run,
    private readonly table: SchemaTable
  ) {
    this.result = { sobject: table.sobject, developerName: table.developerName, records: 0, requests: 0, bytes: 0, seconds: 0 };
  }

  private get o() {
    return this.run.opts;
  }

  /** One HTTP request, counted. */
  private async call(method: "GET" | "POST", url: string, body?: unknown, headers?: Record<string, string>): Promise<unknown> {
    if (this.signal.aborted) throw new StopTable(this.run.aborted ? "cancelled" : "table timeout");
    this.result.requests++;
    const res = await this.o.session.http({
      method,
      url,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: this.signal,
    });
    this.result.bytes += res.body.length;
    return jsonOrThrow(res, `${method} ${this.table.sobject}`);
  }

  /** Account a page of records; returns false when a record cap or the time budget stops the table. */
  private accept(records: Record<string, unknown>[]): boolean {
    collectIds(this.table, records, this.run.ids);
    this.o.idStore?.add(this.table.sobject, records);
    this.o.onRecords?.(this.table, records);
    this.result.records += records.length;
    this.run.totalRecords += records.length;
    const perTable = this.o.maxRecordsPerTable;
    if (perTable !== undefined && this.result.records >= perTable) {
      this.result.truncated = `stopped at maxRecordsPerTable (${perTable})`;
      return false;
    }
    const total = this.o.maxTotalRecords;
    if (total !== undefined && this.run.totalRecords >= total) {
      this.result.truncated = `stopped at maxTotalRecords (${total})`;
      return false;
    }
    if (this.run.deadline !== undefined && this.run.now() >= this.run.deadline) {
      this.result.truncated = "stopped at maxSeconds";
      return false;
    }
    return true;
  }

  async execute(): Promise<TableResult> {
    const table = this.table;
    const tags = resolveTags(table, this.o.context, this.run.ids);
    const reason = skipReason(table, tags);
    if (reason) {
      this.result.skipped = reason;
      return this.result;
    }
    if (!table.fields.some((f) => f.toLowerCase() === "id")) {
      this.result.skipped = "no Id field in the requested fields";
      return this.result;
    }
    const scope = timeoutScope(this.o.signal, this.o.tableTimeoutSeconds ? this.o.tableTimeoutSeconds * 1000 : undefined);
    this.signal = scope.signal;
    const start = this.run.now();
    try {
      if (this.o.flow === "enhanced") await this.enhanced(tags);
      else await this.legacy(tags);
    } catch (e) {
      if (e instanceof StopTable || this.signal.aborted) {
        const why = this.o.signal?.aborted ? "cancelled" : "table timeout";
        this.result.truncated = this.result.truncated ?? why;
        if (this.o.signal?.aborted) this.run.aborted = true;
      } else {
        this.result.error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      scope.dispose();
      this.result.seconds = (this.run.now() - start) / 1000;
    }
    return this.result;
  }

  // ----- enhanced -----

  private enhancedTagSets(tags: ResolvedTags): EnhancedTag[][] {
    const base: EnhancedTag[] = Object.entries(tags.scalars).map(([tagName, tagValue]) => ({ tagName, tagValue }));
    const listTags = Object.entries(tags.lists);
    const idTags: EnhancedTag[] = listTags
      .filter(([t]) => (ID_TAGS as readonly string[]).includes(t))
      .map(([tagName, ids]) => ({ tagName, tagValue: quoteIds(ids) }));
    const content = listTags.filter(([t]) => (CONTENT_TAGS as readonly string[]).includes(t));
    const common = [...base, ...idTags];
    if (content.length === 0) return [common];
    // Content IN-lists are chunked unless the server handles them. Several content tags are
    // chunked in lockstep by the longest list; the others are sent whole.
    const [primary, ...others] = [...content].sort((a, b) => b[1].length - a[1].length);
    const whole = others.map(([tagName, ids]) => ({ tagName, tagValue: quoteIds(ids) }));
    const pieces = this.o.context.serverHandlesContentInList ? [primary[1]] : chunk(primary[1], CONTENT_CHUNK);
    return pieces.map((p) => [...common, ...whole, { tagName: primary[0], tagValue: quoteIds(p) }]);
  }

  private async enhanced(tags: ResolvedTags): Promise<void> {
    const url = connectPath(this.o.session, "life-sciences/commercial/sobject/query");
    const fields = requestFields(this.table);
    for (const tagSet of this.enhancedTagSets(tags)) {
      const batch = new AdaptiveBatch(this.table.weight, !this.o.fixedBatchSize);
      let locator: string | undefined;
      for (;;) {
        const before = { bytes: this.result.bytes };
        const t0 = this.run.now();
        const json = await this.call(
          "POST",
          url,
          buildEnhancedBody({ table: this.table, fields, tags: tagSet, batchSize: batch.size, syncStart: this.o.syncStart, queryLocator: locator }),
          { "X-Chatter-Entity-Encoding": "false" }
        );
        const { records, o } = recordsOf(json);
        batch.update((this.run.now() - t0) / 1000, this.result.bytes - before.bytes, records.length);
        const keepGoing = this.accept(records);
        locator = typeof o.queryLocator === "string" && o.queryLocator ? o.queryLocator : undefined;
        if (!keepGoing) return;
        if (o.hasMore !== true || !locator) break;
      }
    }
  }

  // ----- legacy -----

  private async legacy(tags: ResolvedTags): Promise<void> {
    const fields = requestFields(this.table);
    let where = this.table.whereSoql;
    for (const [tag, value] of Object.entries(tags.scalars)) if (where) where = substituteTag(where, tag, value);

    const listTags = Object.entries(tags.lists);
    const [primary, ...others] = [...listTags].sort((a, b) => b[1].length - a[1].length);
    for (const [tag, ids] of others) if (where) where = substituteTag(where, tag, quoteIds(ids));

    if (!primary || !where) {
      await this.legacyQuery(buildLegacyQuery(this.table, fields, where, this.o.syncStart));
      return;
    }
    const [tag, ids] = primary;
    const template = buildLegacyQuery(this.table, fields, where, this.o.syncStart);
    const occurrences = Math.max(1, template.toLowerCase().split(tag.toLowerCase()).length - 1);
    const size = legacyChunkSize(template.length, where.length, occurrences);
    for (const piece of chunk(ids, size)) {
      await this.legacyQuery(buildLegacyQuery(this.table, fields, substituteTag(where, tag, quoteIds(piece)), this.o.syncStart));
    }
  }

  private async legacyQuery(soql: string): Promise<void> {
    const session = this.o.session;
    const first = await this.call("GET", dataPath(session, `query?q=${encodeURIComponent(soql)}`));
    const { records, o } = recordsOf(first);
    if (!this.accept(records)) return;
    const next = typeof o.nextRecordsUrl === "string" ? o.nextRecordsUrl : undefined;
    if (o.done === true || !next) return;

    const totalSize = typeof o.totalSize === "number" ? o.totalSize : undefined;
    const locator = /\/query\/([^/]+?)(?:-\d+)?$/.exec(next)?.[1];
    if (this.o.legacyPaging === "sequential" || !locator || !totalSize || records.length === 0) {
      await this.followNext(next);
      return;
    }
    const step = records.length;
    const urls: string[] = [];
    for (let off = step; off < totalSize; off += step) urls.push(`${session.apiVersion}/query/${locator}-${off}`);
    for (const group of chunk(urls, LEGACY_PAGE_BATCH)) {
      const json = await this.call("POST", dataPath(session, "composite/batch"), {
        haltOnError: true,
        batchRequests: group.map((url) => ({ method: "GET", url })),
      });
      const results = Array.isArray((json as Record<string, unknown>)?.results) ? ((json as Record<string, unknown>).results as Record<string, unknown>[]) : [];
      for (const r of results) {
        if (typeof r.statusCode === "number" && r.statusCode >= 300) {
          throw new Error(`composite/batch sub-request failed (HTTP ${r.statusCode})`);
        }
        if (!this.accept(recordsOf(r.result).records)) return;
      }
    }
  }

  private async followNext(first: string): Promise<void> {
    let next: string | undefined = first;
    while (next) {
      const json = await this.call("GET", next);
      const { records, o } = recordsOf(json);
      if (!this.accept(records)) return;
      next = o.done === true || typeof o.nextRecordsUrl !== "string" ? undefined : o.nextRecordsUrl;
    }
  }
}

/** Fold another run of the same table into its row; counts add up, it is skipped only if every run was. */
function mergeRuns(into: TableResult, next: TableResult): void {
  into.records += next.records;
  into.requests += next.requests;
  into.bytes += next.bytes;
  into.seconds += next.seconds;
  if (next.skipped === undefined) delete into.skipped;
  into.error ??= next.error;
  into.truncated ??= next.truncated;
}

/** One-line description of the scheduling for the result notes. */
export function schedulingNote(flow: Flow, maxConcurrent: number = MAX_CONCURRENT_TABLES[flow]): string {
  return (
    `Tables scheduled like the iOS app: concurrency ramps from 1 to at most ${maxConcurrent} while the running tables' query complexity ` +
    `(1 + subselects in WHERE) stays within ${MAX_OPEN_QUERY_LOCATORS} open query locators, tables taken first-in-first-out; OT2A, then Account, ` +
    `then the rest, then Attachment/ContentDocumentLink, ContentVersion/ContentDocument, with DeviceSyncTransactionRecord repeating ` +
    `(its requests, bytes and records are summed in one row).`
  );
}

export async function replayInitialSync(opts: ReplayOptions): Promise<TableResult[]> {
  const now = opts.now ?? (() => performance.now());
  const run: Run = {
    opts,
    ids: emptyIds(),
    now,
    deadline: opts.maxSeconds ? now() + opts.maxSeconds * 1000 : undefined,
    totalRecords: 0,
    aborted: false,
  };
  const queue = new SmartQueue({ maxConcurrent: opts.concurrency ?? MAX_CONCURRENT_TABLES[opts.flow] });
  const results = new Map<SchemaTable, TableResult>();

  const skipped = (table: SchemaTable, why: string): TableResult => ({
    sobject: table.sobject, developerName: table.developerName, records: 0, requests: 0, bytes: 0, seconds: 0, skipped: why,
  });

  const phases = orderPhases(opts.tables, opts.flow);
  const runsLeft = new Map<SchemaTable, number>();
  for (const table of phases.flat()) runsLeft.set(table, (runsLeft.get(table) ?? 0) + 1);

  for (const phase of phases) {
    await queue.run(
      phase.map((table) => ({
        complexity: tableComplexity(table.whereSoql),
        run: async () => {
          let r: TableResult;
          if (opts.signal?.aborted || run.aborted) r = skipped(table, "cancelled");
          else if (run.deadline !== undefined && now() >= run.deadline) r = skipped(table, "maxSeconds budget exhausted");
          else if (opts.maxTotalRecords !== undefined && run.totalRecords >= opts.maxTotalRecords) r = skipped(table, "maxTotalRecords reached");
          else r = await new TableRunner(run, table).execute();
          const earlier = results.get(table);
          if (earlier) mergeRuns(earlier, r);
          else results.set(table, r);
          const left = (runsLeft.get(table) ?? 1) - 1;
          runsLeft.set(table, left);
          if (left === 0) opts.onTable?.(results.get(table) ?? r);
          return r;
        },
      }))
    );
  }
  if (opts.idStore) opts.idStore.collected = run.ids;
  return opts.tables.map((t) => results.get(t) ?? skipped(t, "not scheduled"));
}
