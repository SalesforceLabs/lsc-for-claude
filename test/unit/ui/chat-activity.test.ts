import { describe, expect, it } from "vitest";
import {
  advanceReveal, openMermaidFence, replyActivity, revealCut, summarizeTools, toolDetail, toolLabel, toolPhrase,
} from "../../../src-renderer/chat-activity.js";
import type { ChatMessage, ToolCall } from "../../../src-renderer/hooks/useChat.js";

const tool = (over: Partial<ToolCall>): ToolCall => ({ id: "t1", name: "run_soql", status: "success", collapsed: true, ...over });
const reply = (blocks: ChatMessage["blocks"], isStreaming = true): ChatMessage => ({ id: "m", role: "assistant", text: "", blocks, isStreaming });

describe("tool phrases", () => {
  it("names known tools in plain words, by state", () => {
    expect(toolLabel(tool({ name: "search_lsc_knowledge", status: "running" }))).toBe("Searching the knowledge base");
    expect(toolLabel(tool({ name: "search_lsc_knowledge" }))).toBe("Searched the knowledge base");
    expect(toolLabel(tool({ name: "mcp__salesforce-docs__salesforce_docs_search" }))).toBe("Searched Salesforce Help");
  });

  it("phrases check_*_config tools and humanizes the rest", () => {
    expect(toolPhrase("check_activity_plan_config").running).toBe("Checking activity plan configuration");
    expect(toolPhrase("add_navigation_tab").done).toBe("Add navigation tab");
  });

  it("picks the argument that says what a call was about, on one short line", () => {
    expect(toolDetail({ targetOrg: "x", query: "SELECT Id\n  FROM Account" })).toBe("SELECT Id FROM Account");
    expect(toolDetail({ objectName: "Visit" })).toBe("Visit");
    expect(toolDetail({ query: "a".repeat(200) }, 10)).toBe(`${"a".repeat(9)}…`);
    expect(toolDetail({ limit: 5 } as Record<string, unknown>)).toBeUndefined();
    expect(toolDetail(undefined)).toBeUndefined();
  });

  it("summarizes a group by phrase with counts", () => {
    const tools = [tool({ name: "run_soql" }), tool({ name: "run_soql" }), tool({ name: "describe_sobject" })];
    expect(summarizeTools(tools)).toBe("Queried the org ×2, Described an object");
  });
});

describe("replyActivity", () => {
  it("is thinking before anything arrives and after tools finish", () => {
    expect(replyActivity(reply([]))?.label).toBe("Thinking…");
    expect(replyActivity(reply([{ type: "tool", tool: tool({}) }]))?.label).toBe("Thinking…");
  });

  it("names the running tool and what it's about — never 'done' while the reply goes on", () => {
    const a = replyActivity(reply([
      { type: "tool", tool: tool({ id: "a" }) },
      { type: "tool", tool: tool({ id: "b", name: "search_lsc_knowledge", status: "running", input: { query: "medical events" } }) },
      { type: "tool", tool: tool({ id: "c", status: "pending" }) },
    ]));
    expect(a).toEqual({ label: "Searching the knowledge base…", detail: "medical events", key: "tool:b", timed: true });
  });

  it("says a diagram is being drawn while its fence is open", () => {
    expect(replyActivity(reply([{ type: "text", text: "Here:\n```mermaid\ngraph TD\nA-->B" }]))?.label).toBe("Drawing a diagram…");
    expect(replyActivity(reply([{ type: "text", text: "Here:\n```mermaid\ngraph TD\n```\nDone" }]))?.label).toBe("Writing…");
  });

  it("is gone once the reply has finished", () => {
    expect(replyActivity(reply([{ type: "text", text: "hi" }], false))).toBeNull();
  });
});

describe("openMermaidFence", () => {
  it("finds an unclosed mermaid fence and ignores other code", () => {
    const text = "a\n```mermaid\ngraph TD";
    expect(openMermaidFence(text)).toBe(2);
    expect(openMermaidFence("```ts\nconst a = 1;")).toBe(-1);
    expect(openMermaidFence("```mermaid\ngraph\n```\n\n```mermaid\nA")).toBe(22);
  });
});

describe("streamed text reveal", () => {
  it("eases toward what has arrived, never past it", () => {
    let shown = 0;
    for (let i = 0; i < 30; i++) shown = advanceReveal(shown, 400, 16, false);
    expect(shown).toBeGreaterThan(300);
    expect(shown).toBeLessThan(400);
    expect(advanceReveal(399.5, 400, 16, false)).toBe(400);
  });

  it("keeps a steady minimum pace and finishes faster once the stream ends", () => {
    expect(advanceReveal(0, 5, 100, false)).toBe(5);
    expect(advanceReveal(0, 1000, 16, true)).toBeGreaterThan(advanceReveal(0, 1000, 16, false));
  });

  it("treats a long pause as one frame", () => {
    expect(advanceReveal(0, 10_000, 5_000, false)).toBe(advanceReveal(0, 10_000, 100, false));
  });

  it("cuts at the end of a word", () => {
    expect(revealCut("hello world again", 2)).toBe(5);
    expect(revealCut("hello world", 5)).toBe(5);
    expect(revealCut("hello", 99)).toBe(5);
    expect(revealCut("a" + "b".repeat(40), 3)).toBe(3);
  });
});
