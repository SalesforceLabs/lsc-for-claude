import type { FlexiSource, PublishedComponent, PublishedPage } from "./published-types";
import { checkProp, DYNAMIC_COMPONENTS, IPAD_READS, normalizeProp, untypedDef, type ComponentPropDef, type ComponentProps } from "./component-props";
import type { ComponentCatalog, FlexiItemRef, FlexiPageEditFix, FlexiPageOp, FlexiPageProperty, LiveFlexiPage } from "./types";
import { flexiPageOpsChange, pendingFor, queueChange, type PendingChange } from "./changes";
import type { DraftState, Verb } from "./edit-draft";
import { StaleDraftError, withGhosts } from "./layout-draft";

/**
 * Lightning pages in Draft, the way layout-draft.ts does page layouts: the tray
 * holds one `editMetadata` change per page whose ops are the whole difference
 * between the page as it is in the org (`LiveFlexiPage`) and the page the admin
 * has arranged. Ops apply here the way the server applies them to the XML
 * (src/studio/metadata/flexipage-ops.ts). Pure: nothing here touches the org.
 */

export interface FlexiItemModel {
  /** Identity through moves: the identifier, else `region#index` in the org's page. */
  key: string;
  component: string;
  identifier: string | null;
  properties: Record<string, string>;
  facets: string[];
}

export interface FlexiRegionModel {
  name: string;
  facet: boolean;
  items: FlexiItemModel[];
}

export interface FlexiModel {
  regions: FlexiRegionModel[];
}

/** Properties Studio sets from the preview; the rest of a component is left as it is. */
/** The names of the properties either item has, in a stable order. */
const propertyKeys = (a: Record<string, string>, b: Record<string, string>): string[] => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
/** Tab titles longer than this are cut on the iPad. */
export const TAB_TITLE_MAX = 25;

export function modelOf(live: LiveFlexiPage): FlexiModel {
  return {
    regions: live.regions.map((r) => ({
      name: r.name,
      facet: r.facet,
      items: r.items.map((i, index) => ({
        key: i.identifier ?? `${r.name}#${index}`,
        component: i.component,
        identifier: i.identifier,
        properties: { ...i.properties },
        facets: [...i.facets],
      })),
    })),
  };
}

const clone = (m: FlexiModel): FlexiModel => JSON.parse(JSON.stringify(m)) as FlexiModel;

const regionOf = (m: FlexiModel, name: string) => m.regions.find((r) => r.name === name);

function findRegion(m: FlexiModel, name: string): FlexiRegionModel {
  const r = regionOf(m, name);
  if (!r) throw new StaleDraftError(`The region ${name} isn't on the page.`);
  return r;
}

/** The item `ref` names, checked the way the server checks it. */
function findItem(region: FlexiRegionModel, ref: FlexiItemRef): FlexiItemModel {
  const item = ref.identifier !== null ? region.items.find((i) => i.identifier === ref.identifier) : region.items[ref.index];
  const name = ref.identifier ?? `${ref.component} (item ${ref.index + 1})`;
  if (!item || (ref.identifier === null && item.identifier !== null)) throw new StaleDraftError(`${name} isn't in ${region.name} any more.`);
  if (item.component !== ref.component) throw new StaleDraftError(`${name} is no longer a ${ref.component}.`);
  return item;
}

export function itemRef(region: FlexiRegionModel, item: FlexiItemModel): FlexiItemRef {
  return { component: item.component, identifier: item.identifier, index: region.items.indexOf(item) };
}

/** Where the item with this key is. */
export function locateItem(m: FlexiModel, key: string): { region: FlexiRegionModel; item: FlexiItemModel; index: number } | undefined {
  for (const region of m.regions) {
    const index = region.items.findIndex((i) => i.key === key);
    if (index >= 0) return { region, item: region.items[index], index };
  }
  return undefined;
}

/** The facets `item` points at, and the ones those point at. */
function facetTree(m: FlexiModel, item: FlexiItemModel): FlexiRegionModel[] {
  const out: FlexiRegionModel[] = [];
  const walk = (it: FlexiItemModel) => {
    for (const name of it.facets) {
      const facet = regionOf(m, name);
      if (!facet || !facet.facet || out.includes(facet)) continue;
      out.push(facet);
      facet.items.forEach(walk);
    }
  };
  walk(item);
  return out;
}

