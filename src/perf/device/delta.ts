/**
 * Delta-sync simulation (enhanced flow): after an initial-sync replay, pretends the device last
 * synced `sinceHours` ago and makes the calls the iOS app makes next, over the ids the replay kept.
 *
 *  1. Visibility check (SyncConnectVisibilityLoader): POST connect/life-sciences/commercial/sobject/record-visibility
 *     with the table's local ids, WHERE, tags and a timeStamp range. The response lists ids to download and
 *     delete and may page through a queryLocator. OT2A and Account run first, one request at a time, when some
 *     WHERE uses their id tags. Tables over HEAVY_TABLE_IDS local ids go alone through a pool of
 *     VISIBILITY_MAX_IN_FLIGHT; the rest are sent in sequential rounds of at most VISIBILITY_BATCH_SIZE objects
 *     (paging objects first, fresh tables largest-first filling the slots). Attachment, then ContentDocumentLink,
 *     then ContentVersion and ContentDocument follow, one table per request (content id lists chunked).
 *  2. Fetch (SyncConnectDownloadManager.downloadWithIdSubquery): one IdSubquery request per table carrying every
 *     id to download, paged by queryLocator with the whole id list repeated on each page.
 *
 * Every call goes through `session.http`, with bodies gzipped by the app's rule (`gzip: true`; Connect bodies of
 * 4 KB or more). Nothing here sends a device id; the endpoints are read-only
 * queries as far as the client code shows.
 */

import { connectPath, jsonOrThrow, prepareRequestBody, type DeviceSession } from "./session.js";
import {
  AdaptiveBatch,
  CONTENT_CHUNK,
  CONTENT_TAGS,
  ID_TAGS,
  MAX_CONCURRENT_TABLES,
  SmartQueue,
  emptyIds,
  orderPhases,
  quoteIds,
  requestFields,
  resolveTags,
  tableComplexity,
  tagsInWhere,
  timeoutScope,
  type CollectedIds,
  type EnhancedTag,
  type LocalIdStore,
  type ReplayContext,
  type TableResult,
} from "./replay.js";
import type { SchemaTable } from "./schema.js";

export const VISIBILITY_PATH = "life-sciences/commercial/sobject/record-visibility";
export const QUERY_PATH = "life-sciences/commercial/sobject/query";
/** Visibility requests in flight at once (SyncConnectVisibilityLoader.maxNetworkRequests). */
export const VISIBILITY_MAX_IN_FLIGHT = 6;
/** Objects per light-table visibility request (maxBatchSize). */
export const VISIBILITY_BATCH_SIZE = 5;
/** Tables with more local ids than this get their own request (heavyTableIdThreshold). */
export const HEAVY_TABLE_IDS = 10_000;
/** Local ids kept across all tables for a delta simulation. */
export const DEFAULT_MAX_LOCAL_IDS = 2_000_000;
const MAX_PAGES = 10_000;

const OT2A = "objectterritory2association";
const ACCOUNT = "account";
const ATTACHMENT = "attachment";
const CDL = "contentdocumentlink";
const CONTENT_VERSION = "contentversion";
const CONTENT_DOCUMENT = "contentdocument";
const DSTR = "devicesynctransactionrecord";
const POSTPONED = new Set([ATTACHMENT, CDL, CONTENT_VERSION, CONTENT_DOCUMENT]);

export interface DeltaTableResult {
  sobject: string;
  developerName: string;
  /** Ids the simulated device holds for the table. */
  localIds: number;
  /** Visibility requests that carried this table (a batched request counts for each of its tables). */
  visibilityRequests: number;
  toDownload: number;
  /** Informational: records a device would delete locally. */
  toDelete: number;
  recordsFetched: number;
  fetchRequests: number;
  /** Response bytes; a batched visibility response is split evenly between its tables. */
  bytes: number;
  /** Seconds spent in requests carrying this table (batched requests count for each table), visibility then fetch. */
  visibilitySeconds: number;
  fetchSeconds: number;
  seconds: number;
  skipped?: string;
  error?: string;
  truncated?: string;
}

export interface DeltaTotals {
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
  /** Request body bytes sent, after gzip. */
  uploadBytes: number;
  /** Wall-clock seconds per phase and in all. */
  visibilitySeconds: number;
  fetchSeconds: number;
  seconds: number;
}

