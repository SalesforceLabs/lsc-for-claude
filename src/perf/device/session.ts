/**
 * Authenticated HTTP session for the first-sync simulator. Credentials come
 * from an org already authenticated in the sf CLI (the persona user, not an
 * admin, when the goal is device-accurate numbers). The access token lives only
 * inside the closure returned by `createHttp`; it is never logged or returned.
 */

import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";
import { execSfCommand } from "../../salesforce/cli.js";
import type { NetworkShaper } from "./network.js";

export interface DeviceRequest {
  method: "GET" | "POST";
  /** Absolute URL, or a path starting with "/" resolved against the instance URL. */
  url: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Set by `shapeHttp`; a transport that streams applies the link's bandwidth limits while it reads and writes. */
  shaper?: NetworkShaper;
}

export interface DeviceResponse {
  status: number;
  headers: Record<string, string>;
  /** Decoded body (gzip, deflate and br are decoded, as URLSession does). */
  body: Buffer;
  /** Body bytes as they crossed the wire, before content decoding; what a device downloads. Absent means `body.length`. */
  wireBytes?: number;
  /** True when the transport already applied `req.shaper`'s bandwidth limits. */
  shaped?: boolean;
}

/** The only network seam the simulator uses; unit tests replace it with a mock. */
export interface DeviceHttp {
  (req: DeviceRequest): Promise<DeviceResponse>;
  /** True when the transport throttles uplink and downlink itself, given `req.shaper`. */
  streamsShaping?: boolean;
}

export interface DeviceSession {
  username: string;
  orgId?: string;
  instanceUrl: string;
  /** e.g. "v67.0" */
  apiVersion: string;
  http: DeviceHttp;
}

export const DEFAULT_API_VERSION = "v67.0";

export function normalizeApiVersion(v: string | undefined): string {
  if (!v) return DEFAULT_API_VERSION;
  const trimmed = v.trim();
  const bare = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  return /^\d+(\.\d+)?$/.test(bare) ? `v${bare.includes(".") ? bare : `${bare}.0`}` : DEFAULT_API_VERSION;
}

export function connectPath(session: Pick<DeviceSession, "apiVersion">, rest: string): string {
  return `/services/data/${session.apiVersion}/connect/${rest}`;
}

export function dataPath(session: Pick<DeviceSession, "apiVersion">, rest: string): string {
  return `/services/data/${session.apiVersion}/${rest}`;
}

export const AUTH_HELP =
  "Authenticate the end user in the sf CLI first, e.g. `sf org login jwt --username <user> --client-id <connected app key> --jwt-key-file <key> --instance-url <url>` or `sf org login web --alias <alias>`, then pass that username or alias.";

export class DeviceHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "DeviceHttpError";
  }
}

/** Salesforce-hosted HTTPS origins; a token is only ever sent to one of these. */
const SALESFORCE_HOST = /(^|\.)(salesforce\.com|force\.com|salesforce\.mil|crmforce\.mil|sfcrmproducts\.cn)$/i;

export function isSalesforceUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && SALESFORCE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** An OAuth login Studio made itself, through the LSC mobile app's connected app. */
export interface TokenLogin {
  instanceUrl: string;
  accessToken: string;
  username: string;
  orgId?: string;
}

/**
 * A session from a token Studio obtained through the LSC mobile app's own
 * login. The org serves the mobile sync endpoints (user-info, metadata) only to
 * that connected app, so sf CLI logins get 404 from them.
 */
export function createTokenSession(login: TokenLogin, opts: SessionOptions = {}): DeviceSession {
  if (!isSalesforceUrl(login.instanceUrl)) throw new Error(`"${login.instanceUrl}" is not a Salesforce HTTPS URL.`);
  return {
    username: login.username,
    orgId: login.orgId,
    instanceUrl: login.instanceUrl,
    apiVersion: normalizeApiVersion(opts.apiVersion),
    http: createHttp(login.instanceUrl, login.accessToken, opts.fetchImpl),
  };
}

/** Request bodies under this size are sent as they are (SalesforceApi.gzipCompressionThreshold). */
export const GZIP_REQUEST_THRESHOLD = 4096;

/** What a device's URL loading system advertises; responses in any of these are decoded. */
const ACCEPT_ENCODING = "gzip, deflate, br";
const MAX_REDIRECTS = 5;

/**
 * The request body as sent. Mirrors SalesforceApi.resolveRequestBody: a Connect API request that
 * opts in with `Content-Encoding: gzip` is compressed when the body is at least 4096 bytes and
 * the compressed form is smaller; otherwise it goes out plain and the header is dropped.
 */
