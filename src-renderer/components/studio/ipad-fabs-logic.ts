import type { PublishedFabItem } from "./screens/fabs-types";

/** Which floating buttons a screen shows. */
export interface FabState {
  /** The Agentforce button. */
  astro: boolean;
  /** The ••• quick-action button. */
  more: boolean;
}

/**
 * ••• is added only by SFFlexiPageViewController.setupQuickActions (Home and record pages) and hidden
 * when its action list is empty; the Agentforce AnimatedButton joins it there when LSCAgentforceCapability
 * is on, and stands alone on the Tableau screen (LSCTableauViewController.addAgentforceButton).
 * Calendar hides ••• (CalendarCoordinator.setQuickActionButtonHidden(true)); the other tabs add neither.
 */
export function fabState(screen: { kind: string | undefined; onRecord: boolean; menuCount: number; agentforce: boolean }): FabState {
  const flexi = screen.onRecord || screen.kind === "home";
  if (flexi) return { astro: screen.agentforce, more: screen.menuCount > 0 };
  if (screen.kind === "tableau") return { astro: screen.agentforce, more: false };
  return { astro: false, more: false };
}

/** The menu a record opens: its object's record type, else the object's first. */
export function recordFabItems(
  fabs: { records: Record<string, Record<string, PublishedFabItem[]>> } | undefined,
  object: string,
  recordType: string | undefined
): PublishedFabItem[] {
  const byType = fabs?.records[object];
  if (!byType) return [];
  return (recordType !== undefined ? byType[recordType] : undefined) ?? Object.values(byType)[0] ?? [];
}

/** Menu geometry in screen points (VerticallyStackedQuickActionsViewController, RoundedButtonWithLabel). */
export const MENU = { height: 51.5, pitch: 63.5, inset: 18, maxWidth: 320, scrollBottom: 746, content: 65 } as const;

/**
 * Items share the widest title's width (text + 18pt insets, at most 320). The stack is scrolled to the
 * bottom of a scroll view 746pt tall whose contentSize is 65pt per item, so its top is 746 - 65n.
 */
export function menuLayout(textWidths: number[]): { width: number; tops: number[] } {
  const n = textWidths.length;
  const width = Math.min(MENU.maxWidth, Math.round(Math.max(0, ...textWidths) + 2 * MENU.inset));
  const top = MENU.scrollBottom - MENU.content * n;
  return { width, tops: textWidths.map((_, i) => top + i * MENU.pitch) };
}
