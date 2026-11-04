import React, { useEffect, useRef, useState } from "react";
import "./structure.css";

/** Small device-look pieces of the Visit Engagement shell. */

/** An iOS alert: title, message and buttons stacked (or in a row for two short ones). */
export function Alert({
  title,
  message,
  actions,
  row,
}: {
  title: string;
  message?: string;
  actions: { label: string; onClick: () => void; strong?: boolean }[];
  row?: boolean;
}) {
  return (
    <div className="visit-alert-scrim" role="alertdialog" aria-label={title}>
      <div className="visit-alert">
        <div className="visit-alert-body">
          <div className="visit-alert-title">{title}</div>
          {message && <div className="visit-alert-msg">{message}</div>}
        </div>
        <div className={`visit-alert-actions${row ? " row" : ""}`}>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`visit-alert-btn${a.strong ? " strong" : ""}`}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A list of choices over a scrim; a click on the scrim closes it. */
export function OptionSheet({
  title,
  options,
  value,
  onPick,
  onClose,
}: {
  title: string;
  options: { value: string; label: string }[];
  value?: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="visit-alert-scrim" onClick={onClose}>
      <div className="visit-sheet" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="visit-sheet-head">{title}</div>
        <div style={{ maxHeight: 420, overflow: "auto" }}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`visit-option${o.value === value ? " on" : ""}`}
              onClick={() => onPick(o.value)}
            >
              {o.label}
              {o.value === value && <span>✓</span>}
            </button>
          ))}
          {!options.length && <div className="visit-option">Nothing to choose from</div>}
        </div>
      </div>
    </div>
  );
}

/** Shows `text` for two seconds. */
export function useToast(): [React.ReactNode, (text: string) => void] {
  const [text, setText] = useState<string>();
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => setText(undefined), 2000);
    return () => clearTimeout(t);
  }, [text]);
  return [
    text ? (
      <div className="visit-toast" role="status">
        {text}
      </div>
    ) : null,
    setText,
  ];
}

/** The signature capture sheet: draw with a pointer, Clear, Cancel, Done (Done needs a stroke). */
export function SignaturePad({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const down = useRef(false);
  const pos = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * canvas.current!.width,
      ((e.clientY - r.top) / r.height) * canvas.current!.height,
    ];
  };
  return (
    <div className="visit-alert-scrim">
      <div className="visit-sheet">
        <div className="visit-sheet-head">
          <button type="button" className="studio-ipad-act-link" onClick={onCancel}>
            Cancel
          </button>
          <span>Signature</span>
          <button type="button" className="studio-ipad-act-link" disabled={!drawn} onClick={onDone}>
            Done
          </button>
        </div>
        <div className="visit-sheet-body">
          <div className="visit-pad">
            <canvas
              ref={canvas}
              width={480}
              height={220}
              onPointerDown={(e) => {
                const c = canvas.current!.getContext("2d")!;
                down.current = true;
                canvas.current!.setPointerCapture(e.pointerId);
                c.beginPath();
                c.moveTo(...pos(e));
              }}
              onPointerMove={(e) => {
                if (!down.current) return;
                const c = canvas.current!.getContext("2d")!;
                c.lineWidth = 2.5;
                c.lineCap = "round";
                c.lineTo(...pos(e));
                c.stroke();
                setDrawn(true);
              }}
              onPointerUp={() => (down.current = false)}
            />
            {!drawn && <div className="visit-pad-hint">Sign here</div>}
          </div>
          <button
            type="button"
            className="studio-ipad-act-link"
            style={{ marginTop: 10 }}
            onClick={() => {
              canvas.current!.getContext("2d")!.clearRect(0, 0, 480, 220);
              setDrawn(false);
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

/** The Document ID entry: the signature was taken on paper, this is the form's identifier. */
export function DocumentIdSheet({
  initial,
  onSave,
  onCancel,
}: {
  initial?: string;
  onSave: (id: string) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(initial ?? "");
  return (
    <div className="visit-alert-scrim">
      <div className="visit-sheet">
        <div className="visit-sheet-head">
          <button type="button" className="studio-ipad-act-link" onClick={onCancel}>
            Cancel
          </button>
          <span>Document ID</span>
          <button
            type="button"
            className="studio-ipad-act-link"
            disabled={!id.trim()}
            onClick={() => onSave(id.trim())}
          >
            Save
          </button>
        </div>
        <div className="visit-sheet-body">
          <input
            className="studio-ipad-act-input"
            aria-label="Document ID"
            autoFocus
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
