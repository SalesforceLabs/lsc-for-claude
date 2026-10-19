import {
  LLMProvider,
  Message,
  ToolDefinition,
  LLMProviderConfig,
  StreamChunk,
  ContentBlock,
} from "./provider.js";
import { isAuthError } from "./errors.js";
import { apiFetch, HttpOptions, sseData } from "./http.js";

const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Anthropic Messages API — api.anthropic.com with a personal key, or any gateway
 * that serves the same API at /v1/messages (the Salesforce AI Model Gateway, a
 * company's own gateway).
 */
export class AnthropicProvider implements LLMProvider {
  id = "anthropic";
  name: string;
  private options: HttpOptions;

  constructor(options: HttpOptions) {
    this.options = { ...options, baseUrl: normalizeAnthropicUrl(options.baseUrl) };
    this.name = options.service;
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.probe(DEFAULT_MODEL);
      return true;
    } catch {
      return false;
    }
  }

  /** Send a tiny message to `model`; throws a readable error when that fails. */
  async probe(model: string): Promise<void> {
    await this.post({ model, max_tokens: 16, messages: [{ role: "user", content: "hi" }] }, model);
  }

  /** Model ids the endpoint serves, or null if it doesn't list them; throws when the credentials are rejected. */
  async listModels(): Promise<string[] | null> {
    try {
      const res = await apiFetch(this.options, "anthropic", "/v1/models", { headers: VERSION_HEADER });
      const data = (await res.json()) as { data?: Array<{ id?: unknown }> };
      return (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
    } catch (error) {
      // Rejected credentials fail the connection; anything else just means no list.
      if (isAuthError(error)) throw error;
      return null;
    }
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
    config?: LLMProviderConfig,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<Message> {
    const model = config?.model ?? DEFAULT_MODEL;
    const maxTokens = config?.maxTokens ?? DEFAULT_MAX_TOKENS;

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role === "system" ? "user" : m.role,
        content: m.content,
      })),
      stream: true,
    };

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }

    if (config?.temperature !== undefined) {
      body.temperature = config.temperature;
    }

    if (config?.cache) addCacheBreakpoints(body);

    return processAnthropicStream(await this.post(body, model), onChunk);
  }

  private post(body: Record<string, unknown>, model: string): Promise<Response> {
    return apiFetch(this.options, "anthropic", "/v1/messages", { method: "POST", body, headers: VERSION_HEADER }, model);
  }
}

const EPHEMERAL = { type: "ephemeral" };

/**
 * Mark the end of the system prompt, of the tools and of the conversation so far as cache
 * breakpoints (at most 4 are allowed), so a later round of the same turn reads them from cache.
 */
export function addCacheBreakpoints(body: Record<string, unknown>): void {
  if (typeof body.system === "string" && body.system) {
    body.system = [{ type: "text", text: body.system, cache_control: EPHEMERAL }];
  }
  const tools = body.tools as Array<Record<string, unknown>> | undefined;
  if (tools?.length) tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: EPHEMERAL };
  const messages = body.messages as Array<{ role: string; content: unknown }>;
  const last = messages[messages.length - 1];
  if (!last) return;
  const blocks = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...(last.content as Array<Record<string, unknown>>)];
  if (!blocks.length) return;
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: EPHEMERAL };
  messages[messages.length - 1] = { ...last, content: blocks };
}

const VERSION_HEADER = { "anthropic-version": "2023-06-01" };

/** Strip trailing slashes, `/bedrock`, and `/v1` — requests add `/v1/messages` themselves. */
export function normalizeAnthropicUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/bedrock$/, "").replace(/\/v1$/, "");
}

async function processAnthropicStream(
  res: Response,
  onChunk?: (chunk: StreamChunk) => void
): Promise<Message> {
  const contentBlocks: ContentBlock[] = [];
  let currentToolId = "";
  let currentToolName = "";
  let currentToolInput = "";
  let currentText = "";

  for await (const data of sseData(res)) {
    if (data === "[DONE]") continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }

    const eventType = event.type as string;

    if (process.env.LSC_LLM_DEBUG && (eventType === "message_start" || eventType === "message_delta")) {
      const usage = ((event.message as Record<string, unknown> | undefined)?.usage ?? event.usage) as Record<string, number> | undefined;
      console.log(`[anthropic] ${eventType} usage`, JSON.stringify(usage));
    }

    if (eventType === "content_block_start") {
      const block = event.content_block as Record<string, unknown>;
      if (block.type === "tool_use") {
        currentToolId = block.id as string;
        currentToolName = block.name as string;
        currentToolInput = "";
        onChunk?.({
          type: "tool_use_start",
          id: currentToolId,
          name: currentToolName,
        });
      } else if (block.type === "text") {
        currentText = (block.text as string) || "";
      }
    } else if (eventType === "content_block_delta") {
      const delta = event.delta as Record<string, unknown>;
      if (delta.type === "text_delta") {
        const text = delta.text as string;
        currentText += text;
        onChunk?.({ type: "text_delta", text });
      } else if (delta.type === "input_json_delta") {
        const json = delta.partial_json as string;
        currentToolInput += json;
        onChunk?.({ type: "tool_use_delta", input_json: json });
      }
    } else if (eventType === "content_block_stop") {
      if (currentToolId) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(currentToolInput);
        } catch {
          // empty input
        }
        contentBlocks.push({
          type: "tool_use",
          id: currentToolId,
          name: currentToolName,
          input,
        });
        onChunk?.({ type: "tool_use_end", id: currentToolId });
        currentToolId = "";
        currentToolName = "";
        currentToolInput = "";
      } else if (currentText) {
        contentBlocks.push({ type: "text", text: currentText });
        currentText = "";
      }
    } else if (eventType === "message_stop") {
      onChunk?.({ type: "message_stop" });
    } else if (eventType === "error") {
      const errMsg =
        (event.error as Record<string, string>)?.message || "Unknown error";
      onChunk?.({ type: "error", error: errMsg });
      throw new Error(errMsg);
    }
  }

  if (currentText && !contentBlocks.some((b) => b.type === "text")) {
    contentBlocks.push({ type: "text", text: currentText });
  }

  return { role: "assistant", content: contentBlocks };
}
