/** Renderer copy of src-electron/llm/connection.ts — no secrets ever reach the renderer. */
export type LlmConnectionKind = "claude-code" | "anthropic" | "anthropic-gateway" | "openai" | "openai-compatible";
export type LlmAuthHeader = "x-api-key" | "bearer" | "api-key";
export type LlmApiStyle = "anthropic" | "openai";

export interface LlmConnection {
  kind: LlmConnectionKind;
  baseUrl?: string;
  authHeader?: LlmAuthHeader;
  tokenCommand?: string;
  headers?: Record<string, string>;
  model?: string;
}

export interface LlmConnectionTest {
  ok: boolean;
  models?: string[];
  model?: string;
  needsModel?: boolean;
  error?: string;
}

export interface ConnectionChoice {
  kind: LlmConnectionKind;
  label: string;
  description: string;
  style: LlmApiStyle;
}

export const CONNECTION_CHOICES: ConnectionChoice[] = [
  {
    kind: "claude-code",
    label: "Salesforce AI Model Gateway",
    description: "For Salesforce employees. Uses the gateway Claude Code is set up for.",
    style: "anthropic",
  },
  { kind: "anthropic", label: "Anthropic API key", description: "Your own Anthropic account.", style: "anthropic" },
  {
    kind: "anthropic-gateway",
    label: "Claude through a company gateway",
    description: "A gateway that serves Anthropic's Messages API (/v1/messages).",
    style: "anthropic",
  },
  { kind: "openai", label: "OpenAI API key", description: "ChatGPT models on your own OpenAI account.", style: "openai" },
  {
    kind: "openai-compatible",
    label: "OpenAI-compatible endpoint",
    description: "Azure OpenAI, LiteLLM, Ollama, vLLM, or a company gateway that serves /chat/completions.",
    style: "openai",
  },
];

export function connectionChoice(kind: string | undefined): ConnectionChoice | undefined {
  return CONNECTION_CHOICES.find((c) => c.kind === kind);
}

/** "Claude" when the app talks to Claude, else a neutral name — used in "Ask … how to fix". */
export function assistantName(style: LlmApiStyle | undefined): string {
  return style === "openai" ? "AI" : "Claude";
}

/** `Name: value` lines to headers, and back. */
export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    if (name) headers[name] = line.slice(colon + 1).trim();
  }
  return headers;
}

export function headerLines(headers: Record<string, string> | undefined): string {
  return Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
}
