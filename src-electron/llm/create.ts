import { AnthropicProvider } from "./anthropic.js";
import { detectClaudeCodeGateway } from "./claude-code-config.js";
import {
  ANTHROPIC_API_URL,
  apiStyle,
  ApiStyle,
  baseUrlProblem,
  Connection,
  connectionLabel,
  isGateway,
  OPENAI_API_URL,
} from "./connection.js";
import type { FetchFn, HttpOptions } from "./http.js";
import { OpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./provider.js";
import { TokenSource } from "./token-source.js";

/** What the app tries first when a connection names no model and the endpoint lists none. */
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";

/**
 * A provider for `connection`. `secret` is the saved (or just-entered) key or token;
 * the official APIs fall back to ANTHROPIC_API_KEY / OPENAI_API_KEY from the environment.
 */
export function createProvider(
  connection: Connection,
  secret: string | undefined,
  fetchFn?: FetchFn,
  env: NodeJS.ProcessEnv = process.env
): LLMProvider {
  const service = connectionLabel(connection.kind);
  switch (connection.kind) {
    case "claude-code": {
      // Read in the main process so the token command and tokens never pass through the renderer.
      const gateway = detectClaudeCodeGateway(env);
      if (!gateway) {
        throw new Error(
          "No gateway found in Claude Code settings (ANTHROPIC_BASE_URL plus apiKeyHelper or ANTHROPIC_AUTH_TOKEN in ~/.claude/settings.json)."
        );
      }
      return new AnthropicProvider({
        baseUrl: gateway.baseUrl,
        tokens: gateway.apiKeyHelper ? TokenSource.command(gateway.apiKeyHelper) : TokenSource.fixed(gateway.authToken),
        authHeader: gateway.authHeader,
        headers: gateway.headers,
        service: "The Salesforce AI Model Gateway",
        fetch: fetchFn,
      });
    }
    case "anthropic": {
      const key = secret || env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("Enter an Anthropic API key.");
      return new AnthropicProvider({
        baseUrl: ANTHROPIC_API_URL,
        tokens: TokenSource.fixed(key),
        authHeader: "x-api-key",
        service: "Anthropic",
        fetch: fetchFn,
      });
    }
    case "openai": {
      const key = secret || env.OPENAI_API_KEY;
      if (!key) throw new Error("Enter an OpenAI API key.");
      return new OpenAIProvider(
        { baseUrl: OPENAI_API_URL, tokens: TokenSource.fixed(key), authHeader: "bearer", service: "OpenAI", fetch: fetchFn },
        connection.model
      );
    }
    case "anthropic-gateway":
    case "openai-compatible": {
      const problem = baseUrlProblem(connection.baseUrl);
      if (problem) throw new Error(problem);
      const options: HttpOptions = {
        baseUrl: connection.baseUrl!.trim(),
        tokens: connection.tokenCommand?.trim()
          ? TokenSource.command(connection.tokenCommand.trim())
          : TokenSource.fixed(secret),
        authHeader: connection.authHeader ?? (connection.kind === "anthropic-gateway" ? "x-api-key" : "bearer"),
        headers: connection.headers,
        service: "The gateway",
        fetch: fetchFn,
      };
      return connection.kind === "anthropic-gateway"
        ? new AnthropicProvider(options)
        : new OpenAIProvider(options, connection.model);
    }
    default:
      throw new Error(`Unknown connection: ${service}`);
  }
}

const NOT_CHAT = /embed|whisper|tts|dall-e|davinci|babbage|moderation|audio|realtime|transcribe|image|search|computer-use/i;

/**
 * The listed models worth offering in the chat picker: Claude models on an Anthropic-style
 * endpoint (gateways often list other vendors' models too), chat models on an OpenAI-style one.
 */
export function chatModels(style: ApiStyle, ids: string[] | null): string[] | null {
  if (!ids) return null;
  return style === "anthropic" ? ids.filter((id) => id.startsWith("claude-")) : ids.filter((id) => !NOT_CHAT.test(id));
}

export interface ConnectionTest {
  ok: boolean;
  /** Models to offer, when the endpoint lists them. */
  models?: string[];
  /** The model the test message went to. */
  model?: string;
  /** No model chosen yet, and the endpoint doesn't decide for us. */
  needsModel?: boolean;
  error?: string;
}

/** The model to test with when the connection doesn't name one. */
function testModel(connection: Connection, models: string[] | null): string | undefined {
  if (connection.model) return connection.model;
  if (apiStyle(connection.kind) === "openai") return undefined;
  if (!models?.length || models.includes(DEFAULT_CLAUDE_MODEL)) return DEFAULT_CLAUDE_MODEL;
  return models[0];
}

/** List models, then send one tiny message — the same calls a chat makes, so a pass means chat will work. */
export async function testConnection(provider: LLMProvider, connection: Connection): Promise<ConnectionTest> {
  const models = chatModels(apiStyle(connection.kind), (await provider.listModels?.()) ?? null) ?? undefined;
  const model = testModel(connection, models ?? null);
  if (!model) return { ok: false, models, needsModel: true, error: "Choose a model, then test again." };
  try {
    await provider.probe?.(model);
    return { ok: true, models, model };
  } catch (error) {
    return { ok: false, models, model, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Gateway connections keep only the fields that apply to them. */
export function cleanConnection(connection: Connection): Connection {
  const clean: Connection = { kind: connection.kind };
  if (connection.model?.trim()) clean.model = connection.model.trim();
  if (isGateway(connection.kind)) {
    if (connection.baseUrl?.trim()) clean.baseUrl = connection.baseUrl.trim();
    if (connection.authHeader) clean.authHeader = connection.authHeader;
    if (connection.tokenCommand?.trim()) clean.tokenCommand = connection.tokenCommand.trim();
    if (connection.headers && Object.keys(connection.headers).length) clean.headers = connection.headers;
  }
  return clean;
}
