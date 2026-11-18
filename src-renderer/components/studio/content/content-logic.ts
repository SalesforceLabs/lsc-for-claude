/**
 * The builder's rules the renderer needs: which parts of a presentation a draft changes, and how a value reads.
 * A copy of part of src/studio/content/logic.ts (the renderer bundle cannot import from src/);
 * test/unit/studio/content/renderer-logic.test.ts checks the two agree.
 */

import {
  NEW_PAGE_PREFIX,
  type ContentDraft,
  type ContentDraftEvent,
  type CreatePresentationFix,
  type DraftPage,
  type NewPage,
  type PageOption,
  type DraftShare,
  type Named,
  type PresentationDraft,
  type PresentationFields,
  type TerritoryOption,
} from "./content-types";

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

export function changedParts(from: PresentationDraft, to: PresentationDraft): Part[] {
  return PARTS.filter((p) => partKey(from, p) !== partKey(to, p));
}

export function sameDraft(a: PresentationDraft, b: PresentationDraft): boolean {
  return changedParts(a, b).length === 0;
}

// --- Edits the editor makes (renderer only) ------------------------------------------------

export function setField<K extends FieldKey>(
  d: PresentationDraft,
  key: K,
  value: PresentationFields[K]
): PresentationDraft {
  return { ...d, fields: { ...d.fields, [key]: value } };
}

/** Moves the page at `from` to index `to`. */
export function movePage(d: PresentationDraft, from: number, to: number): PresentationDraft {
  if (from === to || from < 0 || from >= d.pages.length || to < 0 || to >= d.pages.length) return d;
  const pages = [...d.pages];
  const [p] = pages.splice(from, 1);
  pages.splice(to, 0, p);
  return { ...d, pages };
}

export function removePage(d: PresentationDraft, pageId: string): PresentationDraft {
  return { ...d, pages: d.pages.filter((p) => p.pageId !== pageId) };
}

/** Adds a page at the end; it keeps its own settings, so `page` carries them when they're known. */
export function addPage(d: PresentationDraft, page: DraftPage): PresentationDraft {
  if (d.pages.some((p) => p.pageId === page.pageId)) return d;
  return { ...d, pages: [...d.pages, page] };
}

export function updatePage(
  d: PresentationDraft,
  pageId: string,
  change: Partial<Pick<DraftPage, "mandatory" | "products">>
): PresentationDraft {
  return { ...d, pages: d.pages.map((p) => (p.pageId === pageId ? { ...p, ...change } : p)) };
}

const byName = <T extends { name: string }>(xs: T[]) =>
  [...xs].sort((a, b) => a.name.localeCompare(b.name));

export function addNamed(list: Named[], item: Named): Named[] {
  return list.some((x) => x.id === item.id) ? list : byName([...list, item]);
}

export function removeNamed(list: Named[], id: string): Named[] {
  return list.filter((x) => x.id !== id);
}

/**
 * Distributing to a territory picks its group: the territory and the ones below it when it has any (as the
 * Distribute Presentation action does), else the territory alone. Null when the territory has no group yet.
 */
export function shareFor(t: TerritoryOption, withChildren: boolean): DraftShare | null {
  const groupId = withChildren
    ? (t.subordinatesGroupId ?? t.groupId)
    : (t.groupId ?? t.subordinatesGroupId);
  if (!groupId) return null;
  return {
    groupId,
    territoryId: t.territoryId,
    name: t.name,
    subordinates: groupId === t.subordinatesGroupId,
  };
}

export function addShare(d: PresentationDraft, share: DraftShare): PresentationDraft {
  // One group per territory: picking it again with or without the ones below swaps it.
  const shares = d.shares.filter((s) => s.territoryId !== share.territoryId);
  return { ...d, shares: byName([...shares, share]) };
}

export function removeShare(d: PresentationDraft, groupId: string): PresentationDraft {
  return { ...d, shares: d.shares.filter((s) => s.groupId !== groupId) };
}

export const shareName = (s: DraftShare) => (s.subordinates ? `${s.name} and below` : s.name);

/** What the editor shows as a value. */
export function showField(k: FieldKey, v: unknown): string {
  if (v === null || v === undefined || v === "") return "(none)";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (k === "gesture") return GESTURE_LABEL[String(v)] ?? String(v);
  return String(v);
}

/** Problems the editor shows before anything is queued (the server checks them again). */
export function fieldProblem(k: FieldKey, v: unknown): string | null {
  if (k === "name") {
    const name = String(v ?? "");
    if (!name.trim()) return "The presentation needs a name.";
    if (name.length > 80) return "The name is over 80 characters.";
  }
  return null;
}

export const PART_LABEL = (p: Part): string =>
  p.startsWith("field:")
    ? FIELD_LABEL[p.slice(6) as FieldKey].toLowerCase()
    : {
        pages: "pages",
        mandatory: "required pages",
        products: "page products",
        topics: "topics",
        shares: "territories",
      }[p as "pages"];

