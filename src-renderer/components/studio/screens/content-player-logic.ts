/**
 * The CLM player's rules, from lifesciences-ios module/CLM: where gotoSlide and the page moves land
 * (CLMPageViewController, SlideRequestHandler), when a drag on the slide is a swipe
 * (GesturesExtension+PresentationViewController.swift: RefinedSwipeConfig, gesture areas) and what
 * the slide's API calls do in the preview. Pure, so it's tested without a frame.
 */

import type { ContentPlayerAsset, ContentPlayerData } from "./content-player-types";

export type GotoResult =
  | { kind: "slide"; index: number }
  | { kind: "asset"; asset: ContentPlayerAsset }
  | { kind: "error"; message: string };

/** The app's message when gotoSlide names a page the presentation doesn't have. */
export const NOT_IN_PRESENTATION =
  "The page can't be accessed because it's not part of the current presentation.";

/**
 * Where `gotoSlide(pageId, slideName)` lands: an additional-content asset named (or with the id) `pageId`;
 * else the page with that id or name (null: the current page), at the slide with that file name, or the
 * page's first slide.
 */
export function resolveGoto(
  data: ContentPlayerData,
  current: number,
  pageId: string | null,
  slideName: string | null
): GotoResult {
  if (pageId) {
    const asset = data.assets.find((a) => a.name === pageId || a.pageId === pageId);
    if (asset) return { kind: "asset", asset };
  }
  const here = data.slides[current];
  const page =
    pageId == null
      ? here?.pageId
      : data.pages.find((p) => p.id === pageId || p.name === pageId)?.id;
  const onPage = data.slides.filter((s) => s.pageId === page);
  if (!page || !onPage.length) return { kind: "error", message: NOT_IN_PRESENTATION };
  const slide = (slideName && onPage.find((s) => s.name === slideName)) || onPage[0];
  return { kind: "slide", index: slide.index };
}

/** The first slide of the next (`step` 1) or previous (-1) page, or null at either end. */
export function pageStep(data: ContentPlayerData, current: number, step: 1 | -1): number | null {
  const here = data.slides[current];
  if (!here) return null;
  const target = here.pageIndex + step;
  const first = data.slides.find((s) => s.pageIndex === target);
  return first ? first.index : null;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A pointer drag on the slide, in the slide document's CSS pixels. */
export interface Drag {
  x: number;
  y: number;
  dx: number;
  dy: number;
  ms: number;
}

export type GestureAction = "next" | "prev" | "showMenu" | "hideMenu" | null;

/** Swipe limits (RefinedSwipeConfig) and the share of the view the top and bottom gesture areas take (Coefficent). */
export const SWIPE = {
  maxHorizontal: 300,
  maxVertical: 50,
  maxMs: 300,
  minGapMs: 300,
  edge: 0.06,
} as const;
/** Movement before UIKit's pan starts (and below which a touch is a tap). */
const SLOP = 10;
/** UISwipeGestureRecognizer's distance for an up or down swipe. */
const VERTICAL_SWIPE = 50;

/**
 * What a drag does, as the player's tap, swipe and pan recognizers decide (all three run together):
 * a tap hides the bar when it's up, or shows it in the gesture's top or bottom area (`TapTop` / `TapBottom`);
 * a short up/down swipe from the bottom/top area shows it (`SwipeUp` / `SwipeDown`); a short horizontal pan
 * outside the slide's no-swipe regions goes to the next (leftwards) or previous slide.
 * `scale` turns document pixels into the player view's points; `viewHeight` is the view in points.
 */
export function gestureFor(
  drag: Drag,
  opts: {
    scale: number;
    viewHeight: number;
    gesture: string;
    menuShown: boolean;
    regions: Region[];
    sinceLastSwipeMs: number;
  }
): GestureAction {
  const x = drag.x * opts.scale;
  const y = drag.y * opts.scale;
  const dx = drag.dx * opts.scale;
  const dy = drag.dy * opts.scale;
  const top = y < opts.viewHeight * SWIPE.edge;
  const bottom = y > opts.viewHeight * (1 - SWIPE.edge);
  if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) {
    if (opts.menuShown) return "hideMenu";
    if ((bottom && opts.gesture === "TapBottom") || (top && opts.gesture === "TapTop"))
      return "showMenu";
    return null;
  }
  if (Math.abs(dy) >= VERTICAL_SWIPE && Math.abs(dy) > Math.abs(dx)) {
    if (dy < 0 && bottom && opts.gesture === "SwipeUp") return "showMenu";
    if (dy > 0 && top && opts.gesture === "SwipeDown") return "showMenu";
  }
  const inRegion = opts.regions.some(
    (r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
  );
  if (
    Math.abs(dx) >= SLOP &&
    drag.ms <= SWIPE.maxMs &&
    opts.sinceLastSwipeMs > SWIPE.minGapMs &&
    !inRegion &&
    Math.abs(dx) <= SWIPE.maxHorizontal &&
    Math.abs(dy) <= SWIPE.maxVertical
  )
    return dx < 0 ? "next" : "prev";
  return null;
}

/** The width a slide lays out at in a WKWebView: its viewport meta width, else `device-width` (0), else WebKit's 980. */
export function layoutWidth(reported: number | null, viewWidth: number): number {
  if (reported == null) return viewWidth;
  return reported > 0 ? reported : 980;
}

/** What the preview says when a slide asks for something only the iPad does. Null: handled, or nothing to say. */
export function unsupportedNote(request: string): string | null {
  switch (request) {
    case "fetchWithParams":
      return "This slide reads records from the iPad's offline data. The preview doesn't run slide queries, so that part stays empty.";
    case "upsert":
    case "createVisit":
      return "This slide saves records on the iPad. The preview doesn't save anything.";
    case "getSurveyFlowJson":
    case "setSurveyFlowJson":
      return "This slide runs a survey. Surveys inside slides only run on the iPad.";
    case "launchApprovedEmail":
    case "launchEmails":
      return "This slide opens an approved email on the iPad. The preview doesn't send email.";
    case "updateFeedback":
      return "This slide records the rep's rating. The preview doesn't save ratings.";
    default:
      return null;
  }
}

/** Requests the player takes without a word in the preview (tracking runs when a visit is saved; nothing is saved here). */
export const QUIET_REQUESTS = new Set([
  "startTrackingPage",
  "stopTrackingPage",
  "trackInteraction",
  "saveState",
  "logError",
  "pauseVideoPlayback",
]);

/** The app's alert for a request it doesn't know (SlideRequestParser). */
export const unknownRequest = (request: string) =>
  `Intelligent Content: Cannot parse the request type: ${request}`;

/** `__link` taps: what the app would do with the link. */
export function linkNote(href: string): string {
  if (/^(tel|mailto|sms):/i.test(href))
    return `On the iPad this opens ${href.replace(/:.*/, "")} on the device.`;
  try {
    const u = new URL(href);
    if (u.protocol === "lsc-frame:")
      return "On the iPad this opens a file from the presentation full screen.";
    return `On the iPad this opens ${u.host || href} full screen.`;
  } catch {
    return `On the iPad this opens ${href} full screen.`;
  }
}
