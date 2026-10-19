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
    expect(signals[0]).toBe(ctl.signal);
  });

  it("reaches the OpenAI request", async () => {
    const { signals, fetch } = recordingFetch();
    const ctl = new AbortController();
    await new OpenAIProvider({ ...base, authHeader: "bearer", fetch }, "m").chat("s", [{ role: "user", content: "hi" }], [], { signal: ctl.signal });
    expect(signals[0]).toBe(ctl.signal);
  });

  it("rethrows the abort itself, not a network message", async () => {
    const { fetch } = recordingFetch();
    const ctl = new AbortController();
    ctl.abort();
    await expect(
      new AnthropicProvider({ ...base, fetch }).chat("s", [{ role: "user", content: "hi" }], [], { signal: ctl.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sends no signal when none is given", async () => {
    const { signals, fetch } = recordingFetch();
    await new AnthropicProvider({ ...base, fetch }).chat("s", [{ role: "user", content: "hi" }], []);
    expect(signals[0]).toBeUndefined();
  });
});
