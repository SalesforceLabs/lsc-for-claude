import { describe, it, expect, vi } from "vitest";
import { ConversationEngine, STOPPED_TEXT } from "../../../src-electron/engine/conversation.js";
import type { ContentBlock, Message } from "../../../src-electron/llm/provider.js";

type Reply = Message | ((messages: Message[]) => Message);

/** An LLM that answers from a script and records the history it was sent each round. */
function fakeLlm(replies: Reply[]) {
  const seen: Message[][] = [];
  return {
    seen,
    llm: {
      id: "fake",
      name: "Fake",
      validateCredentials: async () => true,
      chat: vi.fn(async (_sys: string, messages: Message[]) => {
        seen.push(structuredClone(messages));
        const next = replies.shift();
        if (!next) throw new Error("no more replies");
        return typeof next === "function" ? next(messages) : next;
      }),
    },
  };
}

const toolUse = (...ids: string[]): Message => ({
  role: "assistant",
  content: ids.map((id) => ({ type: "tool_use", id, name: "run_apex", input: {} }) as ContentBlock),
});
const text = (t: string): Message => ({ role: "assistant", content: [{ type: "text", text: t }] });

function callbacks() {
  return {
    onTextDelta: vi.fn(),
    onToolStart: vi.fn(),
    onToolRun: vi.fn(),
    onToolResult: vi.fn(),
    onToolEnd: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
  };
}

const promptBuilder = { buildSystemPrompt: () => "sys", getCommandContent: () => null } as never;

/** What providers require: every tool_use answered by the very next (user) message. */
function expectValidHistory(messages: Message[]) {
  messages.forEach((m, i) => {
    if (m.role !== "assistant" || !Array.isArray(m.content)) return;
    const ids = (m.content as ContentBlock[]).filter((b) => b.type === "tool_use").map((b) => b.id);
    if (!ids.length) return;
    const next = messages[i + 1];
    expect(next?.role).toBe("user");
    const answered = (next.content as ContentBlock[]).filter((b) => b.type === "tool_result").map((b) => b.tool_use_id);
    expect(answered.sort()).toEqual([...ids].sort());
  });
}

describe("ConversationEngine stopping mid-tool", () => {
  it("answers a call left waiting on an approval when the user sends a new message", async () => {
    const { llm, seen } = fakeLlm([toolUse("a", "b"), text("ok")]);
    let gateCalls = 0;
    const gateTool = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<null>((resolve) => {
          gateCalls++;
          signal.addEventListener("abort", () => resolve(null));
        })
    );
    const mcp = { getTools: () => [], callTool: vi.fn(async () => ({ content: [{ type: "text", text: "ran" }] })) };
    const engine = new ConversationEngine(llm as never, mcp as never, promptBuilder, null, { gateTool: gateTool as never });
    engine.initialize();

    const first = engine.sendMessage("run two things", callbacks());
    await vi.waitFor(() => expect(gateCalls).toBe(1));
    const second = engine.sendMessage("never mind", callbacks());
    await Promise.all([first, second]);

    // The stopped run neither ran the tool nor wrote to the history after it was replaced.
    expect(mcp.callTool).not.toHaveBeenCalled();
    const sent = seen[1];
    expectValidHistory(sent);
    const stopped = sent[2].content as ContentBlock[];
    expect(stopped.every((b) => b.type === "tool_result" && b.is_error && b.content === STOPPED_TEXT)).toBe(true);
    expect(sent.at(-1)).toEqual({ role: "user", content: "never mind" });
    expectValidHistory(engine.getMessages());
    expect(engine.getMessages().at(-1)).toEqual(text("ok"));
  });

  it("answers the open calls after Stop, before the next message", async () => {
    const { llm, seen } = fakeLlm([toolUse("a"), text("ok")]);
    let release!: () => void;
    const mcp = {
      getTools: () => [],
      callTool: vi.fn(() => new Promise<{ content: Array<{ type: string; text: string }> }>((r) => (release = () => r({ content: [{ type: "text", text: "late" }] })))),
    };
    const engine = new ConversationEngine(llm as never, mcp as never, promptBuilder);
    engine.initialize();

    const first = engine.sendMessage("go", callbacks());
    await vi.waitFor(() => expect(mcp.callTool).toHaveBeenCalled());
    engine.abort();
    release(); // the tool answers after the stop
    await first;
    // Nothing from the stopped run was added once it stopped.
    expect(engine.getMessages().at(-1)).toEqual(toolUse("a"));

    await engine.sendMessage("again", callbacks());
    expectValidHistory(seen[1]);
    expect((seen[1][2].content as ContentBlock[])[0]).toMatchObject({ tool_use_id: "a", content: STOPPED_TEXT });
  });
});

describe("ConversationEngine preflight", () => {
  it("shows a failed preflight but doesn't give it to the model", async () => {
    const { llm, seen } = fakeLlm([text("ok")]);
    const mcp = { getTools: () => [], callTool: vi.fn(async () => ({ content: [{ type: "text", text: "timed out" }], isError: true })) };
    const cb = callbacks();
    const engine = new ConversationEngine(llm as never, mcp as never, promptBuilder, null, {
      preflight: async () => [{ name: "diagnose_lsc_issue", input: { symptom: "x" } }],
    });
    engine.initialize();
    await engine.sendMessage("sync failed", cb);

    expect(mcp.callTool).toHaveBeenCalledWith("diagnose_lsc_issue", { symptom: "x" }, { timeoutMs: 15_000 });
    expect(cb.onToolResult).toHaveBeenCalledWith(expect.stringMatching(/^preflight_/), "timed out", true);
    expect(cb.onToolEnd).toHaveBeenCalledTimes(1);
    expect(seen[0]).toEqual([{ role: "user", content: "sync failed" }]);
  });

  it("gives a successful preflight to the model as a tool turn", async () => {
    const { llm, seen } = fakeLlm([text("ok")]);
    const mcp = { getTools: () => [], callTool: vi.fn(async () => ({ content: [{ type: "text", text: "{\"items\":[]}" }] })) };
    const engine = new ConversationEngine(llm as never, mcp as never, promptBuilder, null, {
      preflight: async () => [{ name: "diagnose_lsc_issue", input: { symptom: "x" } }],
    });
    engine.initialize();
    await engine.sendMessage("sync failed", callbacks());
    expect(seen[0]).toHaveLength(3);
    expectValidHistory(seen[0]);
  });
});

describe("ConversationEngine per-message tool limits", () => {
  const checks = (...ids: string[]): Message => ({
    role: "assistant",
    content: ids.map((id) => ({ type: "tool_use", id, name: "check_user_access", input: { user: id } }) as ContentBlock),
  });

  it("refuses a third rep check in one message and allows checks again on the next", async () => {
    const { llm, seen } = fakeLlm([checks("a", "b", "c"), text("done"), checks("d"), text("done")]);
    const mcp = { getTools: () => [], callTool: vi.fn(async () => ({ content: [{ type: "text", text: "{}" }] })) };
    const engine = new ConversationEngine(llm as never, mcp as never, promptBuilder);
    engine.initialize();

    await engine.sendMessage("reps can't see the Samples tab", callbacks());
    expect(mcp.callTool).toHaveBeenCalledTimes(2);
    const results = seen[1].at(-1)!.content as ContentBlock[];
    expect(results.find((b) => b.tool_use_id === "c")).toMatchObject({ is_error: true, content: expect.stringMatching(/Already checked 2 reps/) });
    expectValidHistory(seen[1]);

    await engine.sendMessage("check Carmen", callbacks());
    expect(mcp.callTool).toHaveBeenCalledTimes(3);
  });
});
