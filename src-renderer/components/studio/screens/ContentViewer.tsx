import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PublishedContentCard } from "./content-types";
import type { ContentPlayerAsset, ContentPlayerData } from "./content-player-types";
import { slideLabel } from "./content-logic";
import {
  gestureFor,
  layoutWidth,
  linkNote,
  pageStep,
  QUIET_REQUESTS,
  resolveGoto,
  unknownRequest,
  unsupportedNote,
  type Drag,
  type Region,
} from "./content-player-logic";
import { ScreenLayer } from "./interact-ui";
import "./content-viewer.css";

/** The stored image of page `i` (0-based): the first-page image, or a later page's when it was rendered. */
function pageImage(card: PublishedContentCard, i: number): string | undefined {
  return i === 0 ? card.thumbnail : (card.pageThumbnails?.[i - 1] ?? undefined);
}

type Load =
  | { state: "loading" }
  | { state: "ready"; data: ContentPlayerData }
  | { state: "error"; error: string };

/**
 * The CLM player (PresentationViewController). The presentation's pages are downloaded and run live:
 * HTML slides in a sandboxed frame with the PresentationPlayer API, PDF pages as images. Until they're
 * ready, or when they can't be opened, the stored first-page images stand in.
 */
export default function ContentViewer({
  card,
  userId,
  load: loadPlayer,
  loadKey,
  onClose,
}: {
  card: PublishedContentCard;
  userId?: string;
  /** Loads something other than an org presentation (a page Roz drafted); its folder is never released. */
  load?: () => Promise<{ data?: ContentPlayerData; error?: string }>;
  /** Changes when `load` would answer something new. */
  loadKey?: string | number;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setPaused(false), 2600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let live = true;
    let base: string | undefined;
    setLoad({ state: "loading" });
    (loadPlayer ? loadPlayer() : window.lscApi.studioContentPlayer(card.id, userId))
      .then((res) => {
        if (res.data && !loadPlayer) base = res.data.base;
        if (!live) {
          if (base) void window.lscApi.studioContentPlayerRelease(base);
          return;
        }
        if (res.data && res.data.slides.length) setLoad({ state: "ready", data: res.data });
        else
          setLoad({
            state: "error",
            error:
              res.error ||
              res.data?.notes[0] ||
              "This presentation has no slides the preview can show.",
          });
      })
      .catch(
        (err: unknown) =>
          live &&
          setLoad({ state: "error", error: err instanceof Error ? err.message : String(err) })
      );
    return () => {
      live = false;
      if (base) void window.lscApi.studioContentPlayerRelease(base);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, userId, attempt, loadKey]);

  return (
    <ScreenLayer>
      <div className="studio-ipad-content-viewer">
        {load.state === "ready" ? (
          <LivePlayer data={load.data} card={card} paused={paused} onClose={onClose} />
        ) : (
          <StoredViewer
            card={card}
            paused={paused}
            load={load}
            onRetry={() => setAttempt((n) => n + 1)}
            onClose={onClose}
          />
        )}
      </div>
    </ScreenLayer>
  );
}

/** A message from the slide's bridge (src/studio/screens/clm-bridge.ts). */
interface BridgeMessage {
  __clm: 1;
  request: string;
  params: Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;

function LivePlayer({
  data,
  card,
  paused,
  onClose,
}: {
  data: ContentPlayerData;
  card: PublishedContentCard;
  paused: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [menu, setMenu] = useState(true);
  const [dismissable, setDismissable] = useState(true);
  const [asset, setAsset] = useState<ContentPlayerAsset | null>(null);
  const [alertText, setAlertText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(data.notes.length > 0);
  const [rate, setRate] = useState(false);
  /** The slide's viewport: undefined until it reports, then `layoutWidth`'s input. */
  const [viewport, setViewport] = useState<number | null | undefined>(undefined);
  const [size, setSize] = useState({ w: 1194, h: 808 });
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const regions = useRef(new Map<string, Region>());
  const lastSwipe = useRef(0);
  const told = useRef(new Set<string>());
  const state = useRef("");
  const slide = data.slides[index];

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= data.slides.length) return;
      regions.current.clear();
      setViewport(undefined);
      setIndex(to);
    },
    [data.slides.length]
  );

