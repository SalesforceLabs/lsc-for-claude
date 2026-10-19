import { LLMProvider, Message, ContentBlock, StreamChunk } from "../llm/provider.js";
import { STUDIO_TOOL_PREFIX } from "../mcp/client.js";
import type { ToolHost } from "../mcp/pool.js";
import { PromptBuilder } from "./prompt-builder.js";
import type { StoredMessage } from "./history.js";
import { ORG_SWITCH_TOOLS, orgPromptSection, orgSwitchRefusal, type SessionOrg } from "./session-org.js";

export interface ConversationCallbacks {
  onTextDelta: (text: string) => void;
  onToolStart: (id: string, name: string) => void;
  /** Right before a tool runs, once its input is complete — tools run one at a time. */
  onToolRun?: (id: string, input: Record<string, unknown>) => void;
  onToolResult: (id: string, result: string, isError: boolean) => void;
  onToolEnd: (id: string) => void;
  onComplete: (message: Message) => void;
  onError: (error: string) => void;
}

interface AbortToken {
  aborted: boolean;
}

const MAX_TOOL_ROUNDS = 25;

export class ConversationEngine {
  private llm: LLMProvider;
  private mcp: ToolHost;
  private promptBuilder: PromptBuilder;
  /** The org this session works in — its tools run there and nowhere else. */
  private org: SessionOrg | null;
  private messages: Message[] = [];
  private systemPrompt: string = "";
  private currentAbort: AbortToken | null = null;
  private model?: string;

  constructor(llm: LLMProvider, mcp: ToolHost, promptBuilder: PromptBuilder, org: SessionOrg | null = null) {
    this.llm = llm;
    this.mcp = mcp;
    this.promptBuilder = promptBuilder;
    this.org = org;
  }

