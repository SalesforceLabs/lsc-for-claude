/**
 * What taking a tab out of the app's bar breaks on the iPad, so the review dialog can say so.
 *
 * Source of truth: the lifesciences-ios client. `OCE/Classes/DeepLink/DeepLinkNavigation.swift`
 * (`Tab.Custom`) maps a tab's name to the screen it opens: `standard-home` to Home, `Planner` to
 * the calendar planner, `Accounts` / `Customers` / `AccountFilter` to the accounts list,
 * `SalesData` / `Reports` to reports, `CLM` to Intelligent Content and `MyTeamTab` to My Team;
 * other tabs match by their id, or — for an object's tab — by object (`lightningObject` links).
 * `OCEDemo/Tabs/TabsCoordinator.swift` (`tabsModuleName(for:)`) and `TabsItemFactory.swift` build
 * the bar from the same names (Home is always titled "Home"). Deep links, push notifications and
 * in-app buttons that route to a screen look its tab up, so with the tab gone they have nowhere to go.
 */

import type { AppOp } from "../types.js";

interface Rule {
  screen: string;
  /** Matches the tab name with any namespace in front of it removed, lowercased. */
  names: string[];
}

const RULES: Rule[] = [
  { screen: "Home", names: ["standard-home", "home"] },
  { screen: "the Planner (calendar)", names: ["planner", "calendar"] },
  { screen: "Accounts", names: ["accounts", "customers", "accountfilter"] },
  { screen: "Reports", names: ["salesdata", "reports", "standard-report"] },
  { screen: "Intelligent Content", names: ["clm", "intelligentcontent"] },
  { screen: "My Team", names: ["myteamtab"] },
];

const bare = (tab: string) => tab.replace(/^[A-Za-z0-9]+__/, "").toLowerCase();

/** The screen that tab is the iPad's route to, or null for an ordinary tab. */
export function routedScreen(tab: string): string | null {
  const name = bare(tab);
  return (
    RULES.find((r) => r.names.includes(name) || r.names.includes(tab.toLowerCase()))?.screen ?? null
  );
}

/** Warnings for the tabs the ops take out of the bar (and not put back again). */
export function appTabWarnings(ops: AppOp[]): string[] {
  const removed = new Set<string>();
  for (const op of ops) {
    if (op.op === "removeAppTab") removed.add(op.tab);
    if (op.op === "addAppTab") removed.delete(op.tab);
  }
  const out: string[] = [];
  for (const tab of removed) {
    const screen = routedScreen(tab);
    if (screen) {
      out.push(
        `${tab} is how the iPad gets to ${screen}: links, notifications and in-app buttons that open ${screen} stop working once reps get the new tab bar.`
      );
    } else if (tab.startsWith("standard-")) {
      const object = tab.slice("standard-".length);
      out.push(
        `${tab} is the ${object} tab: links that open ${object} records in the app (lightningObject deep links) have no tab to land on once reps get the new tab bar.`
      );
    } else if (tab.endsWith("__c")) {
      out.push(
        `${tab} is an object's tab: links that open its records in the app have no tab to land on once reps get the new tab bar.`
      );
    }
  }
  return out;
}
