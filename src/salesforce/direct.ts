/**
 * Direct REST transport for SOQL and REST GETs.
 *
 * Every `sf data query` spawn costs 1–2 s of CLI start-up before the query
 * even runs; a large org's sync-volume estimate issues thousands of queries.
 * This client reuses the sf CLI's own login (`sf org display`) and talks to the
 * REST API over one keep-alive connection pool instead, paging with
 * nextRecordsUrl up to a row cap and reporting when the cap was hit.
 *
 * It is a fast path, not a replacement: anything it can't do (no usable
 * token, network/proxy/certificate trouble, URLs too long for a GET) returns
 * `null` and the caller falls back to the sf CLI. A network-level failure
 * turns the fast path off for that org for the rest of the session.
 *
 * Tokens are only ever sent to the org's own https instance URL.
 */

import { createWriteStream, renameSync, rmSync } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolveApiVersion } from "./api-version.js";
import { sfLimiter } from "./limiter.js";

export interface DirectCredentials {
  accessToken: string;
  instanceUrl: string;
  apiVersion?: string;
}

export type CredentialFetcher = (org: string) => Promise<DirectCredentials | null>;

export interface DirectQueryResult {
  totalSize: number;
  done: boolean;
  records: Record<string, unknown>[];
  truncated?: boolean;
}

export type DirectOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; timedOut?: boolean; status?: number; /** The org refused the components (not a transport problem). */ rejected?: boolean };

/** Salesforce rejects request URIs past ~16 KB; stay under it and let the CLI try. */
export const MAX_GET_URL_CHARS = 15_000;
const DEFAULT_TIMEOUT_MS = 120_000;

const credentials = new Map<string, Promise<DirectCredentials | null>>();
const disabledOrgs = new Set<string>();

export function directEnabled(org: string): boolean {
  if (process.env.LSC_SF_DIRECT === "0") return false;
  return !disabledOrgs.has(org);
}

/** Forget cached logins (after an org switch or re-login) and re-enable the fast path. */
export function resetDirect(org?: string): void {
  if (org) {
    credentials.delete(org);
    disabledOrgs.delete(org);
  } else {
    credentials.clear();
    disabledOrgs.clear();
  }
}

function isHttpsInstance(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

async function getCredentials(org: string, fetcher: CredentialFetcher, fresh = false): Promise<DirectCredentials | null> {
  if (fresh) credentials.delete(org);
  let pending = credentials.get(org);
  if (!pending) {
    pending = fetcher(org).then((c) => (c && c.accessToken && isHttpsInstance(c.instanceUrl) ? c : null)).catch(() => null);
    credentials.set(org, pending);
  }
  const creds = await pending;
  if (!creds) credentials.delete(org);
  return creds;
}

function errorText(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const parts = list
      .map((e: { errorCode?: string; message?: string }) =>
        e && (e.message || e.errorCode) ? `${e.errorCode ? `${e.errorCode}: ` : ""}${e.message ?? ""}`.trim() : ""
      )
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  } catch {
    // not JSON
  }
  return body.trim() || `HTTP ${status}`;
}

interface RawResponse {
  status: number;
  body: string;
}

/**
 * One GET against the org. `null` means "transport unusable — fall back".
 * Retries once on a 5xx, once with a fresh token on a 401.
 *
 * A request marked `once` (a create, which isn't safe to send twice) is never
 * retried on a 5xx, and a connection lost after it may have been sent comes
 * back as a failure instead of `null`, so the CLI doesn't send it again. A 401
 * is still retried: Salesforce refuses an expired token before acting.
 */
