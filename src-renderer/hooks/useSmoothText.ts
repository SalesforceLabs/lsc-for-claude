import { useEffect, useRef, useState } from "react";
import { advanceReveal, revealCut } from "../chat-activity";

/**
 * `text` revealed at a steady pace while it streams in, a frame at a time, whole words at once.
 * Text already there when it mounts (a saved reply, a session reopened mid-reply) shows at once;
 * after `live` ends the rest is revealed quickly rather than cut short.
 */
export function useSmoothText(text: string, live: boolean): string {
  const [shown, setShown] = useState(text.length);
  const shownRef = useRef(text.length);
  const textRef = useRef(text);
  const liveRef = useRef(live);
  const frame = useRef<number | null>(null);
  textRef.current = text;
  liveRef.current = live;

  useEffect(() => {
    if (shownRef.current > text.length) {
      // The text was replaced rather than extended.
      shownRef.current = text.length;
      setShown(text.length);
    }
    if (frame.current != null || shownRef.current >= text.length) return;
    let last = performance.now();
    const tick = (now: number) => {
      const full = textRef.current;
      shownRef.current = advanceReveal(shownRef.current, full.length, now - last, !liveRef.current);
      last = now;
      setShown(revealCut(full, shownRef.current));
      frame.current = shownRef.current < full.length ? requestAnimationFrame(tick) : null;
    };
    frame.current = requestAnimationFrame(tick);
  }, [text]);

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  return shown >= text.length ? text : text.slice(0, shown);
}
