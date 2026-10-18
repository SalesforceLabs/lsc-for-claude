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

/** Attributes that make an element selectable; the target rides along as JSON. `pass` lets a click still do what it does on the iPad (tabs, list chips). */
export function editAttrs(on: boolean, target: EditTarget, pass = false): Record<string, string> {
  if (!on) return {};
  return {
    "data-edit-key": targetKey(target),
    "data-edit-target": JSON.stringify(target),
    ...(pass ? { "data-edit-pass": "" } : {}),
  };
}

export const useEditOn = () => useContext(EditContext);

/** A selectable block. Lays out as its children (display: contents). */
export function Mark({ target, children }: { target: EditTarget; children: React.ReactNode }) {
  const on = useContext(EditContext);
  if (!on) return <>{children}</>;
  return (
    <div className="studio-edit-mark" {...editAttrs(true, target)}>
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
};

/** Toolbar words; the full sentence ("Hide for LS Rep") is the button's tooltip and stays in the inspector. */
const TOOLBAR_LABELS: Partial<Record<VerbId, string>> = { hide: "Hide", show: "Show", addField: "Add field", addRelated: "Add list" };
/** Verbs the toolbar draws as an icon alone; their tooltip says what they do. */
const ICON_ONLY = new Set<VerbId>(["up", "down", "column", "heading", "required", "readonly"]);

export interface EditSurfaceProps {
  on: boolean;
  selected: EditTarget | null;
  onSelect: (target: EditTarget | null) => void;
  /** Verbs for the selected block, and the tray they'd leave. */
  verbs: Verb[];
  onRun: (verb: Verb) => void;
  /** "Open in Setup" for blocks Studio can't change itself. */
  setup?: { label: string } | null;
  onSetup?: () => void;
  /** Tab moves left / right rather than up / down. */
  horizontal?: boolean;
  children: React.ReactNode;
}

export function EditSurface({
  on,
  selected,
  onSelect,
  verbs,
  onRun,
  setup,
  onSetup,
  horizontal,
  children,
}: EditSurfaceProps) {
  const root = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<{ hover: DOMRect | null; selected: DOMRect | null }>({
    hover: null,
    selected: null,
  });
  const selectedKey = selected ? targetKey(selected) : null;

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
  }, [hover, selectedKey]);

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
  }, [on, selected, selectedKey, verbs, onRun, onSelect, horizontal]);

  const keyAt = (node: EventTarget | null) =>
    node instanceof Element ? node.closest("[data-edit-key]") : null;
  const onClickCapture = (e: React.MouseEvent) => {
    if (!on) return;
    if ((e.target as Element).closest(".studio-edit-toolbar")) return;
    const el = keyAt(e.target);
    if (!el) return;
    const t = targetOf(el);
    if (!t) return;
    onSelect(t);
    if (!el.hasAttribute("data-edit-pass")) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const hoverTarget = targetOf(find(hover));
  return (
    <EditContext.Provider value={on}>
      <div
        ref={root}
        className={`studio-edit-surface${on ? " on" : ""}`}
        onClickCapture={onClickCapture}
        onMouseOver={
          on ? (e) => setHover(keyAt(e.target)?.getAttribute("data-edit-key") ?? null) : undefined
        }
        onMouseLeave={on ? () => setHover(null) : undefined}
      >
        {children}
        {on && (
          <div className="studio-edit-overlay" aria-hidden={!selected}>
            {boxes.hover && hoverTarget && (
              <div className="studio-edit-hover" style={rectStyle(boxes.hover)}>
                <span className="studio-edit-tag">{targetTag(hoverTarget)}</span>
              </div>
            )}
            {boxes.selected && selected && (
              <>
                <div className="studio-edit-ring" style={rectStyle(boxes.selected)} />
                <Toolbar
                  box={boxes.selected}
                  width={root.current?.clientWidth ?? 0}
                  target={selected}
                  verbs={verbs}
                  onRun={onRun}
                  setup={setup}
                  onSetup={onSetup}
                  horizontal={horizontal}
                />
              </>
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
      aria-label={`Edit ${targetTag(target)}`}
    >
      <span className="studio-edit-toolbar-name">{targetTag(target)}</span>
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
