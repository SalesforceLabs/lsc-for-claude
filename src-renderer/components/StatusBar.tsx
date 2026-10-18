import React, { useState, useEffect, useCallback, useRef } from "react";
import { Check, ChevronUp, Cloud, RefreshCw, Settings, TriangleAlert } from "lucide-react";
import Spinner from "./ui/Spinner";
import Segmented from "./ui/Segmented";

interface SfOrg {
  alias?: string;
  username: string;
  orgId: string;
  instanceUrl: string;
  isDefault?: boolean;
}

/** How long to watch `sf org list` for a browser login to finish. */
const LOGIN_WAIT_MS = 5 * 60_000;

/** The value Settings stores for an org (`sfTargetOrg`). */
const orgKey = (o: SfOrg) => o.alias || o.username;

const matches = (o: SfOrg, key: string) =>
  o.alias?.toLowerCase() === key.toLowerCase() || o.username.toLowerCase() === key.toLowerCase();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** App-wide bottom bar: Settings on the left; on the right, the sf CLI org the tools run against, with a menu to switch, open, or add one. */
interface StatusBarProps {
  toolCount: number;
  onSettingsClick: () => void;
}

export default function StatusBar({ toolCount, onSettingsClick }: StatusBarProps) {
  const [orgs, setOrgs] = useState<SfOrg[]>([]);
  const [chosen, setChosen] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginAlias, setLoginAlias] = useState("");
  const [isSandbox, setIsSandbox] = useState(false);
  const [waitingLogin, setWaitingLogin] = useState<{ before: SfOrg[]; since: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [opening, setOpening] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const fetchOrgs = useCallback(async (): Promise<SfOrg[]> => {
    setLoading(true);
    try {
      const result = await window.lscApi.listSfOrgs();
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
    window.lscApi.getSettings().then((s) => setChosen(s.sfTargetOrg || "")).catch(() => {});
    fetchOrgs();
    return window.lscApi.onSfOrgChanged((org) => setChosen(org));
  }, [fetchOrgs]);

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const selectOrg = useCallback(async (key: string) => {
    setChosen(key);
    setNotice("");
    await window.lscApi.setSfOrg(key);
  }, []);

  // A browser login finishes outside the app; watch for the new connection and switch to it.
  useEffect(() => {
    if (!waitingLogin) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const list = await fetchOrgs();
      if (stopped) return;
      const known = new Set(waitingLogin.before.map((o) => o.username.toLowerCase()));
      const added = list.find((o) => !known.has(o.username.toLowerCase()));
      if (added) {
        setWaitingLogin(null);
        await selectOrg(orgKey(added));
        return;
      }
      if (Date.now() - waitingLogin.since > LOGIN_WAIT_MS) {
        setWaitingLogin(null);
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
  }, [waitingLogin, fetchOrgs, selectOrg]);

  const startLogin = async () => {
    setNotice("");
    const instanceUrl = isSandbox ? "https://test.salesforce.com" : undefined;
    const res = await window.lscApi.loginSfOrg(loginAlias.trim() || undefined, instanceUrl);
    if (!res.ok) {
      setNotice(`Couldn't start the login: ${res.error ?? "unknown error"}`);
      return;
    }
    setShowLogin(false);
    setLoginAlias("");
    setWaitingLogin({ before: orgs, since: Date.now() });
  };

  // With no org picked, the tools fall back to the sf CLI default.
  const current = chosen ? orgs.find((o) => matches(o, chosen)) : orgs.find((o) => o.isDefault);
  const missing = !!chosen && !loading && !error && !current;

  const openInBrowser = async () => {
    const key = current ? orgKey(current) : chosen;
    if (!key) return;
    setOpening(true);
    setNotice("");
    const res = await window.lscApi.openSfOrg(key);
    setOpening(false);
    if (!res.ok) setNotice(`Couldn't open the org: ${res.error ?? "unknown error"}`);
  };

  const state = error ? "error" : missing ? "warning" : current ? "ok" : "idle";
  const label = error
    ? error
    : current
    ? orgKey(current)
    : chosen
    ? chosen
    : loading
    ? "Loading orgs…"
    : orgs.length
    ? "No org selected"
    : "No orgs connected";
  const title = current
    ? `${current.username}\n${current.instanceUrl}${chosen ? "" : "\n(sf CLI default — no org picked)"}`
    : missing
    ? `${chosen} isn't in sf org list — log in again or pick another org`
    : "Salesforce org";

  return (
    <div className="status-bar" ref={rootRef}>
      <button className="status-bar-settings" onClick={onSettingsClick} title="Settings">
        <Settings size={13} strokeWidth={1.9} aria-hidden="true" />
        <span>Settings</span>
        <span className="status-bar-meta">{toolCount} tools</span>
      </button>
      <span className="status-bar-spacer" />
      {waitingLogin && <span className="status-bar-note">Waiting for browser login…</span>}
      {notice && !menuOpen && <span className="status-bar-note error" title={notice}>{notice}</span>}
      <button
        className={`status-bar-org ${menuOpen ? "open" : ""}`}
        onClick={() => setMenuOpen((o) => !o)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className={`status-bar-dot ${state}`} />
        <Cloud size={13} strokeWidth={1.9} aria-hidden="true" />
        <span className="status-bar-label">{label}</span>
        {current && <span className="status-bar-host">{hostOf(current.instanceUrl)}</span>}
        {current && !chosen && <span className="status-bar-tag">sf default</span>}
        {missing && <span className="status-bar-tag warning">not authenticated</span>}
        <ChevronUp size={12} strokeWidth={2} className="status-bar-chevron" aria-hidden="true" />
      </button>

      {menuOpen && (
        <div className="status-bar-menu" role="menu">
          <div className="status-bar-menu-header">
            <span>Salesforce orgs (sf CLI)</span>
            <button className="ui-icon-btn sm" onClick={() => fetchOrgs()} disabled={loading} title="Refresh org list" aria-label="Refresh org list">
              {loading ? <Spinner size={12} /> : <RefreshCw size={13} strokeWidth={1.9} aria-hidden="true" />}
            </button>
          </div>
          <div className="status-bar-menu-list">
            {orgs.length === 0 && (
              <div className="status-bar-menu-empty">{loading ? "Loading…" : error ? "Couldn't run sf org list." : "No orgs connected yet."}</div>
            )}
            {orgs.map((o) => {
              const active = current?.username === o.username;
              return (
                <button
                  key={o.username}
                  role="menuitemradio"
                  aria-checked={active}
                  className={`status-bar-menu-item ${active ? "active" : ""}`}
                  onClick={() => { selectOrg(orgKey(o)); setMenuOpen(false); }}
                >
                  <span className="status-bar-check">{active && <Check size={14} strokeWidth={2.25} aria-hidden="true" />}</span>
                  <span className="status-bar-menu-text">
                    <span className="status-bar-menu-name">
                      {o.alias || o.username}
                      {o.isDefault && <span className="status-bar-tag">sf default</span>}
                    </span>
                    <span className="status-bar-menu-sub">{o.alias ? `${o.username} · ` : ""}{hostOf(o.instanceUrl)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="status-bar-menu-actions">
            <button className="status-bar-menu-action" onClick={openInBrowser} disabled={!current || opening}>
              {opening ? "Opening…" : "Open org in browser"}
            </button>
            <button className="status-bar-menu-action" onClick={() => setShowLogin((s) => !s)} disabled={!!waitingLogin}>
              {waitingLogin ? "Waiting for browser login…" : showLogin ? "Cancel" : "Log in to another org…"}
            </button>
            {showLogin && (
              <div className="status-bar-login">
                <input
                  type="text"
                  placeholder="Alias (optional)"
                  value={loginAlias}
                  onChange={(e) => setLoginAlias(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") startLogin(); }}
                  autoFocus
                  spellCheck={false}
                />
                <Segmented
                  aria-label="Org type"
                  value={isSandbox ? "sandbox" : "production"}
                  onChange={(v) => setIsSandbox(v === "sandbox")}
                  options={[
                    { value: "production", label: "Production" },
                    { value: "sandbox", label: "Sandbox" },
                  ]}
                />
                <button className="btn-primary" onClick={startLogin}>
                  Log in
                </button>
              </div>
            )}
            {notice && (
              <div className="status-bar-menu-notice" role="alert">
                <TriangleAlert size={13} strokeWidth={1.9} aria-hidden="true" />
                <span>{notice}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
