/** The editor page's keyboard shortcuts as one pure map, so the page and its tests agree. */

export type ScriptShortcut = "save" | "ask" | "accept" | "reject" | "test";

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface ShortcutState {
  /** A proposal from Ask Roz is on screen. */
  proposal: boolean;
  /** Something blocks page shortcuts, e.g. a dialog is open. */
  blocked: boolean;
}

/** The shortcut a key press means, or null. ⌘ on a Mac, Ctrl elsewhere. */
export function scriptShortcut(e: KeyLike, state: ShortcutState, isMac: boolean): ScriptShortcut | null {
  if (state.blocked) return null;
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (state.proposal && !e.altKey && !e.shiftKey) {
    if (mod && e.key === "Enter") return "accept";
    if (!e.metaKey && !e.ctrlKey && e.key === "Escape") return "reject";
  }
  if (!mod || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === "s" && !e.shiftKey) return "save";
  if (k === "k" && !e.shiftKey) return "ask";
  if (k === "enter" && e.shiftKey) return "test";
  return null;
}

/** "⌘S" on a Mac, "Ctrl+S" elsewhere. */
export function shortcutLabel(key: string, isMac: boolean): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}
