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

export interface PublishedCardAction {
  name: string;
  label: string;
  recordTypes: string[];
}

export interface PublishedChrome {
  cardActions: PublishedCardAction[];
  alerts: PublishedAlert[];
  profile: { username: string; territory: string | null; synced: string | null };
}
