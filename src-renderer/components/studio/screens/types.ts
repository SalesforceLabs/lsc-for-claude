import type { PublishedIpad, PublishedTab } from "../published-types";
import type { PublishedAccounts } from "./accounts-types";
import type { PublishedCalendar } from "./calendar-types";
import type { PublishedContent } from "./content-types";
import type { PublishedFabs } from "./fabs-types";
import type { PublishedTableau } from "./tableau-types";

export type { PublishedAccounts, PublishedCalendar, PublishedContent, PublishedFabs, PublishedTableau };

/** Structural copy of PublishedScreens in src/studio/screens/index.ts. */
export interface PublishedScreens {
  content?: PublishedContent;
  accounts?: PublishedAccounts;
  calendar?: PublishedCalendar;
  tableau?: PublishedTableau;
  fabs?: PublishedFabs;
}

export interface ScreenProps {
  tab: PublishedTab;
  snapshot: PublishedIpad;
  /** Opens a record (by id) in the record screen; the preview shows it over the screen. */
  onOpenRecord?: (id: string) => void;
}