  const say = useCallback((text: string, once?: string) => {
    if (once) {
      if (told.current.has(once)) return;
      told.current.add(once);
    }
    setNotice(text);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const width = layoutWidth(viewport ?? null, size.w);
  const scale = size.w / width;

  const onGesture = useCallback(
    (drag: Drag, dragScale: number) => {
      const action = gestureFor(drag, {
        scale: dragScale,
        viewHeight: size.h,
        gesture: data.presentation.gesture,
        menuShown: menu,
        regions: [...regions.current.values()],
        sinceLastSwipeMs: Date.now() - lastSwipe.current,
      });
      if (action === "next" || action === "prev") {
        lastSwipe.current = Date.now();
        setMenu(false);
        go(index + (action === "next" ? 1 : -1));
      } else if (action === "showMenu") setMenu(true);
      else if (action === "hideMenu") setMenu(false);
    },
    [data.presentation.gesture, go, index, menu, size.h]
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const msg = e.data as BridgeMessage;
      if (!msg || msg.__clm !== 1 || typeof msg.request !== "string") return;
      const p = msg.params && typeof msg.params === "object" ? msg.params : {};
      switch (msg.request) {
        case "__viewport":
          setViewport(typeof p.width === "number" ? p.width : null);
          return;
        case "__swipe":
          onGesture(
            { x: num(p.x), y: num(p.y), dx: num(p.dx), dy: num(p.dy), ms: num(p.ms) },
            scale
          );
          return;
        case "__link":
          if (typeof p.href === "string") say(linkNote(p.href));
          return;
        case "gotoSlide": {
          const to = resolveGoto(data, index, str(p.pageId), str(p.slideName));
          if (to.kind === "slide") go(to.index);
          else if (to.kind === "asset") setAsset(to.asset);
          else setAlertText(to.message);
          return;
        }
        case "goNextPage":
        case "goPreviousPage": {
          const to = pageStep(data, index, msg.request === "goNextPage" ? 1 : -1);
          if (to != null) go(to);
          return;
        }
        case "alert":
          setAlertText(typeof p.message === "string" ? p.message : "");
          return;
        case "addAction":
          setAlertText("addAction is not supported.");
          return;
        case "disableDismiss":
          setDismissable(false);
          return;
        case "enableDismiss":
          setDismissable(true);
          return;
        case "defineNoSwipeRegion":
          regions.current.set(String(p.regionId), {
            x: num(p.x),
            y: num(p.y),
            width: num(p.width),
            height: num(p.height),
          });
          return;
        case "destroyNoSwipeRegion":
          regions.current.delete(String(p.regionId));
          return;
      }
      if (msg.request === "saveState") state.current = typeof p.state === "string" ? p.state : "";
      if (QUIET_REQUESTS.has(msg.request)) return;
      const note = unsupportedNote(msg.request);
      if (note) say(note, msg.request);
      else setAlertText(unknownRequest(msg.request));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [data, go, index, onGesture, say, scale]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
        return;
      if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "Escape") {
        if (asset) setAsset(null);
        else if (alertText != null) setAlertText(null);
        else if (dismissable) onClose();
        else return;
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [alertText, asset, dismissable, go, index, onClose]);

  // PDF pages are drawn here, so their drags are read here too (in the stage's own points).
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const pointScale = () => {
    const el = stageRef.current;
    return el ? el.getBoundingClientRect().width / el.offsetWidth || 1 : 1;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    const k = pointScale();
    down.current = { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k, t: Date.now() };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    const r = stageRef.current!.getBoundingClientRect();
    const k = pointScale();
    onGesture(
      {
        x: d.x,
        y: d.y,
        dx: (e.clientX - r.left) / k - d.x,
        dy: (e.clientY - r.top) / k - d.y,
        ms: Date.now() - d.t,
      },
      1
    );
  };

  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menu)
      stripRef.current
        ?.querySelector<HTMLElement>(`[data-slide="${index}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index, menu]);

  return (
    <>
      <div
        ref={stageRef}
        className="studio-ipad-content-viewer-stage live"
        onPointerDown={slide.kind === "pdf" ? onPointerDown : undefined}
        onPointerUp={slide.kind === "pdf" ? onPointerUp : undefined}
      >
        {slide.kind === "html" ? (
          <iframe
            key={slide.file}
            ref={frameRef}
            title={`${data.presentation.name}: ${slide.name}`}
            sandbox="allow-scripts"
            src={data.base + slide.file}
            style={{
              width,
              height: size.h / scale,
              transform: `scale(${scale})`,
              visibility: viewport === undefined ? "hidden" : "visible",
            }}
            onLoad={() =>
              frameRef.current?.contentWindow?.postMessage(
                { __clm: 1, event: "viewappearing" },
                "*"
              )
            }
          />
        ) : (
          <img
            key={slide.file}
            src={data.base + slide.file}
            alt={`${data.presentation.name}, page ${slide.pageIndex + 1}`}
            draggable={false}
          />
        )}
        {paused && <div className="studio-ipad-content-viewer-paused">Session Time Paused</div>}
        {notesOpen && (
          <div className="studio-ipad-content-viewer-notes" role="note">
            <div>
              {data.notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
            <button
              type="button"
              aria-label="Hide preview notes"
              onClick={() => setNotesOpen(false)}
            >
              ✕
            </button>
          </div>
        )}
        {notice && (
          <div className="studio-ipad-content-viewer-notice" role="status">
            {notice}
          </div>
        )}
      </div>
      <div className={`studio-ipad-content-viewer-bar${menu ? "" : " hidden"}`}>
        <BarRow onClose={onClose} closeDisabled={!dismissable} />
        <div className="studio-ipad-content-viewer-title">
          <span className="name">{data.presentation.name || card.name}</span>
          <span className="count">{slideLabel(index, data.slides.length)}</span>
          <label className="rate">
            <input type="checkbox" checked={rate} onChange={(e) => setRate(e.target.checked)} />
            <span className="switch" />
            <span>Rate Content</span>
          </label>
        </div>
        <div className="studio-ipad-content-viewer-strip" ref={stripRef}>
          {data.slides.map((s) => (
            <button
              key={s.index}
              type="button"
              data-slide={s.index}
              className="studio-ipad-content-viewer-page"
              title={s.pageName}
              onClick={() => go(s.index)}
            >
              <span className={`thumb${s.index === index ? " on" : ""}`}>
                {s.thumbnail ? (
                  <img src={data.base + s.thumbnail} alt="" />
                ) : (
                  <em>{s.pageName || s.name}</em>
                )}
              </span>
              <span className="num">{s.index + 1}</span>
            </button>
          ))}
        </div>
      </div>
      {asset && <AssetSheet asset={asset} base={data.base} onBack={() => setAsset(null)} />}
      {alertText != null && <IosAlert text={alertText} onOk={() => setAlertText(null)} />}
    </>
  );
}

/** An additional-content file opened by gotoSlide (ShowContentViewController): full screen on white, Back, its title. */
function AssetSheet({
  asset,
  base,
  onBack,
}: {
  asset: ContentPlayerAsset;
  base: string;
  onBack: () => void;
}) {
  return (
    <div className="studio-ipad-content-asset">
      <div className="studio-ipad-content-asset-nav">
        <button type="button" onClick={onBack}>
          <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true">
            <path
              d="M10 2 2 10l8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back
        </button>
        <span className="title">{asset.title}</span>
      </div>
      <div className="studio-ipad-content-asset-body">
        {asset.files.length ? (
          asset.files.map((f) => <img key={f} src={base + f} alt="" />)
        ) : (
          <p className="empty">
            The preview can't show this file. On the iPad it opens here full screen.
          </p>
        )}
      </div>
    </div>
  );
}

/** UIAlertController with one OK, as the player shows a slide's alert. */
function IosAlert({ text, onOk }: { text: string; onOk: () => void }) {
  return (
    <div className="studio-ipad-content-alert-backdrop">
      <div className="studio-ipad-content-alert" role="alertdialog" aria-label={text}>
        <p>{text}</p>
        <button type="button" onClick={onOk}>
          OK
        </button>
      </div>
    </div>
  );
}

/** The bar's top row of controls, at the x positions the device draws them. */
function BarRow({ onClose, closeDisabled }: { onClose: () => void; closeDisabled?: boolean }) {
  return (
    <div className="studio-ipad-content-viewer-row">
      <div className="studio-ipad-content-viewer-seg">
        <span>Presentations</span>
        <span>Favorites</span>
        <span className="on">Pages</span>
      </div>
      <button type="button" className="studio-ipad-content-viewer-circle" aria-label="Search">
        <svg width="20" height="20" viewBox="0 0 18 18">
          <circle cx="7.5" cy="7.5" r="5.2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            d="m11.6 11.6 4.4 4.4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button type="button" className="studio-ipad-content-viewer-circle" aria-label="Pen">
        ✎
      </button>
      <button type="button" className="studio-ipad-content-viewer-circle" aria-label="Lock">
        ⚿
      </button>
      <button type="button" className="studio-ipad-content-viewer-circle" aria-label="Play">
        ▶
      </button>
      <button
        type="button"
        className="studio-ipad-content-viewer-circle"
        aria-label="Add Attendees"
      >
        +
      </button>
      <button
        type="button"
        className="studio-ipad-content-viewer-circle"
        aria-label="Quick Actions"
      >
        ⋮
      </button>
      <button type="button" className="studio-ipad-content-viewer-pill">
        Visit
      </button>
      <button
        type="button"
        className="studio-ipad-content-viewer-pill close"
        onClick={onClose}
        disabled={closeDisabled}
      >
        ✕ Close
      </button>
    </div>
  );
}

/** The stored first-page images, while the slides load or when they can't be opened. */
function StoredViewer({
  card,
  paused,
  load,
  onRetry,
  onClose,
}: {
  card: PublishedContentCard;
  paused: boolean;
  load: Load;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [rate, setRate] = useState(false);
  const pages = Math.max(1, card.pages);
  return (
    <>
      <div className="studio-ipad-content-viewer-stage">
        {pageImage(card, page) ? (
          <img src={pageImage(card, page)!} alt="" />
        ) : (
          <div className="studio-ipad-content-viewer-standin">
            <strong>{card.name}</strong>
            <span>Page {page + 1}</span>
            <small>
              {page === 0
                ? "No preview image is stored for this presentation."
                : "Studio has no stored image for this page; the iPad renders every page."}
            </small>
          </div>
        )}
        {paused && load.state !== "loading" && (
          <div className="studio-ipad-content-viewer-paused">Session Time Paused</div>
        )}
        {load.state === "loading" && (
          <div className="studio-ipad-content-viewer-loading" role="status">
            <span className="spinner" aria-hidden="true" />
            Opening the slides…
          </div>
        )}
        {load.state === "error" && (
          <div className="studio-ipad-content-viewer-notes" role="alert">
            <div>
              <p>The slides couldn't be opened, so this shows the stored images. {load.error}</p>
            </div>
            <button type="button" className="retry" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
      </div>
      <div className="studio-ipad-content-viewer-bar">
        <BarRow onClose={onClose} />
        <div className="studio-ipad-content-viewer-title">
          <span className="name">{card.name}</span>
          <span className="count">{slideLabel(page, pages)}</span>
          <label className="rate">
            <input type="checkbox" checked={rate} onChange={(e) => setRate(e.target.checked)} />
            <span className="switch" />
            <span>Rate Content</span>
          </label>
        </div>
        <div className="studio-ipad-content-viewer-strip">
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              type="button"
              className="studio-ipad-content-viewer-page"
              onClick={() => setPage(i)}
            >
              <span className={`thumb${i === page ? " on" : ""}`}>
                {pageImage(card, i) ? (
                  <img src={pageImage(card, i)!} alt="" />
                ) : (
                  <em>Page {i + 1}</em>
                )}
              </span>
              <span className="num">{i + 1}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
