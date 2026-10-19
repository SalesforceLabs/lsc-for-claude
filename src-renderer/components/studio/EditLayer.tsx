import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Asterisk,
  CircleMinus,
  Columns2,
  Heading,
  Lock,
  Plus,
  Undo2,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Eye,
  EyeOff,
  ExternalLink,
  Power,
  PowerOff,
  Trash2,
  ListPlus,
  TextCursorInput,
  PanelTopOpen,
  SquarePlus,
  Star,
  type LucideIcon,
} from "lucide-react";
import { targetKey, targetTag, type EditTarget } from "./edit-targets";
import type { Verb, VerbId } from "./edit-draft";
import Menu, { type MenuItem } from "../ui/Menu";
import "./edit-mode.css";

/**
 * Edit mode's selection layer over the iPad preview. Blocks that come from
 * configuration are wrapped in a `Mark` (or carry `editAttrs`); the surface
 * draws hover outlines, the selection ring and its toolbar above the scaled
 * screen, so nothing inside the simulated iPad changes size or style.
 */
const EditContext = createContext(false);

/**
 * What a block can be dragged among, in Draft: blocks of the same `family` (one
 * layout's fields, the tab bar) take it, in the `list` each is drawn in (a
 * field's section and column), handed to the drop. Blocks with the same `id`
 * move as one (a compound field's parts). Ghosts are drawn but take no drop.
 */
export interface DragSpec {
  family: string;
  list?: unknown;
  id?: string;
  ghost?: boolean;
  /** The list runs left to right (the tab bar, the record header). */
  horizontal?: boolean;
}

/** Where a block was dropped: its list, and the block it now comes right before (null: last). */
export interface EditDrop {
  list: unknown;
  before: EditTarget | null;
}

/** Attributes that make an element selectable; the target rides along as JSON. `pass` lets a click still do what it does on the iPad (tabs, list chips). */
export function editAttrs(on: boolean, target: EditTarget, pass = false, drag?: DragSpec): Record<string, string> {
  if (!on) return {};
  return {
    "data-edit-key": targetKey(target),
    "data-edit-target": JSON.stringify(target),
    ...(pass ? { "data-edit-pass": "" } : {}),
    ...(drag
      ? {
          "data-edit-drag": drag.family,
          "data-edit-list": JSON.stringify(drag.list ?? null),
          ...(drag.id !== undefined ? { "data-edit-id": drag.id } : {}),
          ...(drag.ghost ? { "data-edit-ghost": "" } : {}),
          ...(drag.horizontal ? { "data-edit-axis": "x" } : {}),
        }
      : {}),
  };
}

export const useEditOn = () => useContext(EditContext);

/** The family being dragged right now (null when nothing is), so a list can show its empty drop targets only while one is. */
const DragContext = createContext<string | null>(null);
export const useDragFamily = () => useContext(DragContext);

/**
 * Makes an element a place blocks of `drag.family` can be dropped in `drag.list`,
 * even when the list has no block (an empty layout column); with blocks it widens
 * the list's drop area to this element.
 */
export function slotAttrs(on: boolean, drag: DragSpec): Record<string, string> {
  return on ? { "data-edit-slot": drag.family, "data-edit-list": JSON.stringify(drag.list ?? null) } : {};
}

/**
 * Counts in a list's order without being selectable or draggable itself: a block
 * the page draws in parts (the details card) still has a place a drop can land before.
 */
export function Anchor({ target, drag, children }: { target: EditTarget; drag: DragSpec; children: React.ReactNode }) {
  const on = useContext(EditContext);
  if (!on) return <>{children}</>;
  const attrs = editAttrs(true, target, false, drag);
  delete attrs["data-edit-key"];
  return (
    <div className="studio-edit-mark" {...attrs} data-edit-anchor="">
      {children}
    </div>
  );
}

/** A selectable block. Lays out as its children (display: contents). */
export function Mark({ target, drag, children }: { target: EditTarget; drag?: DragSpec; children: React.ReactNode }) {
  const on = useContext(EditContext);
  if (!on) return <>{children}</>;
  return (
    <div className="studio-edit-mark" {...editAttrs(true, target, false, drag)}>
      {children}
    </div>
  );
}

