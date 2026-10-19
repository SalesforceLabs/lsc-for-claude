import type { AppEditFix, AppOp, LiveApp } from "./types";
import { appOpsChange, pendingFor, queuedAppOps, queueChange, type PendingChange } from "./changes";
import { addedTab, type DraftState, type DraftTab, type Verb } from "./edit-draft";
import { StaleDraftError, withGhosts } from "./layout-draft";

/**
 * The iPad's tab bar when it comes from the profile's Lightning app (a CustomApplication), in Draft.
 * Like the other documents, the tray holds one `editMetadata` change per app whose ops are the whole
 * difference between its tabs in the org (`LiveApp`) and the order the admin has arranged, so moving a
 * tab back leaves no op behind. Only the tabs the subscriber owns are arranged (an installed app's
 * `subscriberTabs`, an own app's `tabs`); the package's tabs stay put. Tabs of the UI Settings
 * (UISchema) keep their own edits in `edit-draft.ts`. Pure: nothing here touches the org.
 */

/** One op, applied the way the server applies it to the XML (app-ops.ts). */
function applyOp(m: string[], fixed: string[], op: AppOp): void {
  const at = m.indexOf(op.tab);
  if (op.op === "addAppTab") {
    if (at >= 0 || fixed.includes(op.tab)) throw new StaleDraftError(`${op.tab} is already a tab of the app.`);
  } else {
    if (at < 0) throw new StaleDraftError(fixed.includes(op.tab) ? `${op.tab} belongs to the app's package, so it can't be changed.` : `${op.tab} isn't a tab of the app.`);
    m.splice(at, 1);
  }
  if (op.op === "removeAppTab") return;
  const before = op.before ? m.indexOf(op.before) : m.length;
  if (before < 0) throw new StaleDraftError(`${op.before} isn't a tab of the app.`);
  m.splice(before, 0, op.tab);
}

/** The tabs once `ops` are applied; throws `StaleDraftError` when they no longer fit. */
export function applyAppOps(base: string[], fixed: string[], ops: AppOp[]): string[] {
  const m = [...base];
  for (const op of ops) applyOp(m, fixed, op);
  return m;
}

/** Ops that turn `base` into `target`: removals, then each tab last first goes right before the one after it. */
export function diffAppOps(base: string[], target: string[]): AppOp[] {
  const cur = [...base];
  const ops: AppOp[] = [];
  const push = (op: AppOp) => {
    applyOp(cur, [], op);
    ops.push(op);
  };
  for (const t of base) if (!target.includes(t)) push({ op: "removeAppTab", tab: t });
  for (let j = target.length - 1; j >= 0; j--) {
    const tab = target[j];
    const before = target[j + 1] ?? null;
    const at = cur.indexOf(tab);
    if (at >= 0 && (cur[at + 1] ?? null) === before) continue;
    push(at >= 0 ? { op: "moveAppTab", tab, before } : { op: "addAppTab", tab, before });
  }
  return ops;
}

/** The app's tab order as the iPad draws it: the package's tabs, then the subscriber's. */
const orgOrder = (live: Pick<LiveApp, "fixedTabs" | "tabs">) => [...live.fixedTabs, ...live.tabs];

/**
 * Whether the published bar still lines up with the org's app: every tab it drew from the app
 * (those with no UI Settings record) is a tab of the app now, in the same order. When Setup
 * reordered or removed tabs since the publish they don't, and the bar stays explain-only until
 * Publish to iPad.
 */
export function alignAppNav(bar: DraftTab[], live: LiveApp): boolean {
  const drawn = bar.filter((d) => !d.item && !d.create && d.tab.kind !== "recent").map((d) => d.tab.fullName);
  if (!drawn.length) return false;
  const order = orgOrder(live);
  let k = 0;
  for (const name of order) if (name === drawn[k]) k++;
  return k === drawn.length;
}

