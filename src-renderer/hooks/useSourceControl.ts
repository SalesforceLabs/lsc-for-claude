import { useCallback, useEffect, useState } from "react";
import { useOrgs } from "./useOrgs";

/** Told when any view switches the setting, so every user of the hook follows. */
const CHANGED = "roz:source-control-changed";

export interface SourceControlState {
  /** Whether the selected org is deployed from source control; false until read. */
  deployed: boolean;
  /** The org's sfdx project folder: Studio's source files and LSC apps are saved there. */
  folder?: string;
  /** The folder's Git branch; null outside a repository. */
  branch?: string | null;
  loading: boolean;
  setDeployed: (deployed: boolean) => Promise<void>;
  /** Pick the project folder; resolves to an error message, or null when chosen or cancelled. */
  chooseFolder: () => Promise<string | null>;
  /** Re-read after a save chose a new folder. */
  reload: () => void;
}

/** The selected org's "Deployed from source control" setting (stored per org by the main process). */
export function useSourceControl(): SourceControlState {
  const { chosen, current } = useOrgs();
  const orgId = current?.username ?? chosen;
  const [state, setState] = useState<{
    org: string;
    deployed: boolean;
    folder?: string;
    branch?: string | null;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    window.lscApi
      .sourceControlGet()
      .then(
        (s) =>
          live && setState({ org: orgId, deployed: s.deployed, folder: s.folder, branch: s.branch })
      )
      .catch(() => live && setState({ org: orgId, deployed: false }));
    return () => {
      live = false;
    };
  }, [orgId, tick]);

  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, []);

  const reload = useCallback(() => window.dispatchEvent(new Event(CHANGED)), []);

  const setDeployed = useCallback(
    async (deployed: boolean) => {
      setState((s) => (s ? { ...s, deployed } : s));
      await window.lscApi.sourceControlSet(deployed);
      reload();
    },
    [reload]
  );

  const chooseFolder = useCallback(async () => {
    const r = await window.lscApi.sourceControlChooseFolder();
    if (r.folder) reload();
    return r.error ?? null;
  }, [reload]);

  // A value read for another org doesn't count while the new one loads.
  const fresh = state && state.org === orgId ? state : null;
  return {
    deployed: fresh?.deployed ?? false,
    folder: fresh?.folder,
    branch: fresh?.branch,
    loading: !fresh,
    setDeployed,
    chooseFolder,
    reload,
  };
}