const targetOf = (el: Element | null): EditTarget | undefined => {
  const raw = el?.getAttribute("data-edit-target");
  return raw ? (JSON.parse(raw) as EditTarget) : undefined;
};

/** A block's box in the surface's coordinates; a `display: contents` mark is the union of its children. */
function boxOf(el: Element, origin: DOMRect): DOMRect | null {
  let r = el.getBoundingClientRect();
  if (!r.width && !r.height) {
    const rects = [...el.children]
      .map((c) => c.getBoundingClientRect())
      .filter((c) => c.width || c.height);
    if (!rects.length) return null;
    const left = Math.min(...rects.map((c) => c.left));
    const top = Math.min(...rects.map((c) => c.top));
    r = new DOMRect(
      left,
      top,
      Math.max(...rects.map((c) => c.right)) - left,
      Math.max(...rects.map((c) => c.bottom)) - top
    );
  }
  return new DOMRect(r.left - origin.left, r.top - origin.top, r.width, r.height);
}

/** A block's box with the visible part of the page it is drawn on: the box clipped by every scrolling or clipping ancestor, in the surface's coordinates. */
export interface Seen {
  box: DOMRect;
  /** The nearest clipping rect (the scroll viewport), in the surface's coordinates. */
  clip: DOMRect;
}

/** `box` cut to what the scroll containers around `el` show, or null when none of it is on screen. */
export function seenOf(el: Element, root: Element, origin: DOMRect): Seen | null {
  const box = boxOf(el, origin);
  if (!box) return null;
  let left = -Infinity;
  let top = -Infinity;
  let right = Infinity;
  let bottom = Infinity;
  for (let n = el.parentElement; n && n !== root; n = n.parentElement) {
    const st = getComputedStyle(n);
    if (st.display === "contents" || (st.overflowX === "visible" && st.overflowY === "visible")) continue;
    const r = n.getBoundingClientRect();
    if (st.overflowX !== "visible") {
      left = Math.max(left, r.left - origin.left);
      right = Math.min(right, r.right - origin.left);
    }
    if (st.overflowY !== "visible") {
      top = Math.max(top, r.top - origin.top);
      bottom = Math.min(bottom, r.bottom - origin.top);
    }
  }
  const clip = new DOMRect(
    Number.isFinite(left) ? left : box.left,
    Number.isFinite(top) ? top : box.top,
    (Number.isFinite(right) ? right : box.right) - (Number.isFinite(left) ? left : box.left),
    (Number.isFinite(bottom) ? bottom : box.bottom) - (Number.isFinite(top) ? top : box.top)
  );
  return { box, clip };
}

/** The part of `seen.box` inside its clip, or null when it is entirely outside. */
export function visibleBox({ box, clip }: Seen): DOMRect | null {
  const l = Math.max(box.left, clip.left);
  const t = Math.max(box.top, clip.top);
  const r = Math.min(box.right, clip.right);
  const b = Math.min(box.bottom, clip.bottom);
  return r > l && b > t ? new DOMRect(l, t, r - l, b - t) : null;
}

const union = (a: DOMRect, b: DOMRect) => {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top);
};

const distance = (r: DOMRect, x: number, y: number) =>
  Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));

interface DragItem {
  id: string;
  target: EditTarget;
  box: DOMRect;
}
interface DragList {
  list: string;
  items: DragItem[];
  box: DOMRect;
}

const dragId = (el: Element) => el.getAttribute("data-edit-id") ?? el.getAttribute("data-edit-key") ?? "";
const dragList = (el: Element) => el.getAttribute("data-edit-list") ?? "null";

