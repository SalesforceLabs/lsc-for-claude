import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Full, NavBar, linkBtn, type SheetContext } from "../../ipad-sheet-ui";
import { inlineLwcFrame, type FrameMessage } from "../../inline-lwc-frame";
import { answerFrameRequest, describePage, sldsCss } from "../../LiveInlineLwc";
import type { InlineLwcCheck } from "../../published-types";
import { RepLoginContext, useMobileLogins } from "../../../../hooks/useMobileLogins";
import { useFrameUrl } from "../../../../hooks/useFrameUrl";
import { testUserName } from "../../../../test-users";
import { actionContext, notInPreview, offlineLines } from "./logic";
import "./lwc-action.css";

/**
 * A custom action that is an LSC app (a Lightning web component), run live. The app pushes the component's
 * page with the record's id and object (SFLMRAction.swift:48-80, LMRContext.swift:215-239); the title is the
 * action's label (LWCViewController.swift:190-192) and CloseActionScreenEvent goes back (:139).
 * Data requests are read-only and answered as the previewed rep when Studio holds their login.
 */

/** A request that outlives this gets a timeout error, so the component shows its own error state. */
const REQUEST_MS = 12000;

interface Compiled {
  script: string;
  placeholders: string[];
  check: InlineLwcCheck;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; compiled: Compiled }
  | { kind: "failed"; message: string; check?: InlineLwcCheck };

async function answerWithin(
  m: Extract<FrameMessage, { __studio: "request" }>,
  as: string | undefined
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ __studio: string; id: number; ok: boolean; error: unknown }>(
    (resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            __studio: "response",
            id: m.id,
            ok: false,
            error: {
              status: 504,
              statusText: "Timeout",
              ok: false,
              body: { message: "The request took too long." },
            },
          }),
        REQUEST_MS
      );
    }
  );
  try {
    return await Promise.race([answerFrameRequest(m, as), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export default function LwcActionSheet({
  ctx,
  title,
  actionName,
  bundle,
  onClose,
}: {
  ctx: SheetContext;
  title: string;
  actionName: string;
  bundle: string;
  onClose: () => void;
}) {
  const { snapshot, record } = ctx;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [notes, setNotes] = useState<string[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const repLogin = useContext(RepLoginContext);
  const loginRef = useRef(repLogin);
  loginRef.current = repLogin;
  const { logins } = useMobileLogins();
  const login = repLogin ? logins.find((l) => l.id === repLogin) : undefined;
  const viewer = snapshot.viewer;
  const props = useMemo(() => actionContext(actionName, record), [actionName, record]);

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    setNotes([]);
    Promise.all([window.lscApi.studioLwcBundle(bundle), sldsCss()]).then(
      ([r]) => {
        const data = r.data as (Compiled & { error?: string }) | undefined;
        if (!live) return;
        if (r.error || !data || data.error)
          setState({
            kind: "failed",
            message: r.error ?? data?.error ?? "No component named " + bundle + " in the org.",
          });
        else setState({ kind: "ready", compiled: data });
      },
      (e: unknown) =>
        live && setState({ kind: "failed", message: e instanceof Error ? e.message : String(e) })
    );
    return () => {
      live = false;
    };
  }, [bundle]);

  const [styles, setStyles] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void sldsCss().then((c) => live && setStyles(c));
    return () => {
      live = false;
    };
  }, []);

  const html = useMemo(
    () =>
      state.kind === "ready" && styles !== null
        ? inlineLwcFrame(
            state.compiled.script,
            styles,
            {
              componentName: bundle,
              ...props,
              userId: viewer?.userId,
              locale: navigator.language,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
            1
          )
        : null,
    [state, styles, bundle, props, viewer?.userId]
  );
  const frameUrl = useFrameUrl(html);
  const ready = state.kind === "ready";

  useEffect(() => {
    if (!ready) return;
    const note = (text: string) => setNotes((n) => (n.includes(text) ? n : [...n.slice(-2), text]));
    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win) return;
      const m = e.data as FrameMessage;
      if (!m || typeof m !== "object") return;
      switch (m.__studio) {
        case "close":
          onClose();
          break;
        case "request":
          win.postMessage(await answerWithin(m, loginRef.current), "*");
          break;
        case "toast":
          note([m.toast.title, m.toast.message].filter(Boolean).join(": ") || "Toast");
          break;
        case "navigate":
          note(`Opens ${describePage(m.pageReference)} on the iPad`);
          break;
        case "error":
          if (m.mounted) note(`Script error: ${m.message}`);
          else
            setState((s) => ({
              kind: "failed",
              message: m.message,
              check: s.kind === "ready" ? s.compiled.check : undefined,
            }));
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [ready, onClose]);

  const check =
    state.kind === "ready"
      ? state.compiled.check
      : state.kind === "failed"
        ? state.check
        : undefined;
  const lines = offlineLines(check);
  const asName = login ? testUserName(login) : viewer?.name;

  return (
    <Full>
      <NavBar left={linkBtn("Close", onClose)} title={title} />
      <div className="studio-ipad-lwc-as">
        {login
          ? `As ${asName}. Data is read with their login.`
          : `As your admin connection${viewer ? `, not ${viewer.name}` : ""}. It can see more than a rep can.`}
      </div>
      <div className="studio-ipad-lwc-body">
        {state.kind === "loading" || (ready && !frameUrl) ? (
          <div className="studio-ipad-lwc-wait">Loading {bundle}…</div>
        ) : state.kind === "failed" ? (
          <div className="studio-ipad-lwc-fail">{notInPreview(state.message)}</div>
        ) : (
          <iframe
            ref={frame}
            title={bundle}
            sandbox="allow-scripts"
            src={frameUrl ?? undefined}
            className="studio-ipad-lwc-frame"
          />
        )}
      </div>
      {notes.map((n) => (
        <div key={n} className="studio-ipad-lwc-note">
          {n}
        </div>
      ))}
      <div className="studio-ipad-lwc-foot">
        {ready && state.compiled.placeholders.length > 0 && (
          <div>
            {state.compiled.placeholders
              .map((p) => `<lightning-${p.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}>`)
              .join(", ")}{" "}
            drawn as a placeholder.
          </div>
        )}
        {lines.map((l) => (
          <div key={l}>{l}</div>
        ))}
        <div>
          Live preview (approximate): data as the connection above sees it, not the iPad's offline
          copy. Writes are refused.
        </div>
      </div>
    </Full>
  );
}
