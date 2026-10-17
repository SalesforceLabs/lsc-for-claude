/** Accounts tab (SearchFilterCustomersViewController) — what the viewer's iPad shows. */

import type { ScreenContext } from "./context.js";

export interface PublishedAccounts {
  // Filled in by the screen's collector.
  placeholder?: never;
}

export async function collectAccounts(ctx: ScreenContext): Promise<PublishedAccounts | undefined> {
  void ctx;
  return undefined;
}
