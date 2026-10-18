import { execFile } from "child_process";
import type { AuthHeader } from "./connection.js";

const COMMAND_TIMEOUT_MS = 30_000;
// Claude Code re-runs apiKeyHelper after 5 minutes or a 401; do the same.
const COMMAND_TTL_MS = Number(process.env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS) || 5 * 60_000;

/** Run a token command the way Claude Code runs `apiKeyHelper`: in a shell, stdout trimmed. */
export function runTokenCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("/bin/sh", ["-c", command], { timeout: COMMAND_TIMEOUT_MS }, (error, stdout) => {
      const token = String(stdout ?? "").trim();
      if (error || !token) {
        reject(new Error(`The token command ${error ? `failed: ${error.message}` : "printed nothing"}`));
      } else {
        resolve(token);
      }
    });
  });
}

/** Where a provider gets its token: a fixed one (possibly none, e.g. a local server), or a command. */
export class TokenSource {
  private cached: { value: string; at: number } | null = null;

  private constructor(private readonly token?: string, private readonly command?: string) {}

  static fixed(token?: string): TokenSource {
    return new TokenSource(token || undefined);
  }

  static command(command: string): TokenSource {
    return new TokenSource(undefined, command);
  }

  async get(): Promise<string | undefined> {
    if (!this.command) return this.token;
    if (!this.cached || Date.now() - this.cached.at > COMMAND_TTL_MS) {
      this.cached = { value: await runTokenCommand(this.command), at: Date.now() };
    }
    return this.cached.value;
  }

  /** Forget a command's token so the next `get` runs it again; false when there's nothing to refresh. */
  invalidate(): boolean {
    if (!this.command) return false;
    this.cached = null;
    return true;
  }
}

export function authHeaders(header: AuthHeader, token: string | undefined): Record<string, string> {
  if (!token) return {};
  switch (header) {
    case "bearer":
      return { authorization: `Bearer ${token}` };
    case "api-key":
      return { "api-key": token };
    default:
      return { "x-api-key": token };
  }
}

/**
 * Send once; on a 401 with a command-issued token, run the command again and retry once.
 * `request` must build its headers from a fresh `tokens.get()` each call.
 */
export async function sendWithRefresh(tokens: TokenSource, request: () => Promise<Response>): Promise<Response> {
  const res = await request();
  if (res.status !== 401 || !tokens.invalidate()) return res;
  return request();
}
