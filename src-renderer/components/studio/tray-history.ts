import { useCallback, useEffect, useState } from "react";
import { changeKey, type PendingChange } from "./changes";

/**
 * Undo / redo for the pending-changes tray: every state the tray has been in,
 * so any queue, removal or verb can be taken back with ⌘Z (and redone with
 * ⇧⌘Z). Nothing here touches the org; applying changes starts a new history.
 */
export interface TrayHistory {
  past: PendingChange[][];
  present: PendingChange[];
  future: PendingChange[][];
}

/** How many tray states are kept to step back through. */
export const HISTORY_LIMIT = 100;

export const emptyHistory = (present: PendingChange[] = []): TrayHistory => ({ past: [], present, future: [] });

/** The tray moved to `next`; a new edit clears what could be redone. */
export function record(h: TrayHistory, next: PendingChange[]): TrayHistory {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo(h: TrayHistory): TrayHistory {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: TrayHistory): TrayHistory {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

/** What stepping from `from` to `to` does, for the button's tooltip: "Edit page layout Account Layout". */
export function describeStep(from: PendingChange[], to: PendingChange[]): string {
  const keyed = (l: PendingChange[]) => new Map(l.map((p) => [changeKey(p.fix), p]));
  const [a, b] = [keyed(from), keyed(to)];
  const added = [...b.values()].filter((p) => a.get(changeKey(p.fix)) !== p);
  const removed = [...a.values()].filter((p) => !b.has(changeKey(p.fix)));
  if (!added.length && removed.length > 1) return `Take ${removed.length} changes out of the tray`;
  if (!added.length && removed.length === 1) return `Take “${removed[0].fix.label}” out of the tray`;
  if (added.length === 1) return added[0].fix.label;
  if (added.length > 1) return `${added.length} changes`;
  return "The last change";
}

/** True for keys typed into a field, which keep their own undo. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/**
 * The tray with its history: `setPending` records a step, `reset` starts over
 * (after changes are applied). ⌘Z / ⇧⌘Z (Ctrl on Windows and Linux) work
 * anywhere except in a text field, and not while `paused` (a dialog is open).
 */
export function useTrayHistory(paused = false) {
  const [history, setHistory] = useState<TrayHistory>(() => emptyHistory());
  const setPending = useCallback((next: PendingChange[]) => setHistory((h) => record(h, next)), []);
  const reset = useCallback((next: PendingChange[]) => setHistory(emptyHistory(next)), []);
  const stepBack = useCallback(() => setHistory(undo), []);
  const stepForward = useCallback(() => setHistory(redo), []);

  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "z" || typing(e.target)) return;
      e.preventDefault();
      setHistory(e.shiftKey ? redo : undo);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused]);

  const { past, present, future } = history;
  return {
    pending: present,
    setPending,
    reset,
    undo: stepBack,
    redo: stepForward,
    /** What ⌘Z would take back, or null when there's nothing to undo. */
    undoLabel: past.length ? describeStep(past[past.length - 1], present) : null,
    /** What ⇧⌘Z would put back, or null. */
    redoLabel: future.length ? describeStep(present, future[0]) : null,
  };
}