export interface AppDraft {
  fullName: string;
  label: string;
  live: LiveApp;
  /** The editable tabs in the org, in order. */
  base: string[];
  /** The editable tabs once the tray is applied. */
  target: string[];
  /** The tabs drawn in the bar that can be arranged, in Draft order: moves step past these only. */
  shown: string[];
}

export function appFix(fullName: string, label: string, ops: AppOp[]): AppEditFix {
  return appOpsChange(fullName, label, ops) as AppEditFix;
}

/** The tabs once the tray is applied; throws `StaleDraftError` when the queued ops don't fit the org's app. */
export function appTargetOf(fullName: string, live: LiveApp, pending: PendingChange[]): string[] {
  const queued = pendingFor(pending, appFix(fullName, "", []))?.fix;
  return queued?.kind === "editMetadata" && queued.doc.type === "CustomApplication" ? applyAppOps(live.tabs, live.fixedTabs, queuedAppOps(pending, fullName)) : [...live.tabs];
}

/**
 * The bar with the app's tabs as the tray leaves them. The tabs the app owns that the bar already draws
 * hold their places ("slots"); the arranged order is poured into those slots, removed tabs stay as ghosts
 * where they were, and added tabs go right after the tab they were placed behind. Tabs Setup added to the app
 * since the publish (in the org's list, not in the bar and not hidden for the profile) are drawn like added ones.
 * (A tab added just before a UI Settings tab is drawn after it; the UI Settings TabOrder is absolute and merged by the app.)
 */
export function draftAppBar(bar: DraftTab[], live: LiveApp, base: string[], target: string[], hidden: ReadonlySet<string> = new Set()): DraftTab[] {
  const own = new Set(base);
  const slots: number[] = [];
  bar.forEach((d, i) => {
    if (own.has(d.tab.fullName) && !d.item && !d.create) slots.push(i);
  });
  const there = new Set(slots.map((i) => bar[i].tab.fullName));
  const drawnAlready = new Set(bar.map((d) => d.tab.fullName));
  const orgNew = new Set(base.filter((t) => !drawnAlready.has(t) && !hidden.has(t)));
  const common = base.filter((t) => there.has(t) && target.includes(t));
  const commonTarget = target.filter((t) => there.has(t) && base.includes(t));
  const labelOf = (name: string) => live.available.find((a) => a.name === name)?.label ?? name;
  // Hidden tabs of the app are not drawn; added ones are.
  const group = withGhosts(base, target).filter((o) => there.has(o.key) || !base.includes(o.key) || orgNew.has(o.key));
  const isSlot = (key: string) => there.has(key);
  const draw = (o: { key: string; ghost: boolean }): DraftTab => {
    if (!base.includes(o.key)) return { tab: addedTab(o.key, labelOf(o.key)), state: "added" };
    if (!isSlot(o.key)) {
      const tab = { ...addedTab(o.key, o.key), emptyReason: "In the org but not on iPads yet. Publish to iPad so reps get it." };
      return { tab, state: o.ghost ? "removed" : "same" };
    }
    const was = bar[slots.find((i) => bar[i].tab.fullName === o.key)!];
    const state: DraftState = o.ghost ? "removed" : common.indexOf(o.key) !== commonTarget.indexOf(o.key) ? "moved" : "same";
    return { ...was, state };
  };
  const out: DraftTab[] = [];
  if (!slots.length) {
    const extra = group.filter((o) => !isSlot(o.key)).map(draw);
    if (!extra.length) return bar;
    const known = new Set([...live.fixedTabs, ...base]);
    let at = bar.length;
    bar.forEach((d, i) => {
      if (known.has(d.tab.fullName)) at = i + 1;
    });
    if (at === bar.length && bar[bar.length - 1]?.tab.kind === "recent") at = bar.length - 1;
    return [...bar.slice(0, at), ...extra, ...bar.slice(at)];
  }
  let cursor = 0;
  let slot = 0;
  bar.forEach((d, i) => {
    if (slots[slot] !== i) {
      out.push(d);
      return;
    }
    slot++;
    const last = slot === slots.length;
    // Everything up to the next tab that is in the bar already, and the extra tabs behind this one.
    let seen = false;
    while (cursor < group.length) {
      const extra = !isSlot(group[cursor].key);
      if (!last && seen && !extra) break;
      if (!extra) seen = true;
      out.push(draw(group[cursor++]));
    }
  });
  return out;
}

