import { describe, it, expect } from "vitest";
import { CLAUDE_MODELS, modelLabel, modelOptions, modelOptionsFor, pickModel } from "../../../src-renderer/models.js";

describe("modelOptions", () => {
  it("offers every named model, alphabetically, when the provider lists none", () => {
    expect(modelOptions().map((m) => m.label)).toEqual(["Fable 5.1", "Haiku 5.5", "Opus 5.5", "Sonnet 5", "Sonnet 5.5"]);
    expect(modelOptions([])).toEqual(modelOptions());
  });

  it("keeps only the models a gateway serves", () => {
    expect(modelOptions(["claude-sonnet-5", "claude-opus-5-5", "gpt-5"]).map((m) => m.value)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5",
    ]);
  });

  it("falls back to every named model when the gateway lists no Claude models", () => {
    expect(modelOptions(["gpt-5"])).toEqual(modelOptions());
  });
});

describe("pickModel", () => {
  it("keeps an offered model and replaces one that isn't", () => {
    const options = modelOptions(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(pickModel("claude-haiku-5-5", options)).toBe("claude-haiku-5-5");
    expect(pickModel("claude-fable-5-1", options)).toBe("claude-sonnet-5-5");
    expect(pickModel(undefined, options)).toBe("claude-sonnet-5-5");
  });
});

describe("modelOptionsFor", () => {
  it("offers Claude models on Claude connections, with the connection's own model first if it isn't one", () => {
    expect(modelOptionsFor("anthropic", ["claude-haiku-5-5"]).map((m) => m.value)).toEqual(["claude-haiku-5-5"]);
    expect(modelOptionsFor("anthropic", undefined, "claude-custom").map((m) => m.value)[0]).toBe("claude-custom");
    expect(modelOptionsFor(undefined, undefined, "claude-sonnet-5-5")).toEqual(modelOptions());
    expect(CLAUDE_MODELS).toHaveLength(5);
  });

  it("offers the connection's model and the listed ones by id on OpenAI-style connections", () => {
    expect(modelOptionsFor("openai", ["gpt-5", "gpt-5-mini"], "gpt-5")).toEqual([
      { value: "gpt-5", label: "gpt-5" },
      { value: "gpt-5-mini", label: "gpt-5-mini" },
    ]);
    expect(modelOptionsFor("openai", undefined, undefined)).toEqual([]);
    expect(pickModel("claude-sonnet-5", [])).toBe("");
  });
});

describe("listed models", () => {
  // A sample of what the Salesforce AI Model Gateway lists.
  const listed = [
    "claude-sonnet-4-6",
    "gpt-5",
    "claude-sonnet-4-20250514",
    "claude-opus-4-6-vertex",
    "claude-auto-model-preview",
    "claude-haiku-4-5-20251001",
    "claude-opus-5-5",
    "claude-sonnet-5-5-vertex",
    "claude-sonnet-5-5",
    "claude-opus-4-5-20251101",
  ];

  it("labels ids, dropping release dates and naming variants", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelLabel("claude-sonnet-4-6")).toBe("Sonnet 4.6");
    expect(modelLabel("claude-sonnet-4-20250514")).toBe("Sonnet 4");
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelLabel("claude-opus-4-6-vertex")).toBe("Opus 4.6 (Vertex)");
    expect(modelLabel("claude-opus-4-6-v1")).toBe("Opus 4.6 (v1)");
    expect(modelLabel("claude-auto-model-preview")).toBe("claude-auto-model-preview");
  });

  it("offers every listed Claude model, alphabetically", () => {
    expect(modelOptions(listed).map((m) => m.label)).toEqual([
      "claude-auto-model-preview",
      "Haiku 4.5",
      "Opus 4.5",
      "Opus 4.6 (Vertex)",
      "Opus 5.5",
      "Sonnet 4",
      "Sonnet 4.6",
      "Sonnet 5.5",
      "Sonnet 5.5 (Vertex)",
    ]);
  });

  it("shows the id when two listed models read the same", () => {
    expect(modelOptions(["claude-sonnet-4-20250514", "claude-sonnet-4"]).map((m) => m.label)).toEqual([
      "Sonnet 4 — claude-sonnet-4",
      "Sonnet 4 — claude-sonnet-4-20250514",
    ]);
  });

  it("defaults to Sonnet 5.5 rather than the newest model when the saved one isn't served", () => {
    expect(pickModel("claude-fable-5-1", modelOptions(listed))).toBe("claude-sonnet-5-5");
  });
});
