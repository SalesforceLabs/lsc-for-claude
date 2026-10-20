import { changeKey, queueChange, type PendingChange } from "./changes";
import { emptyHistory, record, redo, undo, type TrayHistory } from "./tray-history";
import type { StudioFix } from "./types";

/**
 * Everything the release bar keeps for one org: the tray with its undo history, the undo of the last
 * apply, what was applied and waits for Publish to iPad, and what was applied this session (for source
 * control). The app holds one per org (`useStudioTray.tsx`), so leaving Studio or switching orgs loses nothing.
 */
export interface OrgTray {
  history: TrayHistory;
  lastApply: PendingChange[] | null;
  awaiting: PendingChange[];
  appliedFixes: StudioFix[];
}

export type TrayMap = Record<string, OrgTray>;

export const emptyTray = (): OrgTray => ({ history: emptyHistory(), lastApply: null, awaiting: [], appliedFixes: [] });

/** The key a tray is filed under: the org's username, lowercased ("" when no org is selected). */
export const trayKey = (org: string | undefined): string => (org ?? "").toLowerCase();

export const trayOf = (map: TrayMap, org: string): OrgTray => map[trayKey(org)] ?? emptyTray();

/** `map` with `org`'s tray replaced by `fn` of it; the same map when nothing changed. */
export function updateTray(map: TrayMap, org: string, fn: (t: OrgTray) => OrgTray): TrayMap {
  const key = trayKey(org);
  const before = map[key] ?? emptyTray();
  const after = fn(before);
  if (after === before && key in map) return map;
  return { ...map, [key]: after };
}

/** Queue `changes` one after another with the tray's merge rules (a newer change to the same setting replaces the older). */
export function queueAll(pending: PendingChange[], changes: PendingChange[]): PendingChange[] {
  return changes.reduce(queueChange, pending);
}

/** `changes` queued into `org`'s tray as one undoable step. */
export function queueInto(map: TrayMap, org: string, changes: PendingChange[]): TrayMap {
  return updateTray(map, org, (t) => {
    const next = queueAll(t.history.present, changes);
    return next === t.history.present ? t : { ...t, history: record(t.history, next) };
  });
}

export const pendingCount = (map: TrayMap, org: string): number => trayOf(map, org).history.present.length;

export const stepBack = (map: TrayMap, org: string): TrayMap => updateTray(map, org, (t) => ({ ...t, history: undo(t.history) }));
export const stepForward = (map: TrayMap, org: string): TrayMap => updateTray(map, org, (t) => ({ ...t, history: redo(t.history) }));

/**
 * The tray once the review dialog applied `done`: those changes go, and anything queued or replaced while the
 * dialog was open (from chat, say) stays. The history starts over, so ⌘Z can't bring applied changes back.
 */
export function afterApply(t: OrgTray, done: PendingChange[]): OrgTray {
  const applied = new Set(done);
  return { ...t, history: emptyHistory(t.history.present.filter((c) => !applied.has(c))) };
}

/**
 * The tray once the review dialog closes. `opened` is what it was given, `remaining` what it says should stay:
 * a change still as it was when the dialog opened takes the dialog's word (kept or removed); changes queued or
 * replaced in the meantime are left alone. The same array when nothing changed.
 */
export function afterReview(current: PendingChange[], opened: PendingChange[], remaining: PendingChange[]): PendingChange[] {
  const was = new Map(opened.map((c) => [changeKey(c.fix), c]));
  const left = new Map(remaining.map((c) => [changeKey(c.fix), c]));
  const next = current.flatMap((c) => {
    const key = changeKey(c.fix);
    if (was.get(key) !== c) return [c];
    const kept = left.get(key);
    return kept ? [kept] : [];
  });
  return next.length === current.length && next.every((c, i) => c === current[i]) ? current : next;
}
