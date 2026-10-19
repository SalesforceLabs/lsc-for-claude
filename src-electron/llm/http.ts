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
 * Call `path` under the base URL with auth, refreshing a command-issued token once on a 401.
 * Throws a plain-language error for network failures and non-2xx responses.
 */
export async function apiFetch(
  options: HttpOptions,
  style: ApiStyle,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {},
  model?: string
): Promise<Response> {
  const url = `${options.baseUrl}${path}`;
  const doFetch = options.fetch ?? fetch;
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
        ...(init.signal ? { signal: init.signal } : {}),
      })
    );
  } catch (error) {
    // The token command's own failure is already readable.
    if (error instanceof Error && error.message.startsWith("The token command")) throw error;
    if (init.signal?.aborted) throw error;
    throw describeNetworkError(error, url);
  }
  if (!res.ok) {
    throw describeHttpError(res.status, await res.text().catch(() => ""), { service: options.service, url, style, model });
  }
  return res;
}

/** Lines of a server-sent-events body, as `data:` payloads. */
export async function* sseData(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
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