async function getOnce(
  org: string,
  pathAndQuery: string,
  fetcher: CredentialFetcher,
  timeoutMs: number,
  request?: { method: "POST" | "PATCH" | "DELETE"; body?: unknown; once?: boolean }
): Promise<RawResponse | { timedOut: true } | null> {
  let creds = await getCredentials(org, fetcher);
  if (!creds) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = `${creds.instanceUrl.replace(/\/$/, "")}${pathAndQuery}`;
    if (url.length > MAX_GET_URL_CHARS) return null;
    let res: Response;
    try {
      res = await sfLimiter.run(() =>
        fetch(url, {
          ...(request ? { method: request.method, ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}) } : {}),
          headers: {
            Authorization: `Bearer ${creds!.accessToken}`,
            Accept: "application/json",
            ...(request?.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          signal: AbortSignal.timeout(timeoutMs),
        })
      );
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") return { timedOut: true };
      // DNS, proxy, TLS, connection refused — this machine can't reach the org directly.
      disabledOrgs.add(org);
      if (request?.once) return { status: 599, body: "Lost the connection to Salesforce during the request. Check the org before trying again." };
      return null;
    }
    const body = await res.text();
    if (res.status === 401 && attempt === 0) {
      const next = await getCredentials(org, fetcher, true);
      // Same (expired) token back means sf didn't refresh it; the CLI will.
      if (!next || next.accessToken === creds.accessToken) return null;
      creds = next;
      continue;
    }
    if (res.status === 401) return null;
    if (res.status >= 500 && attempt < 2 && !request?.once) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }
    return { status: res.status, body };
  }
  return null;
}

async function apiVersion(org: string, fetcher: CredentialFetcher): Promise<string> {
  const creds = await getCredentials(org, fetcher);
  return resolveApiVersion(creds?.instanceUrl, creds?.apiVersion);
}

/**
 * Run a SOQL query over REST, following nextRecordsUrl until done or until
 * `maxRows` records are held (then `truncated` is set). `null` = fall back.
 */
export async function directQuery(
  query: string,
  org: string,
  fetcher: CredentialFetcher,
  options: { tooling?: boolean; maxRows: number; timeoutMs?: number }
): Promise<DirectOutcome<DirectQueryResult> | null> {
  if (!directEnabled(org)) return null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const version = await apiVersion(org, fetcher);
  let next: string | null = `/services/data/v${version}/${options.tooling ? "tooling/" : ""}query?q=${encodeURIComponent(query)}`;
  const records: Record<string, unknown>[] = [];
  let totalSize = 0;
  let first = true;
  while (next) {
    const res = await getOnce(org, next, fetcher, timeoutMs);
    if (!res) {
      // Can't page further over REST; only fall back if nothing was read yet.
      if (first) return null;
      return { ok: false, error: "Lost the connection to Salesforce while paging the query results" };
    }
    if ("timedOut" in res) return { ok: false, timedOut: true, error: `Query timed out after ${Math.round(timeoutMs / 1000)}s` };
    if (res.status >= 400) return { ok: false, status: res.status, error: errorText(res.status, res.body) };
    let page: { totalSize?: number; done?: boolean; records?: Record<string, unknown>[]; nextRecordsUrl?: string };
    try {
      page = JSON.parse(res.body);
    } catch {
      return first ? null : { ok: false, error: "Salesforce returned an unreadable query page" };
    }
    if (first) totalSize = page.totalSize ?? 0;
    first = false;
    for (const r of page.records ?? []) records.push(r);
    next = page.done === false && page.nextRecordsUrl ? page.nextRecordsUrl : null;
    if ((next && records.length >= options.maxRows) || records.length > options.maxRows) {
      return { ok: true, data: { totalSize, done: false, records: records.slice(0, options.maxRows), truncated: true } };
    }
  }
  return { ok: true, data: { totalSize, done: true, records } };
}

/**
 * A REST GET (`endpoint` is a path under the instance, e.g. from `dataPath` in cli.ts).
 * Mirrors `sf api request rest`: parsed JSON on 2xx, raw text if it isn't JSON.
 */