/** Take an item off the page with the facets it points at (a tabset's tabs, a tab's body). */
function takeOut(m: FlexiModel, region: FlexiRegionModel, item: FlexiItemModel): void {
  const facets = facetTree(m, item);
  m.regions = m.regions.filter((r) => !facets.includes(r));
  region.items.splice(region.items.indexOf(item), 1);
}

function identifiers(m: FlexiModel): Set<string> {
  return new Set(m.regions.flatMap((r) => r.items.map((i) => i.identifier)).filter((i): i is string => !!i));
}

/** The identifier App Builder would give a new `component` — a copy of the server's `newIdentifier`. */
export function newIdentifier(component: string, taken: Set<string>): string {
  const base = component.includes(":") ? component.replace(":", "_") : `c_${component}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** `Standard.Tab.detail` / `{!$Label.ns__Dashboard}` → a readable title (as published.ts shows it). */
export function tabTitle(raw: string): string {
  const std = /^Standard\.Tab\.(\w+)$/.exec(raw);
  if (std) return ({ detail: "Details", relatedLists: "Related", activity: "Activity", feed: "Chatter", news: "News" } as Record<string, string>)[std[1]] ?? std[1];
  const label = /^\{!\$Label\.(?:\w+__)?(\w+)\}$/.exec(raw);
  if (label) return label[1].replace(/_/g, " ");
  return raw;
}

/** One op, applied the way the server applies it to the XML. */
function applyOp(m: FlexiModel, op: FlexiPageOp): void {
  switch (op.op) {
    case "moveComponent": {
      const region = findRegion(m, op.component.region);
      const item = findItem(region, op.component.item);
      // Both refs address the page as it is before the move.
      const target = op.before ? findItem(region, op.before) : null;
      if (target === item) throw new StaleDraftError("A component can't move before itself.");
      region.items.splice(region.items.indexOf(item), 1);
      region.items.splice(target ? region.items.indexOf(target) : region.items.length, 0, item);
      return;
    }
    case "removeComponent": {
      const region = findRegion(m, op.component.region);
      takeOut(m, region, findItem(region, op.component.item));
      return;
    }
    case "addComponent": {
      const region = findRegion(m, op.region);
      if (op.xml) throw new StaleDraftError("A component put back from its XML can't be drawn in Draft.");
      if (!op.identifier) throw new StaleDraftError("A new component needs an identifier.");
      if (identifiers(m).has(op.identifier)) throw new StaleDraftError(`${op.identifier} is already on the page.`);
      const target = op.before ? findItem(region, op.before) : null;
      const item: FlexiItemModel = {
        key: op.identifier,
        component: op.component,
        identifier: op.identifier,
        properties: Object.fromEntries((op.properties ?? []).map((p) => [p.name, p.value])),
        facets: [],
      };
      region.items.splice(target ? region.items.indexOf(target) : region.items.length, 0, item);
      return;
    }
    case "setComponentProperty": {
      const item = findItem(findRegion(m, op.component.region), op.component.item);
      const now = item.properties[op.property] ?? null;
      if (now !== op.from) throw new StaleDraftError(`${item.component}'s ${op.property} changed on the page.`);
      if (op.to === null) delete item.properties[op.property];
      else item.properties[op.property] = op.to;
      return;
    }
  }
}

/** The page once `ops` are applied; throws `StaleDraftError` when they no longer fit it. */
export function applyOps(base: FlexiModel, ops: FlexiPageOp[]): FlexiModel {
  const m = clone(base);
  for (const op of ops) applyOp(m, op);
  return m;
}

/**
 * Ops that turn `base` into `target` (items moved within their region or
 * facet, removed, or new; a few properties set). Each op is applied to a
 * working copy as it's chosen, so its refs are the ones the server will see:
 * removals first, then each region's order last first, then properties.
 */
