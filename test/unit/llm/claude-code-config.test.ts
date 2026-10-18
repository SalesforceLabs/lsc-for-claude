import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { detectClaudeCodeGateway, parseCustomHeaders } from "../../../src-electron/llm/claude-code-config.js";

const dirs: string[] = [];
function settingsFile(content: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-settings-"));
  dirs.push(dir);
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, JSON.stringify(content));
  return file;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("detectClaudeCodeGateway", () => {
  it("reads the gateway, helper, and headers from Claude Code settings", () => {
    const file = settingsFile({
      env: {
        ANTHROPIC_BASE_URL: "https://gw.example.com/",
        ANTHROPIC_CUSTOM_HEADERS: "x-client-id: claude\nx-team: lsc",
      },
      apiKeyHelper: "/usr/bin/get-token --gateway",
    });
    expect(detectClaudeCodeGateway({}, file)).toEqual({
      baseUrl: "https://gw.example.com/",
      authToken: undefined,
      apiKeyHelper: "/usr/bin/get-token --gateway",
      authHeader: "x-api-key",
      headers: { "x-client-id": "claude", "x-team": "lsc" },
    });
  });

  it("falls back to the Bedrock base URL, left for the provider to normalize", () => {
    const file = settingsFile({ env: { ANTHROPIC_BEDROCK_BASE_URL: "https://gw.example.com/bedrock" }, apiKeyHelper: "tok" });
    expect(detectClaudeCodeGateway({}, file)?.baseUrl).toBe("https://gw.example.com/bedrock");
  });

  it("lets the environment override the file and a static token replace the helper", () => {
    const file = settingsFile({ env: { ANTHROPIC_BASE_URL: "https://file.example.com" }, apiKeyHelper: "tok" });
    const gateway = detectClaudeCodeGateway(
      { ANTHROPIC_BASE_URL: "https://env.example.com", ANTHROPIC_AUTH_TOKEN: "secret" },
      file
    );
    expect(gateway).toMatchObject({
      baseUrl: "https://env.example.com",
      authToken: "secret",
      apiKeyHelper: undefined,
      authHeader: "bearer",
    });
  });

  it("sends ANTHROPIC_API_KEY as x-api-key, as Claude Code does", () => {
    const file = settingsFile({ env: { ANTHROPIC_BASE_URL: "https://gw.example.com", ANTHROPIC_API_KEY: "key" } });
    expect(detectClaudeCodeGateway({}, file)).toMatchObject({ authToken: "key", authHeader: "x-api-key" });
  });

  it("is null without a URL or without a way to get a token", () => {
    expect(detectClaudeCodeGateway({}, settingsFile({ apiKeyHelper: "tok" }))).toBeNull();
    expect(detectClaudeCodeGateway({}, settingsFile({ env: { ANTHROPIC_BASE_URL: "https://gw.example.com" } }))).toBeNull();
    expect(detectClaudeCodeGateway({}, path.join(os.tmpdir(), "missing-cc-settings.json"))).toBeNull();
  });
});

describe("helpers", () => {
  it("parses header lines, ignoring blanks and lines without a name", () => {
    expect(parseCustomHeaders("a: 1\n\n: nope\nb:two:parts")).toEqual({ a: "1", b: "two:parts" });
    expect(parseCustomHeaders(undefined)).toEqual({});
  });
});
