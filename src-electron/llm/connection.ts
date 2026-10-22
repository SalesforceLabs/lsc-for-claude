/**
 * A saved way of reaching a model. Secrets (API keys, tokens) are never part of it —
 * they live in the OS keychain (see ../secrets.ts), keyed by `kind`.
 */
export type ConnectionKind =
  // Salesforce employees: the gateway Claude Code is set up for, read from ~/.claude/settings.json
  | "claude-code"
  // A personal Anthropic account
  | "anthropic"
  // A corporate gateway that speaks Anthropic's Messages API
  | "anthropic-gateway"
  // OpenAI (ChatGPT models)
  | "openai"
  // Anything that speaks OpenAI's Chat Completions API: Azure OpenAI, LiteLLM, Ollama, vLLM, corporate gateways
  | "openai-compatible";

export type ApiStyle = "anthropic" | "openai";

/** Which header carries the token: Anthropic's, the standard bearer header, or Azure OpenAI's. */
export type AuthHeader = "x-api-key" | "bearer" | "api-key";

export interface Connection {
  kind: ConnectionKind;
  /** Gateway kinds only; the official APIs use their own URLs. */
  baseUrl?: string;
  /** Gateway kinds only. */
  authHeader?: AuthHeader;
  /** Gateway kinds only: a shell command that prints the token, run instead of using a saved one. */
  tokenCommand?: string;
  /** Gateway kinds only: extra headers sent with every request. */
  headers?: Record<string, string>;
  /** The model to use when the picker has no choice of its own; required for OpenAI-style connections. */
  model?: string;
}

export const CONNECTION_KINDS: ConnectionKind[] = [
  "claude-code",
  "anthropic",
  "anthropic-gateway",
  "openai",
  "openai-compatible",
];

export const ANTHROPIC_API_URL = "https://api.anthropic.com";
export const OPENAI_API_URL = "https://api.openai.com/v1";

export function apiStyle(kind: ConnectionKind): ApiStyle {
  return kind === "openai" || kind === "openai-compatible" ? "openai" : "anthropic";
}

export function isGateway(kind: ConnectionKind): boolean {
  return kind === "anthropic-gateway" || kind === "openai-compatible";
}

export function connectionLabel(kind: ConnectionKind | string | undefined): string {
  switch (kind) {
    case "claude-code":
      return "Salesforce AI Model Gateway (Claude Code settings)";
    case "anthropic":
      return "Anthropic API key";
    case "anthropic-gateway":
      return "Claude through a company gateway";
    case "openai":
      return "OpenAI API key";
    case "openai-compatible":
      return "OpenAI-compatible endpoint";
    default:
      return "Not connected";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Why `url` can't be used as a base URL, or null when it can. Tokens only go over
 * HTTPS — plain HTTP is allowed for this machine only (e.g. Ollama on localhost).
 */
export function baseUrlProblem(url: string | undefined): string | null {
  if (!url?.trim()) return "Enter the base URL.";
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return `"${url}" isn't a URL.`;
  }
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname)) return null;
  return "Use an https:// URL (http:// is only allowed for localhost).";
}

/** Settings written before connections existed, mapped to a connection and its secret. */
export interface LegacyLlmSettings {
  providerType?: string;
  apiKey?: string;
  baseUrl?: string;
  authToken?: string;
  gatewayUrl?: string;
  gatewayToken?: string;
}

export function migrateLegacyConnection(
  legacy: LegacyLlmSettings
): { connection: Connection; secret?: string } | null {
  switch (legacy.providerType) {
    case "claude-code":
      return { connection: { kind: "claude-code" } };
    case "api-key":
      return legacy.apiKey ? { connection: { kind: "anthropic" }, secret: legacy.apiKey } : null;
    case "bedrock-gateway":
      return legacy.baseUrl
        ? {
            connection: { kind: "anthropic-gateway", baseUrl: legacy.baseUrl, authHeader: "x-api-key" },
            secret: legacy.authToken,
          }
        : null;
    case "sf-gateway":
      return legacy.gatewayUrl
        ? {
            connection: { kind: "anthropic-gateway", baseUrl: legacy.gatewayUrl, authHeader: "bearer" },
            secret: legacy.gatewayToken,
          }
        : null;
    default:
      return null;
  }
}