export function diffOps(base: FlexiModel, target: FlexiModel): FlexiPageOp[] {
  const cur = clone(base);
  const ops: FlexiPageOp[] = [];
  const push = (op: FlexiPageOp) => {
    applyOp(cur, op);
    ops.push(op);
  };
  const wanted = new Map<string, string>();
  for (const r of target.regions) for (const i of r.items) wanted.set(i.key, r.name);

  for (const r of base.regions) {
    // A facet missing from the target went with the component that points at it.
    if (!regionOf(target, r.name)) continue;
    for (const i of r.items) {
      const region = wanted.get(i.key);
      if (region && region !== r.name) throw new StaleDraftError("Components don't move between regions.");
      if (region) continue;
      const now = regionOf(cur, r.name);
      const item = now?.items.find((x) => x.key === i.key);
      if (now && item) push({ op: "removeComponent", component: { region: r.name, item: itemRef(now, item) } });
    }
  }

  for (const tr of target.regions) {
    const cr = regionOf(cur, tr.name);
    if (!cr) throw new StaleDraftError(`The region ${tr.name} isn't on the page.`);
    const keys = new Set(tr.items.map((i) => i.key));
    for (let j = tr.items.length - 1; j >= 0; j--) {
      const item = tr.items[j];
      const next = tr.items[j + 1];
      const nextItem = next && cr.items.find((i) => i.key === next.key)!;
      const before = nextItem ? itemRef(cr, nextItem) : null;
      const at = cr.items.findIndex((i) => i.key === item.key);
      if (at >= 0) {
        const after = cr.items.slice(at + 1).find((i) => keys.has(i.key));
        if ((after?.key ?? null) === (next?.key ?? null)) continue;
        push({ op: "moveComponent", component: { region: tr.name, item: itemRef(cr, cr.items[at]) }, before });
      } else {
        if (item.facets.length) throw new StaleDraftError("A new component with facets can't be drawn in Draft.");
        const properties = Object.entries(item.properties).map(([name, value]) => ({ name, value }));
        push({ op: "addComponent", region: tr.name, before, component: item.component, identifier: item.identifier, ...(properties.length ? { properties } : {}) });
      }
    }
  }

  for (const tr of target.regions) {
    const cr = regionOf(cur, tr.name)!;
    for (const item of tr.items) {
      const now = cr.items.find((i) => i.key === item.key)!;
      for (const property of propertyKeys(now.properties, item.properties)) {
        const from = now.properties[property] ?? null;
        const to = item.properties[property] ?? null;
        if (from !== to) push({ op: "setComponentProperty", component: { region: tr.name, item: itemRef(cr, now) }, property, from, to });
      }
    }
  }
  return ops;
}

// --- The published page, lined up with the org's ---------------------------------

/** A published block's identity: its source path, as text. */
export function sourceKey(s: FlexiSource): string {
  return `${s.region}/${s.path.map((p) => p.identifier ?? `${p.component}#${p.index}`).join("/")}`;
}

/** The org item a published block's source path names, or undefined when the page doesn't have it. */
function resolve(live: FlexiModel, s: FlexiSource): { region: FlexiRegionModel; item: FlexiItemModel } | undefined {
  const top = regionOf(live, s.region);
  if (!top || top.facet || !s.path.length) return undefined;
  const find = (region: FlexiRegionModel, step: FlexiSource["path"][number]) => {
    const item = step.identifier !== null ? region.items.find((i) => i.identifier === step.identifier) : region.items[step.index];
    return item && item.component === step.component && (step.identifier !== null || item.identifier === null) ? item : undefined;
  };
  let region = top;
  let item = find(top, s.path[0]);
  for (const step of s.path.slice(1)) {
    if (!item) return undefined;
    const facets = item.facets.map((f) => regionOf(live, f)).filter((r): r is FlexiRegionModel => !!r);
    const hit = facets.map((f) => ({ f, i: find(f, step) })).find((x) => x.i);
    if (!hit) return undefined;
    region = hit.f;
    item = hit.i;
  }
  return item && { region, item };
}

/** Every block of a published page with its source, in drawing order, grouped by the list it's drawn in. */
function publishedLists(page: PublishedPage): FlexiSource[][] {
  const lists: FlexiSource[][] = [];
  const walk = (components: PublishedComponent[]) => {
    lists.push(components.map((c) => c.source!));
    for (const c of components) {
      if (!c.tabs) continue;
      lists.push(c.tabs.map((t) => t.source!));
      for (const t of c.tabs) walk(t.components);
    }
  };
  for (const r of page.regions) walk(r.components);
  return lists;
}

/**
 * Which org item each published block is (source key → item key), or null when
 * the published page no longer lines up — someone changed it in Setup since the
 * last publish, or the snapshot predates component sources.
 */
