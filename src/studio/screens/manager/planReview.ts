/**
 * Activity plan review (lifesciences-ios ActivityPlanReviewCoordinator). The
 * device opens the tab as a web view: `<instance>/secur/frontdoor.jsp?sid=…&retURL=/lightning/n/<tab>`
 * in a modal titled with the tab's label. There is nothing native to read, so
 * the screen says so; the tab's label and path come from the renderer's tab.
 */

import type { ScreenContext } from "../context.js";
import { orgApiVersionDetails } from "../../../salesforce/cli.js";

export interface PublishedPlanReview {
  /** The device loads a Lightning page in a web view as the rep. */
  webView: true;
  /** The org's https instance URL, for building the page address; absent when the org didn't report one. */
  instanceUrl?: string;
}

export async function collectPlanReview(
  ctx: ScreenContext
): Promise<PublishedPlanReview | undefined> {
  const details = await orgApiVersionDetails(ctx.org).catch(() => null);
  const url = details?.instanceUrl ?? "";
  return /^https:\/\//i.test(url)
    ? { webView: true, instanceUrl: url.replace(/\/$/, "") }
    : { webView: true };
}
