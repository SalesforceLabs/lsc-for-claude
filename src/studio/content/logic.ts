/**
 * The builder's pure rules: which parts of a presentation a change touches, whether the org still holds
 * what the builder saw, and the record writes that take the org from what it holds to the change's `to`.
 * Only the parts a change touches are written, so someone else's edit to another part is left alone.
 */

import type { FixChange } from "../types.js";
import type {
  DraftPage,
  DraftShare,
  Named,
  PresentationDraft,
  PresentationFields,
} from "./types.js";

export type FieldKey = keyof PresentationFields;
export const FIELD_KEYS: FieldKey[] = [
  "name",
  "status",
  "activationDate",
  "deactivationDate",
  "gesture",
  "pinchZoom",
  "doubleTapZoom",
  "canEmail",
  "locked",
];

/** Presentation API names for the fields. */
export const FIELD_API: Record<FieldKey, string> = {
  name: "Name",
  status: "Status",
  activationDate: "ActivationDate",
  deactivationDate: "DeactivationDate",
  gesture: "PlayerGestureSectionSide",
  pinchZoom: "IsPinchZoomEnabled",
  doubleTapZoom: "IsDoubleTapZoomEnabled",
  canEmail: "CanSendByEmail",
  locked: "IsPresentationLocked",
};

export const FIELD_LABEL: Record<FieldKey, string> = {
  name: "Name",
  status: "Status",
  activationDate: "Available from",
  deactivationDate: "Available until",
  gesture: "Show the player's bar with",
  pinchZoom: "Pinch to zoom",
  doubleTapZoom: "Double-tap to zoom",
  canEmail: "Reps can email it",
  locked: "Locked",
};

export const GESTURE_LABEL: Record<string, string> = {
  TapTop: "A tap at the top",
  TapBottom: "A tap at the bottom",
  SwipeUp: "A swipe up from the bottom",
  SwipeDown: "A swipe down from the top",
};

/** The parts of a draft a change can touch. */
export type Part = `field:${FieldKey}` | "pages" | "mandatory" | "products" | "topics" | "shares";

const PARTS: Part[] = [
  ...FIELD_KEYS.map((k) => `field:${k}` as Part),
  "pages",
  "mandatory",
  "products",
  "topics",
  "shares",
];

const sorted = (xs: string[]) => [...xs].sort();

/** A part of the draft as a comparable string (names are ignored: only ids and values count). */
export function partKey(d: PresentationDraft, part: Part): string {
  if (part.startsWith("field:")) {
    const v = d.fields[part.slice(6) as FieldKey];
    return JSON.stringify(v === "" || v === undefined ? null : v);
  }
  switch (part) {
    case "pages":
      return d.pages.map((p) => p.pageId).join(",");
    case "mandatory":
      return sorted(d.pages.map((p) => `${p.pageId}:${p.mandatory ? 1 : 0}`)).join(",");
    case "products":
      return sorted(
        d.pages.map((p) => `${p.pageId}:${sorted(p.products.map((x) => x.id)).join("+")}`)
      ).join(",");
    case "topics":
      return sorted(d.topics.map((t) => t.id)).join(",");
    case "shares":
      return sorted(d.shares.map((s) => s.groupId)).join(",");
    default:
      return "";
  }
}

/** The parts `to` changes from `from`. */
export function changedParts(from: PresentationDraft, to: PresentationDraft): Part[] {
  return PARTS.filter((p) => partKey(from, p) !== partKey(to, p));
}

export function sameDraft(a: PresentationDraft, b: PresentationDraft): boolean {
  return changedParts(a, b).length === 0;
}

/**
 * Whether the org (`current`) can take the change: "applied" when it already holds `to` in every part the change
 * touches, "changed" (with the parts) when it no longer holds `from` in one of them, else "ok".
 */
export function checkCurrent(
  current: PresentationDraft,
  from: PresentationDraft,
  to: PresentationDraft
): { state: "ok" | "applied" } | { state: "changed"; parts: Part[] } {
  const parts = changedParts(from, to);
  if (parts.every((p) => partKey(current, p) === partKey(to, p))) return { state: "applied" };
  // A page's mandatory switch and products are compared on the pages both drafts have.
  const moved = parts.filter((p) => {
    if (p === "mandatory" || p === "products") {
      const ids = new Set(from.pages.map((x) => x.pageId));
      const pick = (d: PresentationDraft) => ({
        ...d,
        pages: d.pages.filter((x) => ids.has(x.pageId)),
      });
      return partKey(pick(current), p) !== partKey(pick(from), p);
    }
    return partKey(current, p) !== partKey(from, p);
  });
  return moved.length ? { state: "changed", parts: moved } : { state: "ok" };
}

