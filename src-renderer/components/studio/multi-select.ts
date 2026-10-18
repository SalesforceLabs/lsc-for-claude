import type { PendingChange } from "./changes";
import type { Verb, VerbId } from "./edit-draft";
import { targetKey, type EditTarget } from "./edit-targets";

/**
 * Selecting several blocks at once in edit mode (⌘- or ⇧-click). Blocks join
 * a selection only with blocks of the same kind in the same container — the
 * same layout, compact layout, Lightning region, tab bar or ••• menu — and the
 * toolbar offers only the verbs every one of them has. Pure: nothing here
 * touches the org.
 */

/** The container blocks must share to be selected together, or null when a block can't be part of a group. */
export function containerOf(t: EditTarget): string | null {
  switch (t.kind) {
    case "tab":
      return "tabs";
    case "component":
      return `component:${t.page}:${t.region}`;
    case "section":
    case "field":
      return `${t.kind}:${t.layout}`;
    case "related":
      return t.layout ? `related:${t.layout}` : null;
    case "headerField":
      return `headerField:${t.compactLayout}`;
    case "action":
      return `action:${t.place}:${t.object ?? ""}`;
    case "highlights":
    case "listView":
      return null;
  }
}

/**
 * The selection after a click: a plain click selects the block alone; an
 * extending click (⌘ / ⇧) adds it, or takes it out again, when it fits the
 * selection — otherwise it starts a new one. The last block clicked is first.
 */
export function extendSelection(selection: EditTarget[], t: EditTarget, extend: boolean): EditTarget[] {
  const key = targetKey(t);
  const container = containerOf(t);
  if (!extend || !selection.length || container === null || containerOf(selection[0]) !== container) return [t];
  if (selection.some((s) => targetKey(s) === key)) {
    const rest = selection.filter((s) => targetKey(s) !== key);
    return rest.length ? rest : [t];
  }
  return [t, ...selection];
}

/**
 * Verbs that can run on a whole selection. Moves, column changes and adds are
 * one-block verbs (a group move would have to keep the blocks' order and gaps),
 * so they're never offered for a group.
 */
export const GROUP_VERBS = new Set<VerbId>(["remove", "restore", "hide", "show", "off", "on", "required", "readonly", "heading", "discard"]);

/**
 * The verbs every selected block offers with the same meaning (same id and
 * label — "Make required" and "Make optional" don't mix). Running one applies
 * it to each block in turn, each against the tray the previous one left, so a
 * layout's verbs still re-diff into one change per document.
 *
 * `verbsFor` gives a block's verbs as they'd be with `pending` in the tray.
 */
export function groupVerbs(targets: EditTarget[], pending: PendingChange[], verbsFor: (t: EditTarget, pending: PendingChange[]) => Verb[], noun: string): Verb[] {
  if (targets.length < 2) return targets.length ? verbsFor(targets[0], pending) : [];
  const lists = targets.map((t) => verbsFor(t, pending));
  const n = targets.length;
  return lists[0].flatMap((first): Verb[] => {
    if (!GROUP_VERBS.has(first.id) || first.pick) return [];
    const all = lists.map((l) => l.find((v) => v.id === first.id && v.label === first.label));
    if (all.some((v) => !v)) return [];
    const label = first.label;
    const title = `${label} — all ${n} ${noun}`;
    const blocked = all.find((v) => !v!.run);
    if (blocked) return [{ id: first.id, label, title, reason: `${blocked.reason ?? "Can't do this"} (one of the ${n} ${noun})` }];
    return [
      {
        id: first.id,
        label,
        title,
        run: (p) =>
          targets.reduce((acc, t) => {
            const v = verbsFor(t, acc).find((x) => x.id === first.id && x.label === label);
            return v?.run ? v.run(acc) : acc;
          }, p),
      },
    ];
  });
}

/** "3 fields", for the toolbar and inspector. */
export function selectionNoun(t: EditTarget, n: number): string {
  const words: Record<EditTarget["kind"], [string, string]> = {
    tab: ["tab", "tabs"],
    component: ["component", "components"],
    section: ["section", "sections"],
    field: ["field", "fields"],
    related: ["related list", "related lists"],
    highlights: ["record header", "record headers"],
    headerField: ["header field", "header fields"],
    action: ["action", "actions"],
    listView: ["list view", "list views"],
  };
  return words[t.kind][n === 1 ? 0 : 1];
}
