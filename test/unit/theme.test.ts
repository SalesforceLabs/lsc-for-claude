import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({ nativeTheme: {}, BrowserWindow: {} }));

import { APP_THEMES, appTheme } from "../../src-electron/theme.js";
import { APP_THEMES as RENDERER_THEMES, appTheme as rendererAppTheme } from "../../src-renderer/theme.js";

describe("App appearance", () => {
  it("offers the same appearances in Settings as the main process applies", () => {
    expect(RENDERER_THEMES.map((theme) => theme.id)).toEqual([...APP_THEMES]);
  });

  it("follows the system for missing or unknown choices", () => {
    expect(appTheme(undefined)).toBe("system");
    expect(appTheme("sepia")).toBe("system");
    expect(appTheme("light")).toBe("light");
    expect(rendererAppTheme(undefined)).toBe("system");
    expect(rendererAppTheme("dark")).toBe("dark");
  });
});
