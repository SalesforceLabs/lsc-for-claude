import type { PublishedLayout, PublishedRelated, RecordFieldSpec } from "./published-types";
import type { FieldBehavior, LayoutEditFix, LayoutFieldOption, LayoutOp, LiveLayout, SectionRef } from "./types";
import { layoutOpsChange, pendingFor, queuedLayoutOps, queueChange, type PendingChange } from "./changes";
import type { DraftState, Verb } from "./edit-draft";

/**
 * Page layouts in Draft. The tray holds one `editMetadata` change per layout
 * whose ops are the whole difference between the layout as it is in the org
 * (`LiveLayout`) and the layout the admin has arranged. Verbs edit that target
 * model and diff it against the org again, so moving something back where it
 * was leaves no op behind. Pure: nothing here touches the org.
 */

export interface LayoutItem {
  field: string;
  behavior: FieldBehavior;
}

export interface LayoutSectionModel {
  /** The section's index in the org's layout: its identity through moves. */
  key: number;
  label: string;
  heading: boolean;
  columns: LayoutItem[][];
}

export interface LayoutModel {
  sections: LayoutSectionModel[];
  relatedLists: string[];
}

export class StaleDraftError extends Error {}

export function modelOf(live: LiveLayout): LayoutModel {
  return {
    sections: live.sections.map((s, key) => ({
      key,
      label: s.label,
      heading: s.heading,
      columns: s.columns.map((c) => c.map((i) => ({ field: i.field, behavior: i.behavior }))),
    })),
    relatedLists: [...live.relatedLists],
  };
}

const clone = (m: LayoutModel): LayoutModel => JSON.parse(JSON.stringify(m)) as LayoutModel;

function refOf(m: LayoutModel, sec: LayoutSectionModel): SectionRef {
  return { label: sec.label, nth: m.sections.filter((s) => s.label === sec.label).indexOf(sec) };
}

function findSection(m: LayoutModel, ref: SectionRef): LayoutSectionModel {
  const sec = m.sections.filter((s) => s.label === ref.label)[ref.nth];
  if (!sec) throw new StaleDraftError(`The section "${ref.label}" isn't on the layout.`);
  return sec;
}

const sectionByKey = (m: LayoutModel, key: number) => m.sections.find((s) => s.key === key);

function locate(m: LayoutModel, field: string): { sec: LayoutSectionModel; col: number; index: number } | undefined {
  for (const sec of m.sections) {
    for (let col = 0; col < sec.columns.length; col++) {
      const index = sec.columns[col].findIndex((i) => i.field === field);
      if (index >= 0) return { sec, col, index };
    }
  }
  return undefined;
}

function place<T>(list: T[], item: T, before: number): void {
  list.splice(before < 0 ? list.length : before, 0, item);
}

/** One op, applied the way the server applies it to the XML (layout-ops.ts). */
function applyOp(m: LayoutModel, op: LayoutOp): void {
  switch (op.op) {
    case "moveField":
    case "removeField": {
      const at = locate(m, op.field);
      if (!at) throw new StaleDraftError(`${op.field} isn't on the layout.`);
      const [item] = at.sec.columns[at.col].splice(at.index, 1);
      if (op.op === "moveField") placeField(m, item, op.to);
      return;
    }
    case "addField":
      if (locate(m, op.field)) throw new StaleDraftError(`${op.field} is already on the layout.`);
      placeField(m, { field: op.field, behavior: op.behavior }, op.to);
      return;
    case "setFieldBehavior": {
      const at = locate(m, op.field);
      const item = at && at.sec.columns[at.col][at.index];
      if (!item || item.behavior !== op.from) throw new StaleDraftError(`${op.field} changed on the layout.`);
      item.behavior = op.to;
      return;
    }
    case "moveSection":
    case "removeSection": {
      const sec = findSection(m, op.section);
      m.sections.splice(m.sections.indexOf(sec), 1);
      if (op.op === "moveSection") place(m.sections, sec, op.before ? m.sections.indexOf(findSection(m, op.before)) : -1);
      return;
    }
    case "addSection":
      throw new StaleDraftError("A new section can't be drawn in Draft.");
    case "setSectionHeading": {
      const sec = findSection(m, op.section);
      if (sec.heading !== op.from) throw new StaleDraftError(`The section "${op.section.label}" changed on the layout.`);
      sec.heading = op.to;
      return;
    }
    case "moveRelatedList":
    case "removeRelatedList": {
      const i = m.relatedLists.indexOf(op.relatedList);
      if (i < 0) throw new StaleDraftError(`The related list ${op.relatedList} isn't on the layout.`);
      m.relatedLists.splice(i, 1);
      if (op.op === "moveRelatedList") placeRelated(m, op.relatedList, op.before);
      return;
    }
    case "addRelatedList":
      if (m.relatedLists.includes(op.relatedList)) throw new StaleDraftError(`The related list ${op.relatedList} is already on the layout.`);
      placeRelated(m, op.relatedList, op.before);
      return;
    case "addAction":
    case "removeAction":
      return;
  }
}

