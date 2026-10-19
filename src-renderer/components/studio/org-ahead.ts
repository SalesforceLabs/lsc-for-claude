import type { PublishedIpad } from "./published-types";
import type { EditTarget } from "./edit-targets";

/**
 * "In the org, not on iPads yet": the middle of three states the iPad preview tells apart —
 * on iPads (the published cache, unmarked), in the org but not published (dotted amber), and
 * in your tray (queued, purple). Pure, so the grouping, the markers and the wording are tested
 * without a renderer. The types are a structural copy of `src/studio/unpublished-logic.ts`.
 */

/** Class on a Draft block that is in the org but not in the published cache (set by the Draft drawers, styled in record.css). */
export const ORG_AHEAD_CLASS = "draft-org-ahead";
/** The small tag on such a block; record.css draws the same text, and a test keeps the two equal. */
export const ORG_AHEAD_TAG = "Not on iPads yet";
/** The tag on a block the org removed that iPads still have. */
export const ORG_AHEAD_GONE = "Removed in the org";
export const ORG_AHEAD_NOTE = "This is in the org but not on iPads yet. Publish to iPad so reps get it.";
export const ORG_AHEAD_GONE_NOTE = "This was removed in the org but is still on iPads. Publish to iPad so reps lose it.";
export const ORG_AHEAD_LEGEND = {
  published: "On iPads",
  org: "In the org, not published",
  tray: "In your tray",
} as const;

export type UnpublishedKind =
  | "layout"
  | "compactLayout"
  | "flexiPage"
  | "app"
  | "recordType"
  | "tab"
  | "listView"
  | "dbSchema"
  | "uiSetting"
  | "action"
  | "appSetting";

export interface UnpublishedItem {
  id: string;
  kind: UnpublishedKind;
  name: string;
  label: string;
  lastModifiedAt: string;
  lastModifiedBy: string | null;
  target: string;
  /** Already live on iPads without a publish. */
  live?: boolean;
  /** What changed, when the server can say (Admin Console records). */
  summary?: string[];
}

export interface UnpublishedResult {
  profile: string;
  cacheAt: string | null;
  cacheStartedAt: string | null;
  checkedAt: string;
  noCache: boolean;
  items: UnpublishedItem[];
  errors: { kind: string; message: string }[];
  scoped: boolean;
}

export type UnpublishedState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; result: UnpublishedResult; cachedAt?: string };

/** What the header indicator shows. */
export type Indicator =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** Checked everything, nothing is waiting. */
  | { kind: "upToDate"; publishedAt: string | null }
  /** `count` changes need a publish; `incomplete` when some kinds couldn't be read. */
  | { kind: "changes"; count: number; incomplete: boolean; publishedAt: string | null }
  /** Part of the check failed and nothing was found in the rest: never "up to date". */
  | { kind: "partial"; message: string }
  | { kind: "neverPublished" };

/** Changes that need a publish (list views are live already). */
export const pendingItems = (items: UnpublishedItem[]): UnpublishedItem[] => items.filter((i) => !i.live);

export function indicatorFor(state: UnpublishedState | undefined): Indicator {
  if (!state || state.status === "loading") return { kind: "loading" };
  if (state.status === "error") return { kind: "error", message: state.error };
  const r = state.result;
  if (r.noCache) return { kind: "neverPublished" };
  const count = pendingItems(r.items).length;
  const incomplete = r.errors.length > 0;
  if (count > 0) return { kind: "changes", count, incomplete, publishedAt: r.cacheAt };
  if (incomplete) return { kind: "partial", message: r.errors.map((e) => e.kind).join(", ") };
  return { kind: "upToDate", publishedAt: r.cacheAt };
}

/** The pill's words. */
export function indicatorLabel(i: Indicator, now = Date.now()): string {
  switch (i.kind) {
    case "loading":
      return "Checking for unpublished changes…";
    case "error":
    case "partial":
      return "Couldn't check for unpublished changes";
    case "neverPublished":
      return "Never published to iPads";
    case "upToDate":
      return i.publishedAt ? `iPads up to date · published ${timeAgo(i.publishedAt, now)}` : "iPads up to date";
    case "changes":
      return `${i.count} ${i.count === 1 ? "change" : "changes"} not on iPads yet`;
  }
}

