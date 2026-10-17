/** Intelligent Content grid (CLMGridViewController) — what the viewer's iPad shows. */

import type { ScreenContext } from "./context.js";

export interface PublishedContent {
  // Filled in by the screen's collector.
  placeholder?: never;
}

export async function collectContent(ctx: ScreenContext): Promise<PublishedContent | undefined> {
  void ctx;
  return undefined;
}