function placeField(m: LayoutModel, item: LayoutItem, slot: { section: SectionRef; column: number; before: string | null; at?: number }): void {
  const column = findSection(m, slot.section).columns[slot.column];
  if (!column) throw new StaleDraftError(`The section "${slot.section.label}" has no column ${slot.column + 1}.`);
  let index = -1;
  if (slot.at !== undefined) index = Math.min(slot.at, column.length);
  else if (slot.before) {
    index = column.findIndex((i) => i.field === slot.before);
    if (index < 0) throw new StaleDraftError(`${slot.before} isn't in that column any more.`);
  }
  place(column, item, index);
}

function placeRelated(m: LayoutModel, name: string, before: string | null): void {
  const at = before ? m.relatedLists.indexOf(before) : -1;
  if (before && at < 0) throw new StaleDraftError(`The related list ${before} isn't on the layout.`);
  place(m.relatedLists, name, at);
}

/** The layout once `ops` are applied; throws `StaleDraftError` when they no longer fit it. */
export function applyOps(base: LayoutModel, ops: LayoutOp[]): LayoutModel {
  const m = clone(base);
  for (const op of ops) applyOp(m, op);
  return m;
}

/**
 * Ops that turn `base` into `target` (same sections, possibly fewer; fields and
 * related lists moved, added or removed). Each op is applied to a working copy
 * as it's chosen, so its section refs and neighbours are the ones the server
 * will see at that point.
 */
export function diffOps(base: LayoutModel, target: LayoutModel): LayoutOp[] {
  const cur = clone(base);
  const ops: LayoutOp[] = [];
  const push = (op: LayoutOp) => {
    applyOp(cur, op);
    ops.push(op);
  };
  const wanted = new Map<string, LayoutItem>();
  for (const s of target.sections) for (const c of s.columns) for (const i of c) wanted.set(i.field, i);
  const kept = new Set(target.sections.map((s) => s.key));
  for (const s of target.sections) if (!sectionByKey(base, s.key)) throw new StaleDraftError("A new section can't be drawn in Draft.");

  // Fields that leave the layout; a removed section takes its own along when it goes.
  for (const s of base.sections) {
    if (!kept.has(s.key)) continue;
    for (const c of s.columns) for (const i of c) if (!wanted.has(i.field)) push({ op: "removeField", field: i.field });
  }

  // Section order, last first: each section goes right before the one that follows it.
  const order = target.sections.map((s) => s.key);
  for (let j = order.length - 1; j >= 0; j--) {
    const sec = sectionByKey(cur, order[j])!;
    const after = cur.sections.slice(cur.sections.indexOf(sec) + 1).find((s) => kept.has(s.key));
    const next = order[j + 1];
    if ((after?.key ?? null) === (next ?? null)) continue;
    // The op applies after the section is lifted out, so its neighbour is named as the layout reads without it (same-label sections renumber).
    const without = { ...cur, sections: cur.sections.filter((s) => s !== sec) };
    const before = next === undefined ? null : refOf(without, sectionByKey(without, next)!);
    push({ op: "moveSection", section: refOf(cur, sec), before });
  }

  // Fields, column by column and last first, the same way.
  for (const ts of target.sections) {
    ts.columns.forEach((column, col) => {
      const names = new Set(column.map((i) => i.field));
      for (let j = column.length - 1; j >= 0; j--) {
        const item = column[j];
        const next = column[j + 1]?.field ?? null;
        const at = locate(cur, item.field);
        const sec = sectionByKey(cur, ts.key)!;
        if (at && at.sec === sec && at.col === col) {
          const after = sec.columns[col].slice(at.index + 1).find((i) => names.has(i.field));
          if ((after?.field ?? null) === next) continue;
        }
        const to = { section: refOf(cur, sec), column: col, before: next };
        push(at ? { op: "moveField", field: item.field, to } : { op: "addField", field: item.field, behavior: item.behavior, to });
      }
    });
  }

  for (const [field, item] of wanted) {
    const at = locate(cur, field)!;
    const now = at.sec.columns[at.col][at.index].behavior;
    if (now !== item.behavior) push({ op: "setFieldBehavior", field, from: now, to: item.behavior });
  }
  for (const ts of target.sections) {
    const sec = sectionByKey(cur, ts.key)!;
    if (sec.heading !== ts.heading) push({ op: "setSectionHeading", section: refOf(cur, sec), from: sec.heading, to: ts.heading });
  }
  for (const s of [...cur.sections]) if (!kept.has(s.key)) push({ op: "removeSection", section: refOf(cur, s) });

  // Related lists: removals, additions, then order.
  const lists = new Set(target.relatedLists);
  for (const r of base.relatedLists) if (!lists.has(r)) push({ op: "removeRelatedList", relatedList: r });
  for (const r of target.relatedLists) if (!cur.relatedLists.includes(r)) push({ op: "addRelatedList", relatedList: r, before: null });
  for (let j = target.relatedLists.length - 1; j >= 0; j--) {
    const name = target.relatedLists[j];
    const next = target.relatedLists[j + 1] ?? null;
    if ((cur.relatedLists[cur.relatedLists.indexOf(name) + 1] ?? null) === next) continue;
    push({ op: "moveRelatedList", relatedList: name, before: next });
  }
  return ops;
}

/**
 * `target` with what it took away put back where it was in `live`: each ghost
 * goes right after the nearest earlier key still listed, or first.
 */
