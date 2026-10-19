import { describe, it, expect } from "vitest";
import { isCompactToolbar, visibleBox } from "../../../src-renderer/components/studio/EditLayer";

// Node has no DOMRect; the clipping maths only reads left/top/right/bottom/x/y/width/height.
class Rect {
  constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number
  ) {}
  get left() { return this.x; }
  get top() { return this.y; }
  get right() { return this.x + this.width; }
  get bottom() { return this.y + this.height; }
}
(globalThis as { DOMRect?: unknown }).DOMRect ??= Rect;
const r = (x: number, y: number, w: number, h: number) => new Rect(x, y, w, h) as unknown as DOMRect;

describe("visibleBox", () => {
  const clip = r(0, 100, 400, 300);
  it("leaves a block inside the viewport alone", () => {
    expect(visibleBox({ box: r(10, 150, 100, 50), clip })).toMatchObject({ x: 10, y: 150, width: 100, height: 50 });
  });
  it("cuts a block scrolled up under the nav bar at the viewport's top", () => {
    expect(visibleBox({ box: r(10, 60, 100, 100), clip })).toMatchObject({ y: 100, height: 60 });
  });
  it("cuts a block running past the bottom", () => {
    expect(visibleBox({ box: r(10, 380, 100, 100), clip })).toMatchObject({ y: 380, height: 20 });
  });
  it("hides a block that is entirely outside", () => {
    expect(visibleBox({ box: r(10, 420, 100, 50), clip })).toBeNull();
    expect(visibleBox({ box: r(10, 20, 100, 50), clip })).toBeNull();
  });
});

describe("toolbar on a narrow surface", () => {
  it("goes icon-only on Side by side's half-size iPad, not on the full one", () => {
    expect(isCompactToolbar(360)).toBe(true);
    expect(isCompactToolbar(760)).toBe(false);
    expect(isCompactToolbar(0)).toBe(false);
  });
});
