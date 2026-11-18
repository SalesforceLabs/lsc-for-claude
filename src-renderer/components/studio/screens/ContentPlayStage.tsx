import React, { useLayoutEffect, useRef, useState } from "react";
import type { PublishedContentCard } from "./content-types";
import ContentViewer from "./ContentViewer";

const SCREEN_W = 1210;
const SCREEN_H = 834;

/**
 * The CLM player on an iPad-sized screen, scaled to fit its box — for the Intelligent Content builder's Play tab.
 * Closing the player (its Done button) calls `onClose`.
 */
export default function ContentPlayStage({
  card,
  load,
  loadKey,
  onClose,
}: {
  card: PublishedContentCard;
  load?: React.ComponentProps<typeof ContentViewer>["load"];
  loadKey?: string | number;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / SCREEN_W, el.clientHeight / SCREEN_H));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="content-play-box" ref={box}>
      <div
        className="content-play-device"
        style={{ width: SCREEN_W * scale, height: SCREEN_H * scale }}
      >
        <div
          className="studio-ipad-screen"
          style={{ transform: `scale(${scale})`, visibility: scale ? "visible" : "hidden" }}
        >
          <ContentViewer card={card} load={load} loadKey={loadKey} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