export function alignFlexiPage(page: PublishedPage, live: FlexiModel): Map<string, string> | null {
  const out = new Map<string, string>();
  for (const list of publishedLists(page)) {
    let last = -1;
    let container: FlexiRegionModel | null = null;
    for (const s of list) {
      if (!s) return null;
      const hit = resolve(live, s);
      if (!hit || (container && hit.region !== container)) return null;
      const at = hit.region.items.indexOf(hit.item);
      // Blocks are drawn in the order the page lists them.
      if (at <= last) return null;
      last = at;
      container = hit.region;
      out.set(sourceKey(s), hit.item.key);
    }
  }
  return out;
}

// --- Drawing -----------------------------------------------------------------------

/** One Lightning page in Draft: the org's version, the arranged one, and how published blocks map onto it. */
export interface PageDraft {
  fullName: string;
  label: string;
  live: LiveFlexiPage;
  base: FlexiModel;
  target: FlexiModel;
  aligned: Map<string, string>;
}

/** The org item a published block is. */
export const keyOf = (d: PageDraft, source: FlexiSource | undefined) => (source ? d.aligned.get(sourceKey(source)) : undefined);

/** The region or facet a key's item is in, in the target or else the org's page. */
export function containerOf(d: PageDraft, key: string): string | undefined {
  return (locateItem(d.target, key) ?? locateItem(d.base, key))?.region.name;
}

/** A readable name for a component Draft inserted, which has no published block. */
export function insertedLabel(component: string, properties: Record<string, string>): string {
  const name = component.includes(":") ? component.split(":")[1] : component;
  if (name === "relatedListSingleContainer" && properties.relatedListApiName) {
    return [...properties.relatedListApiName.replace(/__r$/, "")].map((ch, i) => (i > 0 && ch.toLowerCase() !== ch ? ` ${ch}` : ch)).join("");
  }
  if (name === "recentItems") return "Recent Items";
  if (/^lscMobileInline_/.test(name)) return `LWC · ${name.slice(16)}`;
  return name;
}

/**
 * A published block with the target's property edits: what the org's item has
 * and the target's doesn't is dropped, and what the target sets is passed on
 * where the iPad reads it (a property the preview already keeps, one in
 * `IPAD_READS`, or any property of a component that reads them all).
 */
function withProperties(c: PublishedComponent, props: Record<string, string>, orgProps: Record<string, string>): PublishedComponent {
  const properties = { ...c.properties };
  const name = c.name.includes(":") ? c.name.split(":")[1] : c.name;
  const all = DYNAMIC_COMPONENTS.includes(name);
  for (const k of propertyKeys(orgProps, props)) {
    if (k === "active") continue;
    if (props[k] !== undefined) {
      if (all || k in c.properties || IPAD_READS.includes(k)) properties[k] = props[k];
    } else delete properties[k];
  }
  const halfWidth = name === "ActivityPlanByProduct" ? properties.showEnhActivityPlanOnMobileHomepage !== "true" : c.halfWidth;
  return { ...c, properties, halfWidth };
}

export interface DrawnBlock<T> {
  value: T;
  /** The org item, or the inserted one. */
  key: string;
  state: DraftState;
}

/**
 * A list of published blocks in Draft order: the target's order for the
 * container they're in, removed ones left as ghosts where they were, inserted
 * ones made with `make`. Blocks the published page doesn't draw stay out.
 */
function draftList<T>(d: PageDraft, published: T[], sourceOf: (t: T) => FlexiSource | undefined, make: (item: FlexiItemModel) => T | null, edit: (t: T, item: FlexiItemModel) => T): DrawnBlock<T>[] {
  const pub = new Map<string, T>();
  for (const t of published) {
    const key = keyOf(d, sourceOf(t));
    if (key) pub.set(key, t);
  }
  const first = [...pub.keys()][0];
  const container = first && containerOf(d, first);
  if (!container) return published.map((value) => ({ value, key: "", state: "same" as DraftState }));
  const liveKeys = regionOf(d.base, container)?.items.map((i) => i.key) ?? [];
  const targetRegion = regionOf(d.target, container);
  const targetKeys = targetRegion?.items.map((i) => i.key) ?? [];
  const common = liveKeys.filter((k) => targetKeys.includes(k) && pub.has(k));
  const commonTarget = targetKeys.filter((k) => liveKeys.includes(k) && pub.has(k));
  return withGhosts(liveKeys, targetKeys).flatMap(({ key, ghost }): DrawnBlock<T>[] => {
    const item = targetRegion?.items.find((i) => i.key === key);
    const known = pub.get(key);
    if (ghost) return known ? [{ value: known, key, state: "removed" }] : [];
    if (!liveKeys.includes(key)) {
      const made = item && make(item);
      return made ? [{ value: made, key, state: "added" }] : [];
    }
    if (!known || !item) return [];
    const liveItem = regionOf(d.base, container)!.items.find((i) => i.key === key)!;
    const edited = propertyKeys(liveItem.properties, item.properties).some((p) => (liveItem.properties[p] ?? null) !== (item.properties[p] ?? null));
    const moved = common.indexOf(key) !== commonTarget.indexOf(key);
    return [{ value: edit(known, item), key, state: moved || edited ? "moved" : "same" }];
  });
}

