/**
 * Content downloads, the opt-in phase after a first-sync simulation. The iOS
 * app fetches file bodies after the data sync (outside the timed sync window):
 *
 * - Attachments: `AttachmentLoader.startDownload` runs a serial queue
 *   (maxConcurrentOperationCount = 1) of single GETs to each attachment's body
 *   URL (`AttachmentDownloadOperation`), for records whose parent belongs to a
 *   table with attachmentSupport "background" (`enqueueAttachmentDownload`,
 *   `AttachmentsService.allAttachments`).
 * - CLM: `CLMDataService.loadCLMDataIfNeeded` (on init and on sync completion)
 *   hands the active presentations to `CLMDownloadService`, which downloads each
 *   page's ContentVersion in Range chunks (`FilesDownloader.downloadFileInChunks`,
 *   10 MB chunks, 2 MB on low-RAM devices) with up to 4 downloads at once, and
 *   checks the MD5 against the ContentVersion checksum.
 *
 * Everything is a GET through the session's http function. Bodies are counted
 * and dropped: nothing is written to disk and only the file being fetched is in
 * memory (one chunk for CLM; attachments are a single GET like the app's).
 * The device's follow-up writes (clickstream, "presentation viewed") are not made.
 */

import { createHash } from "node:crypto";
import { isSalesforceUrl, type DeviceSession } from "./device/session.js";
import type { SchemaTable } from "./device/schema.js";

export interface ContentOptions {
  attachments?: boolean;
  clm?: boolean;
  /** Most files started per kind (default 200). */
  maxFiles?: number;
  /** Most bytes fetched per kind (default 2 GiB). */
  maxBytes?: number;
  /** Time limit for the whole phase, in seconds. */
  maxSeconds?: number;
  /** CLM Range chunk size (default 10 MiB, as on devices with 4 GB RAM or more). */
  chunkBytes?: number;
}

export const DEFAULT_CONTENT_MAX_FILES = 200;
export const DEFAULT_CONTENT_MAX_BYTES = 2 * 1024 ** 3;
export const DEFAULT_CHUNK = 10 * 1024 * 1024;
/** Downloads CLM runs at once (`CLMDownloadService.maxConcurentDownloadRequests`). */
export const CLM_CONCURRENCY = 4;
/** Rows kept in memory per kind of record (attachments, links, documents, versions, presentations, pages); more are counted and ignored. */
export const DEFAULT_MAX_COLLECTED_ROWS = 250_000;
/** A returned `Body` longer than this is file content, not the URL the app GETs; never kept. */
const MAX_BODY_URL = 512;
const LARGEST = 5;
const MAX_ERRORS = 3;

export interface ContentFileStat {
  name: string;
  bytes: number;
  seconds: number;
}

export interface ContentKindResult {
  /** Files the downloaded records pointed at. */
  candidates: number;
  /** Files fetched completely. */
  files: number;
  bytes: number;
  /** Wall-clock seconds for this kind. */
  seconds: number;
  failures: number;
  /** Candidates not attempted for lack of a size or URL. */
  skipped: number;
  largest: ContentFileStat[];
  /** Why the phase stopped early; the numbers are then lower bounds. */
  truncated?: string;
  /** A few distinct failure messages. */
  errors?: string[];
}

export interface ContentResult {
  /** Always true: this phase runs after the sync and is not part of its totals. */
  outsideSyncWindow: true;
  limits: { maxFiles: number; maxBytes: number };
  seconds: number;
  attachments?: ContentKindResult;
  clm?: ContentKindResult;
  notes: string[];
}

export interface ContentItem {
  name: string;
  url: string;
  /** Bytes; required for CLM (Range loop), informational for attachments. */
  size: number;
  checksum?: string;
}

export interface ContentPlan {
  attachments: ContentItem[];
  clm: ContentItem[];
  notes: string[];
}

// ---------- collecting the records the downloads are driven by ----------

type Row = Record<string, unknown>;

const lower = (r: Row): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) out[k.toLowerCase()] = v;
  return out;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? Number(v) || 0 : 0);

interface Cdl { docId: string; linkedId: string }
interface Doc { id: string; latestVersionId?: string; fileType?: string }
interface Version { id: string; docId?: string; url?: string; size: number; checksum?: string; title?: string; isLatest: boolean }
interface Pres { id: string; name: string; type: string; status?: string; activation?: string; deactivation?: string; isCustom: boolean }
interface Link { presentationId: string; pageId: string; order: number }
interface Page { id: string; name: string; type: string; status?: string }