  initialize(): void {
    // Last, so the shared prompt above it stays identical across sessions.
    this.systemPrompt = `${this.promptBuilder.buildSystemPrompt()}\n\n${orgPromptSection(this.org)}\n`;
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  /** Abort the current run. Fire-and-forget — the run will stop at the next checkpoint. */
  abort(): void {
    if (this.currentAbort) {
      this.currentAbort.aborted = true;
    }
  }

  /**
   * Restore LLM message history from DB-stored messages.
   * Called when creating an engine for a session that already has history.
   *
   * Converts StoredMessages into the LLM Message format:
   * - User messages → { role: "user", content: text }
   * - Assistant text-only → { role: "assistant", content: text }
   * - Assistant with tools → assistant message with tool_use blocks
   *   + following user message with tool_result blocks
   */
  restoreMessages(stored: StoredMessage[]): void {
    this.messages = [];

    for (const msg of stored) {
      if (msg.role === "user") {
        this.messages.push({ role: "user", content: msg.text });
      } else {
        // Assistant message
        const toolCalls: Array<{ id: string; name: string; input?: Record<string, unknown>; result?: string; isError?: boolean }> =
          msg.toolCalls ? JSON.parse(msg.toolCalls) : [];

        if (toolCalls.length === 0) {
          // Text-only assistant message
          this.messages.push({ role: "assistant", content: msg.text });
        } else {
          // Assistant message with tool use
          const contentBlocks: ContentBlock[] = [];

          if (msg.text) {
            contentBlocks.push({ type: "text", text: msg.text });
          }

          for (const tc of toolCalls) {
            contentBlocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.input ?? {}, // Sessions saved before inputs were kept have none; the LLM doesn't need them
            });
          }

          this.messages.push({ role: "assistant", content: contentBlocks });

          // Add the tool results as a user message
          const toolResults: ContentBlock[] = toolCalls.map((tc) => ({
            type: "tool_result" as const,
            tool_use_id: tc.id,
            content: tc.result ?? "",
            is_error: tc.isError ?? false,
          }));

          this.messages.push({ role: "user", content: toolResults });
        }
      }
    }
  }

  /**
   * Send a message and run the tool loop.
   * Sequential within this engine — if a run is active, it's aborted first.
   */
  sendMessage(
    userInput: string | ContentBlock[],
    callbacks: ConversationCallbacks,
    model?: string
  ): Promise<void> {
    // Lock model on first call so follow-ups in the same session use the same model
    if (model && !this.model) {
      this.model = model;
    }
    // Abort any previous run
    if (this.currentAbort) {
      this.currentAbort.aborted = true;
    }

    const abort: AbortToken = { aborted: false };
    this.currentAbort = abort;

    // If input is an array of content blocks (e.g. text + images), use directly
    if (Array.isArray(userInput)) {
      this.messages.push({ role: "user", content: userInput });
    } else {
      const commandMatch = userInput.match(/^\/lsc:(\S+)\s*(.*)/);
      if (commandMatch) {
        const cmdName = commandMatch[1];
        const cmdArgs = commandMatch[2].trim();
        const cmdContent = this.promptBuilder.getCommandContent(cmdName);
        if (cmdContent) {
          const injected = `[Running command /lsc:${cmdName}]\n\n${cmdContent}\n\nUser input: ${cmdArgs || "(no arguments)"}`;
          this.messages.push({ role: "user", content: injected });
        } else {
          this.messages.push({ role: "user", content: userInput });
        }
      } else {
        this.messages.push({ role: "user", content: userInput });
      }
    }

    const tools = this.mcp.getTools();

    return this.runToolLoop(tools, callbacks, this.messages, abort)
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg !== "aborted") {
          callbacks.onError(msg);
        }
      });
  }

  private async runToolLoop(
    tools: ReturnType<ToolHost["getTools"]>,
    callbacks: ConversationCallbacks,
    messages: Message[],
    abort: AbortToken
  ): Promise<void> {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (abort.aborted) throw new Error("aborted");

      const response = await this.llm.chat(
        this.systemPrompt,
        messages,
        tools,
        { model: this.model },
        (chunk: StreamChunk) => {
          if (abort.aborted) return;
          if (chunk.type === "text_delta" && chunk.text) {
            callbacks.onTextDelta(chunk.text);
          } else if (chunk.type === "tool_use_start") {
            callbacks.onToolStart(chunk.id!, chunk.name!);
          }
        }
      );

      if (abort.aborted) throw new Error("aborted");

      messages.push(response);

      const content = response.content as ContentBlock[];
      const toolCalls = content.filter((b) => b.type === "tool_use");

      if (toolCalls.length === 0) {
        callbacks.onComplete(response);
        return;
      }

      const toolResults: ContentBlock[] = [];

      for (const toolCall of toolCalls) {
        if (abort.aborted) throw new Error("aborted");

        if (!abort.aborted) callbacks.onToolRun?.(toolCall.id!, (toolCall.input ?? {}) as Record<string, unknown>);

        try {
          // Studio tools (including fixes that write to the org) are UI-only — never run one the model names.
          if (toolCall.name!.startsWith(STUDIO_TOOL_PREFIX)) {
            throw new Error(`${toolCall.name} is only available from the Studio UI.`);
          }
          // A session stays in its org; its server would otherwise be pointed elsewhere for every later call.
          if (ORG_SWITCH_TOOLS.has(toolCall.name!)) {
            throw new Error(orgSwitchRefusal(this.org));
          }
          const result = await this.mcp.callTool(
            toolCall.name!,
            toolCall.input as Record<string, unknown>
          );
          const resultText = result.content
            .map((c) => c.text)
            .join("\n");
          const isError = result.isError ?? false;

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: resultText,
            is_error: isError,
          });

          if (!abort.aborted) {
            callbacks.onToolResult(toolCall.id!, resultText, isError);
            callbacks.onToolEnd(toolCall.id!);
          }
        } catch (error) {
          const errMsg =
            error instanceof Error ? error.message : String(error);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: `Error: ${errMsg}`,
            is_error: true,
          });
          if (!abort.aborted) {
            callbacks.onToolResult(toolCall.id!, `Error: ${errMsg}`, true);
            callbacks.onToolEnd(toolCall.id!);
          }
        }
      }

      messages.push({
        role: "user",
        content: toolResults,
      });
    }

    callbacks.onError(
      `Reached maximum tool call rounds (${MAX_TOOL_ROUNDS})`
    );
  }
}