/** A region's or tab's components as Draft draws them. */
export function draftComponents(d: PageDraft, published: PublishedComponent[]): DrawnBlock<PublishedComponent>[] {
  return draftList(
    d,
    published,
    (c) => c.source,
    (item) => ({
      name: item.component,
      label: insertedLabel(item.component, item.properties),
      supported: true,
      halfWidth: false,
      visibility: "shown",
      properties: { ...item.properties },
    }),
    (c, item) => withProperties(c, item.properties, locateItem(d.base, item.key)?.item.properties ?? {})
  );
}

type PublishedTab = NonNullable<PublishedComponent["tabs"]>[number];

/** A tabset's tabs as Draft draws them, with the target's titles and default tab. */
export function draftRecordTabs(d: PageDraft, tabs: PublishedTab[]): DrawnBlock<PublishedTab>[] {
  return draftList(
    d,
    tabs,
    (t) => t.source,
    () => null,
    (t, item) => ({ ...t, title: tabTitle(item.properties.title ?? ""), active: item.properties.active === "true" })
  );
}

// --- Verbs -------------------------------------------------------------------------

export function flexiPageFix(fullName: string, label: string, ops: FlexiPageOp[]): FlexiPageEditFix {
  return flexiPageOpsChange(fullName, label, ops) as FlexiPageEditFix;
}

/** The page's target once the tray is applied; throws `StaleDraftError` when the queued ops don't fit the org's page. */
export function targetOf(fullName: string, base: FlexiModel, pending: PendingChange[]): FlexiModel {
  const queued = pendingFor(pending, flexiPageFix(fullName, "", []))?.fix;
  return queued?.kind === "editMetadata" && queued.doc.type === "FlexiPage" ? applyOps(base, queued.ops as FlexiPageOp[]) : clone(base);
}

/** The tray with this page arranged as `next` (its change dropped when that's the org's page). */
function arrange(d: PageDraft, next: FlexiModel, pending: PendingChange[]): PendingChange[] {
  const fix = flexiPageFix(d.fullName, d.label, diffOps(d.base, next));
  const without = pending.filter((p) => !(p.fix.kind === "editMetadata" && p.fix.doc.type === "FlexiPage" && p.fix.doc.fullName === d.fullName));
  return queueChange(without, { fix, ...(d.live.profiles ? { affects: d.live.profiles } : {}) });
}

function verb(d: PageDraft, id: Verb["id"], label: string, title: string, edit: (m: FlexiModel) => boolean | void, reason?: string): Verb {
  const next = clone(d.target);
  const ok = edit(next) !== false;
  return ok ? { id, label, title, run: (p) => arrange(d, next, p) } : { id, label, title, reason: reason ?? title };
}

/** Swap places with the nearest shown neighbour, or false at an end. */
function step(region: FlexiRegionModel, shown: string[], key: string, dir: -1 | 1): boolean {
  const vis = shown.filter((k) => region.items.some((i) => i.key === k));
  const other = vis[vis.indexOf(key) + dir];
  if (!vis.includes(key) || other === undefined) return false;
  const item = region.items.find((i) => i.key === key)!;
  region.items.splice(region.items.indexOf(item), 1);
  const at = region.items.findIndex((i) => i.key === other);
  region.items.splice(dir < 0 ? at : at + 1, 0, item);
  return true;
}

