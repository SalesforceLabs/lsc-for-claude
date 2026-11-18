import { describe, it, expect } from "vitest";
import {
  gestureOf,
  safeEntries,
  slideFiles,
  thumbnailFor,
} from "../../../../src/studio/screens/content-player.js";
import { renderSlideTemplate } from "../../../../src/studio/screens/mustache-lite.js";
import {
  CLM_BRIDGE_FILE,
  CLM_BRIDGE_JS,
  injectBridgeTag,
} from "../../../../src/studio/screens/clm-bridge.js";

describe("page folders", () => {
  it("takes top-level .html files in name order, not the rendered copies", () => {
    expect(
      slideFiles([
        "02_b.html",
        "01_a.html",
        "01_a.html.mustache.html",
        "style.css",
        "01_thumbnail.jpg",
      ])
    ).toEqual(["01_a.html", "02_b.html"]);
  });
  it("names thumbnails after the slide's prefix", () => {
    expect(thumbnailFor("02_intro.html")).toBe("02_thumbnail.jpg");
    expect(thumbnailFor("index.html")).toBe("index.html_thumbnail.jpg");
  });
  it("normalizes the gesture and defaults to SwipeUp", () => {
    expect(gestureOf("Tap Bottom")).toBe("TapBottom");
    expect(gestureOf("swipe_down")).toBe("SwipeDown");
    expect(gestureOf(null)).toBe("SwipeUp");
    expect(gestureOf("sideways")).toBe("SwipeUp");
  });
  it("refuses ZIP entries that leave the folder", () => {
    expect(safeEntries(["a/b.html", "c.js"])).toBe(true);
    expect(safeEntries(["../x"])).toBe(false);
    expect(safeEntries(["a/../../x"])).toBe(false);
    expect(safeEntries(["/etc/x"])).toBe(false);
    expect(safeEntries(["C:/x"])).toBe(false);
    expect(safeEntries(["a\\..\\x"])).toBe(false);
    expect(safeEntries(Array.from({ length: 2001 }, (_, i) => `f${i}`))).toBe(false);
  });
});

describe("renderSlideTemplate", () => {
  const data = {
    user: { name: "Carmen <C>" },
    customers: [],
    presentations: [{ name: "Deck", pages: [{ id: "p1" }, { id: "p2" }] }],
  };
  it("leaves plain slides alone", () => {
    expect(renderSlideTemplate("<p>x</p>", data)).toBe("<p>x</p>");
  });
  it("escapes, keeps raw, and walks sections", () => {
    expect(renderSlideTemplate("{{user.name}}|{{{user.name}}}|{{& user.name}}", data)).toBe(
      "Carmen &lt;C&gt;|Carmen <C>|Carmen <C>"
    );
    expect(
      renderSlideTemplate(
        "{{#presentations}}{{name}}:{{#pages}}[{{id}}]{{/pages}}{{/presentations}}",
        data
      )
    ).toBe("Deck:[p1][p2]");
    expect(
      renderSlideTemplate("{{#customers}}x{{/customers}}{{^customers}}none{{/customers}}", data)
    ).toBe("none");
    expect(renderSlideTemplate("a{{! note }}b", data)).toBe("ab");
  });
  it("puts the data in as JSON for {{{.}}}", () => {
    const out = renderSlideTemplate("let all = {{{.}}};", data);
    expect(JSON.parse(out.slice("let all = ".length, -1))).toEqual(data);
  });
});

describe("injectBridgeTag", () => {
  it("puts the player script first in <head>", () => {
    const out = injectBridgeTag('<html><head><script src="app.js"></script></head></html>');
    expect(out.indexOf(CLM_BRIDGE_FILE)).toBeGreaterThan(0);
    expect(out.indexOf(CLM_BRIDGE_FILE)).toBeLessThan(out.indexOf("app.js"));
  });
  it("adds it to a slide with no <head>", () => {
    expect(injectBridgeTag("<p>x</p>")).toContain(CLM_BRIDGE_FILE);
  });
  it("defines PresentationPlayer", () => {
    expect(CLM_BRIDGE_JS).toContain("PresentationPlayer");
    expect(() => new Function(CLM_BRIDGE_JS)).not.toThrow();
  });
});
