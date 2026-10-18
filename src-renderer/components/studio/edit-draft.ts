import type { PublishedTab } from "./published-types";
import type { PublishedFabItem } from "./screens/fabs-types";
import type { StudioFix, StudioItem } from "./types";
import {
  activeChange,
  effectiveActive,
  effectiveProfiles,
  itemAffects,
  profileChange,
  queueChange,
  splitList,
  type PendingChange,
} from "./changes";

/**
 * Draft — the published iPad with the tray's pending changes laid on top, and
 * the verbs edit mode offers on a tab or a Home ••• action. Pure: nothing here
 * touches the org; every verb returns the tray it would leave.
 */

/** How a block differs between Published and Draft. */
export type DraftState = "same" | "added" | "removed" | "moved";

const lower = (s: unknown) => String(s ?? "").toLowerCase();
const has = (list: string[], name: string) =>
  list.some((n) => n.toLowerCase() === name.toLowerCase());

/** A config record's field as it will be once the tray is applied. */
export function effectiveField(
  item: StudioItem,
  field: string,
  pending: PendingChange[]
): string | number | boolean | null {
  const rec = item.edit?.record;
  if (rec?.type === "config") {
    for (const p of pending) {
      const f = p.fix;
      if (
        f.kind === "setConfigField" &&
        f.category === rec.category &&
        f.developerName === rec.developerName &&
        f.field === field
      )
        return f.to;
    }
  }
  return item.properties[field] ?? null;
}

function isDeleted(item: StudioItem, pending: PendingChange[]): boolean {
  const rec = item.edit?.record;
  return (
    rec?.type === "config" &&
    pending.some(
      (p) =>
        p.fix.kind === "deleteConfigRecord" &&
        p.fix.category === rec.category &&
        p.fix.developerName === rec.developerName
    )
  );
}

/** Whether a record reaches `profile`: active and — when it lists profiles — listing it. */
function reaches(
  item: StudioItem,
  pending: PendingChange[],
  profile: string,
  draft: boolean
): boolean {
  const edit = item.edit;
  if (!edit) return !!item.active;
  if (draft && isDeleted(item, pending)) return false;
  const active = draft ? effectiveActive(edit, pending) : edit.active;
  if (!active) return false;
  if (!edit.profiles) return true;
  const profiles = draft
    ? effectiveProfiles(edit, pending)
    : edit.profiles.source === "field"
      ? splitList(edit.profiles.raw)
      : edit.profiles.names;
  return has(profiles, profile);
}

// --- Navigation tabs -------------------------------------------------------------

export interface DraftTab {
  tab: PublishedTab;
  state: DraftState;
  /** The UI Settings (UISchema TAB) record behind the tab; absent for tabs from the Lightning app. */
  item?: StudioItem;
  /** A pending new record this tab comes from. */
  create?: PendingChange;
}

/** The UI Settings tab record for a published tab: same TabName, preferring one that reaches the profile. */
export function tabItemFor(
  tab: PublishedTab,
  tabItems: StudioItem[],
  profile: string
): StudioItem | undefined {
  const named = tabItems.filter((i) => lower(i.properties.TabName) === tab.fullName.toLowerCase());
  return named.find((i) => reaches(i, [], profile, false)) ?? named[0];
}

const tabOrder = (item: StudioItem, pending: PendingChange[]) => {
  const n = Number(effectiveField(item, "TabOrder", pending));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
};

function addedTab(fullName: string, label: string): PublishedTab {
  return {
    fullName,
    label,
    kind: "empty",
    emptyReason: "Added in Draft. The iPad draws this tab after you apply the change and publish.",
  };
}

/**
 * The tab bar in Draft. Tabs whose UI Settings record is switched off, deleted
 * or no longer assigned to the profile stay as ghosts; records the tray makes
 * visible are added; and when a TabOrder is pending, the UI Settings tabs are
 * re-sorted among the slots they hold — tabs from the Lightning app keep theirs.
 */
