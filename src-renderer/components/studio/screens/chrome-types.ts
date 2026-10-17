/** Structural copy of PublishedChrome in src/studio/screens/chrome.ts. */
export type AlertPill = "alerts" | "recommendations" | "guidedActions";

export interface PublishedAlert {
  id: string;
  title: string;
  /** HTML with only `<a>` links (escaped otherwise). */
  body: string;
  when: string;
  pill: AlertPill;
}

export interface PublishedChrome {
  alerts: PublishedAlert[];
  profile: { username: string; territory: string | null; synced: string | null };
}
