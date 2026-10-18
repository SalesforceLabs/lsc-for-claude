import { describe, it, expect } from "vitest";
import {
  chatModels,
  cleanConnection,
  createProvider,
  testConnection,
} from "../../../src-electron/llm/create.js";
import { AnthropicProvider } from "../../../src-electron/llm/anthropic.js";
import { OpenAIProvider } from "../../../src-electron/llm/openai.js";
import type { LLMProvider } from "../../../src-electron/llm/provider.js";

function fakeProvider(models: string[] | null, probe: (model: string) => Promise<void> = async () => {}): LLMProvider {
  return {
    id: "fake",
    name: "Fake",
    chat: async () => ({ role: "assistant", content: "" }),
    validateCredentials: async () => true,
    listModels: async () => models,
    probe,
  };
}

describe("createProvider", () => {
  it("uses the saved key, falling back to the environment", () => {
    expect(createProvider({ kind: "anthropic" }, "sk-ant", undefined, {})).toBeInstanceOf(AnthropicProvider);
    expect(createProvider({ kind: "anthropic" }, undefined, undefined, { ANTHROPIC_API_KEY: "env" })).toBeInstanceOf(
      AnthropicProvider
    );
    expect(createProvider({ kind: "openai" }, undefined, undefined, { OPENAI_API_KEY: "env" })).toBeInstanceOf(OpenAIProvider);
  });

  it("asks for a key when there is none", () => {
    expect(() => createProvider({ kind: "anthropic" }, undefined, undefined, {})).toThrow(/Enter an Anthropic API key/);
    expect(() => createProvider({ kind: "openai" }, undefined, undefined, {})).toThrow(/Enter an OpenAI API key/);
  });

  it("refuses gateway URLs that would send a token in the clear", () => {
    expect(() =>
      createProvider({ kind: "openai-compatible", baseUrl: "http://llm.example.com/v1" }, "tok", undefined, {})
    ).toThrow(/https/);
    expect(
      createProvider({ kind: "openai-compatible", baseUrl: "http://localhost:11434/v1" }, undefined, undefined, {})
    ).toBeInstanceOf(OpenAIProvider);
    expect(createProvider({ kind: "anthropic-gateway", baseUrl: "https://gw.example.com" }, "tok", undefined, {})).toBeInstanceOf(
      AnthropicProvider
    );
  });
});

describe("chatModels", () => {
  it("keeps Claude models on Anthropic-style endpoints and chat models on OpenAI-style ones", () => {
    expect(chatModels("anthropic", ["claude-sonnet-5-5", "gpt-5", "llama-3"])).toEqual(["claude-sonnet-5-5"]);
    expect(chatModels("openai", ["gpt-5", "text-embedding-3-small", "whisper-1", "dall-e-3", "gpt-5-mini"])).toEqual([
      "gpt-5",
      "gpt-5-mini",
    ]);
    expect(chatModels("openai", null)).toBeNull();
  });
});

describe("testConnection", () => {
  it("tests Claude connections with the default model, or the first listed when it isn't served", async () => {
    const probed: string[] = [];
    const probe = async (m: string) => void probed.push(m);
    expect(await testConnection(fakeProvider(null, probe), { kind: "anthropic" })).toEqual({
      ok: true,
      models: undefined,
      model: "claude-sonnet-5-5",
    });
    expect(await testConnection(fakeProvider(["claude-haiku-5-5", "gpt-5"], probe), { kind: "anthropic-gateway" })).toEqual({
      ok: true,
      models: ["claude-haiku-5-5"],
      model: "claude-haiku-5-5",
    });
    expect(probed).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
  });

  it("needs a model on OpenAI-style connections, offering the listed ones", async () => {
    expect(await testConnection(fakeProvider(["gpt-5"]), { kind: "openai" })).toMatchObject({
      ok: false,
      needsModel: true,
      models: ["gpt-5"],
    });
    expect(await testConnection(fakeProvider(["gpt-5"]), { kind: "openai", model: "gpt-5" })).toMatchObject({
      ok: true,
      model: "gpt-5",
    });
  });

  it("reports the probe's error", async () => {
    const result = await testConnection(
      fakeProvider(null, async () => {
        throw new Error("The gateway doesn't serve the model");
      }),
      { kind: "anthropic" }
    );
    expect(result).toMatchObject({ ok: false, error: "The gateway doesn't serve the model" });
  });
});

describe("cleanConnection", () => {
  it("drops gateway fields from the official APIs and trims the rest", () => {
    expect(cleanConnection({ kind: "anthropic", baseUrl: "https://x", tokenCommand: "cmd", model: " " })).toEqual({
      kind: "anthropic",
    });
    expect(
      cleanConnection({
        kind: "openai-compatible",
        baseUrl: " https://llm.example.com/v1 ",
        authHeader: "api-key",
        tokenCommand: "  ",
        headers: {},
        model: " gpt-5 ",
      })
    ).toEqual({ kind: "openai-compatible", baseUrl: "https://llm.example.com/v1", authHeader: "api-key", model: "gpt-5" });
  });
});