export type AppMatchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; app: { fullName: string; label: string; installed: boolean } | null; reason?: string };

export type LiveAppState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; live: LiveApp };

/** The profile's app in edit mode: not looked at, loading, unreadable, out of line with the last publish (or not known), or ready to draw and edit. */
export type AppEntry =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error"; error: string; fullName?: string }
  | { status: "stale"; note: string; live?: LiveApp }
  | { status: "ready"; draft: AppDraft };

const APP_CHANGED =
  "The app's navigation changed in Setup since this profile's last publish, so the tab bar drawn here doesn't line up with it. Publish to iPad to edit the tabs here.";

/** The bar with the app's edits laid over `bar` (the UI Settings tabs already applied), and what state the app is in. */
export function buildAppBar(bar: DraftTab[], match: AppMatchState, liveApps: Record<string, LiveAppState>, overlay: PendingChange[], hidden?: ReadonlySet<string>): { bar: DraftTab[]; entry: AppEntry } {
  if (match.status === "idle") return { bar, entry: { status: "none" } };
  if (match.status === "loading") return { bar, entry: { status: "loading" } };
  if (match.status === "error") return { bar, entry: { status: "error", error: match.error } };
  if (!match.app) return { bar, entry: { status: "stale", note: match.reason ?? "Which app this profile's tab bar comes from isn't known." } };
  const { fullName, label } = match.app;
  const state = liveApps[fullName];
  if (!state || state.status === "loading") return { bar, entry: { status: "loading" } };
  if (state.status === "error") return { bar, entry: { status: "error", error: state.error, fullName } };
  const live = state.live;
  if (!alignAppNav(bar, live)) return { bar, entry: { status: "stale", note: APP_CHANGED, live } };
  try {
    const target = appTargetOf(fullName, live, overlay);
    const drawn = draftAppBar(bar, live, live.tabs, target, hidden);
    const shown = drawn.filter((d) => d.state !== "removed" && target.includes(d.tab.fullName)).map((d) => d.tab.fullName);
    return { bar: drawn, entry: { status: "ready", draft: { fullName, label: live.label || label, live, base: live.tabs, target, shown } } };
  } catch (e) {
    if (!(e instanceof StaleDraftError)) throw e;
    return { bar, entry: { status: "stale", note: `The queued edits no longer fit the app: ${e.message} Take them out of the tray and refresh the preview.`, live } };
  }
}

// --- Verbs -------------------------------------------------------------------------

/** The tray with this app arranged as `next` (its change dropped when that's the org's). */
function arrange(d: AppDraft, next: string[], pending: PendingChange[]): PendingChange[] {
  const without = pending.filter((p) => !(p.fix.kind === "editMetadata" && p.fix.doc.type === "CustomApplication" && p.fix.doc.fullName === d.fullName));
  return queueChange(without, { fix: appFix(d.fullName, d.label, diffAppOps(d.live.tabs, next)) });
}

function verb(d: AppDraft, id: Verb["id"], label: string, title: string, edit: (m: string[]) => string[] | null, reason?: string): Verb {
  const next = edit([...d.target]);
  return next ? { id, label, title, run: (p) => arrange(d, next, p) } : { id, label, title, reason: reason ?? title };
}

/**
 * Swap places with the nearest shown neighbour, or null at an end. Tabs the profile doesn't see stay with the
 * shown tab before them, so moving right steps over the neighbour and the hidden tabs behind it, and Move left
 * then puts the tab back exactly where it was.
 */