export function withGhosts<K>(live: K[], target: K[], isGhost: (k: K) => boolean = (k) => !target.includes(k)): { key: K; ghost: boolean }[] {
  const out = target.map((key) => ({ key, ghost: false }));
  live.forEach((key, i) => {
    if (target.includes(key) || !isGhost(key)) return;
    const prev = live.slice(0, i).reverse().find((p) => out.some((o) => o.key === p));
    const at = prev === undefined ? 0 : out.findIndex((o) => o.key === prev) + 1;
    out.splice(at, 0, { key, ghost: true });
  });
  return out;
}

// --- The published layout, lined up with the org's -------------------------------

/** Consecutive repeats collapse: a compound field's parts all name its layout item. */
const items = (fields: string[]) => fields.filter((f, i) => f !== fields[i - 1]);

function isSubsequence(small: string[], big: string[]): boolean {
  let k = 0;
  for (const b of big) if (b === small[k]) k++;
  return k === small.length;
}

function sectionMatches(s: PublishedLayout["sections"][number], live: LayoutSectionModel): boolean {
  const src = s.source!;
  return src.columns.every((xmlCol, ci) => {
    const column = live.columns[xmlCol];
    return !!column && isSubsequence(items(src.fields[ci] ?? []), column.map((i) => i.field));
  });
}

/**
 * Which org section each published section is (by index), or null when the
 * published layout no longer lines up — someone changed it in Setup since the
 * last publish, or the snapshot predates section sources.
 */
export function alignLayout(published: PublishedLayout, live: LayoutModel): number[] | null {
  const out: number[] = [];
  let from = 0;
  for (const s of published.sections) {
    if (!s.source) return null;
    const byRef = live.sections.findIndex(
      (l, i) => i >= from && l.label === s.source!.label && refOf(live, l).nth === s.source!.nth && sectionMatches(s, l)
    );
    const at = byRef >= 0 ? byRef : live.sections.findIndex((l, i) => i >= from && sectionMatches(s, l));
    if (at < 0) return null;
    out.push(live.sections[at].key);
    from = at + 1;
  }
  return out;
}

// --- What the org has that the last publish doesn't ------------------------------

/** Words for blocks that are in the org but not in the published cache (the org-ahead style, `draft-org-ahead`); defined in org-ahead.ts. */
export { ORG_AHEAD_TAG, ORG_AHEAD_GONE, ORG_AHEAD_NOTE, ORG_AHEAD_GONE_NOTE } from "./org-ahead";

/** A layout item the cache has and the org's layout no longer does, with where it was. */
export interface GoneField {
  item: string;
  section: { label: string; nth: number };
  /** The org layout's XML column it was in. */
  column: number;
  /** The cache's items in that column (compound repeats collapsed), for placing the ghost among the ones still there. */
  items: string[];
}

/**
 * How the org's layout differs from the published one: the layout as Setup has
 * it now against what the iPads last downloaded. Draft draws the org's layout;
 * this says which of it iPads don't have yet.
 */
export interface LayoutAhead {
  /** Layout items on the org's layout the cache's lacks. */
  fields: Set<string>;
  /** Org sections with no counterpart in the cache. */
  sections: Set<number>;
  /** Related lists on the org's layout the cache's lacks. */
  related: Set<string>;
  /** Items the cache has that the org's layout no longer does. */
  gone: GoneField[];
  /** Related lists the cache has that the org's layout no longer does. */
  goneRelated: string[];
  /** Items removed from sections the org's layout no longer has (not drawn). */
  goneElsewhere: number;
}

export const noAhead = (): LayoutAhead => ({ fields: new Set(), sections: new Set(), related: new Set(), gone: [], goneRelated: [], goneElsewhere: 0 });

export const isAhead = (a: LayoutAhead | null | undefined): boolean =>
  !!a && (a.fields.size > 0 || a.sections.size > 0 || a.related.size > 0 || a.gone.length > 0 || a.goneRelated.length > 0 || a.goneElsewhere > 0);

/**
 * What the org's layout has that the published one doesn't, and the reverse.
 * Null when the published layout can't say (a snapshot from before sections
 * carried their source), so nothing is marked.
 */
export function aheadOf(published: PublishedLayout | undefined, base: LayoutModel): LayoutAhead | null {
  if (!published || published.sections.some((s) => !s.source)) return null;
  const out = noAhead();
  const pubItems = new Set(published.sections.flatMap((s) => s.source!.fields.flat()));
  const orgItems = new Set(base.sections.flatMap((s) => s.columns.flat().map((i) => i.field)));
  for (const f of orgItems) if (!pubItems.has(f)) out.fields.add(f);
  for (const sec of base.sections) {
    const ref = refOf(base, sec);
    const has = published.sections.some((p) => p.source!.label === ref.label && p.source!.nth === ref.nth);
    if (!has && sec.columns.some((c) => c.length)) out.sections.add(sec.key);
  }
  for (const p of published.sections) {
    const src = p.source!;
    const sec = base.sections.find((l) => l.label === src.label && refOf(base, l).nth === src.nth);
    src.fields.forEach((col, ci) => {
      const items = col.filter((f, i) => f !== col[i - 1]);
      for (const item of items) {
        if (orgItems.has(item)) continue;
        if (sec && sec.columns[src.columns[ci]]) out.gone.push({ item, section: { label: src.label, nth: src.nth }, column: src.columns[ci], items });
        else out.goneElsewhere++;
      }
    });
  }
  const match = matchRelatedLists(base.relatedLists, published.relatedLists);
  for (const r of match.added) out.related.add(r);
  out.goneRelated.push(...match.removed);
  return out;
}