export function prepareRequestBody(
  req: Pick<DeviceRequest, "url" | "body" | "headers">
): { body: Buffer | undefined; gzipped: boolean } {
  if (req.body === undefined) return { body: undefined, gzipped: false };
  const raw = Buffer.from(req.body, "utf8");
  const wantsGzip = Object.entries(req.headers ?? {}).some(([k, v]) => k.toLowerCase() === "content-encoding" && v.toLowerCase() === "gzip");
  if (wantsGzip && req.url.includes("/connect/") && raw.length >= GZIP_REQUEST_THRESHOLD) {
    const compressed = zlib.gzipSync(raw);
    if (compressed.length < raw.length) return { body: compressed, gzipped: true };
  }
  return { body: raw, gzipped: false };
}

function decodeBody(body: Buffer, encoding: string | undefined): Buffer {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return body.length ? zlib.gunzipSync(body) : body;
    case "deflate":
      if (!body.length) return body;
      try {
        return zlib.inflateSync(body);
      } catch {
        return zlib.inflateRawSync(body);
      }
    case "br":
      return body.length ? zlib.brotliDecompressSync(body) : body;
    default:
      return body;
  }
}

function requestHeaders(token: string, req: DeviceRequest, gzipped: boolean, body: Buffer | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Accept-Encoding": ACCEPT_ENCODING,
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
  };
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (k.toLowerCase() === "content-encoding") continue; // set below, only when the body really was compressed
    headers[k] = v;
  }
  if (gzipped) headers["Content-Encoding"] = "gzip";
  return headers;
}

/** Send `body` in slices through the uplink bucket (or all at once without a shaper). */
async function writeBody(out: http.ClientRequest, body: Buffer | undefined, shaper: NetworkShaper | undefined): Promise<void> {
  if (body === undefined) return;
  const step = shaper ? shaper.up.sliceBytes : body.length || 1;
  for (let off = 0; off < body.length; off += step) {
    const slice = body.subarray(off, off + step);
    if (shaper) await shaper.up.take(slice.length);
    if (!out.write(slice)) await new Promise<void>((resolve) => out.once("drain", resolve));
  }
}

function nodeRequest(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
  req: DeviceRequest,
  redirectsLeft: number
): Promise<DeviceResponse> {
  return new Promise<DeviceResponse>((resolve, reject) => {
    const lib = url.protocol === "http:" ? http : https;
    const out = lib.request(
      url,
      { method, headers: { ...headers, ...(body !== undefined ? { "Content-Length": String(body.length) } : {}) }, signal: req.signal },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location && redirectsLeft > 0) {
          res.resume();
          const next = new URL(location, url);
          const keepBody = status === 307 || status === 308;
          const nextHeaders = { ...headers };
          if (next.origin !== url.origin || !isSalesforceUrl(next.toString())) delete nextHeaders.Authorization;
          if (!keepBody) {
            delete nextHeaders["Content-Type"];
            delete nextHeaders["Content-Encoding"];
          }
          nodeRequest(next, keepBody ? method : "GET", nextHeaders, keepBody ? body : undefined, req, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        const shaper = req.shaper;
        const chunks: Buffer[] = [];
        let wire = 0;
        (async () => {
          // Taking from the bucket between reads leaves the socket unread, so TCP backs the real download off.
          for await (const chunk of res as AsyncIterable<Buffer>) {
            chunks.push(chunk);
            wire += chunk.length;
            if (shaper) await shaper.down.takeSliced(chunk.length);
          }
          const responseHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) responseHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
          }
          const decoded = decodeBody(Buffer.concat(chunks), responseHeaders["content-encoding"]);
          resolve({ status, headers: responseHeaders, body: decoded, wireBytes: wire, ...(shaper ? { shaped: true } : {}) });
        })().catch(reject);
      }
    );
    out.on("error", reject);
    writeBody(out, body, req.shaper).then(() => out.end(), (e) => {
      out.destroy();
      reject(e);
    });
  });
}

/**
 * The HTTP layer for a session. By default it talks to Salesforce over node's https so it can see
 * wire bytes and shape the link as it reads; `fetchImpl` swaps in another transport (tests), whose
 * wire size is taken from Content-Length when the response was compressed.
 */
