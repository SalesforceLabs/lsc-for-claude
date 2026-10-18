import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { matchesOrg, orgKey, type OrgRole, type SfOrg } from "../orgs";

/** How long to watch `sf org list` for a browser login to finish. */
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
  /** Re-read `sf org list`; `recheckRoles` also checks again which connections are LSC admins. */
  refresh: (options?: { recheckRoles?: boolean }) => Promise<SfOrg[]>;
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
  const [waiting, setWaiting] = useState<{ before: SfOrg[]; since: number } | null>(null);
  const [notice, setNotice] = useState("");

  // Roles arrive after the list, as each connection's check finishes.
  const [roles, setRoles] = useState<Record<string, OrgRole>>({});

  const refresh = useCallback(async (options?: { recheckRoles?: boolean }): Promise<SfOrg[]> => {
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
    refresh();
    const offRoles = window.lscApi.onSfOrgRoles(setRoles);
    const offChanged = window.lscApi.onSfOrgChanged((org) => setChosen(org));
    return () => {
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

  // A browser login finishes outside the app; watch for the new connection and switch to it.
  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const list = await refresh();
      if (stopped) return;
      const known = new Set(waiting.before.map((o) => o.username.toLowerCase()));
      // A login to a connection that had expired reconnects it rather than adding one.
      const added =
        list.find((o) => !known.has(o.username.toLowerCase())) ??
        list.find((o) => o.connected && waiting.before.some((b) => b.username === o.username && !b.connected));
      if (added) {
        setWaiting(null);
        await select(orgKey(added));
        return;
      }
      if (Date.now() - waiting.since > LOGIN_WAIT_MS) {
        setWaiting(null);
        setNotice("No new connection appeared. Finish the login in your browser, then refresh.");
        return;
      }
      timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [waiting, refresh, select]);

  const login = useCallback(
    async ({ alias, instanceUrl }: { alias?: string; instanceUrl?: string }) => {
      setNotice("");
      const res = await window.lscApi.loginSfOrg(alias, instanceUrl);
      if (!res.ok) {
        setNotice(`Couldn't start the login: ${res.error ?? "unknown error"}`);
        return;
      }
      setWaiting({ before: orgs, since: Date.now() });
    },
    [orgs]
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
