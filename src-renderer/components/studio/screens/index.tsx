import React from "react";
import type { PublishedIpad, PublishedTab } from "../published-types";
import AccountsScreen from "./AccountsScreen";
import CalendarScreen from "./CalendarScreen";
import ContentScreen from "./ContentScreen";
import TableauScreen from "./TableauScreen";
import type { ScreenProps } from "./types";

/** Native screens drawn from live data, by tab kind. Each fills the page edge to edge (`.studio-ipad-page.native`). */
const SCREENS: Partial<Record<PublishedTab["kind"], { has: (s: PublishedIpad) => boolean; View: (p: ScreenProps) => React.ReactElement | null }>> = {
  content: { has: (s) => !!s.screens?.content, View: ContentScreen },
  accounts: { has: (s) => !!s.screens?.accounts, View: AccountsScreen },
  calendar: { has: (s) => !!s.screens?.calendar, View: CalendarScreen },
  tableau: { has: (s) => !!s.screens?.tableau, View: TableauScreen },
};

/** True when `tab` opens a native screen the snapshot has data for. */
export function hasNativeScreen(tab: PublishedTab | undefined, snapshot: PublishedIpad): boolean {
  return !!tab && !!SCREENS[tab.kind]?.has(snapshot);
}

export function NativeScreen({ tab, snapshot, onOpenRecord }: ScreenProps) {
  const s = SCREENS[tab.kind];
  return s ? <s.View tab={tab} snapshot={snapshot} onOpenRecord={onOpenRecord} /> : null;
}