// --- Related list names -------------------------------------------------------------

/** Words that say nothing about which child object a related list is. */
const GENERIC_WORDS = new Set(["related", "list", "account", "object", "id", "record", "all", "entity"]);

const singular = (w: string): string => (w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("sses") ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** Short forms in standard related list names: "RelatedHCPSpecialtyPaList" is HealthcareProviderSpecialty on a person account ("Pa"). */
const ABBREVIATIONS: Record<string, string[]> = { hcp: ["healthcare", "provider"], pa: [] };

/** "CommSubscriptionConsents" → {comm, subscription, consent}; custom "Inquiry.Account__c" → {inquiry}. */
function relatedWords(name: string): Set<string> {
  const base = name.replace(/__[a-z]+/gi, "");
  return new Set(
    base
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/[._]/g, " ")
      .toLowerCase()
      .split(/\s+/)
      .flatMap((w) => ABBREVIATIONS[w] ?? [w])
      .map(singular)
      .filter((w) => w && !GENERIC_WORDS.has(w))
  );
}

/**
 * Pairs the related lists a layout names with the ones the cache drew. The layout XML names a
 * standard related list by its relationship ("ContactPointAddresses", "RelatedCaseList") but the
 * cache by child object and field ("ContactPointAddress.ParentId"), so names are compared
 * exactly first, then by the words of the layout's name against the cache's object name and label.
 * Lists that pair with nothing are the ones that really differ.
 */
export function matchRelatedLists(live: string[], published: { name: string; label: string }[]): { added: string[]; removed: string[]; pairs: Map<string, string> } {
  const pairs = new Map<string, string>();
  const taken = new Set<string>();
  for (const l of live) {
    if (published.some((p) => p.name === l)) {
      pairs.set(l, l);
      taken.add(l);
    }
  }
  const pubWords = published.map((p) => ({ p, object: relatedWords(p.name.split(".")[0]), all: new Set([...relatedWords(p.name.split(".")[0]), ...relatedWords(p.label)]) }));
  for (const strict of [true, false]) {
    for (const l of live) {
      if (pairs.has(l)) continue;
      const words = relatedWords(l);
      if (words.size === 0) continue;
      const hit = pubWords.find(({ p, object, all }) => {
        if (taken.has(p.name)) return false;
        if (strict) return object.size === words.size && [...words].every((w) => object.has(w));
        return [...words].every((w) => all.has(w)) || [...object].every((w) => words.has(w));
      });
      if (hit) {
        pairs.set(l, hit.p.name);
        taken.add(hit.p.name);
      }
    }
  }
  return {
    added: live.filter((l) => !pairs.has(l)),
    removed: published.map((p) => p.name).filter((n) => !taken.has(n)),
    pairs,
  };
}

export interface DraftField {
  spec: RecordFieldSpec;
  /** The layout item it belongs to (a compound field's name for its parts). */
  item: string;
  behavior: FieldBehavior;
  state: DraftState;
  /** Its column in the layout section (drawn columns skip empty ones). */
  col: number;
  /** In the org but not on iPads yet, or on iPads but removed in the org (drawn as a ghost that can't be selected). */
  ahead?: "added" | "removed";
}

export interface DraftSection {
  key: number;
  ref: SectionRef;
  /** The heading drawn, or null when it's hidden. */
  label: string | null;
  /** The section's name, shown or not. */
  name: string;
  heading: boolean;
  state: DraftState;
  columns: DraftField[][];
  /** The section is in the org but not on iPads yet. */
  ahead?: "added";
  /** Indices (in the org's layout) of the columns left with nothing to draw; a field can still be dropped in them. */
  emptyColumns: number[];
}

/** Each layout item's drawn parts, read from the published layout. */
function specsByItem(published: PublishedLayout): Map<string, RecordFieldSpec[]> {
  const map = new Map<string, RecordFieldSpec[]>();
  for (const s of published.sections) {
    s.source?.fields.forEach((col, ci) =>
      col.forEach((item, fi) => {
        const spec = s.fields?.[ci]?.[fi];
        if (spec) map.set(item, [...(map.get(item) ?? []), spec]);
      })
    );
  }
  return map;
}

/**
 * The details sections as Draft draws them: the published fields arranged as
 * `target`, with what it takes away left as ghosts. Sections and columns with
 * nothing to draw are left out, as on the iPad.
 */