/** The lists a block of `family` can be dropped in, each with its blocks (ghosts left out) in drawn order. */
function dragLists(root: Element, family: string, origin: DOMRect): DragList[] {
  const lists = new Map<string, DragItem[]>();
  for (const el of root.querySelectorAll(`[data-edit-drag="${CSS.escape(family)}"]`)) {
    if (el.hasAttribute("data-edit-ghost")) continue;
    const box = boxOf(el, origin);
    const target = targetOf(el);
    if (!box || !target) continue;
    const items = lists.get(dragList(el)) ?? [];
    const id = dragId(el);
    const same = items.find((i) => i.id === id);
    if (same) same.box = union(same.box, box);
    else items.push({ id, target, box });
    lists.set(dragList(el), items);
  }
  const slots = new Map<string, DOMRect>();
  for (const el of root.querySelectorAll(`[data-edit-slot="${CSS.escape(family)}"]`)) {
    const box = boxOf(el, origin);
    const at = dragList(el);
    if (box) slots.set(at, slots.has(at) ? union(slots.get(at)!, box) : box);
  }
  return [...new Set([...lists.keys(), ...slots.keys()])].map((list) => {
    const items = lists.get(list) ?? [];
    const slot = slots.get(list);
    return { list, items, box: [...items.map((i) => i.box), ...(slot ? [slot] : [])].reduce(union) };
  });
}

/**
 * Where a drag at (x, y) lands: the nearest list, before the first block the
 * pointer hasn't passed. Blocks that wrap (two Home components to a row) are
 * ordered by row, then left to right, and get a vertical line within a row.
 * `drop` is null right next to where the block is.
 */
function landing(
  lists: DragList[],
  x: number,
  y: number,
  dragged: { id: string; list: string },
  horizontal: boolean
): { line: DOMRect; across: boolean; drop: EditDrop | null } | null {
  if (!lists.length) return null;
  const near = lists.reduce((a, b) => (distance(b.box, x, y) < distance(a.box, x, y) ? b : a));
  const { items } = near;
  if (!items.length) {
    // An empty list takes the drop at its top.
    const b = near.box;
    return { line: new DOMRect(b.x, b.y + 1, b.width, 3), across: false, drop: { list: JSON.parse(near.list) as unknown, before: null } };
  }
  const overlap = (a: DOMRect, b: DOMRect) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) / 2;
  const wraps = (i: DragItem) => !horizontal && items.some((o) => o !== i && overlap(o.box, i.box));
  const inRow = (i: DragItem) => wraps(i) && y >= i.box.top && y <= i.box.bottom;
  const passed = (i: DragItem) =>
    horizontal || inRow(i) ? i.box.x + i.box.width / 2 < x : i.box.y + i.box.height / 2 < y;
  const k = items.filter(passed).length;
  const prev = items[k - 1];
  const next = items[k];
  const here = near.list === dragged.list && (prev?.id === dragged.id || next?.id === dragged.id);
  const drop = here ? null : { list: JSON.parse(near.list) as unknown, before: next?.target ?? null };
  const rect = (r: DOMRect, across: boolean, at: number) =>
    across ? new DOMRect(at - 1.5, r.y, 3, r.height) : new DOMRect(r.x, at - 1.5, r.width, 3);
  if (horizontal) {
    const at = prev && next ? (prev.box.right + next.box.left) / 2 : prev ? prev.box.right + 2 : next.box.left - 2;
    return { line: rect(near.box, true, at), across: true, drop };
  }
  if (prev && next && overlap(prev.box, next.box))
    return { line: rect(union(prev.box, next.box), true, (prev.box.right + next.box.left) / 2), across: true, drop };
  if (next && inRow(next)) return { line: rect(next.box, true, next.box.left - 2), across: true, drop };
  if (prev && inRow(prev)) return { line: rect(prev.box, true, prev.box.right + 2), across: true, drop };
  const at = prev && next ? (prev.box.bottom + next.box.top) / 2 : prev ? prev.box.bottom + 2 : next.box.top - 2;
  return { line: rect(near.box, false, at), across: false, drop };
}

const VERB_ICONS: Record<VerbId, LucideIcon> = {
  up: ArrowUp,
  down: ArrowDown,
  hide: EyeOff,
  show: Eye,
  off: PowerOff,
  on: Power,
  discard: Trash2,
  remove: CircleMinus,
  restore: Undo2,
  column: Columns2,
  heading: Heading,
  required: Asterisk,
  readonly: Lock,
  addField: TextCursorInput,
  addRelated: ListPlus,
  default: Star,
  insertComponent: SquarePlus,
  addTab: PanelTopOpen,
};