/** Put a removed item back where it was in the org's page, with the facets it took along. */
function putBack(d: PageDraft, m: FlexiModel, key: string, before?: string | null): boolean {
  const was = locateItem(d.base, key);
  const region = was && regionOf(m, was.region.name);
  if (!was || !region) return false;
  const facets = facetTree(d.base, was.item).filter((f) => !regionOf(m, f.name));
  m.regions.push(...(JSON.parse(JSON.stringify(facets)) as FlexiRegionModel[]));
  const item = JSON.parse(JSON.stringify(was.item)) as FlexiItemModel;
  if (before !== undefined) {
    const at = before === null ? -1 : region.items.findIndex((i) => i.key === before);
    region.items.splice(at < 0 ? region.items.length : at, 0, item);
    return true;
  }
  const order = withGhosts(was.region.items.map((i) => i.key), region.items.map((i) => i.key), (k) => k === key).map((o) => o.key);
  region.items = order.map((k) => (k === key ? item : region.items.find((i) => i.key === k)!));
  return true;
}

/** Up / down / remove (or restore) for a component or record tab; `shown` is its list's keys as drawn, ghosts left out. */
export function componentVerbs(d: PageDraft, key: string, label: string, shown: string[], tab = false): Verb[] {
  const at = locateItem(d.target, key);
  const what = tab ? "tab" : "component";
  if (!at) {
    if (!locateItem(d.base, key)) return [];
    return [verb(d, "restore", "Restore", `Put ${label} back on the page`, (m) => putBack(d, m, key), `Restore the ${tab ? "tabs" : "tab"} it was in first`)];
  }
  const move = (dir: -1 | 1) => (m: FlexiModel) => step(locateItem(m, key)!.region, shown, key, dir);
  const out = [
    verb(d, "up", tab ? "Move left" : "Move up", `Move ${label} ${tab ? "left" : "up"}`, move(-1), `Already the first ${what}`),
    verb(d, "down", tab ? "Move right" : "Move down", `Move ${label} ${tab ? "right" : "down"}`, move(1), `Already the last ${what}`),
  ];
  if (tab) {
    const isDefault = at.item.properties.active === "true";
    out.push(
      verb(
        d,
        "default",
        "Make default",
        `Open the page on ${label}`,
        (m) => {
          if (isDefault) return false;
          for (const i of locateItem(m, key)!.region.items) delete i.properties.active;
          locateItem(m, key)!.item.properties.active = "true";
        },
        "Already the tab the page opens on"
      )
    );
  }
  out.push(
    verb(d, "remove", "Remove", tab ? `Take the ${label} tab and what's in it off the page` : `Take ${label} off the page`, (m) => {
      const now = locateItem(m, key)!;
      takeOut(m, now.region, now.item);
    })
  );
  return out;
}

/**
 * A component or record tab dropped right before the item keyed `before` (null:
 * last in its region or tab set). One diffed change, as the move verbs queue;
 * null when either isn't in the arranged page, they're in different containers,
 * or a tab and a component would be mixed.
 */
function moveItemTo(d: PageDraft, key: string, before: string | null, tab: boolean, pending: PendingChange[]): PendingChange[] | null {
  if (before === key) return pending;
  const next = clone(d.target);
  const at = locateItem(next, key);
  if (!at || (at.item.component === "flexipage:tab") !== tab) return null;
  const target = before === null ? null : at.region.items.find((i) => i.key === before);
  if (before !== null && !target) return null;
  at.region.items.splice(at.index, 1);
  at.region.items.splice(target ? at.region.items.indexOf(target) : at.region.items.length, 0, at.item);
  return arrange(d, next, pending);
}

export const moveComponentTo = (d: PageDraft, key: string, before: string | null, pending: PendingChange[]) => moveItemTo(d, key, before, false, pending);
export const moveRecordTabTo = (d: PageDraft, key: string, before: string | null, pending: PendingChange[]) => moveItemTo(d, key, before, true, pending);

/** A property the properties sheet lets the admin set on the selected block. */
export interface PropertyEdit {
  property: FlexiPageProperty;
  def: ComponentPropDef;
  /** The value in the arranged page (the definition's default when it has none). */
  value: string;
  /** The value on the org's page, or null when it has none. */
  orgValue: string | null;
  /** The arranged page's value differs from the org's. */
  changed: boolean;
  /** Shown but not editable: it identifies the component. */
  readOnly: boolean;
  /** The tray with the property set to `value`; null when `value` isn't valid. An empty value takes the property off. */
  set: (value: string, pending: PendingChange[]) => PendingChange[] | null;
  /** The tray with the property back at the org's value. */
  reset: (pending: PendingChange[]) => PendingChange[];
  /** What's wrong with `value`, or a warning about it. */
  check: (value: string) => { problem?: string; warning?: string };
}

