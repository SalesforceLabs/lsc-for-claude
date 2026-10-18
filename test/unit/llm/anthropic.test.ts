import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { AnthropicProvider, normalizeAnthropicUrl } from "../../../src-electron/llm/anthropic.js";
import type { HttpOptions } from "../../../src-electron/llm/http.js";
import { TokenSource } from "../../../src-electron/llm/token-source.js";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

function stubFetch(responses: Array<{ status: number; body?: unknown; text?: string }>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses.shift()!;
    return new Response(next.text ?? JSON.stringify(next.body ?? {}), { status: next.status });
  };
  return { calls, fetch };
}

function options(overrides: Partial<HttpOptions>): HttpOptions {
  return {
    baseUrl: "https://gw.example.com",
    tokens: TokenSource.fixed("static"),
    authHeader: "x-api-key",
    service: "The gateway",
    ...overrides,
  };
}

function sse(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

describe("AnthropicProvider", () => {
  it("sends the helper's token and custom headers, and lists models", async () => {
    const { calls, fetch } = stubFetch([{ status: 200, body: { data: [{ id: "claude-sonnet-5-5" }, { id: "gpt-5" }] } }]);
    const provider = new AnthropicProvider(
      options({
        baseUrl: "https://gw.example.com/bedrock/",
        tokens: TokenSource.command("echo tok-1"),
        headers: { "x-client-id": "claude" },
        fetch,
      })
    );
    expect(await provider.listModels()).toEqual(["claude-sonnet-5-5", "gpt-5"]);
    expect(calls[0].url).toBe("https://gw.example.com/v1/models");
    expect(calls[0].headers).toMatchObject({ "x-api-key": "tok-1", "x-client-id": "claude", "anthropic-version": "2023-06-01" });
  });

  it("sends a bearer token when asked to", async () => {
    const { calls, fetch } = stubFetch([{ status: 200 }]);
    await new AnthropicProvider(options({ authHeader: "bearer", fetch })).probe("claude-haiku-5-5");
    expect(calls[0].headers.authorization).toBe("Bearer static");
    expect(calls[0].headers["x-api-key"]).toBeUndefined();
    expect(calls[0].body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 16 });
  });

  it("re-runs the token command and retries once after a 401", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-helper-"));
    const counter = path.join(dir, "n");
    // Prints tok-1, tok-2, … — one more each run.
    const helper = `n=$(cat '${counter}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${counter}'; echo tok-$n`;
    const { calls, fetch } = stubFetch([{ status: 401 }, { status: 200 }]);
    const provider = new AnthropicProvider(options({ tokens: TokenSource.command(helper), fetch }));
    expect(await provider.validateCredentials()).toBe(true);
    expect(calls.map((c) => c.headers["x-api-key"])).toEqual(["tok-1", "tok-2"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("doesn't retry a static token", async () => {
    const { calls, fetch } = stubFetch([{ status: 401 }]);
    expect(await new AnthropicProvider(options({ fetch })).validateCredentials()).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("explains a rejected key, and fails listModels on it instead of returning no list", async () => {
    const rejected = { status: 401, body: { error: { message: "invalid x-api-key" } } };
    const { fetch } = stubFetch([rejected, rejected]);
    const provider = new AnthropicProvider(options({ fetch }));
    await expect(provider.probe("claude-sonnet-5-5")).rejects.toThrow(
      /The gateway rejected the credentials \(HTTP 401\).*invalid x-api-key/
    );
    await expect(provider.listModels()).rejects.toThrow(/rejected the credentials/);
  });

  it("returns no list when the endpoint doesn't list models", async () => {
    const { fetch } = stubFetch([{ status: 404, text: "not found" }]);
    expect(await new AnthropicProvider(options({ fetch })).listModels()).toBeNull();
  });

  it("streams text and tool use into one message", async () => {
    const { calls, fetch } = stubFetch([
      {
        status: 200,
        text: sse([
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Checking" } },
          { type: "content_block_stop", index: 0 },
          { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "run_soql" } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"query":' } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"SELECT Id FROM Account"}' } },
          { type: "content_block_stop", index: 1 },
          { type: "message_stop" },
        ]),
      },
    ]);
    const message = await new AnthropicProvider(options({ fetch })).chat(
      "system",
      [{ role: "user", content: "hi" }],
      [{ name: "run_soql", description: "Run SOQL", input_schema: { type: "object" } }],
      { model: "claude-opus-5-5" }
    );
    expect(calls[0].url).toBe("https://gw.example.com/v1/messages");
    expect(calls[0].body).toMatchObject({ model: "claude-opus-5-5", system: "system", stream: true });
    expect(message.content).toEqual([
      { type: "text", text: "Checking" },
      { type: "tool_use", id: "toolu_1", name: "run_soql", input: { query: "SELECT Id FROM Account" } },
    ]);
  });
});

describe("normalizeAnthropicUrl", () => {
  it("strips trailing slashes, /bedrock and /v1", () => {
    expect(normalizeAnthropicUrl(" https://gw.example.com/bedrock/ ")).toBe("https://gw.example.com");
    expect(normalizeAnthropicUrl("https://gw.example.com/v1")).toBe("https://gw.example.com");
  });
});
