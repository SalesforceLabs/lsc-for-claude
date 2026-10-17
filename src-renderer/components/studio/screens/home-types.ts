// Structural copy of PublishedHome in src/studio/screens/home.ts — the renderer bundle cannot import from src/. Keep in sync.

export interface HomeNbcCard {
  accountId: string;
  name: string;
  specialty: string;
  address: string;
  target: boolean;
  lastVisit: string;
  score: number | null;
  insight: string;
  planProgress: number | null;
}

export interface HomeVisit {
  id: string;
  dateLabel: string;
  time: string;
  account: string;
  address: string;
  channel: string;
  attendees: string;
}

export interface PublishedHome {
  nbc?: { cards: HomeNbcCard[]; lastRefreshed: string };
  visits?: { total: number; items: HomeVisit[] };
  plan?: { cycle?: string; activityType?: string };
}