export function draftSections(
  published: PublishedLayout,
  live: LayoutModel,
  target: LayoutModel,
  aligned: number[],
  available: LayoutFieldOption[] | null = null,
  extra: { placed?: LayoutFieldOption[] | null; ahead?: LayoutAhead | null } = {}
): DraftSection[] {
  const specs = specsByItem(published);
  // A field the cache never drew (added in Draft, or in Setup since the publish) is drawn from the object's describe.
  for (const f of [...(extra.placed ?? []), ...(available ?? [])]) if (!specs.has(f.field)) specs.set(f.field, [{ name: f.field, label: f.label, type: f.type }]);
  const ahead = extra.ahead ?? null;
  const pubByKey = new Map(aligned.map((key, i) => [key, published.sections[i]]));
  // Without an alignment (the org's layout changed since the publish) a section is the published one with its label and place among that label.
  for (const sec of live.sections) {
    if (pubByKey.has(sec.key)) continue;
    const ref = refOf(live, sec);
    const hit = published.sections.find((p) => p.source?.label === ref.label && p.source.nth === ref.nth);
    if (hit) pubByKey.set(sec.key, hit);
  }
  const where = (m: LayoutModel, field: string) => {
    const at = locate(m, field);
    return at && { key: at.sec.key, col: at.col };
  };
  const removedField = (f: string) => !locate(target, f);
  const sectionOrder = withGhosts(
    live.sections.map((s) => s.key),
    target.sections.map((s) => s.key)
  );
  const commonLive = live.sections.map((s) => s.key).filter((k) => sectionByKey(target, k));
  const commonTarget = target.sections.map((s) => s.key);
  return sectionOrder.flatMap(({ key, ghost }): DraftSection[] => {
    const liveSec = sectionByKey(live, key)!;
    const sec = ghost ? liveSec : sectionByKey(target, key)!;
    const pub = pubByKey.get(key);
    const all = sec.columns
      .map((col, ci) => {
        const liveCol = (liveSec.columns[ci] ?? []).map((i) => i.field);
        const tray = ghost ? liveCol.map((key) => ({ key, ghost: true })) : withGhosts(liveCol, col.map((i) => i.field), removedField);
        // Items the cache has in this column that the org's layout no longer does stay as ghosts where they were.
        const goneHere = ghost ? [] : (ahead?.gone ?? []).filter((g) => g.section.label === liveSec.label && g.section.nth === refOf(live, liveSec).nth && g.column === ci);
        const goneItems = new Set(goneHere.map((g) => g.item));
        const order: { key: string; ghost: boolean; orgGone?: boolean }[] = goneHere.length
          ? withGhosts(goneHere[0].items, tray.map((o) => o.key), (k) => goneItems.has(k)).map(({ key, ghost: g }) =>
              g ? { key, ghost: true, orgGone: true } : tray.find((o) => o.key === key)!
            )
          : tray;
        return order.flatMap(({ key: field, ghost: gone, orgGone }) => {
          if (orgGone) return (specs.get(field) ?? []).map((spec): DraftField => ({ spec, item: field, behavior: "Edit", state: "removed", col: ci, ahead: "removed" }));
          const item = (ghost ? liveSec : sec).columns[ci].find((i) => i.field === field) ?? liveSec.columns[ci].find((i) => i.field === field)!;
          const before = where(live, field);
          const liveItem = before && sectionByKey(live, before.key)!.columns[before.col].find((i) => i.field === field);
          const moved =
            !before ||
            before.key !== key ||
            before.col !== ci ||
            liveCol.filter((f) => col.some((i) => i.field === f)).indexOf(field) !== col.map((i) => i.field).filter((f) => liveCol.includes(f)).indexOf(field);
          const state: DraftState = gone || ghost ? "removed" : !before ? "added" : moved || liveItem?.behavior !== item.behavior ? "moved" : "same";
          const aheadField = !gone && !ghost && ahead?.fields.has(field);
          return (specs.get(field) ?? []).map((spec): DraftField => ({ spec, item: field, behavior: item.behavior, state, col: ci, ...(aheadField ? { ahead: "added" as const } : {}) }));
        });
      });
    const columns = all.filter((c) => c.length);
    if (!columns.length) return [];
    // The section's columns with no field to draw: where a drag can still drop one.
    const emptyColumns = ghost ? [] : all.flatMap((c, ci) => (c.length ? [] : [ci]));
    const name = pub?.label ?? sec.label;
    const moved = !ghost && commonLive.indexOf(key) !== commonTarget.indexOf(key);
    return [
      {
        key,
        ref: refOf(ghost ? live : target, sec),
        label: sec.heading ? name || null : null,
        name,
        heading: sec.heading,
        state: ghost ? "removed" : moved || sec.heading !== liveSec.heading ? "moved" : "same",
        ...(!ghost && ahead?.sections.has(key) ? { ahead: "added" as const } : {}),
        columns,
        emptyColumns,
      },
    ];
  });
}

/**
 * Related lists added in Draft, which the published record has no card for:
 * empty cards for `draftRelated` to place, labelled by `labelOf` (the child object).
 */
export function addedRelated(d: LayoutDraft, related: PublishedRelated[], labelOf: (object: string) => string): PublishedRelated[] {
  return d.target.relatedLists.flatMap((name) => {
    // A list the iPads' cache has no card for is drawn empty: one added in Draft, or in Setup since the publish.
    if (related.some((r) => r.api === name)) return [];
    if (d.base.relatedLists.includes(name) && !d.ahead?.related.has(name)) return [];
    const object = relatedObject(d, name);
    return [{ key: `added:${name}`, api: name, label: labelOf(object), object, count: 0, columns: [], rows: [] }];
  });
}

/** The child object of a related list that could be added. */
export function relatedObject(d: LayoutDraft, name: string): string {
  return d.live.availableRelated?.find((r) => r.relatedList === name)?.object ?? name.split(".")[0];
}