/**
 * Keeps, from the records the replay downloads, only the few fields content
 * downloads need. Which presentations and attachments a user has is whatever
 * the sync downloaded into those tables, as on the device.
 */
export class ContentCollector {
  private readonly tableNames: Set<string>;
  private readonly prefixes = new Set<string>();
  private readonly attachmentRows: Array<{ id: string; parentId: string; body?: string; size: number; name: string }> = [];
  /** Rows not kept because a kind reached `maxRows`, by kind. */
  private readonly dropped = new Map<string, number>();
  private readonly cdls: Cdl[] = [];
  private readonly docs = new Map<string, Doc>();
  private readonly versions = new Map<string, Version>();
  private readonly presentations: Pres[] = [];
  private readonly links: Link[] = [];
  private readonly pages = new Map<string, Page>();

  constructor(
    private readonly want: { attachments: boolean; clm: boolean },
    tables: Array<Pick<SchemaTable, "sobject">>,
    private readonly maxRows: number = DEFAULT_MAX_COLLECTED_ROWS
  ) {
    this.tableNames = new Set(tables.map((t) => t.sobject.toLowerCase()));
  }

  /** Whether another row of this kind fits; counts the ones that don't. */
  private room(kind: string, held: number): boolean {
    if (held < this.maxRows) return true;
    this.dropped.set(kind, (this.dropped.get(kind) ?? 0) + 1);
    return false;
  }

  observe(table: Pick<SchemaTable, "sobject" | "attachmentsSupport">, records: Row[]): void {
    const name = table.sobject.toLowerCase();
    const { attachments, clm } = this.want;
    if (attachments && table.attachmentsSupport === "background" && name !== "presentationpage") {
      for (const r of records) {
        const id = str(r.Id) ?? str(lower(r).id);
        if (id && id.length >= 3) this.prefixes.add(id.slice(0, 3));
      }
    }
    switch (name) {
      case "attachment":
        if (!attachments) return;
        for (const raw of records) {
          const r = lower(raw);
          const id = str(r.id);
          const parentId = str(r.parentid);
          if (!id || !parentId || !this.room("Attachment", this.attachmentRows.length)) continue;
          // Over the REST API Body is the URL to GET; anything long is file content, which isn't kept.
          const body = str(r.body);
          this.attachmentRows.push({ id, parentId, body: body && body.length <= MAX_BODY_URL ? body : undefined, size: num(r.bodylength), name: str(r.name) ?? id });
        }
        return;
      case "contentdocumentlink":
        if (!attachments && !clm) return;
        for (const raw of records) {
          const r = lower(raw);
          const docId = str(r.contentdocumentid);
          const linkedId = str(r.linkedentityid);
          if (docId && linkedId && this.room("ContentDocumentLink", this.cdls.length)) this.cdls.push({ docId, linkedId });
        }
        return;
      case "contentdocument":
        if (!attachments && !clm) return;
        for (const raw of records) {
          const r = lower(raw);
          const id = str(r.id);
          if (id && (this.docs.has(id) || this.room("ContentDocument", this.docs.size))) this.docs.set(id, { id, latestVersionId: str(r.latestpublishedversionid), fileType: str(r.filetype) });
        }
        return;
      case "contentversion":
        if (!attachments && !clm) return;
        for (const raw of records) {
          const r = lower(raw);
          const id = str(r.id);
          if (!id || !(this.versions.has(id) || this.room("ContentVersion", this.versions.size))) continue;
          const url = str(r.versiondataurl) ?? (typeof r.versiondata === "string" && r.versiondata.startsWith("/") ? r.versiondata : undefined);
          this.versions.set(id, {
            id,
            docId: str(r.contentdocumentid),
            url,
            size: num(r.contentsize),
            checksum: str(r.checksum)?.toLowerCase(),
            title: str(r.title),
            isLatest: r.islatest !== false,
          });
        }
        return;
      case "presentation":
        if (!clm) return;
        for (const raw of records) {
          const r = lower(raw);
          const id = str(r.id);
          if (id && this.room("Presentation", this.presentations.length)) {
            this.presentations.push({
              id,
              name: str(r.name) ?? id,
              type: (str(r.type) ?? "").toUpperCase(),
              status: str(r.status),
              activation: str(r.activationdate),
              deactivation: str(r.deactivationdate),
              isCustom: r.iscustom === true,
            });
          }
        }
        return;
      case "presentationlinkedpage":
        if (!clm) return;
        for (const raw of records) {
          const r = lower(raw);
          const presentationId = str(r.presentationid);
          const pageId = str(r.presentationpageid);
          if (presentationId && pageId && this.room("PresentationLinkedPage", this.links.length)) this.links.push({ presentationId, pageId, order: num(r.displayorder) });
        }
        return;
      case "presentationpage":
        if (!clm) return;
        for (const raw of records) {
          const r = lower(raw);
          const id = str(r.id);
          if (id && (this.pages.has(id) || this.room("PresentationPage", this.pages.size))) this.pages.set(id, { id, name: str(r.name) ?? id, type: str(r.type) ?? "", status: str(r.status) });
        }
        return;
      default:
    }
  }