/** What the sheet falls back on until `studio_component_props` answers (or when it can't): the short list Phase 3c set. */
function fallbackDefs(component: string, name: string, properties: Record<string, string>): ComponentPropDef[] {
  const used = (d: Omit<ComponentPropDef, "ipad">): ComponentPropDef => ({ ...d, ipad: "used" });
  const defs: ComponentPropDef[] = [];
  if (component === "flexipage:tab") defs.push(used({ name: "title", label: "Tab title", type: "String", required: true }));
  if (name.startsWith("lscMobileInline_")) defs.push(used({ name: "mobileHeight", label: "Height on iPad (pt)", type: "Integer", min: 1, max: 9999, default: "400" }));
  if ("rowsToDisplay" in properties || name === "relatedListSingleContainer") defs.push(used({ name: "rowsToDisplay", label: "Rows to show", type: "Integer", min: 1, max: 9999 }));
  if ("maxRecordsToDisplay" in properties) defs.push(used({ name: "maxRecordsToDisplay", label: "Records to show", type: "Integer", min: 1, max: 9999 }));
  return defs;
}

const READ_ONLY = new Set(["relatedListApiName", "parentFieldApiName"]);

/**
 * The properties of one block Studio can set: the component's definitions
 * (`studio_component_props`, or the short 3c list while they load), then the
 * simple properties already on the page that no definition covers. A property
 * that names a region of the page (a tabset's tabs) is left out.
 */
export function propertyEdits(d: PageDraft, key: string, loaded?: ComponentProps | null): PropertyEdit[] {
  const at = locateItem(d.target, key);
  if (!at) return [];
  const name = at.item.component.includes(":") ? at.item.component.split(":")[1] : at.item.component;
  const props = at.item.properties;
  const orgProps = locateItem(d.base, key)?.item.properties ?? {};
  const pointers = new Set(Object.entries({ ...orgProps, ...props }).filter(([, v]) => d.target.regions.some((r) => r.facet && r.name === v)).map(([k]) => k));
  const dynamic = !!loaded?.dynamic || DYNAMIC_COMPONENTS.includes(name);
  const defs = new Map<string, ComponentPropDef>();
  for (const def of loaded?.properties ?? []) defs.set(def.name, def);
  for (const def of fallbackDefs(at.item.component, name, props)) if (!defs.has(def.name)) defs.set(def.name, def);
  for (const k of Object.keys({ ...orgProps, ...props })) {
    if (!defs.has(k) && !pointers.has(k) && k !== "active") defs.set(k, untypedDef(k, dynamic));
  }
  const result = [...defs.values()]
    .filter((def) => !pointers.has(def.name) && def.name !== "active")
    .map((def): PropertyEdit => {
      const tabTitleField = at.item.component === "flexipage:tab" && def.name === "title";
      const check = (value: string) => {
        const base = checkProp(def, value);
        if (tabTitleField && !base.problem) {
          if (!value.trim()) return { problem: "A tab needs a title." };
          if (value.length > 255) return { problem: "Titles can be at most 255 characters." };
          return tabTitle(value).length > TAB_TITLE_MAX ? { warning: `Over ${TAB_TITLE_MAX} characters — the iPad cuts it short.` } : {};
        }
        return base;
      };
      const write = (value: string | null, pending: PendingChange[]) => {
        const next = clone(d.target);
        const item = locateItem(next, key)!.item;
        if (value === null) delete item.properties[def.name];
        else item.properties[def.name] = value;
        return arrange(d, next, pending);
      };
      const orgValue = orgProps[def.name] ?? null;
      return {
        property: def.name,
        def,
        value: props[def.name] ?? def.default ?? "",
        orgValue,
        changed: (props[def.name] ?? null) !== orgValue,
        readOnly: READ_ONLY.has(def.name),
        check: (value) => (tabTitleField && !value.trim() ? { problem: "A tab needs a title." } : check(value)),
        set: (value, pending) => (check(value).problem ? null : write(normalizeProp(def, value), pending)),
        reset: (pending) => write(orgValue, pending),
      };
    });
  // Properties the iPad reads first, then the ones Studio can't tell about, then the ones it ignores.
  const rank = (e: PropertyEdit) => (e.def.ipad === "used" ? 0 : e.def.ipad === "unknown" ? 1 : 2);
  return result.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e);
}

