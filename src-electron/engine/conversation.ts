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

/**
 * Points where the app steps into a run. `preflight` names tools the engine runs itself before the
 * model's first round (shown and saved like any tool call, and visible to the model as results it
 * already has); `gateTool` sees each tool the model calls and either lets it run (null) or answers
 * in its place — e.g. a write queued for review instead of run.
 */
export interface ConversationHooks {
  preflight?: (userText: string) => Promise<Array<{ name: string; input: Record<string, unknown> }>>;
  /** `signal` aborts when the run is stopped or replaced, so a gate waiting on the user doesn't hang it. */
  gateTool?: (call: { id: string; name: string; input: Record<string, unknown>; signal: AbortSignal }) => Promise<{ text: string; isError: boolean } | null>;
}

interface AbortToken {
  aborted: boolean;
  controller: AbortController;
}

function stopRun(token: AbortToken): void {
  token.aborted = true;
  token.controller.abort();
}

const MAX_TOOL_ROUNDS = 25;

/** What the model reads for a tool call whose run was stopped before it answered. */
export const STOPPED_TEXT = "Stopped by the user before this tool finished.";

/** How long the engine's own diagnose waits before the model starts without it. */
const PREFLIGHT_TIMEOUT_MS = 15_000;

/**
 * Tool results for every tool_use in the last assistant turn that has none — a run stopped while a
 * tool (or an approval) was pending leaves its calls unanswered, and providers refuse the history.
 */
export function unansweredToolResults(messages: Message[]): ContentBlock[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || !Array.isArray(last.content)) return [];
  return (last.content as ContentBlock[])
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ type: "tool_result" as const, tool_use_id: b.id, content: STOPPED_TEXT, is_error: true }));
}

export class ConversationEngine {
  private llm: LLMProvider;
  private mcp: ToolHost;
  private promptBuilder: PromptBuilder;
  /** The org this session works in — its tools run there and nowhere else. */
  private org: SessionOrg | null;
  private messages: Message[] = [];
  private systemPrompt: string = "";
  private currentAbort: AbortToken | null = null;
  /** Runs started and not yet finished (an aborted one stays until it unwinds). */
  private activeRuns = 0;
  private model?: string;
  private hooks: ConversationHooks;

  constructor(llm: LLMProvider, mcp: ToolHost, promptBuilder: PromptBuilder, org: SessionOrg | null = null, hooks: ConversationHooks = {}) {
    this.llm = llm;
    this.mcp = mcp;
    this.promptBuilder = promptBuilder;
    this.org = org;
    this.hooks = hooks;
  }

  initialize(): void {
    // Last, so the shared prompt above it stays identical across sessions.
    this.systemPrompt = `${this.promptBuilder.buildSystemPrompt()}\n\n${orgPromptSection(this.org)}\n`;
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  isRunning(): boolean {
    return this.activeRuns > 0;
  }

  /** Abort the current run. Fire-and-forget — the run will stop at the next checkpoint. */
  abort(): void {
    if (this.currentAbort) stopRun(this.currentAbort);
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
    if (this.currentAbort) stopRun(this.currentAbort);

    const abort: AbortToken = { aborted: false, controller: new AbortController() };
    this.currentAbort = abort;

    // A stopped run never writes to the history again, so answer the calls it left open first.
    const stopped = unansweredToolResults(this.messages);
    if (stopped.length) this.messages.push({ role: "user", content: stopped });

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

    const userText = Array.isArray(userInput)
      ? userInput.filter((b) => b.type === "text").map((b) => (b as { text?: string }).text ?? "").join("\n")
      : userInput;

    this.activeRuns++;
    return this.runPreflight(userText, callbacks, this.messages, abort)
      .then(() => this.runToolLoop(tools, callbacks, this.messages, abort))
      .finally(() => {
        this.activeRuns--;
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg !== "aborted") {
          callbacks.onError(msg);
        }
      });
  }

  /** Run the tools `preflight` asks for, as one assistant turn of tool calls the model then reads. */
  private async runPreflight(userText: string, callbacks: ConversationCallbacks, messages: Message[], abort: AbortToken): Promise<void> {
    if (!this.hooks.preflight) return;
    let calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    try {
      calls = await this.hooks.preflight(userText);
    } catch {
      return; // A preflight that can't decide never blocks the run
    }
    if (!calls.length || abort.aborted) return;
    const uses: ContentBlock[] = [];
    const results: ContentBlock[] = [];
    for (const [i, call] of calls.entries()) {
      const id = `preflight_${Date.now().toString(36)}_${i}`;
      callbacks.onToolStart(id, call.name);
      callbacks.onToolRun?.(id, call.input);
      let text: string;
      let isError: boolean;
      try {
        // Short: the user sees nothing from the model until this returns.
        const result = await this.mcp.callTool(call.name, call.input, { timeoutMs: PREFLIGHT_TIMEOUT_MS });
        text = result.content.map((c) => c.text).join("\n");
        isError = result.isError ?? false;
      } catch (error) {
        text = `Error: ${error instanceof Error ? error.message : String(error)}`;
        isError = true;
      }
      if (abort.aborted) throw new Error("aborted");
      callbacks.onToolResult(id, text, isError);
      callbacks.onToolEnd(id);
      // A failed preflight is shown, but the model starts without it rather than reading the error.
      if (isError) continue;
      uses.push({ type: "tool_use", id, name: call.name, input: call.input });
      results.push({ type: "tool_result", tool_use_id: id, content: text, is_error: isError });
    }
    if (!uses.length) return;
    messages.push({ role: "assistant", content: uses });
    messages.push({ role: "user", content: results });
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
        // Once stopped, the history belongs to the next run (sendMessage answers these calls).
        if (abort.aborted) throw new Error("aborted");

        callbacks.onToolRun?.(toolCall.id!, (toolCall.input ?? {}) as Record<string, unknown>);

        try {
          // Studio tools (including fixes that write to the org) are UI-only — never run one the model names.
          if (toolCall.name!.startsWith(STUDIO_TOOL_PREFIX)) {
            throw new Error(`${toolCall.name} is only available from the Studio UI.`);
          }
          // A session stays in its org; its server would otherwise be pointed elsewhere for every later call.
          if (ORG_SWITCH_TOOLS.has(toolCall.name!)) {
            throw new Error(orgSwitchRefusal(this.org));
          }
          const gated = await this.hooks.gateTool?.({
            id: toolCall.id!,
            name: toolCall.name!,
            input: (toolCall.input ?? {}) as Record<string, unknown>,
            signal: abort.controller.signal,
          });
          if (abort.aborted) throw new Error("aborted");
          if (gated) {
            toolResults.push({ type: "tool_result", tool_use_id: toolCall.id, content: gated.text, is_error: gated.isError });
            callbacks.onToolResult(toolCall.id!, gated.text, gated.isError);
            callbacks.onToolEnd(toolCall.id!);
            continue;
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
          if (abort.aborted) throw new Error("aborted");
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

      if (abort.aborted) throw new Error("aborted");
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
