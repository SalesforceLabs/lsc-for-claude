import type { RecordFieldSpec } from "./published-types";
import type { CompactLayoutEditFix, CompactOp, LiveCompactLayout } from "./types";
import { compactOpsChange, pendingFor, queueChange, type PendingChange } from "./changes";
import type { DraftState, Verb } from "./edit-draft";
import { StaleDraftError, withGhosts } from "./layout-draft";

/**
 * Compact layouts (the record header) in Draft. Like page layouts, the tray
 * holds one `editMetadata` change per compact layout whose ops are the whole
 * difference between its fields in the org (`LiveCompactLayout`) and the order
 * the admin has arranged, so moving a field back where it was leaves no op
 * behind. Pure: nothing here touches the org.
 */

/** The Metadata API refuses a compact layout with more fields than this (compact-ops.ts). */
export const MAX_COMPACT_FIELDS = 10;
/** The header scrolls sideways past about this many fields. */
export const HEADER_FITS = 6;

/** One op, applied the way the server applies it to the XML (compact-ops.ts). */
function applyOp(m: string[], op: CompactOp): void {
  const at = m.indexOf(op.field);
  if (op.op === "addCompactField") {
    if (at >= 0) throw new StaleDraftError(`${op.field} is already on the compact layout.`);
    if (m.length >= MAX_COMPACT_FIELDS) throw new StaleDraftError(`A compact layout holds at most ${MAX_COMPACT_FIELDS} fields.`);
  } else {
    if (at < 0) throw new StaleDraftError(`${op.field} isn't on the compact layout.`);
    m.splice(at, 1);
  }
  if (op.op === "removeCompactField") return;
  const before = op.before ? m.indexOf(op.before) : m.length;
  if (before < 0) throw new StaleDraftError(`${op.before} isn't on the compact layout.`);
  m.splice(before, 0, op.field);
}

/** The fields once `ops` are applied; throws `StaleDraftError` when they no longer fit. */
export function applyCompactOps(base: string[], ops: CompactOp[]): string[] {
  const m = [...base];
  for (const op of ops) applyOp(m, op);
  return m;
}

/** Ops that turn `base` into `target`: removals, then each field last first goes right before the one after it. */
export function diffCompactOps(base: string[], target: string[]): CompactOp[] {
  const cur = [...base];
  const ops: CompactOp[] = [];
  const push = (op: CompactOp) => {
    applyOp(cur, op);
    ops.push(op);
  };
  for (const f of base) if (!target.includes(f)) push({ op: "removeCompactField", field: f });
  for (let j = target.length - 1; j >= 0; j--) {
    const field = target[j];
    const before = target[j + 1] ?? null;
    const at = cur.indexOf(field);
    if (at >= 0 && (cur[at + 1] ?? null) === before) continue;
    push(at >= 0 ? { op: "moveCompactField", field, before } : { op: "addCompactField", field, before });
  }
  return ops;
}

/**
 * Whether the published header still lines up with the org's compact layout:
 * the fields the cache had are the org's now (older snapshots without
 * `compactSources`: the drawn fields appear in the org's, in order).
 */
export function alignCompact(source: { fields: string[] } | undefined, drawn: RecordFieldSpec[], live: string[]): boolean {
  if (source) return source.fields.length === live.length && source.fields.every((f, i) => f === live[i]);
  let k = 0;
  for (const f of live) if (f === drawn[k]?.name) k++;
  return k === drawn.length;
}

/** The record name is the header's title, so a Name field isn't drawn again (published.ts). */
const isTitle = (field: string) => field.toLowerCase() === "name";

export interface DraftHeaderField {
  spec: RecordFieldSpec;
  state: DraftState;
}

/**
 * The header's fields as the tray leaves them: the target order with removed
 * fields as ghosts where they were, added ones drawn from the object's describe.
 */
export function draftHeader(published: RecordFieldSpec[], live: LiveCompactLayout, base: string[], target: string[]): DraftHeaderField[] {
  const specs = new Map(published.map((s) => [s.name, s]));
  const common = base.filter((f) => target.includes(f));
  const commonTarget = target.filter((f) => base.includes(f));
  return withGhosts(base, target).flatMap(({ key, ghost }) => {
    if (isTitle(key)) return [];
    const added = !base.includes(key);
    const known = live.available.find((a) => a.name === key);
    // Fields the cache left out (the profile can't read them) stay out; added ones come from the describe.
    const spec = specs.get(key) ?? (added && known ? { name: key, label: known.label, type: known.type } : undefined);
    if (!spec) return [];
    const state: DraftState = ghost ? "removed" : added ? "added" : common.indexOf(key) !== commonTarget.indexOf(key) ? "moved" : "same";
    return [{ spec, state }];
  });
}

// --- Verbs -------------------------------------------------------------------------

