import { describe, it, expect } from "vitest";
import {
  capToolResult,
  ORG_RESULT_MAX_CHARS,
  RESULT_MAX_CHARS,
} from "../../../src-electron/engine/result-cap.js";
import { describeHttpError } from "../../../src-electron/llm/errors.js";

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => `| row ${i} | ${"x".repeat(80)} |`).join("\n");

describe("capToolResult", () => {
  it("leaves results under the limit alone", () => {
    const text = rows(100);
    expect(capToolResult("run_soql", text)).toBe(text);
  });

  it("cuts a large org query at a line and tells the model to narrow it", () => {
    const text = rows(20_000);
    const out = capToolResult("run_soql", text);
    expect(out.length).toBeLessThan(ORG_RESULT_MAX_CHARS + 600);
    expect(out).toMatch(/\| row \d+ \| x+ \|\n\n\[Result cut/);
    expect(out).toMatch(/narrow the query/);
  });

  it("lets module docs through whole up to the backstop", () => {
    const docs = "d".repeat(1_000_000);
    expect(capToolResult("get_lsc_module_docs", docs)).toBe(docs);
    expect(capToolResult("get_lsc_module_docs", docs + docs).length).toBeLessThan(
      RESULT_MAX_CHARS + 600
    );
  });
});

describe("describeHttpError", () => {
  it("calls a context overflow what it is, not a model the gateway doesn't serve", () => {
    const body = JSON.stringify({
      error: {
        message:
          'litellm.ContextWindowExceededError: BedrockException: Context Window Error - {"message":"prompt is too long: 5319206 tokens > 1000000 maximum"} model=claude-sonnet-5',
      },
    });
    const err = describeHttpError(400, body, {
      service: "The gateway",
      url: "https://x",
      style: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(err.message).toMatch(/too long for the model/);
    expect(err.message).not.toMatch(/doesn't serve/);
  });

  it("still names an unknown model", () => {
    const body = JSON.stringify({ error: { message: "model claude-nope not found" } });
    expect(
      describeHttpError(404, body, {
        service: "The gateway",
        url: "https://x",
        style: "anthropic",
        model: "claude-nope",
      }).message
    ).toMatch(/doesn't serve the model/);
  });
});
