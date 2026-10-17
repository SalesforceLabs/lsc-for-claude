/** Native screens the preview draws from live data, one collector per screen. */

import { collectAccounts, type PublishedAccounts } from "./accounts.js";
import { collectCalendar, type PublishedCalendar } from "./calendar.js";
import { collectContent, type PublishedContent } from "./content.js";
import type { ScreenContext } from "./context.js";
import { collectTableau, type PublishedTableau } from "./tableau.js";

export type { ScreenContext } from "./context.js";
export type { PublishedAccounts, PublishedCalendar, PublishedContent, PublishedTableau };

export interface PublishedScreens {
  content?: PublishedContent;
  accounts?: PublishedAccounts;
  calendar?: PublishedCalendar;
  tableau?: PublishedTableau;
}

const COLLECTORS: { [K in keyof PublishedScreens]-?: { kind: string; collect: (ctx: ScreenContext) => Promise<PublishedScreens[K]> } } = {
  content: { kind: "content", collect: collectContent },
  accounts: { kind: "accounts", collect: collectAccounts },
  calendar: { kind: "calendar", collect: collectCalendar },
  tableau: { kind: "tableau", collect: collectTableau },
};

/** Runs the collector of each screen the viewer has a tab for; one that fails is left out. */
export async function collectScreens(ctx: ScreenContext): Promise<PublishedScreens> {
  const out: Record<string, unknown> = {};
  await Promise.all(
    Object.entries(COLLECTORS).map(async ([key, c]) => {
      if (!ctx.core.tabs.some((t) => t.kind === c.kind)) return;
      const data = await c.collect(ctx).catch(() => undefined);
      if (data !== undefined) out[key] = data;
    })
  );
  return out as PublishedScreens;
}
