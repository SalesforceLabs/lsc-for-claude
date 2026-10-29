import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Check, ChevronRight, ChevronsUpDown, ExternalLink, LogIn, RefreshCw, Search, TriangleAlert } from "lucide-react";
import Spinner from "./ui/Spinner";
import Segmented from "./ui/Segmented";
import { useOrgs } from "../hooks/useOrgs";
import { hostOf, KIND_LABEL, orgKey, orgMonogram, type SfOrg } from "../orgs";

/** Show a filter field once the list is longer than this. */
const FILTER_AFTER = 6;

/** What a connection that isn't an LSC admin is, in a row's subtitle. */
const ROLE_LABEL = { user: "Test user", other: "No LSC" } as const;

interface OrgSwitcherProps {
  /** Usernames (lowercased) with a session running, marked in the list. */
  runningOrgs: Set<string>;
  /** The collapsed sidebar shows only the avatar. */
  compact?: boolean;
}

function OrgAvatar({ label, production, size = "md" }: { label: string; production?: boolean; size?: "md" | "sm" }) {
  return (
    <span className={`org-avatar ${size}${production ? " production" : ""}`} aria-hidden="true">
      {orgMonogram(label)}
    </span>
  );
}

/**
 * The org the app works in, at the top of the sidebar. Sessions, Studio and the Library
 * all belong to it; switching here switches all three.
 */
