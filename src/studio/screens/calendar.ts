/** Planner (PlannerContainerViewController) — what the viewer's iPad shows. */

import type { ScreenContext } from "./context.js";

export interface PublishedCalendar {
  // Filled in by the screen's collector.
  placeholder?: never;
}

export async function collectCalendar(ctx: ScreenContext): Promise<PublishedCalendar | undefined> {
  void ctx;
  return undefined;
}