  private versionOf(docId: string): Version | undefined {
    const latest = this.docs.get(docId)?.latestVersionId;
    const direct = latest ? this.versions.get(latest) : undefined;
    if (direct) return direct;
    let found: Version | undefined;
    for (const v of this.versions.values()) if (v.docId === docId && (!found || v.isLatest)) found = v;
    return found;
  }

  private urlOf(v: Version, apiVersion: string, shepherd: boolean): string {
    if (v.url) return v.url;
    return shepherd ? `/sfc/servlet.shepherd/version/download/${v.id}` : `/services/data/${apiVersion}/sobjects/ContentVersion/${v.id}/VersionData`;
  }

  plan(apiVersion: string, now: Date = new Date()): ContentPlan {
    const plan: ContentPlan = { attachments: [], clm: [], notes: [] };
    if (this.want.attachments) this.planAttachments(plan, apiVersion);
    if (this.want.clm) this.planClm(plan, apiVersion, now);
    if (this.dropped.size > 0) {
      const what = [...this.dropped].map(([kind, n]) => `${n.toLocaleString("en-US")} ${kind}`).join(", ");
      plan.notes.push(`To bound memory the content planner keeps at most ${this.maxRows.toLocaleString("en-US")} rows of each kind; ${what} more were ignored, so the content numbers are lower bounds.`);
    }
    return plan;
  }

  private planAttachments(plan: ContentPlan, apiVersion: string): void {
    if (this.prefixes.size === 0) {
      plan.notes.push("No table with attachmentSupport \"background\" returned records, so there are no attachments to download.");
      return;
    }
    const seen = new Set<string>();
    if (this.tableNames.has("contentdocumentlink")) {
      for (const link of this.cdls) {
        if (!this.prefixes.has(link.linkedId.slice(0, 3))) continue;
        const v = this.versionOf(link.docId);
        if (!v || seen.has(v.id)) continue;
        seen.add(v.id);
        plan.attachments.push({ name: v.title ?? v.id, url: this.urlOf(v, apiVersion, false), size: v.size });
      }
    } else {
      for (const a of this.attachmentRows) {
        if (!this.prefixes.has(a.parentId.slice(0, 3))) continue;
        plan.attachments.push({ name: a.name, url: a.body ?? `/services/data/${apiVersion}/sobjects/Attachment/${a.id}/Body`, size: a.size });
      }
    }
  }

