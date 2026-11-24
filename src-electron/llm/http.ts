import type { ApiStyle, AuthHeader } from "./connection.js";
import { describeHttpError, describeNetworkError } from "./errors.js";
import { TokenSource, authHeaders, sendWithRefresh } from "./token-source.js";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** How a provider reaches its API. */
export interface HttpOptions {
  baseUrl: string;
  tokens: TokenSource;
  authHeader: AuthHeader;
  /** Extra headers (e.g. a gateway's client id); auth and content headers win over them. */
  headers?: Record<string, string>;
  /** Shown in errors: "Anthropic", "OpenAI", "The gateway". */
  service: string;
  /** Electron's net.fetch in the app (system certificates and proxy); global fetch in tests. */
  fetch?: FetchFn;
}

/**
 * How long a model request may wait for the response to start (status and headers). Streaming
 * replies start within seconds; a request with no answer after this has stalled at the gateway.
 */
export const FIRST_RESPONSE_TIMEOUT_MS = 180_000;

/**
 * Call `path` under the base URL with auth, refreshing a command-issued token once on a 401.
 * Throws a plain-language error for network failures and non-2xx responses.
 */
export async function apiFetch(
  options: HttpOptions,
  style: ApiStyle,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    /** Give up when the response hasn't started after this long (streaming chat calls). */
    firstResponseMs?: number;
  } = {},
  model?: string
): Promise<Response> {
  const url = `${options.baseUrl}${path}`;
  const doFetch = options.fetch ?? fetch;
  // One signal for the caller's abort and our own wait limit; the timer is cleared once headers
  // arrive, so it never cuts a reply that is streaming.
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let signal = init.signal;
  if (init.firstResponseMs) {
    const controller = new AbortController();
    const forward = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) forward();
    else init.signal?.addEventListener("abort", forward, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("first response timeout"));
    }, init.firstResponseMs);
    signal = controller.signal;
  }
  let res: Response;
  try {
    res = await sendWithRefresh(options.tokens, async () =>
      doFetch(url, {
        method: init.method ?? "GET",
        headers: {
          ...options.headers,
          ...init.headers,
          ...authHeaders(options.authHeader, await options.tokens.get()),
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        ...(signal ? { signal } : {}),
      })
    );
  } catch (error) {
    if (timedOut && !init.signal?.aborted) {
      throw new Error(
        `${options.service} didn't start answering within ${Math.round(init.firstResponseMs! / 1000)} s. Try sending the message again.`
      );
    }
    // The token command's own failure is already readable.
    if (error instanceof Error && error.message.startsWith("The token command")) throw error;
    if (init.signal?.aborted) throw error;
    throw describeNetworkError(error, url);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw describeHttpError(res.status, await res.text().catch(() => ""), {
      service: options.service,
      url,
      style,
      model,
    });
  }
  return res;
}

/**
 * How long a stream may send nothing before it counts as stalled. Providers send keep-alive
 * events while a long reply is being generated, so a silent minute means the connection is gone.
 */
export const STREAM_IDLE_TIMEOUT_MS = 120_000;

/** Lines of a server-sent-events body, as `data:` payloads. Throws when the stream goes silent. */
export async function* sseData(
  res: Response,
  idleMs = STREAM_IDLE_TIMEOUT_MS
): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const read = () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Reject before cancelling: cancelling ends the pending read as "done", which would win the race.
        reject(
          new Error(
            `The model's reply stopped arriving (nothing for ${Math.round(idleMs / 1000)} s). Try sending the message again.`
          )
        );
        setTimeout(() => reader.cancel().catch(() => {}), 0);
      }, idleMs);
    });
    return Promise.race([reader.read(), stalled]).finally(() => clearTimeout(timer));
  };
  while (true) {
    const { done, value } = await read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  if (buffer.startsWith("data:")) yield buffer.slice(5).trim();
}
