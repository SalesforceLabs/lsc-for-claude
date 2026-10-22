import type { Audience, FeatureMap, LayoutSidebar, Severity, StudioItem, SurfaceId } from "./types";
import { fitFor, type Fit, type Lens } from "./lens";
import { worstSeverity } from "./findings";
import { effectiveActive, effectiveProfiles, pendingFor, activeChange, profileChange, queuedLayoutOps, type PendingChange } from "./changes";

/**
 * Studio's iPad preview — a block render of what LSC Mobile shows one profile,
 * built from the Actions & Home Page and Mobile Sync maps. Purely client-side;
 * queued changes are applied so the preview shows the iPad after they're applied
 * and published.
 */

/** A block on the preview, linked back to the board item it comes from. */
export interface IpadBlock {
  featureId: string;
  surface: SurfaceId;
  itemId: string;
  label: string;
  fit: Exclude<Fit, "excluded">;
  reason?: string;
  severity?: Severity;
  /** A queued change touches this item. */
  pending: boolean;
  /** Small tag, e.g. "Stage path". */
  tag?: string;
}

/** Whether the tab's object reaches the iPad — `unknown` when it isn't an object or Mobile Sync isn't loaded. */
export type SyncState = "synced" | "notSynced" | "unknown";

export interface IpadTab extends IpadBlock {
  tabName: string;
  /** The object the tab lists, when Studio knows it — tab names are often plural ("Accounts"). */
  object?: string;
  isHome: boolean;
  sync: SyncState;
  /** Actions on this object's record pages. */
  recordActions: IpadBlock[];
}

export interface IpadCache {
  state: "profile" | "orgLevel" | "none" | "unknown";
  label: string;
  block?: IpadBlock;
}

export interface IpadPreview {
  tabs: IpadTab[];
  homeActions: IpadBlock[];
  /** Actions on Next Best Customer cards; the home page shows the NBC widget when the profile has any. */
  nbcActions: IpadBlock[];
  /** Set when no tab is the home page — the home page actions are still shown. */
  homeMissing: boolean;
  cache: IpadCache;
  /** Active items the profile doesn't get, by kind — for "N hidden" notes. */
  hidden: { tabs: number; actions: number };
  pendingCount: number;
}

type Located = { featureId: string; surface: SurfaceId; item: StudioItem };

const str = (v: unknown) => (v == null ? "" : String(v));
const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
/** Tab name → object name candidates: "Opportunities" → Opportunity, "Visits" → Visit. */
const objectCandidates = (tabName: string) => [tabName, tabName.replace(/ies$/i, "y"), tabName.replace(/e?s$/i, ""), tabName.replace(/s$/i, "")];
const isHomeTab = (tabName: string, label: string) => /home/i.test(tabName) || /^home$/i.test(label);

/** The item's audience with any queued profile change applied. */
function effectiveAudience(item: StudioItem, pending: PendingChange[]): Audience | undefined {
  const edit = item.edit;
  if (!edit?.profiles) return item.audience;
  const probe = profileChange(edit, []);
  if (!probe || !pendingFor(pending, probe)) return item.audience;
  const profiles = effectiveProfiles(edit, pending);
  const permissionSets = item.audience?.permissionSets ?? [];
  // An action with no profiles or permission sets listed shows to everyone.
  if (edit.profiles.source === "field" && profiles.length === 0 && permissionSets.length === 0) return undefined;
  return { profiles, permissionSets };
}

function isPending(item: StudioItem, pending: PendingChange[]): boolean {
  const edit = item.edit;
  if (!edit) return false;
  const toggle = activeChange(edit, !edit.active);
  const profiles = profileChange(edit, []);
  return !!(toggle && pendingFor(pending, toggle)) || !!(profiles && pendingFor(pending, profiles));
}

function isActive(item: StudioItem, pending: PendingChange[]): boolean {
  if (item.edit) return effectiveActive(item.edit, pending) !== false;
  return item.active !== false;
}

