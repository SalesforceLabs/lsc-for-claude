import React, { useRef, useState } from "react";

interface ResizeHandleProps {
  /** Current width of the panel the handle sits on the right edge of. */
  value: number;
  min: number;
  max: number;
  /** Called continuously while dragging (and on arrow keys). */
  onChange: (width: number) => void;
  /** Double-click or Home. */
  onReset: () => void;
  /** Reported so the panel can switch its width transition off while dragging. */
  onDragging?: (dragging: boolean) => void;
  label: string;
  /** Which edge of the panel the handle is on; a panel on the right widens when dragged left. */
  edge?: "right" | "left";
}

/**
 * The draggable edge of a resizable side panel: col-resize cursor, a hairline that lights up
 * on hover and drag, double-click to reset, arrow keys to nudge. Place it inside a
 * `position: relative` panel.
 */
export default function ResizeHandle({ value, min, max, onChange, onReset, onDragging, label, edge = "right" }: ResizeHandleProps) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [active, setActive] = useState(false);
  const sign = edge === "left" ? -1 : 1;
  const clamp = (w: number) => Math.min(max, Math.max(min, w));
  const end = () => {
    start.current = null;
    setActive(false);
    onDragging?.(false);
  };

  return (
    <div
      className={`ui-resize-handle${edge === "left" ? " left" : ""}${active ? " active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: value };
        setActive(true);
        onDragging?.(true);
      }}
      onPointerMove={(e) => {
        if (start.current) onChange(clamp(start.current.w + sign * (e.clientX - start.current.x)));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 32 : 8;
        if (e.key === "ArrowLeft") onChange(clamp(value - sign * step));
        else if (e.key === "ArrowRight") onChange(clamp(value + sign * step));
        else if (e.key === "Home") onReset();
        else return;
        e.preventDefault();
      }}
    />
  );
}
