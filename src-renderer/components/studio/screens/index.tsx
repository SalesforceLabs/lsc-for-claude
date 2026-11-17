import React from "react";
import type { PublishedIpad, PublishedTab } from "../published-types";
import AccountsScreen from "./AccountsScreen";
import CalendarScreen from "./CalendarScreen";
import ContentScreen from "./ContentScreen";
import TableauScreen from "./TableauScreen";
import MyTeamScreen from "./manager/MyTeamScreen";
import PlanReviewScreen from "./manager/PlanReviewScreen";
import SalesDataScreen from "./manager/SalesDataScreen";
import DashboardsScreen from "./manager/DashboardsScreen";
import ComplianceScreen from "./compliance/ComplianceScreen";
import InsightsScreen from "./insights/InsightsScreen";
import type { ScreenProps } from "./types";

/** Native screens drawn from live data, by tab kind. Each fills the page edge to edge (`.studio-ipad-page.native`). */
const SCREENS: Partial<Record<PublishedTab["kind"], { has: (s: PublishedIpad) => boolean; View: (p: ScreenProps) => React.ReactElement | null }>> = {
  content: { has: (s) => !!s.screens?.content, View: ContentScreen },
  accounts: { has: (s) => !!s.screens?.accounts, View: AccountsScreen },
  calendar: { has: (s) => !!s.screens?.calendar, View: CalendarScreen },
  tableau: { has: (s) => !!s.screens?.tableau, View: TableauScreen },
  myTeam: { has: (s) => !!s.screens?.myTeam, View: MyTeamScreen },
  activityPlanReview: { has: (s) => !!s.screens?.planReview, View: PlanReviewScreen },
  salesData: { has: (s) => !!s.screens?.salesData, View: SalesDataScreen },
  dashboards: { has: (s) => !!s.screens?.dashboards, View: DashboardsScreen },
  compliance: { has: (s) => !!s.screens?.compliance, View: ComplianceScreen },
  insights: { has: (s) => !!s.screens?.insights, View: InsightsScreen },
};

/** True when `tab` opens a native screen the snapshot has data for. */
export function hasNativeScreen(tab: PublishedTab | undefined, snapshot: PublishedIpad): boolean {
  return !!tab && !!SCREENS[tab.kind]?.has(snapshot);
}

export function NativeScreen({ tab, snapshot, onOpenRecord }: ScreenProps) {
  const s = SCREENS[tab.kind];
  return s ? <s.View tab={tab} snapshot={snapshot} onOpenRecord={onOpenRecord} /> : null;
}