/** A block for the item, or null when the profile doesn't get it (or it's off). */
function toBlock({ featureId, surface, item }: Located, lens: Lens, pending: PendingChange[]): IpadBlock | null {
  if (!isActive(item, pending)) return null;
  const { fit, reason } = fitFor({ ...item, audience: effectiveAudience(item, pending) }, lens);
  if (fit === "excluded") return null;
  return {
    featureId,
    surface,
    itemId: item.id,
    label: item.label,
    fit,
    reason,
    severity: worstSeverity(item.findings) ?? undefined,
    pending: isPending(item, pending),
  };
}

function itemsOf(map: FeatureMap | null, surfaces: SurfaceId[]): Located[] {
  if (!map) return [];
  return map.surfaces
    .filter((s) => surfaces.includes(s.id))
    .flatMap((s) => s.items.map((item) => ({ featureId: map.featureId, surface: s.id, item })));
}

const sortOrder = (l: Located) => {
  const n = Number(l.item.properties.SortOrder);
  return Number.isFinite(n) && l.item.properties.SortOrder !== null && l.item.properties.SortOrder !== "" ? n : Infinity;
};
const bySortOrder = (a: Located, b: Located) => sortOrder(a) - sortOrder(b);

const ACTION_SURFACES = [
  "homeActions",
  "visitActions",
  "searchActions",
  "contentActions",
  "nbcActions",
  "otherQuickActions",
  "recordCustomActions",
  "stagePathActions",
];

/** Quick action locations that aren't record pages — their SObject is what they create, not where they show. */
const NON_RECORD_LOCATIONS = ["HomePage", "Search", "IntelligentContent", "NextBestCustomer", "StagePath"];

/** Whether an action shows on `object`'s record pages. */
function onRecord(item: StudioItem, object: string): boolean {
  const p = item.properties;
  if (p.Kind === "Custom Action") return !NON_RECORD_LOCATIONS.includes(str(p.EntityType)) && same(str(p.EntityName), object);
  const location = str(p.Location);
  return !NON_RECORD_LOCATIONS.includes(location) && (same(location, object) || same(str(p.SObject), object));
}

export function buildIpadPreview(
  actionsMap: FeatureMap | null,
  syncMap: FeatureMap | null,
  lens: Lens,
  pending: PendingChange[]
): IpadPreview {
  // Tabs come from whichever map is loaded; both carry the same surface.
  const tabSource = actionsMap ?? syncMap;
  const tabItems = itemsOf(tabSource, ["navigationTabs"]).sort(
    (a, b) => Number(a.item.properties.TabOrder ?? 0) - Number(b.item.properties.TabOrder ?? 0)
  );
  const actions = itemsOf(actionsMap, ACTION_SURFACES);

  // Objects that sync to this profile, and every object Mobile Sync knows about.
  const schema = (ids: SurfaceId[]) => itemsOf(syncMap, ids);
  const synced = new Set(
    schema(["syncedObjects"])
      .filter((l) => toBlock(l, lens, pending))
      .map((l) => str(l.item.properties.SObject).toLowerCase())
  );
  // Every object Mobile Sync or an action mentions, by lower-cased name.
  const known = new Map(
    [...schema(["syncedObjects", "disabledObjects"]).map((l) => str(l.item.properties.SObject))]
      .concat(actions.flatMap((l) => [str(l.item.properties.SObject), str(l.item.properties.EntityName), str(l.item.properties.Location)]))
      .filter((o) => o && o !== "HomePage")
      .map((o) => [o.toLowerCase(), o] as const)
  );
  const objectFor = (tabName: string) => objectCandidates(tabName).map((c) => known.get(c.toLowerCase())).find(Boolean);

  const recordActions = (object: string) =>
    actions
      .filter((l) => l.surface !== "homeActions" && onRecord(l.item, object))
      .sort(bySortOrder)
      .flatMap((l) => {
        const b = toBlock(l, lens, pending);
        if (!b) return [];
        return [{ ...b, tag: l.surface === "stagePathActions" ? "Stage path" : undefined }];
      });

  let hiddenTabs = 0;
  const tabs: IpadTab[] = tabItems.flatMap((l) => {
    const block = toBlock(l, lens, pending);
    if (!block) {
      if (isActive(l.item, pending)) hiddenTabs++;
      return [];
    }
    const tabName = str(l.item.properties.TabName);
    const object = objectFor(tabName);
    const sync: SyncState = !syncMap || !object ? "unknown" : synced.has(object.toLowerCase()) ? "synced" : "notSynced";
    return [{ ...block, tabName, object, isHome: isHomeTab(tabName, block.label), sync, recordActions: object ? recordActions(object) : [] }];
  });

  const home = actions.filter((l) => l.surface === "homeActions").sort(bySortOrder);
  const homeActions = home.flatMap((l) => toBlock(l, lens, pending) ?? []);
  const nbcActions = actions
    .filter((l) => l.surface === "nbcActions")
    .sort(bySortOrder)
    .flatMap((l) => toBlock(l, lens, pending) ?? []);
  const hiddenActions =
    actions.filter((l) => isActive(l.item, pending)).length -
    actions.filter((l) => toBlock(l, lens, pending)).length;

  return {
    tabs,
    homeActions,
    nbcActions,
    homeMissing: !tabs.some((t) => t.isHome),
    cache: cacheFor(syncMap, lens),
    hidden: { tabs: hiddenTabs, actions: hiddenActions },
    pendingCount: pending.length,
  };
}

