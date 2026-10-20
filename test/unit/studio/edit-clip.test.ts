import { describe, it, expect } from "vitest";
import { compactInline, isCompactToolbar, placeToolbar, shiftOnto, tagSpot, visibleBox } from "../../../src-renderer/components/studio/EditLayer";

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

  it("keeps one row and puts what doesn't fit under More", () => {
    expect(compactInline(4, 360)).toBe(4);
    // 190 px fits 5 buttons: 4 inline plus More.
    expect(compactInline(9, 190)).toBe(4);
    expect(compactInline(5, 190)).toBe(5);
    expect(compactInline(3, 20)).toBe(0);
  });
});

describe("toolbar placement", () => {
  // The iPad's screen, in the surface's coordinates.
  const screen = r(0, 0, 1000, 640);

  it("goes above a block with room above it", () => {
    expect(placeToolbar(r(100, 300, 200, 40), screen)).toEqual({ top: 292, below: false });
  });

  it("measures against the screen, not a record tab strip that clips to one tab's height", () => {
    // The tab is the strip's full height; against the strip there'd be no room either side.
    const tab = r(580, 214, 120, 30);
    const placed = placeToolbar(tab, screen);
    expect(placed.below).toBe(false);
    expect(placed.top).toBeLessThanOrEqual(tab.top);
  });

  it("goes below a block at the top of the screen", () => {
    expect(placeToolbar(r(100, 20, 200, 40), screen)).toEqual({ top: 68, below: true });
  });

  it("never covers the selection when either side has room", () => {
    for (const y of [0, 30, 51, 52, 200, 500, 548, 600]) {
      const box = r(100, y, 200, 40);
      const { top, below } = placeToolbar(box, screen);
      const bar = below ? r(100, top, 300, 44) : r(100, top - 44, 300, 44);
      expect(bar.bottom <= box.top || bar.top >= box.bottom).toBe(true);
    }
  });

  it("slides a toolbar anchored to a block's right edge back onto the screen", () => {
    // A 540 px toolbar right-aligned to a tab ending at 500 would start at -40.
    expect(shiftOnto(500 - 540, 540, screen)).toBe(4);
    expect(shiftOnto(900, 200, screen)).toBe(796);
    expect(shiftOnto(300, 200, screen)).toBe(300);
  });

  it("pins to the screen's top edge only for a block with no room on either side", () => {
    expect(placeToolbar(r(0, 10, 1000, 620), screen)).toEqual({ top: 8, below: true });
  });
});

describe("hover label placement", () => {
  const clip = r(0, 0, 1000, 640);

  it("sits above the block by default", () => {
    expect(tagSpot(r(100, 200, 120, 30), clip, 100, [])).toBe("above");
  });

  it("tucks inside at the viewport's top edge", () => {
    expect(tagSpot(r(100, 5, 120, 30), clip, 100, [])).toBe("inside");
  });

  it("moves inside when the toolbar is where it would go", () => {
    const toolbar = r(80, 150, 400, 44);
    expect(tagSpot(r(100, 200, 120, 30), clip, 100, [toolbar])).toBe("inside");
  });

  it("isn't drawn when every spot covers the toolbar or the selection", () => {
    const toolbar = r(80, 170, 400, 60);
    expect(tagSpot(r(100, 200, 120, 30), clip, 100, [toolbar])).toBeNull();
  });

  it("keeps off a selected block just above it", () => {
    const selected = r(100, 160, 120, 30);
    expect(tagSpot(r(100, 192, 120, 30), clip, 100, [selected])).toBe("inside");
  });

  it("goes beside an action capsule when there's room on its left", () => {
    expect(tagSpot(r(400, 200, 40, 40), clip, 120, [], true)).toBe("beside");
    expect(tagSpot(r(100, 200, 40, 40), clip, 120, [], true)).toBe("above");
  });
});
