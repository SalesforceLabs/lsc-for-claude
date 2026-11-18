import { describe, it, expect } from "vitest";
import {
  gestureFor,
  layoutWidth,
  linkNote,
  NOT_IN_PRESENTATION,
  pageStep,
  QUIET_REQUESTS,
  resolveGoto,
  unknownRequest,
  unsupportedNote,
  type Drag,
} from "../../../../src-renderer/components/studio/screens/content-player-logic.js";
import type {
  ContentPlayerData,
  ContentPlayerSlide,
} from "../../../../src-renderer/components/studio/screens/content-player-types.js";

const slide = (
  index: number,
  pageId: string,
  pageIndex: number,
  name: string
): ContentPlayerSlide => ({
  index,
  pageId,
  pageName: `Page ${pageId}`,
  pageIndex,
  name,
  kind: "html",
  file: `${pageId}_v/${name}.mustache.html`,
  mandatory: false,
});

const data: ContentPlayerData = {
  base: "lsc-frame://clm/t/",
  presentation: {
    id: "1IG",
    name: "Deck",
    type: "HTML",
    gesture: "SwipeUp",
    pinchZoom: true,
    doubleTapZoom: true,
  },
  pages: [
    { id: "pA", name: "intro", sourceSystemIdentifier: "" },
    { id: "pB", name: "efficacy", sourceSystemIdentifier: "" },
  ],
  slides: [
    slide(0, "pA", 0, "01_a.html"),
    slide(1, "pA", 0, "02_b.html"),
    slide(2, "pB", 1, "01_c.html"),
    slide(3, "pB", 1, "02_d.html"),
  ],
  assets: [
    { pageId: "pPI", name: "isadditionalcontent_PI", title: "PI", files: ["asset_v/page-1.jpg"] },
  ],
  notes: [],
};

describe("resolveGoto", () => {
  it("opens an additional-content asset by name or id", () => {
    expect(resolveGoto(data, 0, "isadditionalcontent_PI", null)).toEqual({
      kind: "asset",
      asset: data.assets[0],
    });
    expect(resolveGoto(data, 0, "pPI", "x.html")).toMatchObject({ kind: "asset" });
  });
  it("finds the page by id or name, then the slide by file name, else the page's first", () => {
    expect(resolveGoto(data, 0, "pB", "02_d.html")).toEqual({ kind: "slide", index: 3 });
    expect(resolveGoto(data, 0, "efficacy", null)).toEqual({ kind: "slide", index: 2 });
    expect(resolveGoto(data, 0, "pB", "missing.html")).toEqual({ kind: "slide", index: 2 });
  });
  it("uses the current page when no page is given", () => {
    expect(resolveGoto(data, 3, null, "01_c.html")).toEqual({ kind: "slide", index: 2 });
    expect(resolveGoto(data, 1, null, null)).toEqual({ kind: "slide", index: 0 });
  });
  it("says so for a page that isn't in the presentation", () => {
    expect(resolveGoto(data, 0, "nope", null)).toEqual({
      kind: "error",
      message: NOT_IN_PRESENTATION,
    });
  });
});

describe("pageStep", () => {
  it("lands on the next or previous page's first slide, nowhere at the ends", () => {
    expect(pageStep(data, 1, 1)).toBe(2);
    expect(pageStep(data, 3, -1)).toBe(0);
    expect(pageStep(data, 3, 1)).toBeNull();
    expect(pageStep(data, 0, -1)).toBeNull();
  });
});

describe("gestureFor", () => {
  const base = {
    scale: 1,
    viewHeight: 800,
    gesture: "SwipeUp",
    menuShown: false,
    regions: [],
    sinceLastSwipeMs: 1000,
  };
  const drag = (d: Partial<Drag>): Drag => ({ x: 600, y: 400, dx: 0, dy: 0, ms: 150, ...d });

  it("turns a short horizontal swipe into next (leftwards) or previous", () => {
    expect(gestureFor(drag({ dx: -120 }), base)).toBe("next");
    expect(gestureFor(drag({ dx: 120 }), base)).toBe("prev");
  });
  it("ignores slow, long, steep, too-soon or no-swipe-region swipes", () => {
    expect(gestureFor(drag({ dx: -120, ms: 400 }), base)).toBeNull();
    expect(gestureFor(drag({ dx: -320 }), base)).toBeNull();
    expect(gestureFor(drag({ dx: -120, dy: 60 }), base)).toBeNull();
    expect(gestureFor(drag({ dx: -120 }), { ...base, sinceLastSwipeMs: 200 })).toBeNull();
    expect(
      gestureFor(drag({ dx: -120 }), {
        ...base,
        regions: [{ x: 500, y: 300, width: 200, height: 200 }],
      })
    ).toBeNull();
  });
  it("measures in the player's points, through the slide's scale", () => {
    // 200 document px at half scale is a 100 pt swipe; 700 px is 350 pt, too long.
    expect(gestureFor(drag({ dx: -200 }), { ...base, scale: 0.5 })).toBe("next");
    expect(gestureFor(drag({ dx: -700 }), { ...base, scale: 0.5 })).toBeNull();
  });
  it("shows the bar from the gesture's area and hides it on any tap", () => {
    expect(gestureFor(drag({ y: 790, dy: -80 }), base)).toBe("showMenu");
    expect(gestureFor(drag({ y: 400, dy: -80 }), base)).toBeNull();
    expect(gestureFor(drag({ y: 10, dy: 80 }), { ...base, gesture: "SwipeDown" })).toBe("showMenu");
    expect(gestureFor(drag({ y: 790 }), { ...base, gesture: "TapBottom" })).toBe("showMenu");
    expect(gestureFor(drag({ y: 10 }), { ...base, gesture: "TapTop" })).toBe("showMenu");
    expect(gestureFor(drag({ y: 790 }), base)).toBeNull();
    expect(gestureFor(drag({}), { ...base, menuShown: true })).toBe("hideMenu");
  });
});

describe("layoutWidth", () => {
  it("follows the viewport tag like WebKit", () => {
    expect(layoutWidth(1024, 1194)).toBe(1024);
    expect(layoutWidth(null, 1194)).toBe(1194);
    expect(layoutWidth(0, 1194)).toBe(980);
  });
});

describe("slide requests", () => {
  it("explains what only the iPad does, stays quiet on tracking, and alerts on the unknown", () => {
    expect(unsupportedNote("fetchWithParams")).toMatch(/offline data/);
    expect(unsupportedNote("upsert")).toMatch(/doesn't save/);
    expect(unsupportedNote("gotoSlide")).toBeNull();
    expect(QUIET_REQUESTS.has("trackInteraction")).toBe(true);
    expect(unknownRequest("fly")).toBe("Intelligent Content: Cannot parse the request type: fly");
  });
  it("says where a link would open", () => {
    expect(linkNote("https://www.example.com/pi.pdf")).toBe(
      "On the iPad this opens www.example.com full screen."
    );
    expect(linkNote("tel:5551234")).toBe("On the iPad this opens tel on the device.");
  });
});
