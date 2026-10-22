import { useEffect, useState } from "react";

/**
 * The lsc-frame:// URL serving a live preview frame's HTML (src-electron/frame-docs.ts), or null until
 * the main process has it. Frames load it as `src` rather than `srcDoc`, so they get their own
 * Content-Security-Policy instead of the window's. The document is released when the HTML changes or
 * the frame goes away.
 */
export function useFrameUrl(html: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!html) return;
    let live = true;
    let held: string | null = null;
    void window.lscApi.registerFrame(html).then((u) => {
      held = u;
      if (live) setUrl(u);
      else if (u) void window.lscApi.releaseFrame(u);
    });
    return () => {
      live = false;
      if (held) void window.lscApi.releaseFrame(held);
    };
  }, [html]);
  return url;
}
