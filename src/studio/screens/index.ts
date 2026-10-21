/** Native screens the preview draws from live data, one collector per screen. */

import { collectAccounts, type PublishedAccounts } from "./accounts.js";
import { collectCalendar, type PublishedCalendar } from "./calendar.js";
import { collectChrome, type PublishedChrome } from "./chrome.js";
import { collectContent, type PublishedContent } from "./content.js";
import { errorText, isScaleError, withTimeout, type ScreenContext } from "./context.js";
import { collectFabs, type PublishedFabs } from "./fabs.js";
import { collectHome, type PublishedHome } from "./home.js";
import { collectTableau, type PublishedTableau } from "./tableau.js";

export type { ScreenContext } from "./context.js";
export type {
  PublishedAccounts,
  PublishedCalendar,
  PublishedChrome,
  PublishedContent,
  PublishedFabs,
  PublishedHome,
  PublishedTableau,
};

export interface PublishedScreens {
  content?: PublishedContent;
  accounts?: PublishedAccounts;
  calendar?: PublishedCalendar;
  tableau?: PublishedTableau;
  fabs?: PublishedFabs;
  home?: PublishedHome;
  chrome?: PublishedChrome;
}

const COLLECTORS: {
  [K in keyof PublishedScreens]-?: {
    kind: string | null;
    collect: (ctx: ScreenContext) => Promise<PublishedScreens[K]>;
  };
} = {
  content: { kind: "content", collect: collectContent },
  accounts: { kind: "accounts", collect: collectAccounts },
  calendar: { kind: "calendar", collect: collectCalendar },
  tableau: { kind: "tableau", collect: collectTableau },
  // The floating buttons belong to Home and record pages, not to a tab, so they are always collected.
  fabs: { kind: null, collect: collectFabs },
  // Home's components (NBC cards, Visits To Submit, Activity Plan Progress) read data too; Home has no collector of its own.
  home: { kind: null, collect: collectHome },
  // Alerts and the profile sheet belong to the top bar, not to a tab.
  chrome: { kind: null, collect: collectChrome },
};

/** Longest one screen's collector is waited on, so a large org's slow reads don't hold up the whole preview. */
export const SCREEN_TIMEOUT_MS = 90_000;

const SCREEN_NAMES: Record<keyof PublishedScreens, string> = {
  content: "Content",
  accounts: "Accounts",
  calendar: "Calendar",
  tableau: "Tableau",
  fabs: "Floating buttons",
  home: "Home",
  chrome: "Alerts and profile",
};

/**
 * Runs the collector of each screen the viewer has a tab for. One that fails
 * is left out — with a note when the cause is scale (too many rows, too slow),
 * quietly when the org lacks what it reads.
 */
export async function collectScreens(ctx: ScreenContext): Promise<PublishedScreens> {
  const out: Record<string, unknown> = {};
  await Promise.all(
    Object.entries(COLLECTORS).map(async ([key, c]) => {
      if (c.kind !== null && !ctx.core.tabs.some((t) => t.kind === c.kind)) return;
      const name = SCREEN_NAMES[key as keyof PublishedScreens];
      const data = await withTimeout<unknown>(
        c.collect(ctx),
        SCREEN_TIMEOUT_MS,
        `Reading the ${name} screen`
      ).catch((err) => {
        if (isScaleError(err)) ctx.note(`${name} screen not shown with data: ${errorText(err)}`);
        return undefined;
      });
      if (data !== undefined) out[key] = data;
    })
  );
  return out as PublishedScreens;
}
