import { createContext, useCallback, useEffect, useState } from "react";
import type { MobileLoginInfo } from "../types";

/** The test users' mobile logins, kept current as they're added, removed, or expire. */
export function useMobileLogins() {
  const [logins, setLogins] = useState<MobileLoginInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stale = false;
    window.lscApi
      .mobileLoginList()
      .then((res) => !stale && setLogins(res.logins))
      .catch(() => {})
      .finally(() => !stale && setLoaded(true));
    const off = window.lscApi.onMobileLoginsChanged((list) => setLogins(list));
    return () => {
      stale = true;
      off();
    };
  }, []);

  /** Renew logins not used lately, so their status is current. */
  const check = useCallback(async () => {
    const res = await window.lscApi.mobileLoginCheck().catch(() => null);
    if (res) setLogins(res.logins);
  }, []);

  return { logins, loaded, check };
}

/** The previewed rep's signed-in test user, for live data in the iPad preview to load as them. */
export const RepLoginContext = createContext<string | undefined>(undefined);
