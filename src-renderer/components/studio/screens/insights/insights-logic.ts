import type { InsightsPage, PublishedInsightItem, PublishedInsights } from "./insights-types";

export const PAGE_TITLES: Record<InsightsPage, string> = {
  latest: "Latest",
  trending: "Trending",
  allChannels: "All Insights",
  myInsights: "My Insights",
  inProgress: "In Progress",
  myDrafts: "My Drafts",
};

export type InsightSort =
  | "dateDescending"
  | "lastUpdatedDateDescending"
  | "mostLiked"
  | "nameDescending";

/** InsightSortOption.allCases, with Name left out when Admin Console hides it from the feed. */
export function sortOptions(hideName: boolean): { id: InsightSort; label: string }[] {
  const all: { id: InsightSort; label: string }[] = [
    { id: "dateDescending", label: "Created Date" },
    { id: "lastUpdatedDateDescending", label: "Last Modified Date" },
    { id: "mostLiked", label: "Most Liked" },
    { id: "nameDescending", label: "Name" },
  ];
  return hideName ? all.filter((o) => o.id !== "nameDescending") : all;
}

/** InsightsCoordinator.defaultSortOption: Created Date, except Trending which starts on Most Liked. */
export function defaultSort(page: InsightsPage): InsightSort {
  return page === "trending" ? "mostLiked" : "dateDescending";
}

const DAY = 86400000;

/**
 * InsightsUseCase.filter(for:) and InsightsRepository.buildBaseCondition. Latest, Trending, All and My Insights keep
 * final-status and no-status insights; My Drafts matches the draft status exactly (owner's own), In Progress the mapped ones.
 */
export function insightsForPage(
  data: PublishedInsights,
  page: InsightsPage,
  inProgress: string | null
): PublishedInsightItem[] {
  const cutoff = Date.parse(data.now) - 30 * DAY;
  const finalOk = (i: PublishedInsightItem) =>
    !data.finalStatus || i.status === null || i.status === data.finalStatus;
  return data.items.filter((i) => {
    switch (page) {
      case "latest":
        return Date.parse(i.createdDate) > cutoff && finalOk(i);
      case "trending":
        return (
          [i.lastModifiedDate, i.lastUpvotedDate].some((d) => d && Date.parse(d) > cutoff) &&
          finalOk(i)
        );
      case "allChannels":
        return finalOk(i);
      case "myInsights":
        return i.createdById === data.viewerId && finalOk(i);
      case "myDrafts":
        return i.ownerId === data.viewerId && !!data.draftStatus && i.status === data.draftStatus;
      case "inProgress": {
        const wanted = inProgress ? [inProgress] : data.inProgressStatuses;
        return i.status !== null && wanted.includes(i.status);
      }
    }
  });
}

/** InsightsRepository.buildSearchCondition: name (unless hidden), content, tags, products and who logged it. */
export function searchInsights(
  items: PublishedInsightItem[],
  text: string,
  data: Pick<PublishedInsights, "hideName" | "hideTags" | "hideProducts">
): PublishedInsightItem[] {
  const q = text.trim().toLowerCase();
  if (!q) return items;
  const has = (v: string) => v.toLowerCase().includes(q);
  return items.filter(
    (i) =>
      (!data.hideName && has(i.title)) ||
      has(i.fullSubtitle) ||
      (!data.hideTags && i.tags.some(has)) ||
      (!data.hideProducts && i.products.some(has)) ||
      has(i.loggedBy)
  );
}

export function sortInsights(
  items: PublishedInsightItem[],
  sort: InsightSort
): PublishedInsightItem[] {
  const out = [...items];
  const byDate =
    (key: "createdDate" | "lastModifiedDate") =>
    (a: PublishedInsightItem, b: PublishedInsightItem) =>
      (b[key] ?? "").localeCompare(a[key] ?? "");
  if (sort === "dateDescending") out.sort(byDate("createdDate"));
  else if (sort === "lastUpdatedDateDescending") out.sort(byDate("lastModifiedDate"));
  else if (sort === "mostLiked")
    out.sort((a, b) => b.upvoteCount - a.upvoteCount || byDate("createdDate")(a, b));
  else out.sort((a, b) => b.title.localeCompare(a.title));
  return out;
}
