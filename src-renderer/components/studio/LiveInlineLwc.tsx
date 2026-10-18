import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { InlineLwcCheck } from "./published-types";
import { inlineLwcFrame, type FrameMessage, type InlineLwcContext, type ZoomMessage } from "./inline-lwc-frame";
import { IpadScaleContext } from "./IpadScreen";
import { RepLoginContext } from "../../hooks/useMobileLogins";

/**
 * An org inline LWC (lscMobileInline_*) running live in the iPad preview: the
 * component compiled by `studio_lwc_bundle`, in an `allow-scripts` sandbox
 * frame as tall as the iPad's web view (`mobileHeight`, default 400 as
 * LMRModule.inlineComponentDefaultHeight), with its data requests answered by
 * `studio_lwc_request` as the Salesforce connection. When it can't be compiled
 * or throws, `fallback` is drawn instead.
 */

interface Compiled {
  script: string;
  placeholders: string[];
  check: InlineLwcCheck;
}

const bundles = new Map<string, Promise<Compiled>>();
let css: Promise<string> | undefined;

function compiled(name: string, generation: string): Promise<Compiled> {
  const key = `${generation}|${name}`;
  let p = bundles.get(key);
  if (!p) {
    p = window.lscApi.studioLwcBundle(name).then((r) => {
      const data = r.data as (Compiled & { error?: string }) | undefined;
      if (r.error || !data || data.error) throw new Error(r.error ?? data?.error ?? "No component returned.");
      return data;
    });
    bundles.set(key, p);
    p.catch(() => bundles.delete(key));
  }
  return p;
}

/** SLDS with the touch overrides, loaded the first time a live component is shown. */
function sldsCss(): Promise<string> {
  css ??= Promise.all([
    import("@salesforce-ux/design-system/assets/styles/salesforce-lightning-design-system.min.css?raw"),
    import("@salesforce-ux/design-system/assets/styles/salesforce-lightning-design-system_touch.min.css?raw"),
  ]).then(([base, touch]) => base.default + "\n" + touch.default);
  return css;
}

type State = { kind: "loading" } | { kind: "ready"; html: string; placeholders: string[] } | { kind: "failed"; message: string };