  private planClm(plan: ContentPlan, apiVersion: string, now: Date): void {
    if (this.presentations.length === 0) {
      plan.notes.push("No Presentation records were downloaded, so there is no CLM content to fetch.");
      return;
    }
    const nowMs = now.getTime();
    const inWindow = (p: Pres) => {
      const a = p.activation ? Date.parse(p.activation) : NaN;
      const d = p.deactivation ? Date.parse(p.deactivation) : NaN;
      return (Number.isNaN(a) || a <= nowMs) && (Number.isNaN(d) || d > nowMs);
    };
    const active = this.presentations
      .filter((p) => (p.status ?? "Active").toLowerCase() === "active" && inWindow(p))
      .sort((a, b) => Number(b.isCustom) - Number(a.isCustom) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const cdlsByPage = new Map<string, Cdl[]>();
    for (const l of this.cdls) cdlsByPage.set(l.linkedId, [...(cdlsByPage.get(l.linkedId) ?? []), l]);

    let unresolved = 0;
    for (const p of active) {
      const linked = this.links.filter((l) => l.presentationId === p.id).sort((a, b) => a.order - b.order);
      // PDF presentations download only their first page (the whole PDF); others every distinct page.
      const seenPages = new Set<string>();
      const pages: Page[] = [];
      for (const l of linked) {
        const page = this.pages.get(l.pageId);
        if (!page || (page.status ?? "Active").toLowerCase() !== "active" || seenPages.has(page.id)) continue;
        seenPages.add(page.id);
        pages.push(page);
      }
      for (const page of p.type === "PDF" ? pages.slice(0, 1) : pages) {
        const candidates = cdlsByPage.get(page.id) ?? [];
        const doc = candidates
          .map((c) => this.docs.get(c.docId))
          .find((d) => d && (!page.type || (d.fileType ?? "").toLowerCase() === page.type.toLowerCase()));
        const v = doc ? this.versionOf(doc.id) : undefined;
        if (!v) {
          unresolved++;
          continue;
        }
        plan.clm.push({ name: `${p.name} / ${page.name}`, url: this.urlOf(v, apiVersion, true), size: v.size, checksum: v.checksum });
      }
    }
    if (unresolved > 0) plan.notes.push(`${unresolved} presentation page(s) had no downloaded ContentVersion (ContentDocumentLink, ContentDocument or ContentVersion missing or limited), so they are not in the CLM numbers.`);
  }
}

// ---------- downloading ----------

interface Budget {
  maxFiles: number;
  maxBytes: number;
  deadline: number | undefined;
}

class KindRun {
  readonly result: ContentKindResult;
  private started = 0;
  private cursor = 0;
  private stopped = false;
  private readonly errorSet = new Set<string>();

  constructor(
    private readonly items: ContentItem[],
    private readonly session: DeviceSession,
    private readonly budget: Budget,
    private readonly o: { signal?: AbortSignal; now: () => number; chunkBytes: number; chunked: boolean; concurrency: number }
  ) {
    this.result = { candidates: items.length, files: 0, bytes: 0, seconds: 0, failures: 0, skipped: 0, largest: [] };
  }

  async run(): Promise<ContentKindResult> {
    const t0 = this.o.now();
    await Promise.all(Array.from({ length: Math.min(this.o.concurrency, Math.max(1, this.items.length)) }, () => this.worker()));
    this.result.seconds = (this.o.now() - t0) / 1000;
    if (this.errorSet.size > 0) this.result.errors = [...this.errorSet];
    return this.result;
  }

  private stop(reason: string): void {
    this.stopped = true;
    this.result.truncated ??= reason;
  }

  private overBudget(): string | undefined {
    if (this.o.signal?.aborted) return "cancelled";
    if (this.result.bytes >= this.budget.maxBytes) return `stopped at maxBytes (${this.budget.maxBytes})`;
    if (this.budget.deadline !== undefined && this.o.now() >= this.budget.deadline) return "stopped at the time limit";
    return undefined;
  }

  private async worker(): Promise<void> {
    while (!this.stopped && this.cursor < this.items.length) {
      const reason = this.overBudget();
      if (reason) return this.stop(reason);
      if (this.started >= this.budget.maxFiles) return this.stop(`stopped at maxFiles (${this.budget.maxFiles})`);
      const item = this.items[this.cursor++];
      if (!item.url || (this.o.chunked && item.size <= 0)) {
        this.result.skipped++;
        continue;
      }
      this.started++;
      const t0 = this.o.now();
      const before = this.result.bytes;
      try {
        const complete = this.o.chunked ? await this.fetchChunked(item) : await this.fetchWhole(item);
        if (complete) {
          this.result.files++;
          this.noteLargest({ name: item.name, bytes: this.result.bytes - before, seconds: (this.o.now() - t0) / 1000 });
        }
      } catch (e) {
        if (this.o.signal?.aborted) return this.stop("cancelled");
        this.fail(e instanceof Error ? e.message : String(e));
      }
    }
  }

  private fail(message: string): void {
    this.result.failures++;
    if (this.errorSet.size < MAX_ERRORS) this.errorSet.add(message.slice(0, 200));
  }

  private noteLargest(stat: ContentFileStat): void {
    const l = this.result.largest;
    l.push(stat);
    l.sort((a, b) => b.bytes - a.bytes);
    if (l.length > LARGEST) l.length = LARGEST;
  }

