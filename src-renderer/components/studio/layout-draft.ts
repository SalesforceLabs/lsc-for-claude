import type { PublishedLayout, PublishedRelated, RecordFieldSpec } from "./published-types";
import type { FieldBehavior, LayoutEditFix, LayoutOp, LiveLayout, SectionRef } from "./types";
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
    const before = next === undefined ? null : refOf(cur, sectionByKey(cur, next)!);
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

export interface DraftField {
  spec: RecordFieldSpec;
  /** The layout item it belongs to (a compound field's name for its parts). */
  item: string;
  behavior: FieldBehavior;
  state: DraftState;
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
  aligned: number[]
): DraftSection[] {
  const specs = specsByItem(published);
  const pubByKey = new Map(aligned.map((key, i) => [key, published.sections[i]]));
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
    const columns = sec.columns
      .map((col, ci) => {
        const liveCol = (liveSec.columns[ci] ?? []).map((i) => i.field);
        const order = ghost ? liveCol.map((key) => ({ key, ghost: true })) : withGhosts(liveCol, col.map((i) => i.field), removedField);
        return order.flatMap(({ key: field, ghost: gone }) => {
          const item = (ghost ? liveSec : sec).columns[ci].find((i) => i.field === field) ?? liveSec.columns[ci].find((i) => i.field === field)!;
          const before = where(live, field);
          const liveItem = before && sectionByKey(live, before.key)!.columns[before.col].find((i) => i.field === field);
          const moved =
            !before ||
            before.key !== key ||
            before.col !== ci ||
            liveCol.filter((f) => col.some((i) => i.field === f)).indexOf(field) !== col.map((i) => i.field).filter((f) => liveCol.includes(f)).indexOf(field);
          const state: DraftState = gone || ghost ? "removed" : !before ? "added" : moved || liveItem?.behavior !== item.behavior ? "moved" : "same";
          return (specs.get(field) ?? []).map((spec) => ({ spec, item: field, behavior: item.behavior, state }));
        });
      })
      .filter((c) => c.length);
    if (!columns.length) return [];
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
        columns,
      },
    ];
  });
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
  const objects = new Map(queuedLayoutOps(pending, d.fullName).flatMap((o) => (o.op === "addRelatedList" && o.object ? [[o.relatedList, o.object]] : [])));
  const ops = diffOps(d.base, next).map((o) => (o.op === "addRelatedList" && objects.has(o.relatedList) ? { ...o, object: objects.get(o.relatedList) } : o));
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
    verb(d, "remove", "Remove", `Take ${name} and its fields off the layout`, (m) => {
      m.sections = m.sections.filter((s) => s.key !== key);
    }),
  ];
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

export function relatedVerbs(d: LayoutDraft, name: string, label: string): Verb[] {
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
  ];
}
