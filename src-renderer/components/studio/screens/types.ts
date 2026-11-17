import type { PublishedIpad, PublishedTab } from "../published-types";
import type { PublishedAccounts } from "./accounts-types";
import type { PublishedCalendar } from "./calendar-types";
import type { PublishedChrome } from "./chrome-types";
import type { PublishedContent } from "./content-types";
import type { PublishedFabs } from "./fabs-types";
import type { PublishedHome } from "./home-types";
import type { PublishedTableau } from "./tableau-types";
import type { PublishedVisit } from "../visit/visit-types";
import type { PublishedMyTeam } from "./manager/myTeam-types";
import type { PublishedPlanReview } from "./manager/planReview-types";
import type { PublishedSalesData } from "./manager/salesData-types";
import type { PublishedDashboards } from "./manager/dashboards-types";
import type { PublishedCompliance } from "./compliance/compliance-types";
import type { PublishedInsights } from "./insights/insights-types";
import type { PublishedKam } from "./kam/kam-types";

export type { PublishedAccounts, PublishedCalendar, PublishedChrome, PublishedContent, PublishedFabs, PublishedHome, PublishedTableau, PublishedVisit };

/** Structural copy of PublishedScreens in src/studio/screens/index.ts. */
export interface PublishedScreens {
  content?: PublishedContent;
  accounts?: PublishedAccounts;
  calendar?: PublishedCalendar;
  tableau?: PublishedTableau;
  fabs?: PublishedFabs;
  home?: PublishedHome;
  chrome?: PublishedChrome;
  visit?: PublishedVisit;
  myTeam?: PublishedMyTeam;
  planReview?: PublishedPlanReview;
  salesData?: PublishedSalesData;
  dashboards?: PublishedDashboards;
  compliance?: PublishedCompliance;
  insights?: PublishedInsights;
  kam?: PublishedKam;
}

export interface ScreenProps {
  tab: PublishedTab;
  snapshot: PublishedIpad;
  /** Opens a record (by id) in the record screen; the preview shows it over the screen. */
  onOpenRecord?: (id: string) => void;
}
