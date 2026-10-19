/**
 * Answers the requests an inline LWC makes in Studio's live preview: UI API
 * reads and GraphQL queries, as the connected Salesforce user or the previewed
 * rep's mobile login. Writes and any
 * other endpoint are refused, so a previewed component can't change the org.
 */

import { createDeviceSession, createTokenSession, DEFAULT_API_VERSION, type DeviceHttp, type DeviceSession, type TokenLogin } from "../../perf/device/session.js";


/** Largest answer relayed to the preview frame (over postMessage); a bigger one is refused with a message saying so. */
export const MAX_LWC_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface LwcRequest {
  method: "GET" | "POST";
  /** Relative to the data API: `/ui-api/records/001…?fields=Account.Name`, `/graphql`. */
  path: string;
  body?: unknown;
}

/** An answer shaped like the platform's fetch errors (status, body.message), or the data. */
export type LwcResponse = { ok: true; data: unknown } | { ok: false; status: number; statusText: string; body: { message: string; errorCode?: string } };

/** Why a request isn't allowed, or null when it is. */
export function refuseLwcRequest(req: LwcRequest): string | null {
  if (req.method === "GET") {
    if (!/^\/ui-api\/[\w\-./,%=&?:]+$/.test(req.path) || req.path.includes("..") || req.path.includes("//")) return `Studio's preview doesn't answer ${req.path}.`;
    return null;
  }
  if (req.method === "POST" && req.path === "/graphql") {
    const body = req.body as { query?: unknown } | undefined;
    if (!body || typeof body.query !== "string") return "GraphQL request without a query.";
    // Strings and comments can't hide a mutation from this check: refuse the word anywhere.
    if (/\bmutation\b/i.test(body.query)) return "Studio's preview is read-only, so GraphQL mutations aren't sent.";
    return null;
  }
  return `Studio's preview doesn't send ${req.method} ${req.path}.`;
}

const sessions = new Map<string, Promise<DeviceSession>>();

/** The org's sf CLI session; the token stays inside it (src/perf/device/session.ts). */
function orgSession(org: string, fresh = false): Promise<DeviceSession> {
  let h = fresh ? undefined : sessions.get(org);
  if (!h) {
    h = createDeviceSession(org);
    sessions.set(org, h);
    h.catch(() => sessions.delete(org));
  }
  return h;
}

/** Forget the cached sessions, so the next request uses a newly pinned API version. */
export function resetLwcSessions(): void {
  sessions.clear();
}

function errorBody(data: unknown, fallback: string): { message: string; errorCode?: string } {
  const first = (Array.isArray(data) ? data[0] : data) as { message?: unknown; errorCode?: unknown } | undefined;
  return {
    message: typeof first?.message === "string" ? first.message : fallback,
    ...(typeof first?.errorCode === "string" ? { errorCode: first.errorCode } : {}),
  };
}

/**
 * As the sf CLI connection `as` names, or as a mobile login (its token is used for this request only and
 * the main process refreshes it). `http` replaces the session (tests).
 */
export async function lwcRequest(as: string | TokenLogin, req: LwcRequest, http?: DeviceHttp): Promise<LwcResponse> {
  const refused = refuseLwcRequest(req);
  if (refused) return { ok: false, status: 403, statusText: "Forbidden", body: { message: refused } };
  const tokenSession = typeof as === "string" || http ? undefined : createTokenSession(as);
  const send = async (fresh: boolean) => {
    const session = http ? undefined : (tokenSession ?? (await orgSession(as as string, fresh)));
    const version = session?.apiVersion ?? DEFAULT_API_VERSION;
    return (http ?? session!.http)({
      method: req.method,
      url: `/services/data/${version}${req.path}`,
      headers: { Accept: "application/json", ...(req.method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
    });
  };
  let res = await send(false);
  if (res.status === 401 && !http && !tokenSession) res = await send(true);
  if (res.body.length > MAX_LWC_RESPONSE_BYTES) {
    const mb = (res.body.length / 1048576).toFixed(1);
    return {
      ok: false,
      status: 413,
      statusText: "Payload Too Large",
      body: { message: `The answer is ${mb} MB; Studio's preview relays at most ${MAX_LWC_RESPONSE_BYTES / 1048576} MB. Ask for fewer records or fields (for example a smaller \`first\` in the GraphQL query).`, errorCode: "STUDIO_RESPONSE_TOO_LARGE" },
    };
  }
  const text = res.body.toString("utf8");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const statusText = res.status === 401 ? "Unauthorized" : res.status === 403 ? "Forbidden" : res.status === 404 ? "Not Found" : `HTTP ${res.status}`;
  if (res.status < 200 || res.status >= 300) return { ok: false, status: res.status, statusText, body: errorBody(data, statusText) };
  return { ok: true, data };
}
