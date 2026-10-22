import React, { createContext, useLayoutEffect, useRef, useState } from "react";
import "./ipad.css";

/** An 11-inch iPad in landscape, in points. Everything inside is sized in points. */
export const IPAD_WIDTH = 1210;
export const IPAD_HEIGHT = 834;

/** The screen's current scale, for content that has to undo it (frames are blurry when scaled). */
export const IpadScaleContext = createContext(1);

/**
 * The iPad screen drawn at its real size in points and scaled down to fit the
 * frame, so the layout inside matches the device one to one.
 */
export default function IpadScreen({ label, children }: { label: string; children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const fit = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.77);
  // Narrow enough that the whole device fits below where it starts; under this it scrolls instead.
  const [maxWidth, setMaxWidth] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = fit.current;
    const device = frame.current;
    if (!el || !device) return;
    // The preview's canvas: its height is what the device has to fit in.
    const scroller = device.closest<HTMLElement>(".studio-canvas");
    const measure = () => {
      setScale(el.clientWidth / IPAD_WIDTH || 0.77);
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();
      const top = device.getBoundingClientRect().top - box.top + scroller.scrollTop;
      const style = getComputedStyle(device);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const room = scroller.clientHeight - top - BOTTOM_GAP - padY;
      setMaxWidth(Math.max(MIN_SCREEN_WIDTH, Math.floor((room * IPAD_WIDTH) / IPAD_HEIGHT)) + padX);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (scroller) observer.observe(scroller);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={frame} className="studio-ipad" role="region" aria-label={label} style={maxWidth ? { maxWidth: `min(960px, ${maxWidth}px)` } : undefined}>
      <div ref={fit} className="studio-ipad-fit" style={{ height: IPAD_HEIGHT * scale }}>
        <div className="studio-ipad-screen" style={{ transform: `scale(${scale})`, "--ipad-scale": scale } as React.CSSProperties}>
          <IpadScaleContext.Provider value={scale}>{children}</IpadScaleContext.Provider>
        </div>
      </div>
    </div>
  );
}

/** Space kept under the device so its bottom edge and shadow show. */
const BOTTOM_GAP = 16;
/** Below this the screen's text gets too small to read; the pane scrolls instead. */
const MIN_SCREEN_WIDTH = 480;
