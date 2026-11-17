/** Medical Insights feed rules, ported from lifesciences-ios (OCE/Classes/Insights). Pure. */

export type InsightsPage =
  | "latest"
  | "trending"
  | "allChannels"
  | "myInsights"
  | "inProgress"
  | "myDrafts";

/** InsightsCoordinator.feedPages: In Progress and My Drafts appear only when Admin Console maps the status. */
export function feedPages(
  draftStatus: string | null,
  inProgressStatuses: string[]
): InsightsPage[] {
  const pages: InsightsPage[] = ["latest", "trending", "allChannels", "myInsights"];
  if (inProgressStatuses.length) pages.push("inProgress");
  if ((draftStatus ?? "").trim()) pages.push("myDrafts");
  return pages;
}

/** LSCDBInsightSettings.inProgressStatuses: a multipicklist, semicolon- or comma-separated. */
export function splitStatuses(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** InsightsUseCase.makeInsightsPageItem: the card shows 252 characters and an ellipsis once the text passes 255. */
export function subtitleOf(full: string): string {
  return full.length > 255 ? `${full.slice(0, 252)}…` : full;
}

/** LSCDBInsightModel.tagNames: TopicNames holds one subject per line. */
export function tagNames(topicNames: unknown): string[] {
  return typeof topicNames === "string"
    ? topicNames
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
}
