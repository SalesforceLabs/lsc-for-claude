import React, { useEffect, useMemo, useRef, useState } from "react";
import { inlineLwcFrame, type FrameMessage, type InlineLwcContext } from "../inline-lwc-frame";
import { answerFrameRequest, describePage, sldsCss } from "../LiveInlineLwc";

/** How long the frame may take to start before the preview says so. */
const STALL_MS = 10000;
/** How long a data request may take before the component gets an error instead of spinning. */
const REQUEST_MS = 12000;

interface LiveAppFrameProps {
  script: string;
  name: string;
  context: Omit<InlineLwcContext, "componentName">;
  height: number;
  /** The test user whose login answers data requests; none = the sf CLI connection. */
  loginId?: string;
  /** A toast, navigation or a script error after the component drew. */
  onNote: (text: string, tone: "info" | "error") => void;
  /** The component asked to close itself (CloseActionScreenEvent). */
  onClose?: () => void;
  /** The component threw before drawing anything. */
  onFail: (message: string) => void;
  /** Fades in over the layer below it. */
  enter?: boolean;
  /** Offered when the frame has not started after a while. */
  onReload?: () => void;
}

/** The answer to a data request, or a timeout error response so the component shows its own error state instead of spinning. */
async function answerWithin(m: Parameters<typeof answerFrameRequest>[0], as: string | undefined, onTimeout: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ __studio: string; id: unknown; ok: boolean; error: unknown }>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve({ __studio: "response", id: m.id, ok: false, error: { status: 504, statusText: "Timeout", ok: false, body: { message: "The request took too long." } } });
    }, REQUEST_MS);
  });
  try {
    return await Promise.race([answerFrameRequest(m, as), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** One compiled app in a sandboxed frame; its data requests are answered like the iPad preview's inline LWCs. */
export default function LiveAppFrame({ script, name, context, height, loginId, onNote, onFail, onClose, enter, onReload }: LiveAppFrameProps) {
  const [styles, setStyles] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [stalled, setStalled] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const ctxKey = JSON.stringify(context);
  useEffect(() => {
    let live = true;
    void sldsCss().then((c) => live && setStyles(c));
    return () => {
      live = false;
    };
  }, []);
  const html = useMemo(
    () => (styles === null ? "" : inlineLwcFrame(script, styles, { ...context, componentName: name }, 1)),
    // context is compared by value through ctxKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [script, styles, name, ctxKey]
  );

  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(t);
  }, [loaded]);

  const asLogin = useRef(loginId);
  asLogin.current = loginId;
  const notes = useRef({ onNote, onFail, onClose });
  notes.current = { onNote, onFail, onClose };
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win) return;
      const m = e.data as FrameMessage;
      if (!m || typeof m !== "object") return;
      switch (m.__studio) {
        case "close":
          notes.current.onClose?.();
          break;
        case "request":
          win.postMessage(await answerWithin(m, asLogin.current, () => notes.current.onNote("A data request took more than 12 seconds, so the component was told it failed. The org may be slow for this query.", "error")), "*");
          break;
        case "toast":
          notes.current.onNote([m.toast.title, m.toast.message].filter(Boolean).join(": ") || "Toast", "info");
          break;
        case "navigate":
          notes.current.onNote(`Opens ${describePage(m.pageReference)} on the iPad`, "info");
          break;
        case "error":
          if (m.mounted) notes.current.onNote(`Script error: ${m.message}`, "error");
          else notes.current.onFail(m.message);
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className={`bld-frame-layer${enter ? " enter" : ""}${loaded ? " loaded" : ""}`}>
      {!loaded && !stalled && <div className="bld-frame-skeleton ui-skeleton" aria-hidden="true" />}
      {!loaded && stalled && (
        <div className="bld-frame-stall" role="status">
          <span>The app is still starting. It may be waiting for data.</span>
          {onReload && (
            <button type="button" className="studio-btn sm" onClick={onReload}>
              Reload
            </button>
          )}
        </div>
      )}
      {styles !== null && <iframe ref={frame} title={`${name} running`} sandbox="allow-scripts" srcDoc={html} style={{ height }} className="bld-frame" onLoad={() => setLoaded(true)} />}
    </div>
  );
}