  private async get(url: string, headers?: Record<string, string>): Promise<number> {
    if (!(url.startsWith("/") && !url.startsWith("//")) && !isSalesforceUrl(url)) {
      throw new Error("refused a URL outside Salesforce");
    }
    // Attachment bodies can be hundreds of MB and are only counted: have the transport stream and drop them.
    const res = await this.session.http({ method: "GET", url, headers, signal: this.o.signal, discardBody: true });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    const n = res.bodyBytes ?? res.body.length;
    this.result.bytes += n;
    return n;
  }

  /** The attachment loader's single GET. */
  private async fetchWhole(item: ContentItem): Promise<boolean> {
    await this.get(item.url);
    return true;
  }

  /** `FilesDownloader.downloadFileInChunks`: Range requests until the ContentVersion's size is reached. */
  private async fetchChunked(item: ContentItem): Promise<boolean> {
    const md5 = item.checksum ? createHash("md5") : undefined;
    let received = 0;
    while (received < item.size) {
      const reason = this.overBudget();
      if (reason) {
        this.stop(`${reason}; the last file was cut short`);
        return false;
      }
      const end = Math.min(received + this.o.chunkBytes - 1, item.size - 1);
      const res = await this.session.http({ method: "GET", url: this.checked(item.url), headers: { Range: `bytes=${received}-${end}` }, signal: this.o.signal });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      if (res.body.length === 0) throw new Error("download stalled: received an empty chunk");
      this.result.bytes += res.body.length;
      received += res.body.length;
      md5?.update(res.body);
    }
    if (md5 && md5.digest("hex") !== item.checksum) throw new Error("MD5 did not match the ContentVersion checksum");
    return true;
  }

  private checked(url: string): string {
    if (!(url.startsWith("/") && !url.startsWith("//")) && !isSalesforceUrl(url)) throw new Error("refused a URL outside Salesforce");
    return url;
  }
}

export interface DownloadContentOptions extends ContentOptions {
  signal?: AbortSignal;
  now?: () => number;
  onStep?: (step: string) => void;
}

/** Fetch the planned files and report counts and times; nothing is kept. */
export async function downloadContent(session: DeviceSession, plan: ContentPlan, opts: DownloadContentOptions): Promise<ContentResult> {
  const now = opts.now ?? (() => performance.now());
  const start = now();
  const budget: Budget = {
    maxFiles: opts.maxFiles ?? DEFAULT_CONTENT_MAX_FILES,
    maxBytes: opts.maxBytes ?? DEFAULT_CONTENT_MAX_BYTES,
    deadline: opts.maxSeconds ? start + opts.maxSeconds * 1000 : undefined,
  };
  const result: ContentResult = {
    outsideSyncWindow: true,
    limits: { maxFiles: budget.maxFiles, maxBytes: budget.maxBytes },
    seconds: 0,
    notes: [...plan.notes],
  };
  const common = { signal: opts.signal, now, chunkBytes: opts.chunkBytes ?? DEFAULT_CHUNK };
  if (opts.attachments) {
    opts.onStep?.(`Downloading attachments (${plan.attachments.length} files, one at a time)`);
    result.attachments = await new KindRun(plan.attachments, session, budget, { ...common, chunked: false, concurrency: 1 }).run();
  }
  if (opts.clm) {
    opts.onStep?.(`Downloading CLM content (${plan.clm.length} files)`);
    result.clm = await new KindRun(plan.clm, session, budget, { ...common, chunked: true, concurrency: CLM_CONCURRENCY }).run();
  }
  result.seconds = (now() - start) / 1000;
  for (const [label, k] of [["attachments", result.attachments], ["CLM content", result.clm]] as const) {
    if (k?.truncated) result.notes.push(`${label}: ${k.truncated}; the numbers are lower bounds.`);
  }
  return result;
}

export const CONTENT_NOTES = [
  "Content downloads run after the data sync, as on the device, and are not part of the sync totals above.",
  "Bodies are counted and discarded; nothing is written to disk. Network time only (no unzip, thumbnails or file writes).",
  "Attachments are fetched one at a time with a single GET each, like the app's attachment loader; CLM files use Range requests (4 at a time) and an MD5 check.",
  "CLM files are fetched once per presentation page, as the app does, so a page shared by several presentations is downloaded for each.",
  "Not replicated: the app's writes after viewing a presentation (clickstream, \"presentation viewed\").",
];
