import { useCallback, useEffect, useState } from "react";
import { usePersistedFlag, usePersistedState } from "./usePersistedState";

export const SIDEBAR_WIDTH = { min: 208, max: 360, default: 248, collapsed: 76 } as const;
/** Below this window width the sidebar folds to its icon rail on its own. */
export const SIDEBAR_NARROW_PX = 1000;

const NARROW_QUERY = `(max-width: ${SIDEBAR_NARROW_PX - 1}px)`;

export const clampSidebarWidth = (w: number) => Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, Math.round(w)));

/**
 * The sidebar's layout: collapsed or not (remembered across restarts), its dragged width
 * (remembered), and the narrow-window rule. In a narrow window the sidebar is folded whatever
 * was chosen; toggling it there opens it for as long as the window stays narrow, then the
 * remembered choice applies again.
 */
export function useSidebarLayout() {
  const [pref, setPref] = usePersistedFlag("roz.sidebar.collapsed");
  const [width, setStoredWidth] = usePersistedState<number>(
    "roz.sidebar.width",
    SIDEBAR_WIDTH.default,
    (r) => (Number.isFinite(Number(r)) ? clampSidebarWidth(Number(r)) : undefined),
    String
  );
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  const [peek, setPeek] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const on = () => {
      setNarrow(mq.matches);
      setPeek(false);
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const collapsed = narrow ? !peek : pref;
  const toggle = useCallback(() => {
    if (narrow) setPeek((p) => !p);
    else setPref(!pref);
  }, [narrow, pref, setPref]);

  return {
    collapsed,
    narrow,
    toggle,
    width,
    setWidth: useCallback((w: number) => setStoredWidth(clampSidebarWidth(w)), [setStoredWidth]),
    resetWidth: useCallback(() => setStoredWidth(SIDEBAR_WIDTH.default), [setStoredWidth]),
  };
}