export const PART_LABEL = (p: Part): string =>
  p.startsWith("field:")
    ? FIELD_LABEL[p.slice(6) as FieldKey]
    : {
        pages: "pages",
        mandatory: "required pages",
        products: "page products",
        topics: "topics",
        shares: "territories",
      }[p as "pages"];

/** Ids of the records the writes act on, read with the draft. */
export interface DraftRows {
  /** PresentationLinkedPage Id and DisplayOrder per page id. */
  links: Map<string, { id: string; order: number }>;
  /** Each page's own state (pages in the presentation and pages being added): mandatory, and PresentationPageProduct Id per product id. */
  pageState: Map<string, { mandatory: boolean; products: Map<string, string> }>;
  /** TopicAssignment Id per topic id. */
  topics: Map<string, string>;
  /** PresentationShare Ids per group id (Manual and LSC4CEAutoShare rows). */
  shares: Map<string, string[]>;
}

/** The record writes, in the order they're made. */
export interface WritePlan {
  presentation: Record<string, unknown> | null;
  deleteLinks: string[];
  createLinks: { PresentationPageId: string; DisplayOrder: number }[];
  reorderLinks: { Id: string; DisplayOrder: number }[];
  mandatory: { Id: string; IsMandatory: boolean }[];
  createProducts: { PresentationPageId: string; ProductId: string }[];
  deleteProducts: string[];
  createTopics: string[];
  deleteTopics: string[];
  addShares: DraftShare[];
  /** Group ids whose shares go. */
  removeShares: string[];
}

export const emptyPlan = (): WritePlan => ({
  presentation: null,
  deleteLinks: [],
  createLinks: [],
  reorderLinks: [],
  mandatory: [],
  createProducts: [],
  deleteProducts: [],
  createTopics: [],
  deleteTopics: [],
  addShares: [],
  removeShares: [],
});

export function planIsEmpty(p: WritePlan): boolean {
  return (
    !p.presentation &&
    !p.deleteLinks.length &&
    !p.createLinks.length &&
    !p.reorderLinks.length &&
    !p.mandatory.length &&
    !p.createProducts.length &&
    !p.deleteProducts.length &&
    !p.createTopics.length &&
    !p.deleteTopics.length &&
    !p.addShares.length &&
    !p.removeShares.length
  );
}

const fieldValue = (k: FieldKey, v: unknown) => {
  if (k === "pinchZoom" || k === "doubleTapZoom" || k === "canEmail" || k === "locked") return !!v;
  return v === "" || v === undefined ? null : v;
};