/** Related lists in Draft order, with removed ones as ghosts; lists the layout doesn't name keep their place after them. */
export function draftRelated(related: PublishedRelated[], live: LayoutModel, target: LayoutModel): { related: PublishedRelated; state: DraftState }[] {
  const named = related.filter((r) => live.relatedLists.includes(r.api) || target.relatedLists.includes(r.api));
  const rest = related.filter((r) => !named.includes(r));
  const common = live.relatedLists.filter((r) => target.relatedLists.includes(r));
  const commonTarget = target.relatedLists.filter((r) => live.relatedLists.includes(r));
  const order = withGhosts(live.relatedLists, target.relatedLists);
  return [
    ...order.flatMap(({ key, ghost }) =>
      named
        .filter((r) => r.api === key)
        .map((r) => ({
          related: r,
          state: (ghost ? "removed" : !live.relatedLists.includes(key) ? "added" : common.indexOf(key) !== commonTarget.indexOf(key) ? "moved" : "same") as DraftState,
        }))
    ),
    ...rest.map((related) => ({ related, state: "same" as DraftState })),
  ];
}

// --- Verbs -------------------------------------------------------------------------

/** One layout in Draft: the org's version, the arranged one, and how to queue a new arrangement. */
export interface LayoutDraft {
  fullName: string;
  label: string;
  live: LiveLayout;
  base: LayoutModel;
  target: LayoutModel;
  /** Sections and related lists drawn on the iPad, in Draft order: verbs move past these only. */
  shownSections: number[];
  shownRelated: string[];
  /** What the org has that the last publish doesn't (null when the cache can't say). */
  ahead?: LayoutAhead | null;
}

export function layoutFix(fullName: string, label: string, ops: LayoutOp[]): LayoutEditFix {
  return layoutOpsChange(fullName, label, ops) as LayoutEditFix;
}

/** The layout's target once the tray is applied; throws `StaleDraftError` when the queued ops don't fit the org's layout. */
export function targetOf(fullName: string, base: LayoutModel, pending: PendingChange[]): LayoutModel {
  const queued = pendingFor(pending, layoutFix(fullName, "", []))?.fix;
  return queued?.kind === "editMetadata" && queued.doc.type === "Layout" ? applyOps(base, queued.ops as LayoutOp[]) : clone(base);
}

/** The tray with this layout arranged as `next` (its change dropped when that's the org's layout). */
function arrange(d: LayoutDraft, next: LayoutModel, pending: PendingChange[]): PendingChange[] {
  // A related list added from the board keeps its object, for the DB Schema check.
  const objects = new Map([
    ...(d.live.availableRelated ?? []).map((r): [string, string] => [r.relatedList, r.object]),
    ...queuedLayoutOps(pending, d.fullName).flatMap((o): [string, string][] => (o.op === "addRelatedList" && o.object ? [[o.relatedList, o.object]] : [])),
  ]);
  const ops: LayoutOp[] = diffOps(d.base, next).map((o) => (o.op === "addRelatedList" && objects.has(o.relatedList) ? { ...o, object: objects.get(o.relatedList) } : o));
  // Action ops aren't part of the drawn model: keep what's queued.
  ops.push(...queuedLayoutOps(pending, d.fullName).filter((o) => o.op === "addAction" || o.op === "removeAction"));
  const fix = layoutFix(d.fullName, d.label, ops);
  const without = pending.filter((p) => !(p.fix.kind === "editMetadata" && p.fix.doc.fullName === d.fullName));
  return queueChange(without, { fix, ...(d.live.profiles ? { affects: d.live.profiles } : {}) });
}

function verb(d: LayoutDraft, id: Verb["id"], label: string, title: string, edit: (m: LayoutModel) => boolean | void, reason?: string): Verb {
  const next = clone(d.target);
  const ok = edit(next) !== false;
  return ok ? { id, label, title, run: (p) => arrange(d, next, p) } : { id, label, title, reason: reason ?? title };
}

/** Swap places with the nearest shown neighbour in `order` (keys), returning the new order, or null at an end. */
function step<K>(order: K[], shown: K[], key: K, dir: -1 | 1): K[] | null {
  const vis = shown.filter((k) => order.includes(k));
  const i = vis.indexOf(key);
  const other = vis[i + dir];
  if (i < 0 || other === undefined) return null;
  const out = order.filter((k) => k !== key);
  const at = out.indexOf(other);
  out.splice(dir < 0 ? at : at + 1, 0, key);
  return out;
}

const BEHAVIOR_WORDS: Record<FieldBehavior, string> = { Edit: "editable", Required: "required", Readonly: "read only" };