export async function directGet<T>(
  endpoint: string,
  org: string,
  fetcher: CredentialFetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<DirectOutcome<T> | null> {
  if (!directEnabled(org) || !endpoint.startsWith("/")) return null;
  const res = await getOnce(org, endpoint, fetcher, timeoutMs);
  if (!res) return null;
  if ("timedOut" in res) return { ok: false, timedOut: true, error: `Request timed out after ${Math.round(timeoutMs / 1000)}s` };
  if (res.status >= 400) return { ok: false, status: res.status, error: errorText(res.status, res.body) };
  try {
    return { ok: true, data: JSON.parse(res.body) as T };
  } catch {
    return { ok: true, data: res.body as unknown as T };
  }
}

const soapEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * One Metadata API SOAP call (`body` is the operation element, e.g. `<retrieve>…</retrieve>`).
 * Gives back the response envelope on 2xx, the fault string otherwise. `null` means
 * "transport unusable — fall back": no token, network trouble, or an expired token
 * sf didn't refresh. Retried only on an invalid session, which Salesforce rejects
 * before acting, so a deploy is never sent twice.
 */
export async function directMetadataSoap(
  org: string,
  body: string,
  fetcher: CredentialFetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<DirectOutcome<string> | null> {
  if (!directEnabled(org)) return null;
  let creds = await getCredentials(org, fetcher);
  if (!creds) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const version = resolveApiVersion(creds.instanceUrl, creds.apiVersion);
    const url = `${creds.instanceUrl.replace(/\/$/, "")}/services/Soap/m/${version}`;
    const envelope =
      `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns="http://soap.sforce.com/2006/04/metadata">` +
      `<env:Header><SessionHeader><sessionId>${soapEscape(creds.accessToken)}</sessionId></SessionHeader></env:Header><env:Body>${body}</env:Body></env:Envelope>`;
    let res: Response;
    try {
      res = await sfLimiter.run(() =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
          body: envelope,
          signal: AbortSignal.timeout(timeoutMs),
        })
      );
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return { ok: false, timedOut: true, error: `Request timed out after ${Math.round(timeoutMs / 1000)}s` };
      }
      disabledOrgs.add(org);
      return null;
    }
    const text = await res.text();
    if (res.ok) return { ok: true, data: text };
    const code = /<faultcode>([^<]*)<\/faultcode>/.exec(text)?.[1] ?? "";
    const message = /<faultstring>([^<]*)<\/faultstring>/.exec(text)?.[1] ?? "";
    if (/INVALID_SESSION_ID/.test(code)) {
      if (attempt > 0) return null;
      const next = await getCredentials(org, fetcher, true);
      if (!next || next.accessToken === creds.accessToken) return null;
      creds = next;
      continue;
    }
    return { ok: false, status: res.status, error: message ? `${code.replace(/^\w+:/, "")}: ${message}`.replace(/^: /, "") : `HTTP ${res.status}` };
  }
  return null;
}

/** The API version for an org (pinned, else the sf CLI's), for URLs and package manifests. */
export async function directApiVersion(org: string, fetcher: CredentialFetcher): Promise<string> {
  return apiVersion(org, fetcher);
}

/**
 * A read-only REST POST (a query posted as a body, e.g. Data Cloud `ssot/query-sql`). Same contract as
 * `directGet`; only for endpoints that don't write — it is retried on a 5xx and on an expired token.
 */