export function draftTabs(
  tabs: PublishedTab[],
  tabItems: StudioItem[],
  pending: PendingChange[],
  profile: string
): DraftTab[] {
  const out: DraftTab[] = tabs.map((tab) => {
    const item = tabItemFor(tab, tabItems, profile);
    const gone =
      item && reaches(item, [], profile, false) && !reaches(item, pending, profile, true);
    return { tab, item, state: gone ? "removed" : "same" };
  });

  const reordered = tabItems.some(
    (i) => effectiveField(i, "TabOrder", pending) !== (i.properties.TabOrder ?? null)
  );
  if (reordered) {
    const slots = out.flatMap((d, i) => (d.item ? [i] : []));
    const sorted = slots
      .map((i) => out[i])
      .sort((a, b) => tabOrder(a.item!, pending) - tabOrder(b.item!, pending));
    slots.forEach((slot, k) => {
      const moved = sorted[k] !== out[slot];
      out[slot] = moved
        ? { ...sorted[k], state: sorted[k].state === "removed" ? "removed" : "moved" }
        : sorted[k];
    });
  }

  // Records the tray switches on or assigns to the profile, and new tab records for it.
  const shown = new Set(out.map((d) => d.tab.fullName.toLowerCase()));
  const extra: { draft: DraftTab; order: number }[] = [];
  for (const item of tabItems) {
    const name = String(item.properties.TabName ?? "");
    if (
      !name ||
      shown.has(name.toLowerCase()) ||
      reaches(item, [], profile, false) ||
      !reaches(item, pending, profile, true)
    )
      continue;
    shown.add(name.toLowerCase());
    extra.push({
      draft: { tab: addedTab(name, item.label), item, state: "added" },
      order: tabOrder(item, pending),
    });
  }
  for (const p of pending) {
    const f = p.fix;
    if (
      f.kind !== "createConfigRecord" ||
      f.category !== "UISchema" ||
      !f.active ||
      !has(f.profiles, profile)
    )
      continue;
    const name = String(f.fields.find((x) => x.name === "TabName")?.value ?? "");
    if (!name || shown.has(name.toLowerCase())) continue;
    shown.add(name.toLowerCase());
    extra.push({
      draft: { tab: addedTab(name, f.recordLabel || name), state: "added", create: p },
      order: Number(f.fields.find((x) => x.name === "TabOrder")?.value) || Number.MAX_SAFE_INTEGER,
    });
  }
  // Each added tab goes after the last UI Settings tab ordered before it.
  for (const { draft, order } of extra.sort((a, b) => a.order - b.order)) {
    let at = out.length;
    const after = out
      .map((d, i) => (d.item && tabOrder(d.item, pending) <= order ? i : -1))
      .filter((i) => i >= 0);
    if (after.length) at = after[after.length - 1] + 1;
    else if (out.some((d) => d.item)) at = out.findIndex((d) => d.item);
    out.splice(at, 0, draft);
  }
  return out;
}

// --- Home ••• menu ---------------------------------------------------------------

const HOME_QUICK = new Set(["newvisit", "inquiry", "sharecontent", "email", "createquote"]);
/** localizedLabel(for:) for the Home quick actions — a copy of SUPPORTED_TITLES in src/studio/screens/fabs.ts. */
const HOME_TITLES: Record<string, string> = {
  newvisit: "New Visit",
  inquiry: "Inquiry",
  sharecontent: "Share Content",
  email: "Email",
  createquote: "Order",
};

export interface DraftAction {
  value: PublishedFabItem;
  state: DraftState;
  /** The QuickAction / CustomAction record behind it. */
  item?: StudioItem;
  create?: PendingChange;
  /** Quick actions sort by SortOrder; custom actions come after them, by name. */
  quick: boolean;
}

interface MenuRow {
  name: string;
  label: string;
  quick: boolean;
  sortOrder: number;
  item?: StudioItem;
  create?: PendingChange;
  action?: PublishedFabItem["action"];
}

const isQuick = (item: StudioItem) => item.id.startsWith("QuickAction:");