export default function OrgSwitcher({ runningOrgs, compact }: OrgSwitcherProps) {
  const orgs = useOrgs();
  const { current, chosen, loading, error, missing, waitingLogin, notice } = orgs;
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [loginAlias, setLoginAlias] = useState("");
  const [isSandbox, setIsSandbox] = useState(false);
  const [opening, setOpening] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setFilter("");
      setShowLogin(false);
      setShowOthers(false);
      return;
    }
    // Show the list we have at once; connection statuses follow when sf has checked every login.
    orgs.refresh({ quick: true });
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? orgs.orgs.filter((o) => [o.alias, o.username, o.instanceUrl].some((s) => s?.toLowerCase().includes(q)))
      : orgs.orgs;
    // The current org first, then the rest as the sf CLI lists them.
    return [...list].sort((a, b) => Number(b.username === current?.username) - Number(a.username === current?.username));
  }, [orgs.orgs, filter, current]);

  // LSC admins are the workspaces; reps (logged in for testing) and orgs without LSC wait below.
  // A connection not checked yet counts as an admin, and the current one always shows.
  const isWorkspace = (o: SfOrg) => !o.role || o.role === "admin" || o.username === current?.username;
  const workspaces = shown.filter(isWorkspace);
  const others = shown.filter((o) => !isWorkspace(o));
  const othersOpen = showOthers || (!!filter.trim() && workspaces.length === 0);

  // Signed in as someone who isn't an LSC admin: point at an admin connection on the same org.
  const notAdmin = !!current?.role && current.role !== "admin";
  const sameOrgAdmin = notAdmin
    ? orgs.orgs.find((o) => o.role === "admin" && o.connected && !!o.orgId && o.orgId === current?.orgId)
    : undefined;

  const choose = (o: SfOrg) => {
    setOpen(false);
    if (o.username !== current?.username) orgs.select(orgKey(o));
  };

  const startLogin = async () => {
    await orgs.login({ alias: loginAlias.trim() || undefined, instanceUrl: isSandbox ? "https://test.salesforce.com" : undefined });
    setShowLogin(false);
    setLoginAlias("");
  };

  const loginAgain = () =>
    orgs.login({ alias: current?.alias ?? (chosen || undefined), instanceUrl: current?.instanceUrl || undefined });

  const openInBrowser = async () => {
    setOpening(true);
    await orgs.open();
    setOpening(false);
  };

  const renderRow = (o: SfOrg) => {
    const active = o.username === current?.username;
    const running = runningOrgs.has(o.username.toLowerCase());
    return (
      <button
        key={o.username}
        role="menuitemradio"
        aria-checked={active}
        className={`org-menu-item${active ? " active" : ""}`}
        onClick={() => choose(o)}
        title={`${o.username}\n${o.instanceUrl}${o.status ? `\n${o.status}` : ""}`}
      >
        <OrgAvatar label={orgKey(o)} production={o.kind === "production"} size="sm" />
        <span className="org-menu-text">
          <span className="org-menu-name">{orgKey(o)}</span>
          <span className="org-menu-sub">
            {o.role && o.role !== "admin" ? `${ROLE_LABEL[o.role]} · ` : ""}
            {o.alias ? `${o.username} · ` : ""}
            {hostOf(o.instanceUrl)}
          </span>
        </span>
        {running && <span className="session-active-dot" title="A session is running in this org" />}
        {!o.connected ? (
          <span className="ui-pill warning">Needs login</span>
        ) : (
          o.kind === "production" && <span className="ui-pill warning">Production</span>
        )}
        <span className="org-menu-check">{active && <Check size={14} strokeWidth={2.25} aria-hidden="true" />}</span>
      </button>
    );
  };

  // Arrow keys move between rows, as in a native menu.
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? []);
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[at < 0 ? 0 : next].focus();
  };

  const needsLogin = missing || (current && !current.connected);
  const label = current ? orgKey(current) : chosen || (loading ? "Loading orgs…" : error ? "sf CLI unavailable" : orgs.orgs.length ? "Choose an org" : "No org connected");
  const sub = error
    ? "Install or repair the Salesforce CLI"
    : missing
    ? "Not logged in"
    : current
    ? [
        !current.connected ? "Login expired" : notAdmin ? `${ROLE_LABEL[current.role as "user" | "other"]}, not an admin` : KIND_LABEL[current.kind],
        hostOf(current.instanceUrl),
      ].join(" · ")
    : loading
    ? ""
    : "Log in to work with org data";
  const title = current ? `${current.username}\n${current.instanceUrl}` : label;

  return (
    <div className={`org-switcher${compact ? " compact" : ""}`} ref={rootRef}>
      <button
        className={`org-switcher-btn${open ? " open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={compact ? `${label}${sub ? `\n${sub}` : ""}` : title}
        aria-label={compact ? `Org: ${label}` : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {current || chosen ? (
          <OrgAvatar label={label} production={current?.kind === "production"} />
        ) : (
          <span className="org-avatar empty" aria-hidden="true">
            {loading ? <Spinner size={12} /> : <LogIn size={14} strokeWidth={1.9} />}
          </span>
        )}
        {(needsLogin || notAdmin) && <span className="org-switcher-badge" aria-hidden="true" />}
        {!compact && (
          <>
            <span className="org-switcher-text">
              <span className="org-switcher-name">{label}</span>
              {sub && <span className={`org-switcher-sub${needsLogin || notAdmin ? " warning" : ""}`}>{sub}</span>}
            </span>
            <ChevronsUpDown size={14} strokeWidth={1.9} className="org-switcher-chevron" aria-hidden="true" />
          </>
        )}
      </button>

      {open && (
        <div className="org-menu" role="menu" aria-label="Salesforce orgs" onKeyDown={onMenuKey}>
          <div className="org-menu-header">
            <span>Salesforce orgs</span>
            <button
              className="ui-icon-btn sm"
              onClick={() => orgs.refresh({ recheckRoles: true })}
              disabled={loading}
              title="Refresh, and check again who's an LSC admin"
              aria-label="Refresh org list"
            >
              {loading ? <Spinner size={12} /> : <RefreshCw size={14} strokeWidth={1.9} aria-hidden="true" />}
            </button>
          </div>
          {orgs.orgs.length > FILTER_AFTER && (
            <div className="org-menu-filter">
              <Search size={14} strokeWidth={1.9} aria-hidden="true" />
              <input
                type="text"
                placeholder="Find an org"
                aria-label="Find an org"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && shown[0]) choose(shown[0]);
                }}
                autoFocus
                spellCheck={false}
              />
            </div>
          )}
          <div className="org-menu-list" ref={listRef}>
            {orgs.orgs.length === 0 && (
              <div className="org-menu-empty">
                {loading ? "Loading…" : error ? "Couldn't run sf org list." : "No orgs yet. Log in to one below."}
              </div>
            )}
            {orgs.orgs.length > 0 && shown.length === 0 && <div className="org-menu-empty">No orgs match "{filter}".</div>}
            {workspaces.length === 0 && others.length > 0 && !filter.trim() && (
              <div className="org-menu-empty">None of these connections is an LSC admin. Log in as one below.</div>
            )}
            {workspaces.map(renderRow)}
            {others.length > 0 && (
              <>
                <button
                  className="org-menu-group"
                  onClick={() => setShowOthers((v) => !v)}
                  aria-expanded={othersOpen}
                  title="Test users and orgs without LSC: they don't hold the LifeSciencesCommercialAdmin permission set, so Studio and the Admin Console tools won't work as them."
                >
                  <ChevronRight size={14} strokeWidth={1.9} className="org-menu-group-chevron" aria-hidden="true" />
                  <span className="org-menu-group-label">Other connections</span>
                  <span className="count">{others.length}</span>
                </button>
                {othersOpen && others.map(renderRow)}
              </>
            )}
          </div>
          <div className="org-menu-actions">
            {notAdmin && current && (
              <div className="org-menu-notice" role="status">
                <TriangleAlert size={14} strokeWidth={1.9} aria-hidden="true" />
                <span>{orgKey(current)} isn't an LSC admin, so Studio changes and Admin Console tools may not work.</span>
              </div>
            )}
            {sameOrgAdmin && (
              <button className="org-menu-action" onClick={() => choose(sameOrgAdmin)}>
                <ArrowRightLeft size={14} strokeWidth={1.9} aria-hidden="true" />
                Switch to {orgKey(sameOrgAdmin)}
              </button>
            )}
            {needsLogin && (
              <button className="org-menu-action" onClick={loginAgain} disabled={waitingLogin}>
                <LogIn size={14} strokeWidth={1.9} aria-hidden="true" />
                Log in to {label} again
              </button>
            )}
            <button className="org-menu-action" onClick={openInBrowser} disabled={!current || !current.connected || opening}>
              {opening ? <Spinner size={12} /> : <ExternalLink size={14} strokeWidth={1.9} aria-hidden="true" />}
              {opening ? "Opening…" : "Open org in browser"}
            </button>
            <button
              className="org-menu-action"
              onClick={() => setShowLogin((s) => !s)}
              disabled={waitingLogin}
              aria-expanded={showLogin}
            >
              {waitingLogin ? <Spinner size={12} /> : <LogIn size={14} strokeWidth={1.9} aria-hidden="true" />}
              {waitingLogin ? "Waiting for browser login…" : "Log in to another org…"}
            </button>
            {showLogin && !waitingLogin && (
              <div className="org-menu-login ui-enter">
                <input
                  className="ui-field"
                  type="text"
                  placeholder="Alias (optional)"
                  aria-label="Alias"
                  value={loginAlias}
                  onChange={(e) => setLoginAlias(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") startLogin();
                  }}
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
                <button className="studio-btn primary" onClick={startLogin}>
                  Log in
                </button>
              </div>
            )}
            {notice && (
              <div className="org-menu-notice" role="alert">
                <TriangleAlert size={14} strokeWidth={1.9} aria-hidden="true" />
                <span>{notice}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
