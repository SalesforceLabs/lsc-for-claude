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
  nbc?: { cards: HomeNbcCard[]; lastRefreshed: string; lastRefreshedSource?: string };
  visits?: { total: number; items: HomeVisit[] };
  plan?: { cycle?: string; activityType?: string };
}

/** UIPageControl window: up to 9 dots, the ones at a clipped edge shrink (one more page than shown in that direction). */
export function pageDots(count: number, page: number, slots = 9): { index: number; on: boolean; small: boolean }[] {
  if (count <= 1) return [];
  const shown = Math.min(count, slots);
  const start = count <= slots ? 0 : Math.max(0, Math.min(page - Math.floor(slots / 2) + 1, count - shown));
  return Array.from({ length: shown }, (_, k) => {
    const index = start + k;
    const clipped = (k === 0 && start > 0) || (k === shown - 1 && start + shown < count);
    return { index, on: index === page, small: clipped && index !== page };
  });
}