function customAction(fields: Record<string, unknown>): PublishedFabItem["action"] {
  return {
    type: lower(fields.ActionType),
    target: fields.ActionTarget ? String(fields.ActionTarget) : undefined,
    targetType: fields.TargetType ? String(fields.TargetType) : undefined,
    hideBrowser: lower(fields.HideViewInBrowserAction) === "true" || undefined,
  };
}

/** homeMenu (src/studio/screens/fabs.ts) over the Home actions surface, as published or with the tray applied. */
function menuRows(
  items: StudioItem[],
  pending: PendingChange[],
  profile: string,
  draft: boolean
): MenuRow[] {
  const rows: MenuRow[] = [];
  for (const item of items) {
    if (
      isQuick(item)
        ? !reaches(item, pending, profile, draft)
        : !reachesEveryone(item, pending, draft)
    )
      continue;
    if (isQuick(item)) {
      const name = String(item.properties.ActionName ?? "");
      if (lower(item.properties.Location) !== "homepage" || !HOME_QUICK.has(name.toLowerCase()))
        continue;
      const order = Number(
        draft ? effectiveField(item, "SortOrder", pending) : item.properties.SortOrder
      );
      rows.push({
        name,
        label: HOME_TITLES[name.toLowerCase()] ?? item.label,
        quick: true,
        sortOrder: Number.isFinite(order) ? order : 0,
        item,
      });
    } else {
      if (
        lower(item.properties.EntityType) !== "homepage" ||
        !/^(url|utterance|app)$/i.test(String(item.properties.ActionType ?? ""))
      )
        continue;
      rows.push({
        name: item.label,
        label: item.label,
        quick: false,
        sortOrder: 0,
        item,
        action: customAction(item.properties),
      });
    }
  }
  if (draft) {
    for (const p of pending) {
      const f = p.fix;
      if (f.kind !== "createConfigRecord" || !f.active) continue;
      const fields = Object.fromEntries(f.fields.map((x) => [x.name, x.value]));
      if (f.category === "QuickAction") {
        const name = String(fields.ActionName ?? "");
        if (
          lower(fields.Location) !== "homepage" ||
          !HOME_QUICK.has(name.toLowerCase()) ||
          !has(splitList(String(fields.Profiles ?? "")), profile)
        )
          continue;
        rows.push({
          name,
          label: HOME_TITLES[name.toLowerCase()] ?? f.recordLabel,
          quick: true,
          sortOrder: Number(fields.SortOrder) || 0,
          create: p,
        });
      } else if (f.category === "CustomAction") {
        if (
          lower(fields.EntityType) !== "homepage" ||
          !/^(url|utterance|app)$/i.test(String(fields.ActionType ?? ""))
        )
          continue;
        rows.push({
          name: f.recordLabel,
          label: f.recordLabel,
          quick: false,
          sortOrder: 0,
          create: p,
          action: customAction(fields),
        });
      }
    }
  }
  const quick = rows.filter((r) => r.quick).sort((a, b) => a.sortOrder - b.sortOrder);
  const custom = rows
    .filter((r) => !r.quick)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const seen = new Set<string>();
  return [...quick, ...custom].filter((r) => !seen.has(r.name) && !!seen.add(r.name));
}

/** Custom actions have no audience on the iPad: every active one reaches every device. */
function reachesEveryone(item: StudioItem, pending: PendingChange[], draft: boolean): boolean {
  const edit = item.edit;
  if (!edit) return !!item.active;
  if (draft && isDeleted(item, pending)) return false;
  return !!(draft ? effectiveActive(edit, pending) : edit.active);
}

/**
 * The Home ••• menu in Draft: the published items, re-derived from the Home
 * actions surface with the tray applied. Items the tray takes away stay as
 * ghosts where they were.
 */