/** Toolbar words; the full sentence ("Hide for LS Rep") is the button's tooltip and stays in the inspector. */
const TOOLBAR_LABELS: Partial<Record<VerbId, string>> = { hide: "Hide", show: "Show", addField: "Add field", addRelated: "Add list", insertComponent: "Insert", addTab: "Add tab" };
/** Verbs the toolbar draws as an icon alone; their tooltip says what they do. */
const ICON_ONLY = new Set<VerbId>(["up", "down", "column", "heading", "required", "readonly"]);

export interface EditSurfaceProps {
  on: boolean;
  selected: EditTarget | null;
  /** `extend`: a ⌘- or ⇧-click, adding the block to the selection (multi-select.ts). */
  onSelect: (target: EditTarget | null, extend?: boolean) => void;
  /** The rest of a multi-selection, ringed beside `selected`; the toolbar stays on `selected`. */
  also?: EditTarget[];
  /** The toolbar's name for the selection ("3 fields"), when it isn't the block's own. */
  name?: string;
  /** Verbs for the selected block, and the tray they'd leave. */
  verbs: Verb[];
  onRun: (verb: Verb) => void;
  /** "Open in Setup" for blocks Studio can't change itself. */
  setup?: { label: string } | null;
  onSetup?: () => void;
  /** Tab and header field moves go left / right rather than up / down. */
  horizontal?: boolean;
  /** A block carrying a `DragSpec` was dragged to `drop`; false when that move can't be made (the block nudges). Draft only. */
  onDrop?: (target: EditTarget, drop: EditDrop) => boolean;
  children: React.ReactNode;
}

/** A press on a draggable block; it becomes a drag once the pointer has moved a few pixels. */
interface Press {
  x: number;
  y: number;
  family: string;
  id: string;
  list: string;
  horizontal: boolean;
  target: EditTarget;
  started: boolean;
  /** The nearest scrolling ancestor of the pressed block: scrolled while the pointer is at its top or bottom edge. */
  scroll: HTMLElement | null;
  /** The block's box when the drag started, which the lifted copy follows the pointer from (the page may scroll under it). */
  grab: DOMRect | null;
}

/** The nearest ancestor that scrolls vertically. */
function scrollParent(el: Element): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/** How near a scrolling edge the pointer has to be (px on screen), and the fastest scroll per frame. */
const SCROLL_EDGE = 56;
const SCROLL_MAX = 16;
/** How long a dragged tab rests on a tab-bar pager before the bar turns the page. */
const PAGER_DWELL_MS = 550;

