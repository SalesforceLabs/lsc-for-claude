import { describe, it, expect } from "vitest";
import {
  OpenAIProvider,
  OpenAIStreamAssembler,
  toOpenAIMessages,
  toOpenAITools,
} from "../../../src-electron/llm/openai.js";
import type { Message, StreamChunk } from "../../../src-electron/llm/provider.js";
import { TokenSource } from "../../../src-electron/llm/token-source.js";

describe("toOpenAIMessages", () => {
  it("puts the system prompt first and passes plain text through", () => {
    expect(
      toOpenAIMessages("You are LSC Assistant.", [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ])
    ).toEqual([
      { role: "system", content: "You are LSC Assistant." },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("turns tool_use blocks into tool_calls and tool_results into tool messages, in order", () => {
    const history: Message[] = [
      { role: "user", content: "How many accounts?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "toolu_1", name: "run_soql", input: { query: "SELECT COUNT() FROM Account" } },
          { type: "tool_use", id: "toolu_2", name: "get_org_status", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "42" },
          { type: "tool_result", tool_use_id: "toolu_2", content: "ok" },
          { type: "text", text: "Also check contacts." },
        ],
      },
    ];
    expect(toOpenAIMessages("", history)).toEqual([
      { role: "user", content: "How many accounts?" },
      {
        role: "assistant",
        content: "Let me check.",
        tool_calls: [
          {
            id: "toolu_1",
            type: "function",
            function: { name: "run_soql", arguments: '{"query":"SELECT COUNT() FROM Account"}' },
          },
          { id: "toolu_2", type: "function", function: { name: "get_org_status", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "toolu_1", content: "42" },
      { role: "tool", tool_call_id: "toolu_2", content: "ok" },
      { role: "user", content: [{ type: "text", text: "Also check contacts." }] },
    ]);
  });

  it("sends a null content for tool-only assistant turns, and images as data URLs", () => {
    const out = toOpenAIMessages("", [
      { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "t" }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "c1" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        ],
      },
    ]);
    expect(out[0]).toMatchObject({ role: "assistant", content: null });
    expect(out[1]).toEqual({ role: "tool", tool_call_id: "c1", content: "" });
    expect(out[2]).toEqual({
      role: "user",
      content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }],
    });
  });
});

describe("toOpenAITools", () => {
  it("wraps tools as functions without the $schema keyword", () => {
    expect(
      toOpenAITools([
        {
          name: "run_soql",
          description: "Run SOQL",
          input_schema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: {} },
        },
      ])
    ).toEqual([
      {
        type: "function",
        function: { name: "run_soql", description: "Run SOQL", parameters: { type: "object", properties: {} } },
      },
    ]);
  });
});

describe("OpenAIStreamAssembler", () => {
  it("assembles text and interleaved tool-call deltas, reporting chunks", () => {
    const chunks: StreamChunk[] = [];
    const a = new OpenAIStreamAssembler((c) => chunks.push(c));
    a.push({ choices: [{ delta: { content: "Hi" } }] });
    a.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "run_soql", arguments: "" } }] } }] });
    a.push({ choices: [{ delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "get_org_status" } }] } }] });
    a.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] } }] });
    a.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"SELECT Id FROM User"}' } }] } }] });
    a.push({ choices: [] });
    expect(a.finish()).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Hi" },
        { type: "tool_use", id: "call_a", name: "run_soql", input: { query: "SELECT Id FROM User" } },
        { type: "tool_use", id: "call_b", name: "get_org_status", input: {} },
      ],
    });
    expect(chunks.map((c) => c.type)).toEqual([
      "text_delta",
      "tool_use_start",
      "tool_use_start",
      "tool_use_delta",
      "tool_use_delta",
      "tool_use_end",
      "tool_use_end",
      "message_stop",
    ]);
  });

  it("gives calls without an id one, and survives malformed arguments", () => {
    const a = new OpenAIStreamAssembler();
    a.push({ choices: [{ delta: { tool_calls: [{ function: { name: "t", arguments: "{not json" } }] } }] });
    expect(a.finish().content).toEqual([{ type: "tool_use", id: "call_0", name: "t", input: {} }]);
  });

  it("throws on an error event", () => {
    const chunks: StreamChunk[] = [];
    const a = new OpenAIStreamAssembler((c) => chunks.push(c));
    expect(() => a.push({ error: { message: "context too long" } })).toThrow("context too long");
    expect(chunks).toEqual([{ type: "error", error: "context too long" }]);
  });
});

describe("OpenAIProvider", () => {
  function provider(responses: Array<{ status: number; text: string }>, defaultModel?: string) {
    const calls: Array<{ url: string; headers: Record<string, string>; body?: Record<string, unknown> }> = [];
    const p = new OpenAIProvider(
      {
        baseUrl: "https://llm.example.com/v1/",
        tokens: TokenSource.fixed("key"),
        authHeader: "api-key",
        service: "The gateway",
        fetch: async (url, init) => {
          calls.push({
            url,
            headers: (init?.headers ?? {}) as Record<string, string>,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          const next = responses.shift()!;
          return new Response(next.text, { status: next.status });
        },
      },
      defaultModel
    );
    return { p, calls };
  }

  it("streams a chat to /chat/completions with tools and no token limit", async () => {
    const stream =
      'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n' + "data: [DONE]\n\n";
    const { p, calls } = provider([{ status: 200, text: stream }], "gpt-5");
    const message = await p.chat("sys", [{ role: "user", content: "hi" }], [
      { name: "t", description: "d", input_schema: { type: "object" } },
    ]);
    expect(message.content).toEqual([{ type: "text", text: "OK" }]);
    expect(calls[0].url).toBe("https://llm.example.com/v1/chat/completions");
    expect(calls[0].headers["api-key"]).toBe("key");
    expect(calls[0].body).toMatchObject({ model: "gpt-5", stream: true });
    expect(calls[0].body).not.toHaveProperty("max_tokens");
    expect((calls[0].body!.tools as unknown[]).length).toBe(1);
  });

  it("asks for a model when the connection has none", async () => {
    const { p } = provider([]);
    await expect(p.chat("", [{ role: "user", content: "hi" }], [])).rejects.toThrow(/Choose a model/);
  });

  it("explains a 404 with a /v1 hint", async () => {
    const { p } = provider([{ status: 404, text: "" }]);
    await expect(p.probe("gpt-5")).rejects.toThrow(/Nothing answered at .*\/chat\/completions.*end in \/v1/);
  });
});
