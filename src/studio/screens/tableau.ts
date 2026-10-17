/** Tableau Followed Metrics (LSCTableauViewController) — what the viewer's iPad shows. */

import type { ScreenContext } from "./context.js";

export interface PublishedTableau {
  // Filled in by the screen's collector.
  placeholder?: never;
}

export async function collectTableau(ctx: ScreenContext): Promise<PublishedTableau | undefined> {
  void ctx;
  return undefined;
}