/** The tray row's label: "Change Cordim deck: pages, territories". */
export function editLabel(name: string, parts: Part[]): string {
  const words = [...new Set(parts.map(PART_LABEL))];
  if (!words.length) return `Change ${name}`;
  const list = words.length > 3 ? `${words.slice(0, 3).join(", ")} and more` : words.join(", ");
  return `Change ${name}: ${list}`;
}

// --- New presentations (renderer only) ------------------------------------------------------

export const isDraftedPage = (pageId: string) => pageId.startsWith(NEW_PAGE_PREFIX);
export const draftedPageId = (draftId: string) => `${NEW_PAGE_PREFIX}${draftId}`;

/** A new presentation's starting point: inactive, nothing in it. */
export function blankPresentation(name: string): PresentationDraft {
  return {
    fields: {
      name,
      status: "Inactive",
      activationDate: null,
      deactivationDate: null,
      gesture: null,
      pinchZoom: true,
      doubleTapZoom: true,
      canEmail: false,
      locked: false,
    },
    pages: [],
    topics: [],
    shares: [],
  };
}

/** A page Roz drafted, as a row of a new presentation. */
export function draftedPage(d: Pick<ContentDraft, "id" | "name">): DraftPage {
  return { pageId: draftedPageId(d.id), name: d.name, mandatory: false, products: [] };
}

/**
 * The tray change for a new presentation. `newPages` follows the drafted pages in `draft.pages` (names from
 * the draft as it is now), so taking one out of the presentation drops it from the upload too.
 */
export function newPresentationFix(
  key: string,
  draft: PresentationDraft,
  drafts: Pick<ContentDraft, "id" | "name">[]
): CreatePresentationFix {
  const byId = new Map(drafts.map((d) => [draftedPageId(d.id), d]));
  const pages = draft.pages.map((p) =>
    isDraftedPage(p.pageId) && byId.has(p.pageId) ? { ...p, name: byId.get(p.pageId)!.name } : p
  );
  const newPages: NewPage[] = pages
    .filter((p) => isDraftedPage(p.pageId))
    .map((p) => ({
      pageId: p.pageId,
      draftId: p.pageId.slice(NEW_PAGE_PREFIX.length),
      name: p.name,
    }));
  const name = draft.fields.name.trim() || "New presentation";
  return {
    kind: "createPresentation",
    label: `Create ${name}`,
    key,
    draft: { ...draft, pages },
    newPages,
  };
}

/** A presentation with drafted pages is saved inactive and undistributed (the server refuses anything else). */
export const holdsDraftedPages = (d: PresentationDraft) =>
  d.pages.some((p) => isDraftedPage(p.pageId));

// --- Roz's drafts (renderer only) ----------------------------------------------------------

export const draftRunning = (d: ContentDraft) => d.turns[d.turns.length - 1]?.status === "running";

/** Number of slides in a draft (its HTML files). */
export const slideCount = (d: Pick<ContentDraft, "files">) =>
  d.files.filter((f) => /\.html?$/i.test(f.path)).length;

/** "1 slide", "3 slides". */
export const slidesLabel = (n: number) => `${n} ${n === 1 ? "slide" : "slides"}`;

/**
 * How a page reads in the page picker. Pages unpacked from a deck are often named only by their number
 * ("2", "3"), so those take the name of the one presentation they're in: "Cordim: Dosing — page 2".
 */
export function pageLabel(p: Pick<PageOption, "name" | "presentations">): string {
  const name = p.name.trim();
  if (/^\d{1,3}$/.test(name) && p.presentations.length === 1)
    return `${p.presentations[0]} — page ${Number(name)}`;
  return name || "Untitled page";
}

/** Folds one streamed event into the list of drafts (newest first). Events for a draft not in the list wait for its `draft` event. */
export function applyDraftEvent(
  drafts: ContentDraft[],
  draftId: string,
  event: ContentDraftEvent
): ContentDraft[] {
  if (event.type === "draft") {
    const rest = drafts.filter((d) => d.id !== event.draft.id);
    return [event.draft, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  if (event.type === "writing") return drafts;
  return drafts.map((d) => {
    if (d.id !== draftId) return d;
    if (event.type === "turn") {
      const has = d.turns.some((t) => t.id === event.turn.id);
      return {
        ...d,
        turns: has
          ? d.turns.map((t) => (t.id === event.turn.id ? event.turn : t))
          : [...d.turns, event.turn],
      };
    }
    return {
      ...d,
      turns: d.turns.map((t) => {
        if (t.id !== event.turnId) return t;
        if (event.type === "reply-delta") return { ...t, reply: t.reply + event.text };
        const has = t.steps.some((s) => s.id === event.step.id);
        return {
          ...t,
          steps: has
            ? t.steps.map((s) => (s.id === event.step.id ? event.step : s))
            : [...t.steps, event.step],
        };
      }),
    };
  });
}
