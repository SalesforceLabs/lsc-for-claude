import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { matchesOrg, orgKey, type OrgRole, type SfOrg } from "../orgs";

/** How long to wait for a browser login to finish. */
const LOGIN_WAIT_MS = 5 * 60_000;

interface OrgsState {
  orgs: SfOrg[];
  loading: boolean;
  /** Set when the sf CLI can't be run. */
  error: string;
  /** The key Settings stores, or "" when none is picked and the sf CLI default applies. */
  chosen: string;
  /** The selected org's connection, if it's in `sf org list`. */
  current: SfOrg | undefined;
  /** A chosen org that isn't in `sf org list` any more. */
  missing: boolean;
  /** Waiting for a browser login started from the app. */
  waitingLogin: boolean;
  /** The last thing that went wrong with an org action, for the menu to show. */
  notice: string;
  /**
   * Re-read `sf org list`; `recheckRoles` also checks again which connections are LSC admins.
   * `quick` answers with the last listing and sends a new one when the sf CLI has checked every login.
   */
  refresh: (options?: { recheckRoles?: boolean; quick?: boolean }) => Promise<SfOrg[]>;
  select: (key: string) => Promise<void>;
  /** Log in through the browser; the new connection is selected once it appears. */
  login: (options: { alias?: string; instanceUrl?: string }) => Promise<void>;
  open: (key?: string) => Promise<void>;
  clearNotice: () => void;
}

const OrgsContext = createContext<OrgsState | null>(null);

/**
 * The sf CLI connections and the one selected in the app. Studio, the Library and new
 * sessions follow the selected org; each session keeps the org it started in.
 */
export function OrgsProvider({ children }: { children: React.ReactNode }) {
  const [orgs, setOrgs] = useState<SfOrg[]>([]);
  const [chosen, setChosen] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState<{ since: number } | null>(null);
  const [notice, setNotice] = useState("");

  // Roles arrive after the list, as each connection's check finishes.
  const [roles, setRoles] = useState<Record<string, OrgRole>>({});

  const refresh = useCallback(async (options?: { recheckRoles?: boolean; quick?: boolean }): Promise<SfOrg[]> => {
    setLoading(true);
    try {
      const result = await window.lscApi.listSfOrgs(options);
      setOrgs(result.orgs || []);
      setError(result.error ? "sf CLI unavailable" : "");
      return result.orgs || [];
    } catch {
      setError("sf CLI unavailable");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!window.lscApi) return;
    window.lscApi.getSettings().then((s) => setChosen(s.sfTargetOrg || "")).catch(() => {});
    // The first listing skips checking each login (seconds per dozen orgs); the full one follows.
    refresh({ quick: true });
    const offListed = window.lscApi.onSfOrgListed((list) => {
      if (!list.error) setOrgs(list.orgs);
    });
    const offRoles = window.lscApi.onSfOrgRoles(setRoles);
    const offChanged = window.lscApi.onSfOrgChanged((org) => setChosen(org));
    return () => {
      offListed();
      offRoles();
      offChanged();
    };
  }, [refresh]);

  const withRoles = useMemo(
    () => orgs.map((o) => ({ ...o, role: roles[o.username.toLowerCase()] ?? o.role })),
    [orgs, roles]
  );

  // Not optimistic: sessions and the Library are listed by the org the main process has
  // saved, so the renderer only moves once it has (`sfOrg:changed` arrives first).
  const select = useCallback(async (key: string) => {
    setNotice("");
    const res = await window.lscApi.setSfOrg(key);
    if (res?.org) setChosen(res.org);
  }, []);

  // A browser login finishes outside the app; the main process says when, with the new connection.
  useEffect(() => {
    if (!waiting) return;
    const off = window.lscApi.onSfOrgLoginDone(async (result) => {
      setWaiting(null);
      if ("error" in result) {
        setNotice(`The login didn't finish: ${result.error}`);
        return;
      }
      await select(result.username);
    });
    const timer = setTimeout(() => {
      setWaiting(null);
      setNotice("No new connection appeared. Finish the login in your browser, then refresh.");
    }, LOGIN_WAIT_MS - (Date.now() - waiting.since));
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [waiting, select]);

  const login = useCallback(
    async ({ alias, instanceUrl }: { alias?: string; instanceUrl?: string }) => {
      setNotice("");
      const res = await window.lscApi.loginSfOrg(alias, instanceUrl);
      if (!res.ok) {
        setNotice(`Couldn't start the login: ${res.error ?? "unknown error"}`);
        return;
      }
      setWaiting({ since: Date.now() });
    },
    []
  );

  // With no org picked, the tools fall back to the sf CLI default (or the only connection).
  const current = chosen
    ? withRoles.find((o) => matchesOrg(o, chosen))
    : withRoles.find((o) => o.isDefault) ?? (withRoles.length === 1 ? withRoles[0] : undefined);
  const missing = !!chosen && !loading && !error && !current;

  const open = useCallback(
    async (key?: string) => {
      const target = key ?? (current ? orgKey(current) : chosen);
      if (!target) return;
      setNotice("");
      const res = await window.lscApi.openSfOrg(target);
      if (!res.ok) setNotice(`Couldn't open the org: ${res.error ?? "unknown error"}`);
    },
    [current, chosen]
  );

  const value = useMemo<OrgsState>(
    () => ({
      orgs: withRoles,
      loading,
      error,
      chosen,
      current,
      missing,
      waitingLogin: !!waiting,
      notice,
      refresh,
      select,
      login,
      open,
      clearNotice: () => setNotice(""),
    }),
    [withRoles, loading, error, chosen, current, missing, waiting, notice, refresh, select, login, open]
  );

  return <OrgsContext.Provider value={value}>{children}</OrgsContext.Provider>;
}

export function useOrgs(): OrgsState {
  const state = useContext(OrgsContext);
  if (!state) throw new Error("useOrgs needs an OrgsProvider");
  return state;
}

/**
 * The username sessions and Library items are scoped by — the selected connection's, or the
 * chosen key while it's logged out. Undefined until it's known.
 */
export function useSelectedOrgId(): string | undefined {
  const { current, chosen, loading } = useOrgs();
  if (current) return current.username;
  if (loading) return undefined;
  return chosen || "";
}