export function draftHomeMenu(
  published: PublishedFabItem[],
  actionItems: StudioItem[],
  pending: PendingChange[],
  profile: string
): DraftAction[] {
  const before = menuRows(actionItems, [], profile, false);
  const after = menuRows(actionItems, pending, profile, true);
  const byName = new Map(published.map((p) => [p.name, p]));
  const beforeNames = before.map((r) => r.name);
  const afterNames = new Set(after.map((r) => r.name));
  // An item moved when its place among the items in both menus changed.
  const keptBefore = beforeNames.filter((n) => afterNames.has(n));
  const keptAfter = after.map((r) => r.name).filter((n) => beforeNames.includes(n));
  const out: DraftAction[] = after.map((r) => {
    const value = byName.get(r.name) ?? {
      name: r.name,
      label: r.label,
      ...(r.action ? { action: r.action } : {}),
    };
    const state: DraftState = !beforeNames.includes(r.name)
      ? "added"
      : keptBefore.indexOf(r.name) !== keptAfter.indexOf(r.name)
        ? "moved"
        : "same";
    return { value, state, item: r.item, create: r.create, quick: r.quick };
  });
  before.forEach((r, i) => {
    if (afterNames.has(r.name)) return;
    const value = byName.get(r.name) ?? { name: r.name, label: r.label };
    out.splice(Math.min(i, out.length), 0, {
      value,
      state: "removed",
      item: r.item,
      quick: r.quick,
    });
  });
  return out;
}

// --- Verbs -----------------------------------------------------------------------

export type VerbId =
  | "up"
  | "down"
  | "hide"
  | "show"
  | "off"
  | "on"
  | "discard"
  | "remove"
  | "restore"
  | "column"
  | "heading"
  | "required"
  | "readonly"
  | "addField"
  | "addRelated"
  | "default"
  | "insertComponent";

/** A verb that asks which one first ("Add field…"): a search picker over `options`, and picking one runs it. */
export interface VerbPick {
  title: string;
  description?: string;
  placeholder: string;
  /** Shown when there is nothing to pick. */
  empty: string;
  options: { value: string; label: string; detail?: string }[];
  run: (value: string, pending: PendingChange[]) => PendingChange[];
}

/**
 * Something the toolbar offers. `run` returns the tray it leaves; `pick` asks
 * first; with neither the verb is shown disabled, with `reason`.
 */
export interface Verb {
  id: VerbId;
  label: string;
  title: string;
  run?: (pending: PendingChange[]) => PendingChange[];
  pick?: VerbPick;
  reason?: string;
}

function fieldFix(item: StudioItem, field: string, to: number, label: string): StudioFix | null {
  const rec = item.edit?.record;
  if (rec?.type !== "config") return null;
  const from = item.properties[field];
  return {
    kind: "setConfigField",
    label,
    category: rec.category,
    developerName: rec.developerName,
    recordLabel: rec.label,
    field,
    from: typeof from === "number" || typeof from === "string" ? from : null,
    to,
  };
}

/** Two order changes swapping `a` with its neighbour `b` (or putting `a` just past `b` when they share a number). */
function swap(
  a: StudioItem,
  b: StudioItem,
  field: string,
  dir: -1 | 1,
  pending: PendingChange[],
  affects?: string[]
): PendingChange[] | null {
  const [oa, ob] = [
    Number(effectiveField(a, field, pending)),
    Number(effectiveField(b, field, pending)),
  ];
  if (!Number.isFinite(oa) || !Number.isFinite(ob)) return null;
  const word = dir < 0 ? "up" : "down";
  if (oa === ob) {
    const fix = fieldFix(a, field, ob + dir, `Move ${a.label} ${word}`);
    return fix ? [{ fix, affects }] : null;
  }
  const fa = fieldFix(a, field, ob, `Move ${a.label} ${word}`);
  const fb = fieldFix(b, field, oa, `Move ${b.label} ${dir < 0 ? "down" : "up"}`);
  return fa && fb
    ? [
        { fix: fa, affects },
        { fix: fb, affects },
      ]
    : null;
}

const queueAll = (pending: PendingChange[], changes: PendingChange[]) =>
  changes.reduce(queueChange, pending);

