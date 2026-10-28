import { useCallback, useEffect, useState } from "react";
import type { UpdateState } from "../update";

/** The app updater's state (src-electron/updater.ts), kept current as it checks and downloads. */
export function useUpdate() {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    let stale = false;
    window.lscApi
      .updateGet()
      .then((s) => !stale && setState(s))
      .catch(() => {});
    const off = window.lscApi.onUpdateState((s) => setState(s));
    return () => {
      stale = true;
      off();
    };
  }, []);

  const check = useCallback(async () => {
    const s = await window.lscApi.updateCheck().catch(() => null);
    if (s) setState(s);
  }, []);

  const install = useCallback(() => void window.lscApi.updateInstall(), []);

  return { state, check, install };
}
