import fs from "fs";
import os from "os";
import path from "path";
import type { AuthHeader } from "./connection.js";

/** How to reach an Anthropic-compatible gateway, as Claude Code is configured to. */
export interface GatewayConfig {
  baseUrl: string;
  /** A static token (ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY). */
  authToken?: string;
  /** A shell command that prints the token (Claude Code's `apiKeyHelper`). */
  apiKeyHelper?: string;
  /** As Claude Code sends it: ANTHROPIC_AUTH_TOKEN as a bearer token, the others as x-api-key. */
  authHeader: AuthHeader;
  /** Extra headers from ANTHROPIC_CUSTOM_HEADERS. */
  headers: Record<string, string>;
}

export function claudeCodeSettingsPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(dir, "settings.json");
}

/** `Name: value` lines, as Claude Code reads ANTHROPIC_CUSTOM_HEADERS. */
export function parseCustomHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name) headers[name] = value;
  }
  return headers;
}

/**
 * The gateway Claude Code uses, from ~/.claude/settings.json (`env` and `apiKeyHelper`)
 * with the process environment taking precedence. An app opened from the Dock doesn't
 * inherit the shell's environment, so the settings file is usually what's found.
 * Null when no gateway URL or no way to get a token is configured.
 */
export function detectClaudeCodeGateway(
  env: NodeJS.ProcessEnv = process.env,
  settingsPath: string = claudeCodeSettingsPath()
): GatewayConfig | null {
  let settings: { env?: Record<string, unknown>; apiKeyHelper?: unknown } = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    // No Claude Code settings — the environment alone may still be enough.
  }
  const fileEnv = settings.env ?? {};
  const get = (name: string): string | undefined => {
    const value = env[name] ?? fileEnv[name];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };

  const url = get("ANTHROPIC_BASE_URL") ?? get("ANTHROPIC_BEDROCK_BASE_URL");
  if (!url) return null;
  const bearer = get("ANTHROPIC_AUTH_TOKEN");
  const authToken = bearer ?? get("ANTHROPIC_API_KEY");
  const apiKeyHelper =
    typeof settings.apiKeyHelper === "string" && settings.apiKeyHelper.trim()
      ? settings.apiKeyHelper.trim()
      : undefined;
  if (!authToken && !apiKeyHelper) return null;

  return {
    baseUrl: url,
    authToken,
    apiKeyHelper: authToken ? undefined : apiKeyHelper,
    authHeader: bearer ? "bearer" : "x-api-key",
    headers: parseCustomHeaders(get("ANTHROPIC_CUSTOM_HEADERS")),
  };
}