/** "just now", "12 min ago", "3 hours ago", "yesterday", "3 days ago", then the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return `on ${new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

export interface ItemGroup {
  id: string;
  title: string;
  /** Said under the title when the group isn't what the pill counts. */
  note?: string;
  items: UnpublishedItem[];
}

const GROUPS: { id: string; title: string; kinds: UnpublishedKind[]; note?: string }[] = [
  { id: "pages", title: "Pages and layouts", kinds: ["layout", "compactLayout", "flexiPage", "recordType"] },
  { id: "tabs", title: "Tabs", kinds: ["tab", "uiSetting", "app"] },
  { id: "actions", title: "Actions", kinds: ["action"] },
  { id: "sync", title: "iPad sync", kinds: ["dbSchema"] },
  { id: "settings", title: "App settings", kinds: ["appSetting"] },
  { id: "live", title: "Already live", kinds: ["listView"], note: "iPads read list views from the org when a rep opens them, so these need no publish." },
];

/** Changes grouped by kind in a fixed order, newest first inside each; empty groups are dropped. */
export function groupItems(items: UnpublishedItem[]): ItemGroup[] {
  const byTime = (a: UnpublishedItem, b: UnpublishedItem) => Date.parse(b.lastModifiedAt) - Date.parse(a.lastModifiedAt) || a.label.localeCompare(b.label);
  return GROUPS.map((g) => ({ id: g.id, title: g.title, note: g.note, items: items.filter((i) => g.kinds.includes(i.kind)).sort(byTime) })).filter((g) => g.items.length > 0);
}

/** What a row calls its kind: "Page layout", "Record header"… */
export function kindLabel(kind: UnpublishedKind): string {
  switch (kind) {
    case "layout":
      return "Page layout";
    case "compactLayout":
      return "Record header";
    case "flexiPage":
      return "Lightning page";
    case "app":
      return "App tab bar";
    case "recordType":
      return "Record type";
    case "tab":
      return "Tab";
    case "listView":
      return "List view";
    case "dbSchema":
      return "DB Schema";
    case "uiSetting":
      return "Tab setting";
    case "action":
      return "Action";
    case "appSetting":
      return "App setting";
  }
}

/** "Ann · 3 hours ago", or just the time when the org doesn't say who. */
export function whoWhen(item: UnpublishedItem, now = Date.now()): string {
  const when = timeAgo(item.lastModifiedAt, now);
  return item.lastModifiedBy ? `${item.lastModifiedBy} · ${when}` : when;
}

/** The inspector's sentence for a block whose document changed in the org. */
export function inspectorNote(item: UnpublishedItem): string {
  const date = new Date(item.lastModifiedAt);
  const when = Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "an unknown date";
  const who = item.lastModifiedBy ? ` by ${item.lastModifiedBy}` : "";
  return item.live
    ? `Changed in the org on ${when}${who}. iPads read this from the org, so reps already have it.`
    : `Changed in the org on ${when}${who}. iPads still show this version until you publish.`;
}

/** The snapshot's documents, so the check ignores changes to other profiles'. */
export function knownDocuments(s: PublishedIpad): Record<string, string[]> {
  const objects = Object.values(s.objects);
  return {
    layouts: Object.keys(s.layouts),
    compactLayouts: Object.keys(s.compactLayouts),
    flexiPages: Object.keys(s.pages),
    recordTypes: objects.flatMap((o) => o.recordTypes.map((r) => `${o.name}.${r.name}`)),
    listViews: objects.flatMap((o) => o.listViews.map((v) => `${o.name}.${v.name}`)),
    tabs: s.tabs.map((t) => t.fullName),
  };
}

const norm = (name: string): string => {
  let n = name;
  try {
    n = decodeURIComponent(name);
  } catch {
    // Compared as written.
  }
  return n.trim().toLowerCase();
};