export function EditSurface({
  on,
  selected,
  onSelect,
  also,
  name,
  verbs,
  onRun,
  setup,
  onSetup,
  horizontal,
  onDrop,
  children,
}: EditSurfaceProps) {
  const root = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const press = useRef<Press | null>(null);
  const landed = useRef<EditDrop | null>(null);
  // The click that ends a drag isn't a selection.
  const swallowClick = useRef(false);
  const [drag, setDrag] = useState<{ lift: DOMRect | null; line: DOMRect | null; horizontal: boolean; tag: string; family: string } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [flash, setFlash] = useState<"dropped" | "refused" | null>(null);
  const latest = useRef({ onDrop, onSelect });
  latest.current = { onDrop, onSelect };
  const endDrag = useCallback(() => {
    press.current = null;
    landed.current = null;
    setDrag(null);
  }, []);
  const [boxes, setBoxes] = useState<{ hover: Seen | null; selected: Seen | null }>({
    hover: null,
    selected: null,
  });
  const [alsoBoxes, setAlsoBoxes] = useState<Seen[]>([]);
  const selectedKey = selected ? targetKey(selected) : null;
  const alsoKeys = (also ?? []).map(targetKey).join("\n");

  const find = (key: string | null) =>
    (key && root.current?.querySelector(`[data-edit-key="${CSS.escape(key)}"]`)) || null;
  const measure = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const origin = el.getBoundingClientRect();
    const h = find(hover);
    const s = find(selectedKey);
    const next = {
      hover: h && hover !== selectedKey ? seenOf(h, el, origin) : null,
      selected: s ? seenOf(s, el, origin) : null,
    };
    setBoxes((prev) =>
      sameSeen(prev.hover, next.hover) && sameSeen(prev.selected, next.selected) ? prev : next
    );
    const rest = alsoKeys
      ? alsoKeys.split("\n").flatMap((k) => {
          const a = find(k);
          const b = a && seenOf(a, el, origin);
          return b ? [b] : [];
        })
      : [];
    setAlsoBoxes((prev) =>
      prev.length === rest.length && prev.every((b, i) => sameSeen(b, rest[i])) ? prev : rest
    );
  }, [hover, selectedKey, alsoKeys]);

  useLayoutEffect(measure);
  useEffect(() => {
    const el = root.current;
    if (!el || !on) return;
    // Scrolls and DOM changes come in bursts; measure once per frame (a scroll event fires before that frame's
    // animation callbacks, so the outlines still move with the content).
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    el.addEventListener("scroll", schedule, true);
    // Clicks inside the preview can open or close things (menus, record tabs) after the layout effect ran.
    const screen = el.querySelector(".studio-ipad-screen");
    const mutations = new MutationObserver(schedule);
    if (screen) mutations.observe(screen, { childList: true, subtree: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      el.removeEventListener("scroll", schedule, true);
    };
  }, [on, measure]);

  useEffect(() => {
    if (!on) {
      setHover(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      // Only while the preview (or nothing) has focus, so the inspector and dialogs keep their keys.
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body && !root.current?.contains(el)) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === "Escape" && press.current?.started) {
        e.preventDefault();
        swallowClick.current = true;
        endDrag();
        return;
      }
      if (e.key === "Escape" && selected) {
        e.preventDefault();
        onSelect(null);
        return;
      }
      if (e.key === "Tab" && root.current) {
        // Next / previous block on screen, in document order.
        const keys = [...root.current.querySelectorAll("[data-edit-key]")].map(
          (n) => n.getAttribute("data-edit-key")!
        );
        const unique = keys.filter((k, i) => keys.indexOf(k) === i);
        if (!unique.length) return;
        e.preventDefault();
        const at = selectedKey ? unique.indexOf(selectedKey) : -1;
        const next = unique[(at + (e.shiftKey ? -1 : 1) + unique.length) % unique.length];
        const t = targetOf(find(next));
        if (t) onSelect(t);
        return;
      }
      if (!selected) return;
      const back = e.key === "ArrowUp" || (horizontal && e.key === "ArrowLeft");
      const forward = e.key === "ArrowDown" || (horizontal && e.key === "ArrowRight");
      const want: VerbId[] =
        e.altKey && back
          ? ["up"]
          : e.altKey && forward
            ? ["down"]
            : e.key === "Backspace" || e.key === "Delete"
              ? ["hide", "off", "discard", "remove"]
              : [];
      const verb = want.map((id) => verbs.find((v) => v.id === id && v.run)).find(Boolean);
      if (verb) {
        e.preventDefault();
        onRun(verb);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, selected, selectedKey, verbs, onRun, onSelect, horizontal, endDrag]);

  // Dragging, with pointer events on the window so a drag that leaves the device still ends.
  useEffect(() => {
    if (!on) return;
    // Where the pointer is now lands the block; run again when the page scrolls or turns under a still pointer.
    const update = () => {
      const p = press.current;
      const el = root.current;
      const pt = pointer.current;
      if (!p?.started || !el || !pt) return;
      const origin = el.getBoundingClientRect();
      const lists = dragLists(el, p.family, origin);
      p.grab ??= lists.find((l) => l.list === p.list)?.items.find((i) => i.id === p.id)?.box ?? null;
      const at = landing(lists, pt.x - origin.left, pt.y - origin.top, p, p.horizontal);
      landed.current = at?.drop ?? null;
      setDrag({
        lift: p.grab ? new DOMRect(p.grab.x + pt.x - p.x, p.grab.y + pt.y - p.y, p.grab.width, p.grab.height) : null,
        line: at?.drop ? at.line : null,
        horizontal: at?.across ?? p.horizontal,
        tag: targetTag(p.target),
        family: p.family,
      });
    };
    let frame = 0;
    let rest: { pager: Element; since: number } | null = null;
    // While a drag is on: scroll the page when the pointer sits at its top or bottom edge, and turn the tab bar's page when a tab rests on a pager.
    const tick = (now: number) => {
      const p = press.current;
      const pt = pointer.current;
      frame = 0;
      if (!p?.started || !pt) return;
      const r = p.scroll?.getBoundingClientRect();
      if (p.scroll && r && pt.x >= r.left && pt.x <= r.right && pt.y >= r.top - SCROLL_EDGE && pt.y <= r.bottom + SCROLL_EDGE) {
        const into = pt.y < r.top + SCROLL_EDGE ? pt.y - (r.top + SCROLL_EDGE) : pt.y > r.bottom - SCROLL_EDGE ? pt.y - (r.bottom - SCROLL_EDGE) : 0;
        const dy = Math.max(-SCROLL_MAX, Math.min(SCROLL_MAX, Math.round(into / 3)));
        const was = p.scroll.scrollTop;
        if (dy) p.scroll.scrollTop = was + dy;
        if (p.scroll.scrollTop !== was) update();
      }
      const pager = p.family === "tabs" ? document.elementFromPoint(pt.x, pt.y)?.closest(".studio-ipad-pager") : null;
      if (!pager) rest = null;
      else if (rest?.pager !== pager) rest = { pager, since: now };
      else if (now - rest.since > PAGER_DWELL_MS) {
        (pager as HTMLElement).click();
        rest = null;
        setTimeout(update, 60);
      }
      frame = requestAnimationFrame(tick);
    };
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p || !root.current) return;
      if (!p.started) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return;
        p.started = true;
        latest.current.onSelect(p.target);
      }
      e.preventDefault();
      pointer.current = { x: e.clientX, y: e.clientY };
      update();
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const up = () => {
      const p = press.current;
      const drop = landed.current;
      if (p?.started) {
        swallowClick.current = true;
        // A drop next to where the block is changes nothing; anywhere else it queues the move, or nudges.
        if (drop) setFlash(latest.current.onDrop?.(p.target, drop) ? "dropped" : "refused");
      }
      endDrag();
      setTimeout(() => (swallowClick.current = false), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", endDrag);
      cancelAnimationFrame(frame);
      endDrag();
    };
  }, [on, endDrag]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [flash]);

  const keyAt = (node: EventTarget | null) =>
    node instanceof Element ? node.closest("[data-edit-key]") : null;
  const onPointerDown = (e: React.PointerEvent) => {
    if (!on || !onDrop || e.button !== 0 || !(e.target instanceof Element)) return;
    if (e.target.closest(".studio-edit-toolbar")) return;
    // Inside the selected block it's the one that moves (a section, not the field pressed in it).
    const el =
      (selectedKey && e.target.closest(`[data-edit-key="${CSS.escape(selectedKey)}"]`)) ||
      keyAt(e.target);
    const target = el && targetOf(el);
    if (!el || !target || !el.hasAttribute("data-edit-drag") || el.hasAttribute("data-edit-ghost")) return;
    press.current = {
      x: e.clientX,
      y: e.clientY,
      family: el.getAttribute("data-edit-drag") ?? "",
      id: dragId(el),
      list: dragList(el),
      horizontal: el.getAttribute("data-edit-axis") === "x",
      target,
      started: false,
      scroll: scrollParent(el),
      grab: null,
    };
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (!on) return;
    if (swallowClick.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if ((e.target as Element).closest(".studio-edit-toolbar")) return;
    const el = keyAt(e.target);
    if (!el) return;
    const t = targetOf(el);
    if (!t) return;
    const extend = e.metaKey || e.shiftKey;
    onSelect(t, extend);
    if (extend || !el.hasAttribute("data-edit-pass")) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const hoverTarget = targetOf(find(hover));
  return (
    <EditContext.Provider value={on}>
      <DragContext.Provider value={drag?.family ?? null}>
      <div
        ref={root}
        className={`studio-edit-surface${on ? " on" : ""}${onDrop ? " draft" : ""}${drag ? " dragging" : ""}`}
        onClickCapture={onClickCapture}
        onPointerDown={onPointerDown}
        onMouseOver={
          on ? (e) => setHover(keyAt(e.target)?.getAttribute("data-edit-key") ?? null) : undefined
        }
        onMouseLeave={on ? () => setHover(null) : undefined}
      >
        {children}
        {on && (
          <div className="studio-edit-overlay" aria-hidden={!selected}>
            {boxes.hover && hoverTarget && !drag && (
              <Clipped seen={boxes.hover} className="studio-edit-hover" tag={targetTag(hoverTarget)} />
            )}
            {boxes.selected && selected && (
              <>
                <Clipped seen={boxes.selected} className={`studio-edit-ring${drag ? " lifted" : ""}${flash ? ` ${flash}` : ""}`} />
                {!drag && alsoBoxes.map((b, i) => <Clipped key={i} seen={b} className="studio-edit-ring" />)}
                {!drag && visibleBox(boxes.selected) && (
                  <Toolbar
                    box={visibleBox(boxes.selected)!}
                    clip={boxes.selected.clip}
                    width={root.current?.clientWidth ?? 0}
                    target={selected}
                    name={name}
                    verbs={verbs}
                    onRun={onRun}
                    setup={setup}
                    onSetup={onSetup}
                    horizontal={horizontal}
                  />
                )}
              </>
            )}
            {drag?.line && (
              <div
                className={`studio-edit-insert${drag.horizontal ? " across" : ""}`}
                style={rectStyle(drag.line)}
              />
            )}
            {drag?.lift && (
              <div className="studio-edit-lift" style={rectStyle(drag.lift)}>
                <span className="studio-edit-tag">{drag.tag}</span>
              </div>
            )}
          </div>
        )}
      </div>
      </DragContext.Provider>
    </EditContext.Provider>
  );
}

const sameBox = (a: DOMRect | null, b: DOMRect | null) =>
  a && b ? a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height : a === b;
const sameSeen = (a: Seen | null, b: Seen | null) => (a && b ? sameBox(a.box, b.box) && sameBox(a.clip, b.clip) : a === b);

/** An outline drawn inside a box that clips it to the scroll viewport it belongs to; nothing when it is scrolled fully out of view. */
function Clipped({ seen, className, tag }: { seen: Seen; className: string; tag?: string }) {
  const shown = visibleBox(seen);
  if (!shown) return null;
  const { box, clip } = seen;
  // A label above the block would be cut off at the viewport's top: tuck it inside instead.
  const inside = box.y - clip.y < 18;
  return (
    <div className="studio-edit-clip" style={rectStyle(clip)}>
      <div className={className} style={rectStyle(new DOMRect(box.x - clip.x, box.y - clip.y, box.width, box.height))}>
        {tag && <span className={`studio-edit-tag${inside ? " inside" : ""}`}>{tag}</span>}
      </div>
    </div>
  );
}

const rectStyle = (r: DOMRect): React.CSSProperties => ({
  left: r.x,
  top: r.y,
  width: r.width,
  height: r.height,
});

/** Surfaces narrower than this (Compare's half-size iPad) get an icon-only toolbar, so it fits on the device. */
export const COMPACT_TOOLBAR_BELOW = 560;
export const isCompactToolbar = (surfaceWidth: number): boolean => surfaceWidth > 0 && surfaceWidth < COMPACT_TOOLBAR_BELOW;

/** A compact toolbar's icon button and the space around a row of them (28 px control, 4 px gap, padding and border). */
const COMPACT_BUTTON = 32;
const COMPACT_CHROME = 18;

/**
 * How many of a compact toolbar's `count` buttons fit in one row on a surface `surfaceWidth` wide;
 * the rest go under a More menu (which takes a slot itself), so the toolbar never wraps over the iPad.
 */
export function compactInline(count: number, surfaceWidth: number): number {
  const slots = Math.max(1, Math.floor((surfaceWidth - 8 - COMPACT_CHROME) / COMPACT_BUTTON));
  return count <= slots ? count : Math.max(0, slots - 1);
}

/** The floating toolbar above the selection (below it when there's no room). */
function Toolbar({
  box,
  clip,
  width,
  target,
  name,
  verbs,
  onRun,
  setup,
  onSetup,
  horizontal,
}: {
  /** The part of the selection that is on screen. */
  box: DOMRect;
  /** The scroll viewport the selection is in: the toolbar stays inside it. */
  clip: DOMRect;
  /** The surface's width: a block in its right half anchors the toolbar to its right edge so it stays on the device. */
  width: number;
  target: EditTarget;
  name?: string;
  verbs: Verb[];
  onRun: (v: Verb) => void;
  setup?: { label: string } | null;
  onSetup?: () => void;
  horizontal?: boolean;
}) {
  const TOOLBAR_H = 44;
  const compact = isCompactToolbar(width);
  const above = box.y - clip.y >= TOOLBAR_H + 8;
  const roomBelow = clip.bottom - box.bottom >= TOOLBAR_H + 8;
  // Above the block, else below it, else tucked inside the viewport's top edge.
  const below = !above;
  const top = above ? box.y - 8 : roomBelow ? box.bottom + 8 : clip.y + 8;
  const right = width > 0 && box.x + box.width / 2 > width / 2;
  const iconOf = (v: Verb): LucideIcon =>
    horizontal && v.id === "up" ? ArrowLeft : horizontal && v.id === "down" ? ArrowRight : VERB_ICONS[v.id];
  // Compact: one row of icons; what doesn't fit (runnable verbs, then Open in Setup) goes under More.
  const hasSetup = !!(setup && onSetup);
  const fit = compact ? compactInline(verbs.length + (hasSetup ? 1 : 0), width) : Infinity;
  const inline = verbs.slice(0, fit);
  const setupButton = hasSetup && verbs.length < fit;
  const more: MenuItem[] = [
    ...verbs
      .slice(fit)
      .filter((v) => v.run || v.pick)
      .map((v) => ({ label: TOOLBAR_LABELS[v.id] ?? v.label, icon: iconOf(v), danger: v.id === "remove", onSelect: () => onRun(v) })),
    ...(hasSetup && !setupButton ? [{ label: "Open in Setup", icon: ExternalLink, onSelect: () => onSetup!() }] : []),
  ];
  const style: React.CSSProperties = {
    // A compact toolbar is one row no wider than the device, so it sits at the surface's left edge.
    ...(compact ? { left: 4 } : right ? { right: Math.max(4, width - box.right) } : { left: Math.max(4, box.x) }),
    top,
  };
  return (
    <div
      className={`studio-edit-toolbar${below ? " below" : ""}${compact ? " compact" : ""}`}
      style={style}
      role="toolbar"
      aria-label={`Edit ${name ?? targetTag(target)}`}
    >
      {!compact && <span className="studio-edit-toolbar-name">{name ?? targetTag(target)}</span>}
      {inline.map((v) => {
        const Icon = iconOf(v);
        const iconOnly = compact || ICON_ONLY.has(v.id);
        return (
          <button
            key={v.id}
            type="button"
            className={iconOnly ? "ui-icon-btn" : "studio-btn ghost sm"}
            disabled={!v.run && !v.pick}
            title={v.run || v.pick ? v.title : v.reason}
            aria-label={v.label}
            onClick={() => onRun(v)}
          >
            <Icon size={14} aria-hidden />
            {!iconOnly && (TOOLBAR_LABELS[v.id] ?? v.label)}
          </button>
        );
      })}
      {setupButton && setup && onSetup && (
        <button
          type="button"
          className={compact ? "ui-icon-btn" : "studio-btn ghost sm"}
          onClick={onSetup}
          title={`Open ${setup.label} in Salesforce Setup`}
          aria-label="Open in Setup"
        >
          <ExternalLink size={14} aria-hidden />
          {!compact && "Open in Setup"}
        </button>
      )}
      {more.length > 0 && <Menu label="More edits" className="studio-edit-toolbar-more" items={more} />}
    </div>
  );
}
