import { describe, it, expect } from "vitest";
import { AnthropicProvider } from "../../../src-electron/llm/anthropic.js";
import { OpenAIProvider } from "../../../src-electron/llm/openai.js";
import { TokenSource } from "../../../src-electron/llm/token-source.js";

function recordingFetch() {
  const signals: Array<AbortSignal | undefined> = [];
  const fetch = async (_url: string, init?: RequestInit) => {
    signals.push(init?.signal ?? undefined);
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return new Response("data: [DONE]\n\n", { status: 200 });
  };
  return { signals, fetch };
}

const base = { baseUrl: "https://gw.example.com", tokens: TokenSource.fixed("k"), authHeader: "x-api-key" as const, service: "gw" };

describe("abort signal", () => {
  it("reaches the Anthropic request", async () => {
    const { signals, fetch } = recordingFetch();
    const ctl = new AbortController();
    await new AnthropicProvider({ ...base, fetch }).chat("s", [{ role: "user", content: "hi" }], [], { signal: ctl.signal });
    // The request gets a signal that follows the caller's (it also carries the first-response timeout).
    expect(signals[0]?.aborted).toBe(false);
    ctl.abort();
    expect(signals[0]?.aborted).toBe(true);
  });

  it("reaches the OpenAI request", async () => {
    const { signals, fetch } = recordingFetch();
    const ctl = new AbortController();
    await new OpenAIProvider({ ...base, authHeader: "bearer", fetch }, "m").chat("s", [{ role: "user", content: "hi" }], [], { signal: ctl.signal });
    // The request gets a signal that follows the caller's (it also carries the first-response timeout).
    expect(signals[0]?.aborted).toBe(false);
    ctl.abort();
    expect(signals[0]?.aborted).toBe(true);
  });

  it("rethrows the abort itself, not a network message", async () => {
    const { fetch } = recordingFetch();
    const ctl = new AbortController();
    ctl.abort();
    await expect(
      new AnthropicProvider({ ...base, fetch }).chat("s", [{ role: "user", content: "hi" }], [], { signal: ctl.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("still sends a signal (for the first-response timeout) when none is given", async () => {
    const { signals, fetch } = recordingFetch();
    await new AnthropicProvider({ ...base, fetch }).chat("s", [{ role: "user", content: "hi" }], []);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(false);
  });
});
