export interface Message {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  source?: { type: string; media_type: string; data: string };
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface StreamChunk {
  type: "text_delta" | "tool_use_start" | "tool_use_delta" | "tool_use_end" | "message_stop" | "error";
  text?: string;
  id?: string;
  name?: string;
  input_json?: string;
  error?: string;
}

export interface LLMProviderConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask the endpoint to cache the system prompt, tools and conversation so far (Anthropic only; others ignore it). */
  cache?: boolean;
  /** Aborts the request and its stream. */
  signal?: AbortSignal;
}

export interface LLMProvider {
  id: string;
  name: string;
  chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
    config?: LLMProviderConfig,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<Message>;
  validateCredentials(): Promise<boolean>;
  /** Model ids the provider serves, when it can list them. */
  listModels?(): Promise<string[] | null>;
  /** Send a tiny message to `model`; throws a readable error when that fails. */
  probe?(model: string): Promise<void>;
}

