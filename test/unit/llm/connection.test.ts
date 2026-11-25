import { describe, it, expect } from "vitest";
import { apiStyle, baseUrlProblem, migrateLegacyConnection } from "../../../src-electron/llm/connection.js";
import { describeHttpError, describeNetworkError, isAuthError } from "../../../src-electron/llm/errors.js";
import {
  ASSISTANT_NAME,
  CONNECTION_CHOICES,
  headerLines,
  parseHeaderLines,
} from "../../../src-renderer/connection.js";

describe("baseUrlProblem", () => {
  it("allows https anywhere and http only on this machine", () => {
    expect(baseUrlProblem("https://gw.example.com")).toBeNull();
    expect(baseUrlProblem("http://localhost:11434/v1")).toBeNull();
    expect(baseUrlProblem("http://127.0.0.1:4000")).toBeNull();
    expect(baseUrlProblem("http://gw.example.com")).toMatch(/https/);
    expect(baseUrlProblem("not a url")).toMatch(/isn't a URL/);
    expect(baseUrlProblem("")).toMatch(/Enter the base URL/);
  });
});

describe("migrateLegacyConnection", () => {
  it("maps each old provider to a connection and its secret", () => {
    expect(migrateLegacyConnection({ providerType: "api-key", apiKey: "sk" })).toEqual({
      connection: { kind: "anthropic" },
      secret: "sk",
    });
    expect(migrateLegacyConnection({ providerType: "bedrock-gateway", baseUrl: "https://gw", authToken: "t" })).toEqual({
      connection: { kind: "anthropic-gateway", baseUrl: "https://gw", authHeader: "x-api-key" },
      secret: "t",
    });
    expect(migrateLegacyConnection({ providerType: "sf-gateway", gatewayUrl: "https://sf", gatewayToken: "b" })).toEqual({
      connection: { kind: "anthropic-gateway", baseUrl: "https://sf", authHeader: "bearer" },
      secret: "b",
    });
    expect(migrateLegacyConnection({ providerType: "claude-code" })).toEqual({ connection: { kind: "claude-code" } });
    expect(migrateLegacyConnection({ providerType: "api-key" })).toBeNull();
    expect(migrateLegacyConnection({})).toBeNull();
  });
});

describe("errors", () => {
  const ctx = { service: "OpenAI", url: "https://api.openai.com/v1/chat/completions", style: "openai" as const, model: "gpt-9" };

  it("explains HTTP failures in plain language", () => {
    const auth = describeHttpError(401, '{"error":{"message":"Incorrect API key"}}', ctx);
    expect(auth.message).toBe("OpenAI rejected the credentials (HTTP 401). Check the API key or token. Details: Incorrect API key");
    expect(isAuthError(auth)).toBe(true);
    expect(describeHttpError(404, '{"error":{"message":"The model gpt-9 does not exist"}}', ctx).message).toMatch(
      /doesn't serve the model "gpt-9"/
    );
    expect(describeHttpError(429, "", ctx).message).toMatch(/rate-limiting/);
    expect(isAuthError(describeHttpError(500, "", ctx))).toBe(false);
  });

  it("names the model only when a 400 says the model is unknown", () => {
    const at = (body: string) => describeHttpError(400, JSON.stringify({ error: { message: body } }), ctx).message;
    expect(at("Invalid model: gpt-9")).toMatch(/doesn't serve the model "gpt-9"/);
    expect(at("The model gpt-9 does not exist or you do not have access to it")).toMatch(/doesn't serve the model/);
    expect(at('tool_choice: type "tool" and "any" are not supported for this model')).not.toMatch(/doesn't serve/);
    expect(at('tool_choice: type "tool" and "any" are not supported for this model')).toMatch(/^OpenAI returned HTTP 400\. Details: tool_choice/);
    expect(at("max_tokens: 64000 > 32000, which is the maximum allowed for this model")).not.toMatch(/doesn't serve/);
    expect(at("temperature is not supported with this model")).not.toMatch(/doesn't serve/);
  });

  it("explains network failures", () => {
    const url = "https://gw.example.com/v1/messages";
    expect(describeNetworkError({ message: "fetch failed", cause: { code: "ENOTFOUND" } }, url).message).toMatch(/VPN/);
    expect(
      describeNetworkError({ message: "fetch failed", cause: { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" } }, url).message
    ).toMatch(/root certificate/);
    expect(describeNetworkError(new Error("net::ERR_CONNECTION_REFUSED"), url).message).toMatch(/Nothing is listening/);
  });
});

describe("renderer connection helpers", () => {
  it("agree with the main process on each kind's API style", () => {
    for (const choice of CONNECTION_CHOICES) expect(choice.style).toBe(apiStyle(choice.kind));
  });

  it("round-trips header lines", () => {
    const headers = parseHeaderLines("x-client-id: lsc\n\nbad line\nx-team:  a:b ");
    expect(headers).toEqual({ "x-client-id": "lsc", "x-team": "a:b" });
    expect(parseHeaderLines(headerLines(headers))).toEqual(headers);
  });

  it("names the assistant Roz on every connection", () => {
    expect(ASSISTANT_NAME).toBe("Roz");
  });
});