/** The metadata cache the profile downloads: its own, else the org-level one. */
function cacheFor(syncMap: FeatureMap | null, lens: Lens): IpadCache {
  if (!syncMap) return { state: "unknown", label: "Load Mobile Sync to check the metadata cache" };
  const live = itemsOf(syncMap, ["metadataCache"]).filter((l) => l.item.active);
  const own = lens ? live.find((l) => l.item.audience?.profiles.some((p) => same(p, lens.profile))) : undefined;
  const org = live.find((l) => !l.item.audience);
  const pick = own ?? org;
  if (!pick) return { state: "none", label: lens ? `No metadata cache for ${lens.profile}` : "No active metadata cache" };
  const when = str(pick.item.properties["Last generated"]);
  const date = when ? new Date(when).toLocaleDateString() : "";
  return {
    state: own ? "profile" : "orgLevel",
    label: `${own ? "Profile cache" : "Org-level cache"}${date ? ` · generated ${date}` : ""}`,
    block: {
      featureId: syncMap.featureId,
      surface: pick.surface,
      itemId: pick.item.id,
      label: pick.item.label,
      fit: "applies",
      severity: worstSeverity(pick.item.findings) ?? undefined,
      pending: false,
    },
  };
}

/** An entry in the Visit engagement sidebar. */
export interface SidebarEntry {
  relationshipName: string;
  objectName?: string;
  /** "add" / "remove" when a queued change adds or takes it out. */
  pending?: "add" | "remove";
}

/** The related lists a Visit layout puts in the engagement sidebar, with queued adds and removes applied. */
export function sidebarEntries(sidebar: LayoutSidebar, pending: PendingChange[]): SidebarEntry[] {
  const entries: SidebarEntry[] = (sidebar.relatedLists ?? []).map((relationshipName) => ({ relationshipName }));
  for (const o of queuedLayoutOps(pending, sidebar.layoutName)) {
    if (o.op !== "addRelatedList" && o.op !== "removeRelatedList") continue;
    const existing = entries.find((e) => e.relationshipName === o.relatedList);
    if (o.op === "addRelatedList" && !existing) entries.push({ relationshipName: o.relatedList, objectName: o.object, pending: "add" });
    if (o.op === "removeRelatedList" && existing) existing.pending = "remove";
  }
  return entries;
}