/** Where in the preview each changed item lands, for markers and the inspector. */
export interface OrgAheadIndex {
  count: number;
  tabs: Map<string, UnpublishedItem>;
  layouts: Map<string, UnpublishedItem>;
  compacts: Map<string, UnpublishedItem>;
  pages: Map<string, UnpublishedItem>;
  /** Lightning apps by full name, which mark the tab bar. */
  apps: Map<string, UnpublishedItem>;
  listViews: Map<string, UnpublishedItem>;
  /** Record types by object, which mark the object's record view. */
  recordTypes: Map<string, UnpublishedItem[]>;
  /** Admin Console records by `Category:DeveloperName`, the id of a Studio item. */
  config: Map<string, UnpublishedItem>;
}

/** `tabItemIds`: the Admin Console item behind each tab (`tab fullName → item id`), so a changed tab setting marks its tab. */
export function buildOrgAhead(items: UnpublishedItem[], tabItemIds: Map<string, string> = new Map()): OrgAheadIndex {
  const idx: OrgAheadIndex = {
    count: pendingItems(items).length,
    tabs: new Map(),
    layouts: new Map(),
    compacts: new Map(),
    pages: new Map(),
    apps: new Map(),
    listViews: new Map(),
    recordTypes: new Map(),
    config: new Map(),
  };
  for (const i of items) {
    const key = norm(i.name);
    switch (i.kind) {
      case "tab":
        idx.tabs.set(key, i);
        break;
      case "layout":
        idx.layouts.set(key, i);
        break;
      case "compactLayout":
        idx.compacts.set(key, i);
        break;
      case "flexiPage":
        idx.pages.set(key, i);
        break;
      case "listView":
        idx.listViews.set(key, i);
        break;
      case "app":
        idx.apps.set(key, i);
        break;
      case "recordType": {
        const object = i.name.split(".")[0];
        idx.recordTypes.set(object, [...(idx.recordTypes.get(object) ?? []), i]);
        break;
      }
      default:
        idx.config.set(i.name, i);
    }
  }
  for (const [tab, itemId] of tabItemIds) {
    const hit = idx.config.get(itemId);
    if (hit && !idx.tabs.has(norm(tab))) idx.tabs.set(norm(tab), hit);
  }
  return idx;
}

export const EMPTY_ORG_AHEAD: OrgAheadIndex = buildOrgAhead([]);

export const orgAheadLayout = (idx: OrgAheadIndex, name: string | null | undefined) => (name ? idx.layouts.get(norm(name)) : undefined);
export const orgAheadCompact = (idx: OrgAheadIndex, object: string, name: string | null | undefined) => (name ? idx.compacts.get(norm(`${object}.${name}`)) : undefined);
export const orgAheadPage = (idx: OrgAheadIndex, name: string | null | undefined) => (name ? idx.pages.get(norm(name)) : undefined);
export const orgAheadTab = (idx: OrgAheadIndex, fullName: string) => idx.tabs.get(norm(fullName));
export const orgAheadApp = (idx: OrgAheadIndex, fullName: string | null | undefined) => (fullName ? idx.apps.get(norm(fullName)) : undefined);
export const orgAheadListView = (idx: OrgAheadIndex, object: string, name: string) => idx.listViews.get(norm(`${object}.${name}`));

/** The changed item behind a selected block, if its document changed in the org. */
export function orgAheadFor(idx: OrgAheadIndex, t: EditTarget): UnpublishedItem | undefined {
  switch (t.kind) {
    case "tab":
      return orgAheadTab(idx, t.fullName);
    case "section":
    case "field":
      return orgAheadLayout(idx, t.layout);
    case "related":
      return orgAheadLayout(idx, t.layout);
    case "highlights":
      return orgAheadCompact(idx, t.object, t.compactLayout);
    case "headerField":
      return idx.compacts.get(norm(t.compactLayout));
    case "component":
    case "recordTab":
      return orgAheadPage(idx, t.page);
    case "listView":
      return orgAheadListView(idx, t.object, t.name);
    case "listColumn":
      return idx.listViews.get(norm(t.listView));
    case "action":
      return undefined;
  }
}

