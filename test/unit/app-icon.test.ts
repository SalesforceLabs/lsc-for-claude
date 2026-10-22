import fs from "fs";
import path from "path";
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, nativeImage: {} }));

import { ROZ_ICONS, rozIcon } from "../../src-electron/app-icon.js";
import { ROZ_ICONS as RENDERER_ICONS, rozIcon as rendererRozIcon } from "../../src-renderer/app-icon.js";

describe("Roz app icons", () => {
  it("offers the same icons in Settings as the main process applies", () => {
    expect(RENDERER_ICONS.map((icon) => icon.id)).toEqual([...ROZ_ICONS]);
  });

  it("has a dock icon and a tile for every choice", () => {
    const dir = path.join(__dirname, "..", "..", "src-renderer", "public", "roz");
    for (const id of ROZ_ICONS) {
      expect(fs.existsSync(path.join(dir, `${id}.png`)), `${id}.png`).toBe(true);
      expect(fs.existsSync(path.join(dir, `tile-${id}.png`)), `tile-${id}.png`).toBe(true);
    }
  });

  it("falls back to the default for missing or unknown choices", () => {
    expect(rozIcon(undefined)).toBe("bold");
    expect(rozIcon("rainbow")).toBe("bold");
    expect(rozIcon("happy")).toBe("happy");
    expect(rendererRozIcon(undefined)).toBe("bold");
    expect(rendererRozIcon("closeup")).toBe("closeup");
  });
});
