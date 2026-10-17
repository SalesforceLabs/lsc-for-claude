import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {}, app: { getPath: () => "/tmp" } }));
const loadSettings = vi.fn();
vi.mock("../../src-electron/settings.js", () => ({ loadSettings: () => loadSettings() }));

import { mobileClientId } from "../../src-electron/mobile-login.js";

describe("mobileClientId", () => {
  const saved = process.env.LSC_MOBILE_CLIENT_ID;
  beforeEach(() => {
    delete process.env.LSC_MOBILE_CLIENT_ID;
    loadSettings.mockReturnValue({});
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.LSC_MOBILE_CLIENT_ID;
    else process.env.LSC_MOBILE_CLIENT_ID = saved;
  });

  it("prefers the saved setting over the env var, trimmed", () => {
    loadSettings.mockReturnValue({ mobileClientId: "  setting-key  " });
    process.env.LSC_MOBILE_CLIENT_ID = "env-key";
    expect(mobileClientId()).toBe("setting-key");
  });

  it("falls back to the env var when the setting is blank", () => {
    loadSettings.mockReturnValue({ mobileClientId: "   " });
    process.env.LSC_MOBILE_CLIENT_ID = " env-key ";
    expect(mobileClientId()).toBe("env-key");
  });

  it("points at Settings when nothing is configured", () => {
    expect(() => mobileClientId()).toThrow(/Settings/);
  });

  it("reads settings on every call", () => {
    loadSettings.mockReturnValue({ mobileClientId: "a" });
    expect(mobileClientId()).toBe("a");
    loadSettings.mockReturnValue({ mobileClientId: "b" });
    expect(mobileClientId()).toBe("b");
  });
});
