import { useCallback, useEffect, useState } from "react";
import type { ApiVersionInfo } from "../types";
import { useOrgs } from "./useOrgs";

export interface ApiVersionState {
  /** Null while loading, with no org selected, or when it couldn't be read. */
  info: ApiVersionInfo | null;
  loading: boolean;
  error: string | null;
  /** The org the version is for (its username), or null with no org selected. */
  org: string | null;
  /** Pin a version for the selected org; null goes back to the org's own. */
  setVersion: (version: string | null) => Promise<void>;
  reload: () => void;
}

/** The selected org's Salesforce API version (pinned per org by the main process). */
export function useApiVersion(): ApiVersionState {
  const { chosen, current } = useOrgs();
  const orgId = current?.username ?? chosen;
  const [state, setState] = useState<{ key: string; org: string | null; info: ApiVersionInfo | null; error: string | null } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    window.lscApi
      .apiVersionGet()
      .then((r) => live && setState({ key: orgId, org: r.org, info: r.data ?? null, error: r.org && !r.data ? r.error ?? "Couldn't read the API version." : null }))
      .catch((e) => live && setState({ key: orgId, org: orgId || null, info: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [orgId, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const setVersion = useCallback(
    async (version: string | null) => {
      const r = await window.lscApi.apiVersionSet(version).catch((e) => ({ org: orgId, data: undefined, error: e instanceof Error ? e.message : String(e) }));
      // A refused version keeps what was in use and says why.
      setState((s) => ({ key: orgId, org: r.org, info: r.data ?? s?.info ?? null, error: r.data ? null : r.error ?? "Couldn't set the API version." }));
    },
    [orgId]
  );

  // A value read for another org doesn't count while the new one loads.
  const fresh = state && state.key === orgId ? state : null;
  return { info: fresh?.info ?? null, loading: !fresh, error: fresh?.error ?? null, org: fresh?.org ?? null, setVersion, reload };
}