export interface DeltaResult {
  sinceHours: number;
  rangeStart: string;
  rangeEnd: string;
  tables: DeltaTableResult[];
  totals: DeltaTotals;
  notes: string[];
}

export interface DeltaOptions {
  session: DeviceSession;
  /** The tables of the initial replay and its results, in the same order. */
  tables: SchemaTable[];
  initial: TableResult[];
  store: LocalIdStore;
  context: ReplayContext;
  sinceHours: number;
  /** Per-request time limit in seconds (default 300). */
  requestTimeoutSeconds?: number;
  signal?: AbortSignal;
  now?: () => number;
  clock?: () => Date;
  onStep?: (step: string) => void;
}

const norm = (s: string) => s.toLowerCase();

/** Tables kept for the check, with the ids the device holds and the row being filled in. */
interface Item {
  table: SchemaTable;
  key: string;
  ids: string[];
  row: DeltaTableResult;
}

interface Change {
  add: string[];
  del: string[];
}

interface VisibilityObject {
  objectName: string;
  fetchedIds: string[];
  toDownload: string[];
  toDelete: string[];
  hasMore: boolean;
  queryLocator?: string;
}

interface Paging {
  item: Item;
  tags: EnhancedTag[];
  fetchedIds: string[];
  locator: string;
  add: string[];
  del: string[];
  pages: number;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function parseVisibility(json: unknown): VisibilityObject[] {
  const objects = (json as { objects?: unknown } | null)?.objects;
  if (!Array.isArray(objects)) return [];
  return objects.map((o: Record<string, unknown>) => ({
    objectName: typeof o?.objectName === "string" ? o.objectName : "",
    fetchedIds: strings(o?.fetchedIds),
    toDownload: strings(o?.toDownload),
    toDelete: strings(o?.toDelete),
    hasMore: o?.hasMore === true,
    queryLocator:
      typeof o?.queryLocator === "string" && o.queryLocator ? o.queryLocator : undefined,
  }));
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

class DeltaRun {
  private readonly now: () => number;
  private readonly changes = new Map<string, Change>();
  private readonly ids: CollectedIds = emptyIds();
  private readonly rangeStart: string;
  private readonly rangeEnd: string;
  private readonly all: Item[] = [];
  private readonly notes: string[] = [];
  private visibilityHttp = 0;
  private fetchHttp = 0;
  private bytes = 0;
  private uploadBytes = 0;

  constructor(private readonly o: DeltaOptions) {
    this.now = o.now ?? (() => performance.now());
    const end = (o.clock ?? (() => new Date()))();
    this.rangeEnd = end.toISOString();
    this.rangeStart = new Date(end.getTime() - o.sinceHours * 3_600_000).toISOString();
    this.ids.contDocs = o.store.collected.contDocs;
    this.ids.relatedEntities = o.store.collected.relatedEntities;
  }

  private get aborted(): boolean {
    return this.o.signal?.aborted === true;
  }

  // ----- setup -----

  private blankRow(t: SchemaTable): DeltaTableResult {
    return {
      sobject: t.sobject,
      developerName: t.developerName,
      localIds: 0,
      visibilityRequests: 0,
      toDownload: 0,
      toDelete: 0,
      recordsFetched: 0,
      fetchRequests: 0,
      bytes: 0,
      visibilitySeconds: 0,
      fetchSeconds: 0,
      seconds: 0,
    };
  }

  /** One row per table; tables the initial replay did not fully download or whose ids were not kept are skipped. */
  private prepare(): Item[] {
    const { tables, initial, store } = this.o;
    const items: Item[] = [];
    let capNoted = false;
    tables.forEach((table, i) => {
      const row = this.blankRow(table);
      const key = norm(table.sobject);
      const first = initial[i];
      const skip = (why: string) => {
        row.skipped = why;
        this.all.push({ table, key, ids: [], row });
      };
      if (key === DSTR)
        return skip("re-downloaded in full by GenericQuery on delta; not simulated");
      if (store.overflowed.has(key)) {
        if (!capNoted) {
          capNoted = true;
          this.notes.push(
            `The ${store.cap.toLocaleString("en-US")} local-id cap was reached, so delta was skipped for the tables whose ids were not kept.`
          );
        }
        return skip(`local ids not kept (cap of ${store.cap.toLocaleString("en-US")} ids reached)`);
      }
      if (!first || first.skipped)
        return skip(`not downloaded in the initial sync (${first?.skipped ?? "not run"})`);
      if (first.error) return skip("the initial download failed, so the local ids are incomplete");
      if (first.truncated)
        return skip(
          `the initial download was cut short (${first.truncated}), so the local ids are incomplete`
        );
      const ids = store.ids.get(key) ?? [];
      row.localIds = ids.length;
      const item: Item = { table, key, ids, row };
      this.all.push(item);
      items.push(item);
    });
    return items;
  }

  // ----- HTTP -----

  /** One counted request through the session; the time and bytes are shared between `rows`. */
  private async post(
    kind: "visibility" | "fetch",
    path: string,
    body: unknown,
    rows: DeltaTableResult[]
  ): Promise<unknown> {
    const scope = timeoutScope(this.o.signal, (this.o.requestTimeoutSeconds ?? 300) * 1000);
    const payload = JSON.stringify(body);
    const url = connectPath(this.o.session, path);
    const t0 = this.now();
    try {
      const res = await this.o.session.http({
        method: "POST",
        url,
        headers: { "X-Chatter-Entity-Encoding": "false" },
        body: payload,
        gzip: true,
        signal: scope.signal,
      });
      const seconds = (this.now() - t0) / 1000;
      if (kind === "visibility") this.visibilityHttp++;
      else this.fetchHttp++;
      const received = res.wireBytes ?? res.body.length;
      this.bytes += received;
      this.uploadBytes += prepareRequestBody({ url, body: payload, gzip: true }).body?.length ?? 0;
      for (const row of rows) {
        row.bytes += received / rows.length;
        if (kind === "visibility") {
          row.visibilityRequests++;
          row.visibilitySeconds += seconds;
        } else {
          row.fetchRequests++;
          row.fetchSeconds += seconds;
        }
      }
      return jsonOrThrow(res, `POST ${path.split("/").pop()}`);
    } finally {
      scope.dispose();
    }
  }

  private fail(rows: DeltaTableResult[], e: unknown): void {
    const message = this.aborted ? "cancelled" : e instanceof Error ? e.message : String(e);
    for (const row of rows) {
      if (this.aborted) row.truncated ??= message;
      else row.error ??= message;
    }
  }

  // ----- tags and requests -----

  /** Tags for a visibility request, or undefined when a content id list is empty (the table is skipped). */
  private tagsFor(item: Item, withContent: boolean): EnhancedTag[] | undefined {
    const tags = resolveTags(item.table, this.o.context, this.ids);
    const out: EnhancedTag[] = Object.entries(tags.scalars).map(([tagName, tagValue]) => ({
      tagName,
      tagValue,
    }));
    for (const [tagName, list] of Object.entries(tags.lists)) {
      if ((ID_TAGS as readonly string[]).includes(tagName)) {
        if (list.length > 0) out.push({ tagName, tagValue: quoteIds(list) });
      } else if ((CONTENT_TAGS as readonly string[]).includes(tagName)) {
        if (list.length === 0) return undefined;
        if (withContent) out.push({ tagName, tagValue: quoteIds(list) });
      }
    }
    return out;
  }

  private requestObject(
    item: Item,
    tags: EnhancedTag[],
    fetchedIds: string[],
    locator?: string
  ): Record<string, unknown> {
    return {
      objectName: item.table.sobject,
      fetchedIds,
      ids: item.ids,
      where: item.table.whereSoql ?? "",
      tags,
      timeStamp: [
        {
          fieldName: item.table.deltaDateField ?? "SystemModstamp",
          rangeStartTime: this.rangeStart,
          rangeEndTime: this.rangeEnd,
        },
      ],
      ...(locator ? { queryLocator: locator } : {}),
    };
  }

  private setChange(item: Item, add: string[], del: string[]): void {
    this.changes.set(item.key, { add, del });
    item.row.toDownload = add.length;
    item.row.toDelete = del.length;
  }

  private find(objects: VisibilityObject[], item: Item): VisibilityObject | undefined {
    return objects.find((x) => norm(x.objectName) === item.key);
  }

  // ----- one table per request -----

  /** performVisibilityCheck: the table alone, paging by queryLocator; content id lists in slices. */
  private async checkSingle(item: Item): Promise<void> {
    if (this.aborted) return;
    try {
      const contentTag = this.contentTag(item);
      if (contentTag && !this.o.context.serverHandlesContentInList)
        return await this.checkContentChunked(item, contentTag);
      const tags = this.tagsFor(item, true);
      if (!tags) return this.setChange(item, [], []);
      const { add, del } = await this.pageThrough(item, tags);
      this.setChange(item, add, del);
    } catch (e) {
      this.fail([item.row], e);
    }
  }

  private async pageThrough(item: Item, tags: EnhancedTag[]): Promise<Change> {
    const add: string[] = [];
    const del: string[] = [];
    let locator: string | undefined;
    let fetched: string[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const json = await this.post(
        "visibility",
        VISIBILITY_PATH,
        { objects: [this.requestObject(item, tags, locator ? fetched : [], locator)] },
        [item.row]
      );
      const result = this.find(parseVisibility(json), item);
      if (!result) break;
      add.push(...result.toDownload);
      del.push(...result.toDelete);
      fetched = result.fetchedIds;
      locator = result.hasMore ? result.queryLocator : undefined;
      if (!locator || this.aborted) return { add, del };
    }
    if (locator) item.row.truncated = `stopped after ${MAX_PAGES} pages`;
    return { add, del };
  }

  private contentTag(item: Item): { tagName: string; ids: string[] } | undefined {
    const tags = tagsInWhere(item.table.whereSoql);
    if (tags.includes("{RELATED.ENTITIES}"))
      return { tagName: "{RELATED.ENTITIES}", ids: [...this.ids.relatedEntities] };
    if (tags.includes("{CONT.DOCS}"))
      return { tagName: "{CONT.DOCS}", ids: [...this.ids.contDocs] };
    return undefined;
  }

  /** performContentChunkedVisibilityCheck: ids to download are the union over slices, ids to delete the intersection. */
  private async checkContentChunked(
    item: Item,
    content: { tagName: string; ids: string[] }
  ): Promise<void> {
    if (content.ids.length === 0) return this.setChange(item, [], []);
    const base = this.tagsFor(item, false);
    if (!base) return this.setChange(item, [], []);
    const union = new Set<string>();
    let intersection: Set<string> | undefined;
    for (let start = 0; start < content.ids.length; start += CONTENT_CHUNK) {
      if (this.aborted) return;
      const slice = content.ids.slice(start, start + CONTENT_CHUNK);
      const { add, del } = await this.pageThrough(item, [
        ...base,
        { tagName: content.tagName, tagValue: quoteIds(slice) },
      ]);
      for (const id of add) union.add(id);
      const delSet = new Set(del);
      intersection = intersection
        ? new Set([...intersection].filter((id) => delSet.has(id)))
        : delSet;
    }
    this.setChange(item, [...union], [...(intersection ?? [])]);
  }

  /** Ids a device holds after the check: local ids minus deletes plus downloads. */
  private validIds(item: Item): string[] {
    const change = this.changes.get(item.key);
    if (!change) return item.ids;
    const valid = new Set(item.ids);
    for (const id of change.del) valid.delete(id);
    for (const id of change.add) valid.add(id);
    return [...valid];
  }

  // ----- batched rounds -----

  /** performVisibilityRound loop: paging objects keep their slot, fresh tables (largest first) fill the rest. */
  private async rounds(light: Item[]): Promise<void> {
    const fresh = [...light].sort((a, b) => b.ids.length - a.ids.length);
    let carry: Paging[] = [];
    while ((fresh.length > 0 || carry.length > 0) && !this.aborted) {
      const take = fresh.splice(0, Math.max(0, VISIBILITY_BATCH_SIZE - carry.length));
      const objects: Record<string, unknown>[] = [];
      const sent: { item: Item; tags: EnhancedTag[]; paging?: Paging }[] = [];
      for (const item of take) {
        const tags = this.tagsFor(item, true);
        if (!tags) {
          this.setChange(item, [], []);
          continue;
        }
        objects.push(this.requestObject(item, tags, []));
        sent.push({ item, tags });
      }
      for (const p of carry) {
        objects.push(this.requestObject(p.item, p.tags, p.fetchedIds, p.locator));
        sent.push({ item: p.item, tags: p.tags, paging: p });
      }
      carry = [];
      if (objects.length === 0) continue;

      const rows = sent.map((s) => s.item.row);
      let results: VisibilityObject[];
      try {
        results = parseVisibility(
          await this.post("visibility", VISIBILITY_PATH, { objects }, rows)
        );
      } catch (e) {
        this.fail(rows, e);
        continue;
      }
      for (const s of sent) {
        const result = this.find(results, s.item);
        const p: Paging = s.paging ?? {
          item: s.item,
          tags: s.tags,
          fetchedIds: [],
          locator: "",
          add: [],
          del: [],
          pages: 0,
        };
        p.pages++;
        if (result) {
          p.add.push(...result.toDownload);
          p.del.push(...result.toDelete);
          p.fetchedIds = result.fetchedIds;
        }
        if (result?.hasMore && result.queryLocator && p.pages < MAX_PAGES) {
          p.locator = result.queryLocator;
          carry.push(p);
        } else {
          if (result?.hasMore) s.item.row.truncated = `stopped after ${MAX_PAGES} pages`;
          this.setChange(s.item, p.add, p.del);
        }
      }
    }
  }

  // ----- phases -----

  private async visibility(items: Item[]): Promise<void> {
    const byKey = new Map(items.map((i) => [i.key, i]));
    const allWheres = this.o.tables.flatMap((t) => tagsInWhere(t.whereSoql));
    const uses = (tag: string) => allWheres.includes(tag);

    const ot2a = byKey.get(OT2A);
    const account = byKey.get(ACCOUNT);
    const first = new Set<Item>();
    if (ot2a && uses("{OT2A.OBJ.IDS}")) {
      first.add(ot2a);
      await this.checkSingle(ot2a);
      for (const id of this.validIds(ot2a)) {
        const objectId = this.o.store.ot2aObjectIds.get(id);
        if (objectId) this.ids.ot2aObjIds.add(objectId);
      }
    }
    if (account && uses("{ACCOUNT.IDS}")) {
      first.add(account);
      await this.checkSingle(account);
      for (const id of this.validIds(account)) this.ids.accountIds.add(id);
    }

    const main = items.filter((i) => !first.has(i) && !POSTPONED.has(i.key));
    const heavy = main.filter((i) => i.ids.length > HEAVY_TABLE_IDS);
    const light = main.filter((i) => i.ids.length <= HEAVY_TABLE_IDS);
    await Promise.all([
      pool(heavy, VISIBILITY_MAX_IN_FLIGHT, (i) => this.checkSingle(i)),
      this.rounds(light),
    ]);

    const attachment = byKey.get(ATTACHMENT);
    if (attachment) await this.checkSingle(attachment);
    const cdl = byKey.get(CDL);
    if (cdl) {
      await this.checkSingle(cdl);
      const rest = [byKey.get(CONTENT_VERSION), byKey.get(CONTENT_DOCUMENT)].filter(
        (i): i is Item => i !== undefined
      );
      await pool(rest, VISIBILITY_MAX_IN_FLIGHT, (i) => this.checkSingle(i));
    }
  }

  /** downloadWithIdSubquery: every id to download in one request, paged, with the id list repeated per page. */
  private async fetchTable(item: Item): Promise<void> {
    const add = this.changes.get(item.key)?.add ?? [];
    if (add.length === 0 || this.aborted || item.row.error) return;
    const batch = new AdaptiveBatch(item.table.weight);
    const fields = requestFields(item.table);
    let locator: string | undefined;
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const before = item.row.bytes;
        const t0 = this.now();
        const json = (await this.post(
          "fetch",
          QUERY_PATH,
          {
            objectName: item.table.sobject,
            fields,
            queryType: "IdSubquery",
            ...(locator ? { queryLocator: locator } : {}),
            ids: add,
            batchSize: batch.size,
          },
          [item.row]
        )) as { records?: unknown; hasMore?: unknown; queryLocator?: unknown } | null;
        const count = Array.isArray(json?.records) ? json.records.length : 0;
        item.row.recordsFetched += count;
        batch.update((this.now() - t0) / 1000, item.row.bytes - before, count);
        locator =
          json?.hasMore === true && typeof json.queryLocator === "string" && json.queryLocator
            ? json.queryLocator
            : undefined;
        if (!locator || this.aborted) return;
      }
      item.row.truncated = `stopped after ${MAX_PAGES} pages`;
    } catch (e) {
      this.fail([item.row], e);
    }
  }