/** Every identifier the org's page or the arranged one uses: a new component's must differ from both. */
const taken = (d: PageDraft) => new Set([...identifiers(d.base), ...identifiers(d.target)]);

/**
 * The tray with a new component in `region`, before the item with key `before`
 * (null: at the end). Its identifier is the one App Builder would give it.
 */
export function insertComponent(d: PageDraft, region: string, before: string | null, component: string, properties: { name: string; value: string }[], pending: PendingChange[]): PendingChange[] {
  const next = clone(d.target);
  const r = findRegion(next, region);
  const identifier = newIdentifier(component, taken(d));
  const at = before === null ? -1 : r.items.findIndex((i) => i.key === before);
  r.items.splice(at < 0 ? r.items.length : at, 0, {
    key: identifier,
    component,
    identifier,
    properties: Object.fromEntries(properties.map((p) => [p.name, p.value])),
    facets: [],
  });
  return arrange(d, next, pending);
}

/** The tray with a component removed in Draft put back in `region`, before `before`; null when it came from another region. */
export function reinsertComponent(d: PageDraft, key: string, region: string, before: string | null, pending: PendingChange[]): PendingChange[] | null {
  if (locateItem(d.target, key) || locateItem(d.base, key)?.region.name !== region) return null;
  const next = clone(d.target);
  return putBack(d, next, key, before) ? arrange(d, next, pending) : null;
}

/** Components on the org's page that the arranged one takes out (not with a removed tab), for "Insert component…". */
export function removedItems(d: PageDraft): { key: string; region: string; component: string; properties: Record<string, string> }[] {
  return d.base.regions.flatMap((r) =>
    regionOf(d.target, r.name) ? r.items.filter((i) => !locateItem(d.target, i.key)).map((i) => ({ key: i.key, region: r.name, component: i.component, properties: i.properties })) : []
  );
}

/** Where "Insert component…" puts a new component next to the selected block: its region or a tab's body, right after it. */
export function insertPoint(d: PageDraft, key: string): { region: string; before: string | null } | null {
  const at = locateItem(d.target, key);
  if (!at) return null;
  if (at.item.component === "flexipage:tab") {
    const body = at.item.facets.find((f) => regionOf(d.target, f));
    return body ? { region: body, before: null } : null;
  }
  return { region: at.region.name, before: at.region.items[at.index + 1]?.key ?? null };
}

/**
 * "Insert component…" next to the selected block: a search picker over the
 * catalog's insertable components (related lists already on the page left out)
 * and the components removed in Draft from the same region or tab. What needs
 * Lightning App Builder is named in the description, not offered.
 */
export function insertVerb(d: PageDraft, key: string, catalog: ComponentCatalog | null): Verb {
  const label = "Insert component…";
  const title = "Insert a component after this one";
  const point = insertPoint(d, key);
  if (!point) return { id: "insertComponent", label, title, reason: "Restore it first" };
  if (!catalog) return { id: "insertComponent", label, title, reason: "Loading the component library…" };
  const placed = new Set(d.target.regions.flatMap((r) => r.items.flatMap((i) => i.properties.relatedListApiName ?? [])));
  const entries = catalog.entries.filter((e) => e.insertable && !(e.group === "Related list" && placed.has(e.properties.find((p) => p.name === "relatedListApiName")?.value ?? "")));
  const removed = removedItems(d).filter((r) => r.region === point.region);
  const options = [
    ...removed.map((r) => ({ value: `back:${r.key}`, label: insertedLabel(r.component, r.properties), detail: "Removed in Draft — put it back here" })),
    ...entries.map((e) => ({ value: `new:${e.key}`, label: e.label, detail: e.group === "Related list" && e.object ? `Related list · ${e.object}` : e.group })),
  ];
  const later = catalog.entries.filter((e) => !e.insertable).map((e) => e.label);
  return {
    id: "insertComponent",
    label,
    title,
    pick: {
      title: "Insert component",
      description: later.length ? `${later.join(", ")} need content Studio can't fill in — add them in Lightning App Builder.` : undefined,
      placeholder: "Search components",
      empty: "No components to insert here",
      options,
      run: (value, pending) => {
        if (value.startsWith("back:")) return reinsertComponent(d, value.slice(5), point.region, point.before, pending) ?? pending;
        const entry = entries.find((e) => `new:${e.key}` === value);
        return entry ? insertComponent(d, point.region, point.before, entry.component, entry.properties, pending) : pending;
      },
    },
  };
}