export function createHttp(instanceUrl: string, accessToken: string, fetchImpl?: typeof fetch): DeviceHttp {
  const base = instanceUrl.replace(/\/+$/, "");
  const send: DeviceHttp = async (req) => {
    const url = req.url.startsWith("/") ? base + req.url : req.url;
    const { body, gzipped } = prepareRequestBody(req);
    const headers = requestHeaders(accessToken, req, gzipped, body);
    if (!fetchImpl) return nodeRequest(new URL(url), req.method, headers, body, req, MAX_REDIRECTS);

    const res = await fetchImpl(url, { method: req.method, headers, body, signal: req.signal });
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    const decoded = Buffer.from(await res.arrayBuffer());
    const declared = Number(responseHeaders["content-length"]);
    const wireBytes = responseHeaders["content-encoding"] && Number.isFinite(declared) && declared > 0 ? declared : decoded.length;
    return { status: res.status, headers: responseHeaders, body: decoded, wireBytes };
  };
  if (!fetchImpl) send.streamsShaping = true;
  return send;
}

/**
 * Apply a network shaper to every request through `inner`: half the RTT before the request and
 * half after the response arrives, plus bandwidth limits. A transport that streams (the default)
 * throttles as it goes; for any other the uplink is charged before the call and the downlink after
 * it. No shaper returns `inner` itself, so "None" adds nothing.
 */
export function shapeHttp(inner: DeviceHttp, shaper: NetworkShaper | undefined): DeviceHttp {
  if (!shaper) return inner;
  const aborted = (signal: AbortSignal | undefined) => {
    if (signal?.aborted) throw new DeviceHttpError("Cancelled");
  };
  const shaped: DeviceHttp = async (req) => {
    await shaper.halfRtt();
    aborted(req.signal);
    if (!inner.streamsShaping && req.body !== undefined) await shaper.up.takeSliced(Buffer.byteLength(req.body));
    aborted(req.signal);
    const res = await inner({ ...req, shaper });
    aborted(req.signal);
    await shaper.halfRtt();
    if (!res.shaped) await shaper.down.takeSliced(res.wireBytes ?? res.body.length);
    return res;
  };
  shaped.streamsShaping = inner.streamsShaping;
  return shaped;
}

function errorMessage(body: Buffer): string {
  const text = body.toString("utf8").slice(0, 400);
  try {
    const parsed = JSON.parse(text) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (first && typeof first === "object") {
      const o = first as Record<string, unknown>;
      const code = typeof o.errorCode === "string" ? o.errorCode : "";
      const message = typeof o.message === "string" ? o.message : "";
      if (code || message) return [code, message].filter(Boolean).join(": ");
    }
  } catch {
    // not JSON
  }
  return text;
}

/** Throws a DeviceHttpError for non-2xx responses and returns the parsed JSON otherwise. */
export function jsonOrThrow(res: DeviceResponse, what: string): unknown {
  if (res.status < 200 || res.status >= 300) {
    const hint =
      res.status === 401
        ? " The access token was rejected; refresh it with `sf org display` or re-authenticate."
        : "";
    throw new DeviceHttpError(`${what} failed (HTTP ${res.status}): ${errorMessage(res.body)}.${hint}`, res.status);
  }
  try {
    return JSON.parse(res.body.toString("utf8")) as unknown;
  } catch {
    throw new DeviceHttpError(`${what} returned a non-JSON body`, res.status);
  }
}

interface SessionOptions {
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Build a session for an sf-CLI-authenticated org alias or username.
 * `sf org display` redacts the token in recent CLI versions, so the token is
 * read with `sf org auth show-access-token` when the display value is redacted.
 */
export async function createDeviceSession(targetOrg: string, opts: SessionOptions = {}): Promise<DeviceSession> {
  const display = await execSfCommand<Record<string, unknown>>("org", ["display"], { targetOrg });
  if (!display.success || !display.data) {
    throw new Error(`Could not read credentials for "${targetOrg}": ${display.error ?? "unknown error"}. ${AUTH_HELP}`);
  }
  const instanceUrl = display.data.instanceUrl as string | undefined;
  const username = (display.data.username as string | undefined) ?? targetOrg;
  if (!instanceUrl) throw new Error(`"${targetOrg}" has no instance URL. ${AUTH_HELP}`);

  let token = display.data.accessToken as string | undefined;
  if (!token || token.startsWith("[REDACTED]")) {
    const shown = await execSfCommand<Record<string, unknown>>("org", ["auth", "show-access-token", "-p"], {
      targetOrg,
    });
    token = shown.success ? (shown.data?.accessToken as string | undefined) : undefined;
  }
  if (!token) throw new Error(`No access token available for "${targetOrg}". ${AUTH_HELP}`);

  const apiVersion = normalizeApiVersion(opts.apiVersion ?? (display.data.apiVersion as string | undefined));
  return {
    username,
    orgId: (display.data.id as string | undefined) ?? (display.data.orgId as string | undefined),
    instanceUrl,
    apiVersion,
    http: createHttp(instanceUrl, token, opts.fetchImpl),
  };
}