/** The writes that take `current` (with its record ids) to `to` in the given parts. */
export function planWrites(
  current: PresentationDraft,
  rows: DraftRows,
  to: PresentationDraft,
  parts: Part[]
): WritePlan {
  const plan = emptyPlan();
  const has = (p: Part) => parts.includes(p);

  const fields: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) {
    if (!has(`field:${k}`)) continue;
    const next = fieldValue(k, to.fields[k]);
    if (JSON.stringify(fieldValue(k, current.fields[k])) !== JSON.stringify(next))
      fields[FIELD_API[k]] = next;
  }
  if (Object.keys(fields).length) plan.presentation = fields;

  if (has("pages") && partKey(current, "pages") !== partKey(to, "pages")) {
    const keep = new Set(to.pages.map((p) => p.pageId));
    for (const p of current.pages) {
      const link = rows.links.get(p.pageId);
      if (!keep.has(p.pageId) && link) plan.deleteLinks.push(link.id);
    }
    to.pages.forEach((p, i) => {
      const order = i + 1;
      const link = rows.links.get(p.pageId);
      if (!link) plan.createLinks.push({ PresentationPageId: p.pageId, DisplayOrder: order });
      else if (link.order !== order) plan.reorderLinks.push({ Id: link.id, DisplayOrder: order });
    });
  }

  // Mandatory and products are the page's own: read for every page in either draft (`rows.pageState`).
  if (has("mandatory")) {
    for (const p of to.pages) {
      const was = rows.pageState.get(p.pageId);
      if (was && was.mandatory !== p.mandatory)
        plan.mandatory.push({ Id: p.pageId, IsMandatory: p.mandatory });
    }
  }

  if (has("products")) {
    for (const p of to.pages) {
      const was = rows.pageState.get(p.pageId);
      if (!was) continue;
      const next = new Set(p.products.map((x) => x.id));
      for (const id of next)
        if (!was.products.has(id))
          plan.createProducts.push({ PresentationPageId: p.pageId, ProductId: id });
      for (const [id, row] of was.products) if (!next.has(id)) plan.deleteProducts.push(row);
    }
  }

  if (has("topics")) {
    const was = new Set(current.topics.map((t) => t.id));
    const next = new Set(to.topics.map((t) => t.id));
    for (const id of next) if (!was.has(id)) plan.createTopics.push(id);
    for (const id of was) {
      const row = rows.topics.get(id);
      if (!next.has(id) && row) plan.deleteTopics.push(row);
    }
  }

  if (has("shares")) {
    const was = new Set(current.shares.map((s) => s.groupId));
    const next = new Set(to.shares.map((s) => s.groupId));
    plan.addShares = to.shares.filter((s) => !was.has(s.groupId));
    plan.removeShares = current.shares.filter((s) => !next.has(s.groupId)).map((s) => s.groupId);
  }
  return plan;
}

// --- What the review dialog shows ------------------------------------------------------------

const yesNo = (v: boolean) => (v ? "Yes" : "No");
const listOf = (xs: string[], none = "(none)") => {
  if (!xs.length) return none;
  return xs.length > 6 ? `${xs.slice(0, 6).join(", ")} and ${xs.length - 6} more` : xs.join(", ");
};

export function showField(k: FieldKey, v: unknown): string {
  if (v === null || v === undefined || v === "") return "(none)";
  if (typeof v === "boolean") return yesNo(v);
  if (k === "gesture") return GESTURE_LABEL[String(v)] ?? String(v);
  return String(v);
}

const shareName = (s: DraftShare) => (s.subordinates ? `${s.name} and below` : s.name);

/** The review dialog's lines for a change from `from` to `to`. */
export function describeChanges(
  name: string,
  from: PresentationDraft,
  to: PresentationDraft,
  /** A new presentation: its fields had no value before, not a default one. */
  created = false
): FixChange[] {
  const out: FixChange[] = [];
  for (const part of changedParts(from, to)) {
    if (part.startsWith("field:")) {
      const k = part.slice(6) as FieldKey;
      out.push({
        target: name,
        field: FIELD_LABEL[k],
        before: created ? "(none)" : showField(k, from.fields[k]),
        after: showField(k, to.fields[k]),
      });
      continue;
    }
    switch (part) {
      case "pages": {
        const was = new Set(from.pages.map((p) => p.pageId));
        const next = new Set(to.pages.map((p) => p.pageId));
        const added = to.pages.filter((p) => !was.has(p.pageId));
        const removed = from.pages.filter((p) => !next.has(p.pageId));
        for (const p of added) {
          out.push({
            target: name,
            field: "Page",
            before: "(not in it)",
            after: `${p.name}, page ${to.pages.indexOf(p) + 1}`,
          });
        }
        for (const p of removed)
          out.push({ target: name, field: "Page", before: p.name, after: "(taken out)" });
        const keptFrom = from.pages.filter((p) => next.has(p.pageId)).map((p) => p.pageId);
        const keptTo = to.pages.filter((p) => was.has(p.pageId)).map((p) => p.pageId);
        if (keptFrom.join() !== keptTo.join()) {
          out.push({
            target: name,
            field: "Page order",
            before: listOf(from.pages.map((p) => p.name)),
            after: listOf(to.pages.map((p) => p.name)),
          });
        }
        break;
      }
      case "mandatory": {
        const was = new Map(from.pages.map((p) => [p.pageId, p.mandatory]));
        for (const p of to.pages) {
          if (was.has(p.pageId) && was.get(p.pageId) !== p.mandatory) {
            out.push({
              target: p.name,
              field: "Reps must show it",
              before: yesNo(!!was.get(p.pageId)),
              after: yesNo(p.mandatory),
            });
          }
        }
        break;
      }
      case "products": {
        const was = new Map(from.pages.map((p) => [p.pageId, p.products]));
        for (const p of to.pages) {
          const before = was.get(p.pageId) ?? [];
          const key = (xs: Named[]) => sorted(xs.map((x) => x.id)).join();
          if (was.has(p.pageId) && key(before) !== key(p.products)) {
            out.push({
              target: p.name,
              field: "Products",
              before: listOf(before.map((x) => x.name)),
              after: listOf(p.products.map((x) => x.name)),
            });
          }
        }
        break;
      }
      case "topics":
        out.push({
          target: name,
          field: "Topics",
          before: listOf(from.topics.map((t) => t.name)),
          after: listOf(to.topics.map((t) => t.name)),
        });
        break;
      case "shares":
        out.push({
          target: name,
          field: "Territories",
          before: listOf(from.shares.map(shareName), "(not distributed)"),
          after: listOf(to.shares.map(shareName), "(not distributed)"),
        });
        break;
    }
  }
  return out;
}

