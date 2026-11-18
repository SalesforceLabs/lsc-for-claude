/** Structural copy of PublishedInsights in src/studio/screens/insights/insights.ts. Keep equal by hand. */
export type InsightsPage =
  | "latest"
  | "trending"
  | "allChannels"
  | "myInsights"
  | "inProgress"
  | "myDrafts";

export interface PublishedInsightItem {
  id: string;
  title: string;
  subtitle: string;
  fullSubtitle: string;
  loggedBy: string;
  date: string;
  createdDate: string;
  lastModifiedDate: string;
  lastUpvotedDate: string | null;
  createdById: string;
  ownerId: string;
  upvoteCount: number;
  childCount: number;
  tags: string[];
  products: string[];
  status: string | null;
  ownedByMe: boolean;
}

export interface PublishedInsights {
  items: PublishedInsightItem[];
  pages: InsightsPage[];
  now: string;
  hideName: boolean;
  hideTags: boolean;
  hideProducts: boolean;
  finalStatus: string | null;
  draftStatus: string | null;
  inProgressStatuses: string[];
  viewerId: string;
  unavailable?: string[];
}