function step(order: string[], shown: string[], tab: string, dir: -1 | 1): string[] | null {
  const vis = shown.filter((t) => order.includes(t));
  const other = vis[vis.indexOf(tab) + dir];
  if (!vis.includes(tab) || other === undefined) return null;
  const out = order.filter((t) => t !== tab);
  let at = out.indexOf(other);
  if (dir > 0) {
    while (at + 1 < out.length && !vis.includes(out[at + 1])) at++;
    at++;
  }
  out.splice(at, 0, tab);
  return out;
}

/** "Add tab…": tabs the app doesn't have yet, placed after `after` (or first among the arranged tabs). */
function addVerb(d: AppDraft, after: string | null): Verb {
  const title = "Add a tab to the app's navigation";
  const taken = new Set([...d.target, ...d.live.fixedTabs]);
  const options = d.live.available
    .filter((a) => !taken.has(a.name))
    .map((a) => ({ value: a.name, label: a.label, detail: `${a.kind === "object" ? "Object tab" : "Page tab"} · ${a.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (!d.live.available.length) return { id: "addTab", label: "Add tab…", title, reason: "Couldn't read the org's tabs." };
  return {
    id: "addTab",
    label: "Add tab…",
    title,
    pick: {
      title: "Add a tab to the app",
      placeholder: "Search tabs",
      options,
      empty: "Every tab the org has is already in the app.",
      run: (tab, p) => {
        const next = [...d.target];
        const at = after === null ? 0 : next.indexOf(after) + 1;
        next.splice(at, 0, tab);
        return arrange(d, next, p);
      },
    },
  };
}

/** Whether the app's arrangement governs this tab: one of its own, added in Draft, or taken out in Draft. */
export const isAppTab = (d: AppDraft, tab: string): boolean => d.target.includes(tab) || d.base.includes(tab);

/** Verbs for a tab of the app; `tab` may be one removed in Draft (drawn as a ghost) or one added in it. */
export function appTabVerbs(d: AppDraft, tab: string, label: string): Verb[] {
  if (!d.target.includes(tab)) {
    if (!d.base.includes(tab)) return [];
    return [verb(d, "restore", "Restore", `Put ${label} back in the app's tab bar`, (m) => withGhosts(d.base, m, (t) => t === tab).map((o) => o.key))];
  }
  return [
    verb(d, "up", "Move left", `Move ${label} left`, (m) => step(m, d.shown, tab, -1), "Already the first tab you can arrange"),
    verb(d, "down", "Move right", `Move ${label} right`, (m) => step(m, d.shown, tab, 1), "Already the last tab"),
    verb(d, "remove", "Remove", `Take ${label} out of the app's tab bar`, (m) => m.filter((t) => t !== tab)),
    addVerb(d, tab),
  ];
}

/** Verbs for a tab the package owns (or any other tab the app arranges around): only adding one, first among the arranged tabs. */
export function appFixedTabVerbs(d: AppDraft): Verb[] {
  return [addVerb(d, null)];
}

/**
 * A tab dropped right before the drawn tab `before` (null: last): one diffed change, as Move left / right queue.
 * `drawn` are the names in the bar in order; the tab goes in front of the first tab at or after `before` that the
 * app arranges. Null when the tab isn't one of them.
 */
export function moveAppTabTo(d: AppDraft, tab: string, before: string | null, drawn: string[], pending: PendingChange[]): PendingChange[] | null {
  if (before === tab || !d.target.includes(tab)) return pending;
  const from = before === null ? -1 : drawn.indexOf(before);
  const mine = before === null || from < 0 ? null : (drawn.slice(from).find((n) => n !== tab && d.target.includes(n)) ?? null);
  if (before !== null && from < 0) return null;
  const next = d.target.filter((t) => t !== tab);
  next.splice(mine === null ? next.length : next.indexOf(mine), 0, tab);
  return next.every((t, i) => t === d.target[i]) ? pending : arrange(d, next, pending);
}
