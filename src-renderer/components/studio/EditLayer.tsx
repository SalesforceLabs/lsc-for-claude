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
  SquarePlus,
  Star,
  type LucideIcon,
} from "lucide-react";
import { targetKey, targetTag, type EditTarget } from "./edit-targets";
import type { Verb, VerbId } from "./edit-draft";
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
  return [...lists].map(([list, items]) => ({ list, items, box: items.map((i) => i.box).reduce(union) }));
}

/**
 * Where a drag at (x, y) lands: the nearest list, before the first block whose
 * middle is past the pointer. `drop` is null right next to where the block is.
 */
function landing(
  lists: DragList[],
  x: number,
  y: number,
  dragged: { id: string; list: string },
  horizontal: boolean
): { line: DOMRect; drop: EditDrop | null } | null {
  if (!lists.length) return null;
  const near = lists.reduce((a, b) => (distance(b.box, x, y) < distance(a.box, x, y) ? b : a));
  const mid = (r: DOMRect) => (horizontal ? r.x + r.width / 2 : r.y + r.height / 2);
  const k = near.items.filter((i) => mid(i.box) < (horizontal ? x : y)).length;
  const prev = near.items[k - 1];
  const next = near.items[k];
  const here = near.list === dragged.list && (prev?.id === dragged.id || next?.id === dragged.id);
  const [end, start] = horizontal ? (["right", "left"] as const) : (["bottom", "top"] as const);
  const at = prev && next ? (prev.box[end] + next.box[start]) / 2 : prev ? prev.box[end] + 2 : next.box[start] - 2;
  const line = horizontal
    ? new DOMRect(at - 1.5, near.box.y, 3, near.box.height)
    : new DOMRect(near.box.x, at - 1.5, near.box.width, 3);
  return { line, drop: here ? null : { list: JSON.parse(near.list) as unknown, before: next?.target ?? null } };
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
};

/** Toolbar words; the full sentence ("Hide for LS Rep") is the button's tooltip and stays in the inspector. */
const TOOLBAR_LABELS: Partial<Record<VerbId, string>> = { hide: "Hide", show: "Show", addField: "Add field", addRelated: "Add list", insertComponent: "Insert" };
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
}

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
  const [drag, setDrag] = useState<{ lift: DOMRect | null; line: DOMRect | null; horizontal: boolean; tag: string } | null>(null);
  const [flash, setFlash] = useState<"dropped" | "refused" | null>(null);
  const latest = useRef({ onDrop, onSelect });
  latest.current = { onDrop, onSelect };
  const endDrag = useCallback(() => {
    press.current = null;
    landed.current = null;
    setDrag(null);
  }, []);
  const [boxes, setBoxes] = useState<{ hover: DOMRect | null; selected: DOMRect | null }>({
    hover: null,
    selected: null,
  });
  const [alsoBoxes, setAlsoBoxes] = useState<DOMRect[]>([]);
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
      hover: h && hover !== selectedKey ? boxOf(h, origin) : null,
      selected: s ? boxOf(s, origin) : null,
    };
    setBoxes((prev) =>
      sameBox(prev.hover, next.hover) && sameBox(prev.selected, next.selected) ? prev : next
    );
    const rest = alsoKeys
      ? alsoKeys.split("\n").flatMap((k) => {
          const a = find(k);
          const b = a && boxOf(a, origin);
          return b ? [b] : [];
        })
      : [];
    setAlsoBoxes((prev) =>
      prev.length === rest.length && prev.every((b, i) => sameBox(b, rest[i])) ? prev : rest
    );
  }, [hover, selectedKey, alsoKeys]);

  useLayoutEffect(measure);
  useEffect(() => {
    const el = root.current;
    if (!el || !on) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener("scroll", measure, true);
    // Clicks inside the preview can open or close things (menus, record tabs) after the layout effect ran.
    const screen = el.querySelector(".studio-ipad-screen");
    const mutations = new MutationObserver(() => requestAnimationFrame(measure));
    if (screen) mutations.observe(screen, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      el.removeEventListener("scroll", measure, true);
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
    const move = (e: PointerEvent) => {
      const p = press.current;
      const el = root.current;
      if (!p || !el) return;
      if (!p.started) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return;
        p.started = true;
        latest.current.onSelect(p.target);
      }
      e.preventDefault();
      const origin = el.getBoundingClientRect();
      const lists = dragLists(el, p.family, origin);
      const own = lists.find((l) => l.list === p.list)?.items.find((i) => i.id === p.id)?.box;
      const at = landing(lists, e.clientX - origin.left, e.clientY - origin.top, p, p.horizontal);
      landed.current = at?.drop ?? null;
      setDrag({
        lift: own ? new DOMRect(own.x + e.clientX - p.x, own.y + e.clientY - p.y, own.width, own.height) : null,
        line: at?.drop ? at.line : null,
        horizontal: p.horizontal,
        tag: targetTag(p.target),
      });
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
              <div className="studio-edit-hover" style={rectStyle(boxes.hover)}>
                <span className="studio-edit-tag">{targetTag(hoverTarget)}</span>
              </div>
            )}
            {boxes.selected && selected && (
              <>
                <div
                  className={`studio-edit-ring${drag ? " lifted" : ""}${flash ? ` ${flash}` : ""}`}
                  style={rectStyle(boxes.selected)}
                />
                {!drag &&
                  alsoBoxes.map((b, i) => <div key={i} className="studio-edit-ring" style={rectStyle(b)} />)}
                {!drag && (
                  <Toolbar
                    box={boxes.selected}
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
    </EditContext.Provider>
  );
}

const sameBox = (a: DOMRect | null, b: DOMRect | null) =>
  a && b ? a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height : a === b;

const rectStyle = (r: DOMRect): React.CSSProperties => ({
  left: r.x,
  top: r.y,
  width: r.width,
  height: r.height,
});

/** The floating toolbar above the selection (below it when there's no room). */
function Toolbar({
  box,
  width,
  target,
  name,
  verbs,
  onRun,
  setup,
  onSetup,
  horizontal,
}: {
  box: DOMRect;
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
  const below = box.y < 44;
  const right = width > 0 && box.x + box.width / 2 > width / 2;
  const style: React.CSSProperties = {
    ...(right ? { right: Math.max(4, width - box.right) } : { left: Math.max(4, box.x) }),
    top: below ? box.bottom + 8 : box.y - 8,
  };
  return (
    <div
      className={`studio-edit-toolbar${below ? " below" : ""}`}
      style={style}
      role="toolbar"
      aria-label={`Edit ${name ?? targetTag(target)}`}
    >
      <span className="studio-edit-toolbar-name">{name ?? targetTag(target)}</span>
      {verbs.map((v) => {
        const Icon =
          horizontal && v.id === "up"
            ? ArrowLeft
            : horizontal && v.id === "down"
              ? ArrowRight
              : VERB_ICONS[v.id];
        const iconOnly = ICON_ONLY.has(v.id);
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
      {setup && onSetup && (
        <button
          type="button"
          className="studio-btn ghost sm"
          onClick={onSetup}
          title={`Open ${setup.label} in Salesforce Setup`}
        >
          <ExternalLink size={14} aria-hidden />
          Open in Setup
        </button>
      )}
    </div>
  );
}