export function sectionVerbs(d: LayoutDraft, key: number): Verb[] {
  const sec = sectionByKey(d.target, key);
  if (!sec) {
    return [
      verb(d, "restore", "Restore", "Put this section back on the layout", (m) => {
        const liveSec = sectionByKey(d.base, key)!;
        const order = withGhosts(d.base.sections.map((s) => s.key), [...m.sections.map((s) => s.key)], (k) => k === key).map((o) => o.key);
        // Its fields come back too, unless they've been moved elsewhere since.
        const back = { ...liveSec, columns: liveSec.columns.map((c) => c.filter((i) => !locate(m, i.field))) };
        m.sections = order.map((k) => (k === key ? back : sectionByKey(m, k)!));
      }),
    ];
  }
  const name = sec.label ? `"${sec.label}"` : "this section";
  const move = (dir: -1 | 1) => (m: LayoutModel) => {
    const order = step(m.sections.map((s) => s.key), d.shownSections, key, dir);
    if (!order) return false;
    m.sections = order.map((k) => sectionByKey(m, k)!);
  };
  return [
    verb(d, "up", "Move up", `Move ${name} up`, move(-1), "Already the first section"),
    verb(d, "down", "Move down", `Move ${name} down`, move(1), "Already the last section"),
    verb(d, "heading", sec.heading ? "Hide heading" : "Show heading", `${sec.heading ? "Hide" : "Show"} the heading of ${name}`, (m) => {
      sectionByKey(m, key)!.heading = !sec.heading;
    }),
    addFieldVerb(d, key, name),
    verb(d, "remove", "Remove", `Take ${name} and its fields off the layout`, (m) => {
      m.sections = m.sections.filter((s) => s.key !== key);
    }),
  ];
}

const TYPE_WORDS: Record<string, string> = {
  string: "Text",
  textarea: "Text area",
  picklist: "Picklist",
  multipicklist: "Multi-select picklist",
  reference: "Lookup",
  boolean: "Checkbox",
  date: "Date",
  datetime: "Date/time",
  double: "Number",
  int: "Number",
  currency: "Currency",
  percent: "Percent",
  phone: "Phone",
  email: "Email",
  url: "URL",
  address: "Address",
};

/** "Add field…": a field the object has but the layout doesn't, at the end of the section's first column. */
function addFieldVerb(d: LayoutDraft, key: number, name: string): Verb {
  const sec = sectionByKey(d.target, key)!;
  const title = `Add a field to ${name}, at the end of its first column`;
  if (!d.live.available) return { id: "addField", label: "Add field…", title, reason: "Couldn't read the object's fields from the org" };
  if (!sec.columns.length) return { id: "addField", label: "Add field…", title, reason: "The section has no columns" };
  const options = d.live.available
    .filter((f) => !locate(d.target, f.field))
    .map((f) => ({ value: f.field, label: f.label, detail: `${f.field} · ${TYPE_WORDS[f.type] ?? f.type}` }));
  return {
    id: "addField",
    label: "Add field…",
    title,
    pick: {
      title: `Add a field to ${name}`,
      description: "Fields of the object that aren't on this layout. The field goes at the end of the section's first column, editable; move it or change it from there.",
      placeholder: "Search fields",
      empty: "Every field the object has is already on this layout.",
      options,
      run: (field, pending) => {
        const next = clone(d.target);
        sectionByKey(next, key)!.columns[0].push({ field, behavior: "Edit" });
        return arrange(d, next, pending);
      },
    },
  };
}

/**
 * "Add related list…": a child relationship the layout doesn't list, right after
 * `after` (or last). `notSynced` marks children the profile's iPad has no table for.
 */
export function addRelatedVerb(d: LayoutDraft, after: string | null, notSynced: (object: string) => boolean = () => false): Verb {
  const title = after ? "Add a related list after this one" : "Add a related list to the layout";
  if (!d.live.availableRelated) return { id: "addRelated", label: "Add related list…", title, reason: "Couldn't read the object's child relationships from the org" };
  const options = d.live.availableRelated
    .filter((r) => !d.target.relatedLists.includes(r.relatedList) && !d.base.relatedLists.includes(r.relatedList))
    .map((r) => ({
      value: r.relatedList,
      label: r.object,
      detail: [r.relatedList !== r.object ? r.relatedList : "", notSynced(r.object) ? "not synced to this iPad" : ""].filter(Boolean).join(" · ") || undefined,
    }));
  return {
    id: "addRelated",
    label: "Add related list…",
    title,
    pick: {
      title: "Add a related list",
      description: "Child objects that aren't on this layout. On the iPad a related list only shows records the profile syncs.",
      placeholder: "Search objects",
      empty: "Every child relationship is already on this layout.",
      options,
      run: (name, pending) => {
        const next = clone(d.target);
        const at = after ? next.relatedLists.indexOf(after) : -1;
        next.relatedLists.splice(at < 0 ? next.relatedLists.length : at + 1, 0, name);
        return arrange(d, next, pending);
      },
    },
  };
}