  private async fetch(items: Item[]): Promise<void> {
    const wanted = items.filter((i) => (this.changes.get(i.key)?.add.length ?? 0) > 0);
    const queue = new SmartQueue({ maxConcurrent: MAX_CONCURRENT_TABLES.enhanced });
    for (const phase of orderPhases(
      wanted.map((i) => i.table),
      "enhanced"
    )) {
      await queue.run(
        phase.map((table) => ({
          complexity: tableComplexity(table.whereSoql),
          run: () => this.fetchTable(wanted.find((i) => i.table === table) as Item),
        }))
      );
    }
  }

  // ----- run -----

  async run(): Promise<DeltaResult> {
    const items = this.prepare();
    const t0 = this.now();
    this.o.onStep?.("Delta: visibility check");
    await this.visibility(items);
    const t1 = this.now();
    this.o.onStep?.("Delta: fetching changed records");
    if (!this.aborted) await this.fetch(items);
    const t2 = this.now();

    for (const { row } of this.all) {
      row.seconds = row.visibilitySeconds + row.fetchSeconds;
      row.bytes = Math.round(row.bytes);
    }
    const rows = this.all.map((i) => i.row);
    const sum = (f: (r: DeltaTableResult) => number) => rows.reduce((s, r) => s + f(r), 0);
    const totals: DeltaTotals = {
      tablesChecked: rows.filter((r) => !r.skipped && !r.error).length,
      tablesSkipped: rows.filter((r) => r.skipped).length,
      tablesFailed: rows.filter((r) => r.error).length,
      localIds: sum((r) => r.localIds),
      toDownload: sum((r) => r.toDownload),
      toDelete: sum((r) => r.toDelete),
      recordsFetched: sum((r) => r.recordsFetched),
      visibilityRequests: this.visibilityHttp,
      fetchRequests: this.fetchHttp,
      requests: this.visibilityHttp + this.fetchHttp,
      bytes: this.bytes,
      uploadBytes: this.uploadBytes,
      visibilitySeconds: (t1 - t0) / 1000,
      fetchSeconds: (t2 - t1) / 1000,
      seconds: (t2 - t0) / 1000,
    };
    const notes = [
      `Delta simulated as if the device last synced ${this.o.sinceHours} hour(s) ago: timeStamp range ${this.rangeStart} to ${this.rangeEnd}, on the field each table's DeltaDateField names (SystemModstamp otherwise).`,
      "The local ids are the records just downloaded, so ids to download are what the server returns for the range; if the server only returns ids the device lacks, expect few or none. Ids to delete are informational.",
      "Network time only. Large request bodies are gzipped as the app does; attachment postponement is assumed on.",
      "DeviceSyncTransactionRecord is re-downloaded in full on delta and is not simulated here.",
      `Visibility: OT2A and Account first when a WHERE uses their id tags; tables over ${HEAVY_TABLE_IDS.toLocaleString("en-US")} ids alone (up to ${VISIBILITY_MAX_IN_FLIGHT} at once); the rest in rounds of at most ${VISIBILITY_BATCH_SIZE} objects, one round at a time; then Attachment, ContentDocumentLink, ContentVersion and ContentDocument. Fetch: one IdSubquery request per table, tables scheduled like the initial sync.`,
      ...this.notes,
    ];
    if (this.aborted) notes.push("The delta simulation was cancelled.");
    if (rows.some((r) => r.error))
      notes.push("A failed request fails that table only here; the app would fail the whole sync.");
    return {
      sinceHours: this.o.sinceHours,
      rangeStart: this.rangeStart,
      rangeEnd: this.rangeEnd,
      tables: rows,
      totals,
      notes,
    };
  }
}

export function simulateDelta(opts: DeltaOptions): Promise<DeltaResult> {
  return new DeltaRun(opts).run();
}