/** One compact layout in Draft: the org's fields, the arranged ones, and how to queue a new arrangement. */
export interface CompactDraft {
  /** "Object.DeveloperName". */
  fullName: string;
  label: string;
  live: LiveCompactLayout;
  base: string[];
  target: string[];
  /** Fields drawn in the header, in Draft order: moves step past these only. */
  shown: string[];
}

export function compactFix(fullName: string, label: string, ops: CompactOp[]): CompactLayoutEditFix {
  return compactOpsChange(fullName, label, ops) as CompactLayoutEditFix;
}

/** The fields once the tray is applied; throws `StaleDraftError` when the queued ops don't fit the org's compact layout. */
export function compactTargetOf(fullName: string, base: string[], pending: PendingChange[]): string[] {
  const queued = pendingFor(pending, compactFix(fullName, "", []))?.fix;
  return queued?.kind === "editMetadata" && queued.doc.type === "CompactLayout" ? applyCompactOps(base, queued.ops as CompactOp[]) : [...base];
}

/** The tray with this compact layout arranged as `next` (its change dropped when that's the org's). */
function arrange(d: CompactDraft, next: string[], pending: PendingChange[]): PendingChange[] {
  const without = pending.filter((p) => !(p.fix.kind === "editMetadata" && p.fix.doc.type === "CompactLayout" && p.fix.doc.fullName === d.fullName));
  return queueChange(without, { fix: compactFix(d.fullName, d.label, diffCompactOps(d.base, next)) });
}

function verb(d: CompactDraft, id: Verb["id"], label: string, title: string, edit: (m: string[]) => string[] | null, reason?: string): Verb {
  const next = edit([...d.target]);
  return next ? { id, label, title, run: (p) => arrange(d, next, p) } : { id, label, title, reason: reason ?? title };
}

/** Swap places with the nearest shown neighbour, or null at an end. */
function step(order: string[], shown: string[], field: string, dir: -1 | 1): string[] | null {
  const vis = shown.filter((f) => order.includes(f));
  const other = vis[vis.indexOf(field) + dir];
  if (!vis.includes(field) || other === undefined) return null;
  const out = order.filter((f) => f !== field);
  const at = out.indexOf(other);
  out.splice(dir < 0 ? at : at + 1, 0, field);
  return out;
}

/** "Add field…": fields the compact layout doesn't have yet, placed after `after` (or at the end). */
function addVerb(d: CompactDraft, after: string | null): Verb {
  const options = d.live.available
    .filter((a) => !d.target.includes(a.name) && !isTitle(a.name))
    .map((a) => ({ value: a.name, label: a.label, detail: a.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const title = "Add a field to the record header";
  if (d.target.length >= MAX_COMPACT_FIELDS) {
    return { id: "addField", label: "Add field…", title, reason: `A compact layout holds at most ${MAX_COMPACT_FIELDS} fields. Remove one first.` };
  }
  if (!d.live.available.length) return { id: "addField", label: "Add field…", title, reason: `Couldn't read ${d.live.fullName.split(".")[0]}'s fields from the org.` };
  return {
    id: "addField",
    label: "Add field…",
    title,
    pick: {
      title: "Add a field to the record header",
      placeholder: "Search fields",
      options,
      empty: "Every field that can go in the header is already there.",
      run: (field, p) => {
        const next = [...d.target];
        const at = after ? next.indexOf(after) + 1 : next.length;
        next.splice(at > 0 ? at : next.length, 0, field);
        return arrange(d, next, p);
      },
    },
  };
}

/** Verbs for a header field; `field` may be a removed one (drawn as a ghost) or an added one. */
export function compactVerbs(d: CompactDraft, field: string, label: string): Verb[] {
  if (!d.target.includes(field)) {
    if (!d.base.includes(field)) return [];
    return [
      verb(d, "restore", "Restore", `Put ${label} back in the header`, (m) =>
        m.length >= MAX_COMPACT_FIELDS ? null : withGhosts(d.base, m, (f) => f === field).map((o) => o.key),
        `A compact layout holds at most ${MAX_COMPACT_FIELDS} fields. Remove one first.`
      ),
    ];
  }
  return [
    verb(d, "up", "Move left", `Move ${label} left`, (m) => step(m, d.shown, field, -1), "Already the first field"),
    verb(d, "down", "Move right", `Move ${label} right`, (m) => step(m, d.shown, field, 1), "Already the last field"),
    verb(d, "remove", "Remove", `Take ${label} out of the header`, (m) => m.filter((f) => f !== field)),
    addVerb(d, field),
  ];
}

/** Shown in the inspector once the header holds more than fits across the screen. */
export function crowdedNote(d: CompactDraft): string | null {
  const n = d.target.filter((f) => !isTitle(f)).length;
  return n > HEADER_FITS ? `${n} fields in the header — fields after the first ${HEADER_FITS} or so scroll off the iPad's screen.` : null;
}