export function LiveInlineLwc({
  name,
  context,
  height,
  generation,
  fallback,
  footer,
}: {
  name: string;
  context: Omit<InlineLwcContext, "componentName">;
  height: number;
  /** Changes when the snapshot is reloaded, so the component is recompiled from the org. */
  generation: string;
  fallback: (reason: string) => React.ReactNode;
  /** Drawn under the caption (Studio's offline note). */
  footer?: React.ReactNode;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [notes, setNotes] = useState<string[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const ctxKey = JSON.stringify(context);
  // The iPad screen is CSS-scaled, which would draw the frame from a downsampled
  // texture; the frame undoes the scale and zooms its own content instead.
  const scale = useContext(IpadScaleContext);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  // Data loads as the previewed rep when Studio holds their login, else as the sf CLI connection.
  const repLogin = useContext(RepLoginContext);
  const repLoginRef = useRef(repLogin);
  repLoginRef.current = repLogin;

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    setNotes([]);
    Promise.all([compiled(name, generation), sldsCss()]).then(
      ([c, styles]) => live && setState({ kind: "ready", html: inlineLwcFrame(c.script, styles, { ...context, componentName: name }, scaleRef.current), placeholders: c.placeholders }),
      (e: unknown) => live && setState({ kind: "failed", message: e instanceof Error ? e.message : String(e) })
    );
    return () => {
      live = false;
    };
    // context is compared by value through ctxKey; a new identity redraws the component with its data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, generation, ctxKey, repLogin]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    const note = (text: string) => setNotes((n) => (n.includes(text) ? n : [...n.slice(-2), text]));
    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win) return;
      const m = e.data as FrameMessage;
      if (!m || typeof m !== "object") return;
      switch (m.__studio) {
        case "request": {
          const as = repLoginRef.current;
          const r = as
            ? await window.lscApi.studioLwcRequestAs(as, m.method, m.path, m.body)
            : await window.lscApi.studioLwcRequest(m.method, m.path, m.body);
          const data = r.data as { ok?: boolean; data?: unknown; error?: string } | undefined;
          const reply = data?.ok
            ? { __studio: "response", id: m.id, ok: true, data: data.data }
            : { __studio: "response", id: m.id, ok: false, error: data && "status" in data ? data : { status: 500, statusText: "Error", ok: false, body: { message: r.error ?? data?.error ?? "Request failed" } } };
          win.postMessage(reply, "*");
          break;
        }
        case "toast":
          note([m.toast.title, m.toast.message].filter(Boolean).join(": ") || "Toast");
          break;
        case "navigate":
          note(`Opens ${describePage(m.pageReference)} on the iPad`);
          break;
        case "error":
          if (m.mounted) note(`Script error: ${m.message}`);
          else setState({ kind: "failed", message: m.message });
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [state.kind]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ __studio: "zoom", zoom: scale } satisfies ZoomMessage, "*");
  }, [scale]);

  // Even unscaled, a frame between device pixels is drawn smoothed: shift it onto
  // whole pixels, again whenever scrolling or resizing moves it.
  useLayoutEffect(() => {
    const el = frame.current;
    if (state.kind !== "ready" || !el) return;
    let shift = { x: 0, y: 0 };
    let queued = 0;
    const snap = () => {
      queued = 0;
      const dpr = window.devicePixelRatio || 1;
      const r = el.getBoundingClientRect();
      const left = r.left - shift.x;
      const top = r.top - shift.y;
      shift = { x: Math.round(left * dpr) / dpr - left, y: Math.round(top * dpr) / dpr - top };
      el.style.transform = `scale(${1 / scale}) translate(${shift.x}px, ${shift.y}px)`;
    };
    const queue = () => {
      queued ||= requestAnimationFrame(snap);
    };
    el.style.transform = `scale(${1 / scale})`;
    snap();
    document.addEventListener("scroll", queue, true);
    window.addEventListener("resize", queue);
    return () => {
      cancelAnimationFrame(queued);
      document.removeEventListener("scroll", queue, true);
      window.removeEventListener("resize", queue);
    };
  }, [state.kind, scale]);

  const caption = useMemo(
    () => (state.kind === "ready" && state.placeholders.length ? ` ${state.placeholders.map((p) => `<lightning-${p.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}>`).join(", ")} drawn as a placeholder.` : ""),
    [state]
  );

  if (state.kind === "failed") return <>{fallback(state.message)}</>;
  return (
    <div className="studio-ipad-rec-card live">
      {state.kind === "loading" ? (
        <div className="studio-ipad-rec-live-loading" style={{ height }}>
          Loading {name.replace(/^lscMobileInline_/, "")}…
        </div>
      ) : (
        <div className="studio-ipad-rec-live-fit" style={{ height }}>
          <iframe
            ref={frame}
            title={name}
            sandbox="allow-scripts"
            srcDoc={state.html}
            onLoad={() => frame.current?.contentWindow?.postMessage({ __studio: "zoom", zoom: scaleRef.current } satisfies ZoomMessage, "*")}
            style={{ width: `${100 * scale}%`, height: height * scale }}
            className="studio-ipad-rec-live-frame"
          />
        </div>
      )}
      {notes.map((n) => (
        <div key={n} className="studio-ipad-rec-live-note">
          {n}
        </div>
      ))}
      <div className="studio-ipad-rec-live-caption">
        Live preview (approximate): data as your Salesforce connection sees it, not the iPad's offline copy.{caption}
      </div>
      {footer}
    </div>
  );
}

function describePage(ref: { type?: string; attributes?: Record<string, unknown> }): string {
  const a = ref.attributes ?? {};
  const name = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  switch (ref.type) {
    case "standard__recordPage":
      return `the ${name("objectApiName") || "record"} record`;
    case "standard__objectPage":
      return `${name("objectApiName") || "the object"} ${name("actionName") === "new" ? "(new record)" : "list"}`;
    case "standard__recordRelationshipPage":
      return `the ${name("relationshipApiName") || "related"} list`;
    case "standard__webPage":
      return name("url") || "a web page";
    case "standard__component":
      return name("componentName") || "a component";
    default:
      return ref.type ? ref.type.replace(/^standard__/, "") : "a page";
  }
}