/** A one-shot request to open a tab (and a record) in the preview; `nonce` tells a new request from the last. */
export interface Reveal {
  nonce: number;
  tab: string | null;
  record: boolean;
}

/** Where "Show" takes the admin. */
export type RevealPlan =
  /** Switch to Draft, open the tab (and a record when `record`), and select `select` when there is one. */
  | { kind: "preview"; tab: string | null; record: boolean; select: EditTarget | null }
  /** The change is an Admin Console record: open it in its Setup page. */
  | { kind: "setup"; feature: string; surface: string | null; item: string }
  | null;

/** The object's tab on the iPad: the one that opens its list. */
function objectTab(s: PublishedIpad, object: string): string | null {
  return s.tabs.find((t) => t.kind === "object" && t.sobject === object)?.fullName ?? null;
}

/** The layout `Object-Name` belongs to the first record type that uses it; the object is the part before the dash. */
const objectOfLayout = (name: string): string => name.split("-")[0];

export function revealPlan(item: UnpublishedItem, s: PublishedIpad): RevealPlan {
  switch (item.kind) {
    case "app":
      return { kind: "preview", tab: s.tabs[0]?.fullName ?? null, record: false, select: null };
    case "tab": {
      const tab = s.tabs.find((t) => norm(t.fullName) === norm(item.name));
      return tab ? { kind: "preview", tab: tab.fullName, record: false, select: { kind: "tab", fullName: tab.fullName, label: tab.label, index: s.tabs.indexOf(tab) } } : null;
    }
    case "layout": {
      const object = objectOfLayout(item.name);
      const layout = Object.keys(s.layouts).find((n) => norm(n) === norm(item.name));
      if (!layout) return null;
      const sections = s.layouts[layout].sections;
      return {
        kind: "preview",
        tab: objectTab(s, object),
        record: true,
        select: sections.length ? { kind: "section", layout, index: 0, count: sections.length, label: sections[0].label } : null,
      };
    }
    case "compactLayout": {
      const [object] = item.name.split(".");
      const key = Object.keys(s.compactLayouts).find((n) => norm(n) === norm(item.name));
      if (!key) return null;
      return {
        kind: "preview",
        tab: objectTab(s, object),
        record: true,
        select: { kind: "highlights", object, compactLayout: key.slice(object.length + 1), fields: s.compactLayouts[key] },
      };
    }
    case "flexiPage": {
      const page = Object.keys(s.pages).find((n) => norm(n) === norm(item.name));
      if (!page) return null;
      if (s.home && norm(s.home.name) === norm(page)) return { kind: "preview", tab: s.tabs.find((t) => t.kind === "home")?.fullName ?? null, record: false, select: null };
      const object = Object.values(s.objects).find((o) => o.recordTypes.some((r) => r.flexiPage && norm(r.flexiPage) === norm(page)));
      const tab = s.tabs.find((t) => t.kind === "flexiPage" && t.flexiPage && norm(t.flexiPage) === norm(page));
      return { kind: "preview", tab: tab?.fullName ?? (object ? objectTab(s, object.name) : null), record: !tab && !!object, select: null };
    }
    case "recordType": {
      const [object] = item.name.split(".");
      return { kind: "preview", tab: objectTab(s, object), record: true, select: null };
    }
    case "listView": {
      const [object, name] = item.name.split(".");
      const view = s.objects[object]?.listViews.find((v) => norm(v.name) === norm(name));
      return {
        kind: "preview",
        tab: objectTab(s, object),
        record: false,
        select: view ? { kind: "listView", object, name: view.name, label: view.label } : null,
      };
    }
    case "dbSchema":
      return { kind: "setup", feature: "mobile-sync", surface: "syncedObjects", item: item.name };
    case "uiSetting":
      return { kind: "setup", feature: "actions-home", surface: "navigationTabs", item: item.name };
    case "action":
    case "appSetting":
      return { kind: "setup", feature: "actions-home", surface: null, item: item.name };
  }
}