/** Hide for this profile / turn off for everyone — and their undos for a ghost. `perProfile` is false where the iPad ignores the record's profiles. */
function visibilityVerbs(
  item: StudioItem,
  state: DraftState,
  profile: string,
  pending: PendingChange[],
  noun: string,
  perProfile = true
): Verb[] {
  const edit = item.edit;
  if (!edit) return [];
  const verbs: Verb[] = [];
  const active = effectiveActive(edit, pending);
  const profiles = edit.profiles && perProfile ? effectiveProfiles(edit, pending) : null;
  const listed = profiles ? has(profiles, profile) : true;
  if (state === "removed") {
    if (profiles && !listed) {
      const fix = profileChange(edit, [...profiles, profile]);
      if (fix)
        verbs.push({
          id: "show",
          label: `Show to ${profile}`,
          title: `Give ${profile} this ${noun} again`,
          run: (p) => queueChange(p, { fix, affects: [profile] }),
        });
    }
    if (!active) {
      const fix = activeChange(edit, true);
      if (fix)
        verbs.push({
          id: "on",
          label: "Turn on",
          title: `Switch this ${noun} back on`,
          run: (p) => queueChange(p, { fix, affects: itemAffects(item) }),
        });
    }
    return verbs;
  }
  if (profiles && listed) {
    const fix = profileChange(
      edit,
      profiles.filter((n) => n.toLowerCase() !== profile.toLowerCase())
    );
    if (fix)
      verbs.push({
        id: "hide",
        label: `Hide for ${profile}`,
        title: `Take ${profile} off this ${noun}'s profiles. Other profiles keep it.`,
        run: (p) => queueChange(p, { fix, affects: [profile] }),
      });
  }
  if (active) {
    const fix = activeChange(edit, false);
    const reach = item.audience?.profiles.length;
    if (fix)
      verbs.push({
        id: "off",
        label: "Turn off",
        title: reach
          ? `Switch this ${noun} off for all ${reach} profiles it reaches`
          : `Switch this ${noun} off for everyone`,
        run: (p) => queueChange(p, { fix, affects: itemAffects(item) }),
      });
  }
  return verbs;
}

/** A pending new record can only be taken back out of the tray. */
function discardVerb(create: PendingChange): Verb {
  return {
    id: "discard",
    label: "Discard",
    title: "Take this new record back out of the tray",
    run: (p) => p.filter((c) => c !== create),
  };
}

/** Verbs on the tab at `index` of the Draft bar. Tabs from the Lightning app get none: they're explained instead. */
export function tabVerbs(
  bar: DraftTab[],
  index: number,
  pending: PendingChange[],
  profile: string
): Verb[] {
  const d = bar[index];
  if (!d) return [];
  if (d.create) return [discardVerb(d.create)];
  const item = d.item;
  if (!item?.edit) return [];
  const verbs: Verb[] = [];
  if (d.state !== "removed") {
    const live = (i: number) => bar[i]?.item && bar[i].state !== "removed" && !bar[i].create;
    for (const dir of [-1, 1] as const) {
      let j = index + dir;
      while (j >= 0 && j < bar.length && !live(j)) j += dir;
      const word = dir < 0 ? "up" : "down";
      const neighbour = bar[j]?.item;
      const changes =
        neighbour &&
        swap(
          item,
          neighbour,
          "TabOrder",
          dir,
          pending,
          itemAffects(item, neighbour.audience?.profiles)
        );
      verbs.push(
        changes
          ? {
              id: word,
              label: dir < 0 ? "Move left" : "Move right",
              title: `Swap TabOrder with ${neighbour.label}`,
              run: (p) => queueAll(p, changes),
            }
          : {
              id: word,
              label: dir < 0 ? "Move left" : "Move right",
              title: "",
              reason: neighbour
                ? "TabOrder isn't a number"
                : `No UI Settings tab to the ${dir < 0 ? "left" : "right"}; tabs from the Lightning app keep their place`,
            }
      );
    }
  }
  return [...verbs, ...visibilityVerbs(item, d.state, profile, pending, "tab")];
}