export function fieldVerbs(d: LayoutDraft, field: string, label: string, shownFields: string[]): Verb[] {
  const at = locate(d.target, field);
  if (!at) {
    return [
      verb(d, "restore", "Restore", `Put ${label} back on the layout`, (m) => {
        const was = locate(d.base, field)!;
        const sec = sectionByKey(m, was.sec.key);
        if (!sec) return false;
        const liveCol = was.sec.columns[was.col].map((i) => i.field);
        const col = sec.columns[was.col];
        const order = withGhosts(liveCol, col.map((i) => i.field), (f) => f === field).map((o) => o.key);
        const item = was.sec.columns[was.col][was.index];
        sec.columns[was.col] = order.map((f) => (f === field ? { ...item } : col.find((i) => i.field === f)!));
      }, "Restore its section first"),
    ];
  }
  const item = at.sec.columns[at.col][at.index];
  const move = (dir: -1 | 1) => (m: LayoutModel) => {
    const sec = sectionByKey(m, at.sec.key)!;
    const names = sec.columns[at.col].map((i) => i.field);
    const order = step(names, shownFields, field, dir);
    if (!order) return false;
    sec.columns[at.col] = order.map((f) => sec.columns[at.col].find((i) => i.field === f)!);
  };
  const columns = at.sec.columns.length;
  const other = columns > 1 ? (at.col + 1) % columns : -1;
  const behave = (to: FieldBehavior) => (m: LayoutModel) => {
    const now = locate(m, field)!;
    now.sec.columns[now.col][now.index].behavior = to;
  };
  return [
    verb(d, "up", "Move up", `Move ${label} up`, move(-1), "Already the first field in its column"),
    verb(d, "down", "Move down", `Move ${label} down`, move(1), "Already the last field in its column"),
    verb(
      d,
      "column",
      other < at.col ? "Move left" : "Move right",
      `Move ${label} to column ${other + 1}, at the end`,
      (m) => {
        if (other < 0) return false;
        const now = locate(m, field)!;
        const [it] = now.sec.columns[now.col].splice(now.index, 1);
        now.sec.columns[other].push(it);
      },
      "The section has one column"
    ),
    verb(d, "required", item.behavior === "Required" ? "Make optional" : "Make required", `Make ${label} ${item.behavior === "Required" ? "optional" : "required"} on this layout`, behave(item.behavior === "Required" ? "Edit" : "Required")),
    verb(
      d,
      "readonly",
      item.behavior === "Readonly" ? "Make editable" : "Make read only",
      `Make ${label} ${item.behavior === "Readonly" ? "editable" : "read only"} on this layout (now ${BEHAVIOR_WORDS[item.behavior]})`,
      behave(item.behavior === "Readonly" ? "Edit" : "Readonly")
    ),
    verb(d, "remove", "Remove", `Take ${label} off the layout`, (m) => {
      const now = locate(m, field)!;
      now.sec.columns[now.col].splice(now.index, 1);
    }),
  ];
}

export function relatedVerbs(d: LayoutDraft, name: string, label: string, notSynced?: (object: string) => boolean): Verb[] {
  if (!d.target.relatedLists.includes(name)) {
    if (!d.base.relatedLists.includes(name)) return [];
    return [
      verb(d, "restore", "Restore", `Put ${label} back on the layout`, (m) => {
        m.relatedLists = withGhosts(d.base.relatedLists, m.relatedLists, (r) => r === name).map((o) => o.key);
      }),
    ];
  }
  const move = (dir: -1 | 1) => (m: LayoutModel) => {
    const order = step(m.relatedLists, d.shownRelated, name, dir);
    if (!order) return false;
    m.relatedLists = order;
  };
  return [
    verb(d, "up", "Move up", `Move ${label} up`, move(-1), "Already the first related list"),
    verb(d, "down", "Move down", `Move ${label} down`, move(1), "Already the last related list"),
    verb(d, "remove", "Remove", `Take ${label} off the layout`, (m) => {
      m.relatedLists = m.relatedLists.filter((r) => r !== name);
    }),
    addRelatedVerb(d, name, notSynced),
  ];
}

// --- Drops -------------------------------------------------------------------------

/** Where a dragged field lands: a column of a section (by key), right before a field, or last when `before` is null. */
export interface FieldSlot {
  section: number;
  column: number;
  before: string | null;
}

/** The tray with `next` arranged, left as it is when the drop changes nothing. */
function settle(d: LayoutDraft, next: LayoutModel, pending: PendingChange[]): PendingChange[] {
  return JSON.stringify(next) === JSON.stringify(d.target) ? pending : arrange(d, next, pending);
}

/**
 * A field dropped at `slot`: within its column, into another column or another
 * section. One diffed change, as the move verbs queue; null when the field or
 * the slot isn't on the layout.
 */
export function moveFieldTo(d: LayoutDraft, field: string, slot: FieldSlot, pending: PendingChange[]): PendingChange[] | null {
  if (slot.before === field) return pending;
  const next = clone(d.target);
  const at = locate(next, field);
  const column = sectionByKey(next, slot.section)?.columns[slot.column];
  if (!at || !column) return null;
  const [item] = at.sec.columns[at.col].splice(at.index, 1);
  const before = slot.before ? column.findIndex((i) => i.field === slot.before) : -1;
  if (slot.before && before < 0) return null;
  place(column, item, before);
  return settle(d, next, pending);
}

/** A section dropped right before the section keyed `before` (null: last). */
export function moveSectionTo(d: LayoutDraft, key: number, before: number | null, pending: PendingChange[]): PendingChange[] | null {
  if (before === key) return pending;
  const next = clone(d.target);
  const sec = sectionByKey(next, key);
  if (!sec || (before !== null && !sectionByKey(next, before))) return null;
  next.sections = next.sections.filter((s) => s !== sec);
  place(next.sections, sec, before === null ? -1 : next.sections.findIndex((s) => s.key === before));
  return settle(d, next, pending);
}

/** A related list dropped right before `before` (null: last). */
export function moveRelatedTo(d: LayoutDraft, name: string, before: string | null, pending: PendingChange[]): PendingChange[] | null {
  if (before === name) return pending;
  const next = clone(d.target);
  if (!next.relatedLists.includes(name) || (before !== null && !next.relatedLists.includes(before))) return null;
  next.relatedLists = next.relatedLists.filter((r) => r !== name);
  placeRelated(next, name, before);
  return settle(d, next, pending);
}
