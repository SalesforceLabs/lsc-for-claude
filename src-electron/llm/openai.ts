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

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OpenAIContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/**
 * The engine's Anthropic-shaped history as Chat Completions messages: tool_use blocks
 * become the assistant's `tool_calls`, and each tool_result its own `tool` message.
 */
export function toOpenAIMessages(systemPrompt: string, messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });

  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push(
        message.role === "assistant"
          ? { role: "assistant", content: message.content }
          : { role: "user", content: message.content }
      );
      continue;
    }
    const blocks = message.content;

    if (message.role === "assistant") {
      const text = blocks
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n");
      const calls: OpenAIToolCall[] = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          id: b.id!,
          type: "function",
          function: { name: b.name!, arguments: JSON.stringify(b.input ?? {}) },
        }));
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }

    // Tool results must directly follow the assistant's tool calls, before anything else the user sends.
    for (const b of blocks) {
      if (b.type === "tool_result") {
        out.push({ role: "tool", tool_call_id: b.tool_use_id!, content: b.content ?? "" });
      }
    }
    const parts: OpenAIContentPart[] = [];
    for (const b of blocks) {
      if (b.type === "text" && b.text) parts.push({ type: "text", text: b.text });
      if (b.type === "image" && b.source) {
        parts.push({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
      }
    }
    if (parts.length) out.push({ role: "user", content: parts });
  }
  return out;
}

export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((t) => {
    // JSON Schema's `$schema` keyword isn't part of a function's parameters.
    const { $schema: _schema, ...parameters } = t.input_schema;
    return { type: "function" as const, function: { name: t.name, description: t.description, parameters } };
  });
}

interface StreamEvent {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  error?: { message?: string } | string;
}

/** Builds the assistant message from Chat Completions stream events, reporting chunks as they arrive. */
export class OpenAIStreamAssembler {
  private text = "";
  private calls = new Map<number, { id: string; name: string; args: string; started: boolean }>();

  constructor(private onChunk?: (chunk: StreamChunk) => void) {}

  push(event: StreamEvent): void {
    if (event.error) {
      const message = typeof event.error === "string" ? event.error : event.error.message || "Unknown error";
      this.onChunk?.({ type: "error", error: message });
      throw new Error(message);
    }
    const delta = event.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      this.text += delta.content;
      this.onChunk?.({ type: "text_delta", text: delta.content });
    }
    for (const part of delta.tool_calls ?? []) {
      const index = part.index ?? 0;
      let call = this.calls.get(index);
      if (!call) {
        call = { id: part.id || `call_${index}`, name: "", args: "", started: false };
        this.calls.set(index, call);
      } else if (part.id && !call.started) {
        call.id = part.id;
      }
      if (part.function?.name) call.name += part.function.name;
      if (call.name && !call.started) {
        call.started = true;
        this.onChunk?.({ type: "tool_use_start", id: call.id, name: call.name });
      }
      if (part.function?.arguments) {
        call.args += part.function.arguments;
        this.onChunk?.({ type: "tool_use_delta", input_json: part.function.arguments });
      }
    }
  }

  finish(): Message {
    const content: ContentBlock[] = [];
    if (this.text) content.push({ type: "text", text: this.text });
    for (const call of [...this.calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c)) {
      let input: Record<string, unknown> = {};
      try {
        input = call.args ? JSON.parse(call.args) : {};
      } catch {
        // malformed arguments — the tool reports what's missing
      }
      content.push({ type: "tool_use", id: call.id, name: call.name, input });
      this.onChunk?.({ type: "tool_use_end", id: call.id });
    }
    this.onChunk?.({ type: "message_stop" });
    return { role: "assistant", content };
  }
}

/**
 * OpenAI Chat Completions API — OpenAI itself, or anything that speaks it (Azure
 * OpenAI's v1 API, LiteLLM, Ollama, vLLM, company gateways). The app is tuned and
 * tested with Claude; other models work, with varying tool-use quality.
 */
export class OpenAIProvider implements LLMProvider {
  id = "openai";
  name: string;
  private options: HttpOptions;

  constructor(
    options: HttpOptions,
    private defaultModel?: string
  ) {
    this.options = { ...options, baseUrl: options.baseUrl.trim().replace(/\/+$/, "") };
    this.name = options.service;
  }

  async validateCredentials(): Promise<boolean> {
    if (!this.defaultModel) return false;
    try {
      await this.probe(this.defaultModel);
      return true;
    } catch {
      return false;
    }
  }

  async probe(model: string): Promise<void> {
    await apiFetch(
      this.options,
      "openai",
      "/chat/completions",
      { method: "POST", body: { model, messages: [{ role: "user", content: "Reply with the word OK." }] } },
      model
    );
  }

  async listModels(): Promise<string[] | null> {
    try {
      const res = await apiFetch(this.options, "openai", "/models");
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
    const model = config?.model ?? this.defaultModel;
    if (!model) throw new Error("Choose a model for this connection in Settings.");

    // No token limit: newer OpenAI models reject max_tokens, and older servers don't know max_completion_tokens.
    const body: Record<string, unknown> = {
      model,
      messages: toOpenAIMessages(systemPrompt, messages),
      stream: true,
    };
    if (tools.length > 0) body.tools = toOpenAITools(tools);
    if (config?.temperature !== undefined) body.temperature = config.temperature;

    const res = await apiFetch(this.options, "openai", "/chat/completions", { method: "POST", body }, model);
    const assembler = new OpenAIStreamAssembler(onChunk);
    for await (const data of sseData(res)) {
      if (!data || data === "[DONE]") continue;
      let event: StreamEvent;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      assembler.push(event);
    }
    return assembler.finish();
  }
}
