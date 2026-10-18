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
  const fit = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.77);
  useLayoutEffect(() => {
    const el = fit.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / IPAD_WIDTH || 0.77);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="studio-ipad" role="region" aria-label={label}>
      <div ref={fit} className="studio-ipad-fit" style={{ height: IPAD_HEIGHT * scale }}>
        <div className="studio-ipad-screen" style={{ transform: `scale(${scale})` }}>
          <IpadScaleContext.Provider value={scale}>{children}</IpadScaleContext.Provider>
        </div>
      </div>
    </div>
  );
}