/** What the review dialog warns about, from the draft alone. */
export function draftWarnings(
  from: PresentationDraft,
  to: PresentationDraft,
  sharedPages: Record<string, string[]>,
  today: string
): string[] {
  const warnings: string[] = [];
  const parts = changedParts(from, to);
  const was = new Map(from.pages.map((p) => [p.pageId, p]));
  if (parts.includes("mandatory") || parts.includes("products")) {
    for (const p of to.pages) {
      const before = was.get(p.pageId);
      const touched =
        before &&
        (before.mandatory !== p.mandatory ||
          sorted(before.products.map((x) => x.id)).join() !==
            sorted(p.products.map((x) => x.id)).join());
      const others = sharedPages[p.pageId] ?? [];
      if (touched && others.length) {
        warnings.push(
          `${p.name} is also in ${listOf(others)}. Its required setting and products change there too.`
        );
      }
    }
  }
  if (
    parts.includes("pages") &&
    from.pages.some((p) => !to.pages.some((q) => q.pageId === p.pageId))
  ) {
    warnings.push("Pages taken out stay in the org; only their place in this presentation goes.");
  }
  const active = to.fields.status === "Active";
  if (active && !to.pages.length)
    warnings.push("The presentation is active but has no pages, so reps can't open it.");
  if (active && !to.shares.length)
    warnings.push("The presentation isn't distributed to any territory, so reps won't see it.");
  if (
    to.fields.activationDate &&
    to.fields.deactivationDate &&
    to.fields.deactivationDate < to.fields.activationDate
  ) {
    warnings.push("It stops being available before it starts.");
  }
  if (active && to.fields.deactivationDate && to.fields.deactivationDate < today) {
    warnings.push("Its end date has passed, so reps won't see it.");
  }
  return warnings;
}

/** Problems that make a change impossible. */
export function draftProblem(
  to: PresentationDraft,
  statusValues: string[],
  gestureValues: string[]
): string | null {
  if (!to.fields.name.trim()) return "The presentation needs a name.";
  if (to.fields.name.length > 80) return "The name is over 80 characters.";
  if (statusValues.length && !statusValues.includes(to.fields.status))
    return `The org doesn't take the status ${to.fields.status}.`;
  if (to.fields.gesture && gestureValues.length && !gestureValues.includes(to.fields.gesture)) {
    return `The org doesn't take the gesture ${to.fields.gesture}.`;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/;
  for (const k of ["activationDate", "deactivationDate"] as const) {
    const v = to.fields[k];
    if (v && !date.test(v)) return `${FIELD_LABEL[k]} isn't a date.`;
  }
  const ids = to.pages.map((p) => p.pageId);
  if (new Set(ids).size !== ids.length) return "A page is in the presentation twice.";
  return null;
}

/** A page entry for the draft (pages added from the library keep their own settings). */
export function pageEntry(p: Pick<DraftPage, "pageId" | "name"> & Partial<DraftPage>): DraftPage {
  return { pageId: p.pageId, name: p.name, mandatory: !!p.mandatory, products: p.products ?? [] };
}
