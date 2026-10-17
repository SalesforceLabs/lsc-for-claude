/**
 * Authenticated HTTP session for the first-sync simulator. Credentials come
 * from an org already authenticated in the sf CLI (the persona user, not an
 * admin, when the goal is device-accurate numbers). The access token lives only
 * inside the closure returned by `createHttp`; it is never logged or returned.
 */

import { execSfCommand } from "../../salesforce/cli.js";

export interface DeviceRequest {
  method: "GET" | "POST";
  /** Absolute URL, or a path starting with "/" resolved against the instance URL. */
  url: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface DeviceResponse {
  status: number;
  headers: Record<string, string>;
  /** Decoded body. */
  body: Buffer;
}

/** The only network seam the simulator uses; unit tests replace it with a mock. */
export type DeviceHttp = (req: DeviceRequest) => Promise<DeviceResponse>;

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

export function createHttp(
  instanceUrl: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): DeviceHttp {
  const base = instanceUrl.replace(/\/+$/, "");
  return async (req) => {
    const url = req.url.startsWith("/") ? base + req.url : req.url;
    const res = await fetchImpl(url, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...req.headers,
      },
      body: req.body,
      signal: req.signal,
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) };
  };
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