export async function directPostRead<T>(
  endpoint: string,
  body: unknown,
  org: string,
  fetcher: CredentialFetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<DirectOutcome<T> | null> {
  if (!directEnabled(org) || !endpoint.startsWith("/")) return null;
  const res = await getOnce(org, endpoint, fetcher, timeoutMs, { method: "POST", body });
  if (!res) return null;
  if ("timedOut" in res) return { ok: false, timedOut: true, error: `Request timed out after ${Math.round(timeoutMs / 1000)}s` };
  if (res.status >= 400) return { ok: false, status: res.status, error: errorText(res.status, res.body) };
  try {
    return { ok: true, data: JSON.parse(res.body) as T };
  } catch {
    return { ok: true, data: res.body as unknown as T };
  }
}

/**
 * Stream a REST GET's body to a file (a ContentVersion's VersionData). `null` = fall back to the CLI
 * (no token, network trouble, expired token). Nothing is left at `dest` unless the whole body arrived.
 */
export async function directDownload(
  endpoint: string,
  dest: string,
  org: string,
  fetcher: CredentialFetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<DirectOutcome<{ bytes: number }> | null> {
  if (!directEnabled(org) || !endpoint.startsWith("/")) return null;
  let creds = await getCredentials(org, fetcher);
  if (!creds) return null;
  const partial = `${dest}.part`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = `${creds.instanceUrl.replace(/\/$/, "")}${endpoint}`;
    try {
      const res = await sfLimiter.run(async () => {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${creds!.accessToken}` }, signal: AbortSignal.timeout(timeoutMs) });
        if (r.status !== 200 || !r.body) return { status: r.status, text: await r.text(), bytes: 0 };
        let bytes = 0;
        const counter = new Transform({
          transform(chunk, _enc, cb) {
            bytes += chunk.length;
            cb(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(r.body as never), counter, createWriteStream(partial));
        return { status: 200, text: "", bytes };
      });
      if (res.status === 401 && attempt === 0) {
        const next = await getCredentials(org, fetcher, true);
        if (!next || next.accessToken === creds.accessToken) return null;
        creds = next;
        continue;
      }
      if (res.status === 401) return null;
      if (res.status >= 500 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      if (res.status >= 400) return { ok: false, status: res.status, error: errorText(res.status, res.text) };
      renameSync(partial, dest);
      return { ok: true, data: { bytes: res.bytes } };
    } catch (err) {
      rmSync(partial, { force: true });
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") return { ok: false, timedOut: true, error: `Download timed out after ${Math.round(timeoutMs / 1000)}s` };
      // Anything else (DNS, proxy, TLS, a dropped connection): let the CLI try.
      if (err instanceof TypeError) disabledOrgs.add(org);
      return null;
    }
  }
  return null;
}

/** Tooling sobjects whose `Metadata` the direct path may PATCH (a closed list: this is a write path). */
const TOOLING_WRITE_TYPES = new Set(["FlexiPage", "CompactLayout", "CustomApplication"]);

/**
 * PATCH one Tooling API record's `Metadata` (`/tooling/sobjects/<Type>/<Id>`). Same contract as
 * `directGet`: `null` = transport unusable (no token, network trouble, expired token), fall back;
 * a refusal comes back as `{ ok: false }` with Salesforce's reasons. A PATCH sets state, so the
 * retry on a 5xx or an expired token is safe.
 */
export async function directToolingPatch(
  type: string,
  id: string,
  metadata: unknown,
  org: string,
  fetcher: CredentialFetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<DirectOutcome<void> | null> {
  if (!directEnabled(org) || !TOOLING_WRITE_TYPES.has(type) || !/^[a-zA-Z0-9]{15,18}$/.test(id)) return null;
  const version = await apiVersion(org, fetcher);
  const res = await getOnce(org, `/services/data/v${version}/tooling/sobjects/${type}/${id}`, fetcher, timeoutMs, { method: "PATCH", body: { Metadata: metadata } });
  if (!res) return null;
  if ("timedOut" in res) return { ok: false, timedOut: true, error: `Request timed out after ${Math.round(timeoutMs / 1000)}s` };
  if (res.status >= 400) return { ok: false, status: res.status, error: errorText(res.status, res.body) };
  return { ok: true, data: undefined };
}

/** Admin Console Tooling sobjects the direct path may create, update and delete (a closed list: this is a write path). */
const TOOLING_RECORD_TYPES = new Set(["LifeSciConfigRecord", "LifeSciConfigFieldValue", "LifeSciConfigAssignment", "LifeScienceTriggerHandler"]);

/**
 * Create (POST, no `id`), update (PATCH) or delete (DELETE) one Admin Console Tooling record —
 * what `sf api request rest` would do, without the CLI start-up. Same contract as `directGet`:
 * `null` = transport unusable before anything was sent, fall back; otherwise the org's answer.
 * Updates and deletes set state, so they are retried like reads; a create is sent once
 * (`getOnce`'s `once`). Parsed JSON on 2xx (a create's `{ id, success }`), undefined on 204.
 */
export async function directToolingWrite<T>(
  method: "POST" | "PATCH" | "DELETE",
  type: string,
  id: string | null,
  body: unknown,
  org: string,
  fetcher: CredentialFetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<DirectOutcome<T> | null> {
  if (!directEnabled(org) || !TOOLING_RECORD_TYPES.has(type)) return null;
  if (method === "POST" ? id !== null : !id || !/^[a-zA-Z0-9]{15,18}$/.test(id)) return null;
  const version = await apiVersion(org, fetcher);
  const path = `/services/data/v${version}/tooling/sobjects/${type}${id ? `/${id}` : ""}`;
  const res = await getOnce(org, path, fetcher, timeoutMs, { method, body: method === "DELETE" ? undefined : body, once: method === "POST" });
  if (!res) return null;
  if ("timedOut" in res) return { ok: false, timedOut: true, error: `Request timed out after ${Math.round(timeoutMs / 1000)}s` };
  if (res.status >= 400) return { ok: false, status: res.status, error: errorText(res.status, res.body) };
  if (!res.body.trim()) return { ok: true, data: undefined as T };
  try {
    return { ok: true, data: JSON.parse(res.body) as T };
  } catch {
    return { ok: true, data: res.body as unknown as T };
  }
}