/** Verbs on the Home ••• action at `index` of the Draft menu. */
export function actionVerbs(
  menu: DraftAction[],
  index: number,
  pending: PendingChange[],
  profile: string
): Verb[] {
  const d = menu[index];
  if (!d) return [];
  if (d.create) return [discardVerb(d.create)];
  const item = d.item;
  if (!item?.edit) return [];
  const verbs: Verb[] = [];
  if (d.state !== "removed") {
    for (const dir of [-1, 1] as const) {
      const id: VerbId = dir < 0 ? "up" : "down";
      const label = dir < 0 ? "Move up" : "Move down";
      if (!d.quick) {
        verbs.push({
          id,
          label,
          title: "",
          reason: "Custom actions are listed after quick actions, by name. Rename it to move it.",
        });
        continue;
      }
      let j = index + dir;
      while (j >= 0 && j < menu.length && (menu[j].state === "removed" || menu[j].create)) j += dir;
      const neighbour = menu[j]?.quick ? menu[j].item : undefined;
      const changes = neighbour && swap(item, neighbour, "SortOrder", dir, pending, [profile]);
      verbs.push(
        changes
          ? {
              id,
              label,
              title: `Swap SortOrder with ${neighbour.label}`,
              run: (p) => queueAll(p, changes),
            }
          : {
              id,
              label,
              title: "",
              reason: dir < 0 ? "Already the first quick action" : "Already the last quick action",
            }
      );
    }
  }
  return [...verbs, ...visibilityVerbs(item, d.state, profile, pending, "action", d.quick)];
}

// --- Drops -----------------------------------------------------------------------

/**
 * A drop in the tab bar or the Home menu: the block's up / down verb, run until
 * it sits where it was dropped (right before `before` among the blocks still
 * shown, or last) or as near as the verbs take it. So the tray is exactly what
 * the same moves made one at a time would leave.
 */
function stepTo(
  order: (pending: PendingChange[]) => string[],
  verbsAt: (pending: PendingChange[], name: string) => Verb[],
  name: string,
  before: string | null,
  pending: PendingChange[]
): PendingChange[] {
  const start = order(pending);
  const from = start.indexOf(name);
  const at = before === null ? start.length - 1 : start.indexOf(before);
  if (from < 0 || at < 0 || before === name) return pending;
  const to = before !== null && at > from ? at - 1 : at;
  let p = pending;
  for (let n = 0; n < start.length; n++) {
    const now = order(p).indexOf(name);
    if (now === to) break;
    const verb = verbsAt(p, name).find((v) => v.id === (to < now ? "up" : "down"));
    if (!verb?.run) break;
    const next = verb.run(p);
    // A step that lands no nearer (past a slot it can't hold, like a Lightning app tab's) ends the move.
    if (Math.abs(to - order(next).indexOf(name)) >= Math.abs(to - now)) break;
    p = next;
  }
  return p;
}

const shownNames = <T extends { state: DraftState }>(rows: T[], name: (r: T) => string) =>
  rows.filter((r) => r.state !== "removed").map(name);

/** A tab dropped right before the tab `before` (null: last), by the TabOrder swaps Move left / right queue. */
export function moveTabTo(
  tabs: PublishedTab[],
  tabItems: StudioItem[],
  profile: string,
  fullName: string,
  before: string | null,
  pending: PendingChange[]
): PendingChange[] {
  const bar = (p: PendingChange[]) => draftTabs(tabs, tabItems, p, profile);
  return stepTo(
    (p) => shownNames(bar(p), (d) => d.tab.fullName),
    (p, name) => {
      const b = bar(p);
      return tabVerbs(b, b.findIndex((d) => d.tab.fullName === name), p, profile);
    },
    fullName,
    before,
    pending
  );
}

/** A Home ••• action dropped right before `before` (null: last), by the SortOrder swaps Move up / down queue. */
export function moveActionTo(
  published: PublishedFabItem[],
  actionItems: StudioItem[],
  profile: string,
  name: string,
  before: string | null,
  pending: PendingChange[]
): PendingChange[] {
  const menu = (p: PendingChange[]) => draftHomeMenu(published, actionItems, p, profile);
  return stepTo(
    (p) => shownNames(menu(p), (d) => d.value.name),
    (p, n) => {
      const m = menu(p);
      return actionVerbs(m, m.findIndex((d) => d.value.name === n), p, profile);
    },
    name,
    before,
    pending
  );
}
