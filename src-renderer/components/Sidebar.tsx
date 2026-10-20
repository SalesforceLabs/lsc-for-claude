import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import {
  Building2,
  ChevronRight,
  Ellipsis,
  LayoutGrid,
  Library,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Search,
  SearchX,
  SquarePen,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { rozTileSrc, useAppIcon } from "../app-icon";
import OrgSwitcher from "./OrgSwitcher";
import ResizeHandle from "./ui/ResizeHandle";
import Segmented from "./ui/Segmented";
import Spinner from "./ui/Spinner";
import StateView from "./ui/StateView";
import { useOrgs } from "../hooks/useOrgs";
import { SIDEBAR_WIDTH } from "../hooks/useSidebarLayout";
import { orgLabel, sameUsername, sessionsElsewhere, type OrgSessions } from "../orgs";
import type { Conversation, OrgScope } from "../types";

/** Remembers whether "Not linked to an org" is expanded; it starts collapsed. */
const UNLINKED_OPEN_KEY = "roz.sidebar.unlinkedOpen";
/** The row-menu id for the "Not linked to an org" section's own menu. */
const UNLINKED_MENU = "section:unlinked";

interface SidebarProps {
  commands: Array<{ name: string; description: string }>;
  providerType: string;
  activeConversationId: string | null;
  streamingConvIds: Set<string>;
  /** The selected org's username ("" for none); undefined until it's known. */
  orgId: string | undefined;
  /** The selected org's name, for the empty state. */
  orgName?: string;
  /** Usernames (lowercased) of orgs with a session running, for the org menu. */
  runningOrgs: Set<string>;
  libraryCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Width when expanded, and how the user changes it by dragging the edge. */
  width: number;
  onResize: (width: number) => void;
  onResetWidth: () => void;
  onCommandClick: (name: string) => void;
  onNewChat: () => void;
  onLoadConversation: (id: string) => void;
  onDeleteConversations: (ids: string[]) => Promise<void>;
  /** Unlinked sessions were moved into the selected org. */
  onSessionsMoved: () => void;
  onRenameConversation: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onOpenLibrary: () => void;
  studioActive: boolean;
  libraryActive: boolean;
  onOpenStudio: () => void;
}

export default function Sidebar({
  commands,
  providerType,
  activeConversationId,
  streamingConvIds,
  orgId,
  orgName,
  runningOrgs,
  libraryCount,
  onCommandClick,
  onNewChat,
  onLoadConversation,
  collapsed,
  onToggleCollapse,
  width,
  onResize,
  onResetWidth,
  onDeleteConversations,
  onSessionsMoved,
  onRenameConversation,
  onTogglePin,
  onOpenLibrary,
  studioActive,
  libraryActive,
  onOpenStudio,
}: SidebarProps) {
  const appIcon = useAppIcon();
  const rootRef = useRef<HTMLDivElement>(null);
  const fullToggleRef = useRef<HTMLButtonElement>(null);
  const railToggleRef = useRef<HTMLButtonElement>(null);
  const refocusToggle = useRef(false);
  const [dragging, setDragging] = useState(false);
  // While the width animates, anything wider than the sidebar is clipped; at rest the org menu may overhang.
  const [animating, setAnimating] = useState(false);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setAnimating(true);
    const t = window.setTimeout(() => setAnimating(false), 300);
    return () => window.clearTimeout(t);
  }, [collapsed]);

  // Toggling from inside the sidebar keeps the keyboard there: the layer that holds focus goes
  // inert, so focus follows to the same toggle on the other layer instead of falling to the page.
  const toggle = useCallback(() => {
    refocusToggle.current = !!rootRef.current?.contains(document.activeElement);
    onToggleCollapse();
  }, [onToggleCollapse]);
  useLayoutEffect(() => {
    if (!refocusToggle.current) return;
    refocusToggle.current = false;
    (collapsed ? railToggleRef : fullToggleRef).current?.focus();
  }, [collapsed]);

  // Cmd+Backslash shows and hides the sidebar, the way Xcode's navigator and Notes' folder list do.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Backslash" || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showCommands, setShowCommands] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const { orgs, select: selectOrg } = useOrgs();
  const [unlinkedOpen, setUnlinkedOpen] = useState(() => localStorage.getItem(UNLINKED_OPEN_KEY) === "1");

  // Search finds a session in this org or any other; opening one from another org switches to it.
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<OrgScope>("org");
  const [results, setResults] = useState<Conversation[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searchRun, setSearchRun] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;

  // The selected org's sessions, plus those from before sessions were tied to an org.
  // When the org has none of its own, every org's, so the empty state can say where they are.
  const [loaded, setLoaded] = useState(false);
  const [allSessions, setAllSessions] = useState<Conversation[]>([]);
  const refreshHistory = useCallback(async () => {
    if (!window.lscApi || orgId === undefined) return;
    const list = await window.lscApi.listConversations("org");
    const own = list.some((c) => c.org);
    setAllSessions(own ? [] : await window.lscApi.listConversations("all"));
    setConversations(list);
    setLoaded(true);
  }, [orgId]);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory, activeConversationId, streamingConvIds]);

  // A new org starts its search in that org, as the Library does.
  useEffect(() => setSearchScope("org"), [orgId]);

  useEffect(() => {
    const q = query.trim();
    if (!q || !window.lscApi || orgId === undefined) {
      setResults(null);
      return;
    }
    // The last results stay up while the next search runs, so typing doesn't flash a spinner.
    let stale = false;
    const timer = setTimeout(() => {
      window.lscApi
        .searchConversations(q, searchScope)
        .then((found) => {
          if (stale) return;
          setResults(found);
          setSearchError("");
        })
        .catch((e) => {
          if (stale) return;
          setResults([]);
          setSearchError(e instanceof Error ? e.message : String(e));
        });
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, searchScope, orgId, searchRun]);

  const clearSearch = () => {
    setQuery("");
    setSearchError("");
  };

  const toggleUnlinked = () => {
    setUnlinkedOpen((open) => {
      localStorage.setItem(UNLINKED_OPEN_KEY, open ? "0" : "1");
      return !open;
    });
  };

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpenId]);

  // Escape closes the commands sheet and the row menu
  useEffect(() => {
    if (!showCommands && !menuOpenId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setShowCommands(false);
      setMenuOpenId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showCommands, menuOpenId]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const handleDelete = (id: string) => {
    setMenuOpenId(null);
    onDeleteConversations([id]);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setResults((prev) => prev && prev.filter((c) => c.id !== id));
  };

  const deleteAll = async (ids: string[]) => {
    setMenuOpenId(null);
    const n = ids.length;
    const what = n === 1 ? "1 session" : `${n} sessions`;
    if (!window.confirm(`Delete ${what} not linked to an org? This can't be undone.`)) return;
    await onDeleteConversations(ids);
    await refreshHistory();
  };

  // Only sessions with no org move; the main process leaves any already in an org alone.
  const moveToOrg = async (ids: string[]) => {
    setMenuOpenId(null);
    const res = await window.lscApi.moveConversationsToOrg(ids);
    if (res.moved) onSessionsMoved();
    await refreshHistory();
    if (searching) setSearchRun((n) => n + 1);
  };

  const handlePin = async (id: string) => {
    setMenuOpenId(null);
    await onTogglePin(id);
    await refreshHistory();
  };

  const startRename = (conv: Conversation) => {
    setMenuOpenId(null);
    setRenamingId(conv.id);
    setRenameValue(conv.title);
  };

  const commitRename = (id: string) => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversations.find((c) => c.id === id)?.title) {
      onRenameConversation(id, trimmed);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c))
      );
    }
    setRenamingId(null);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  const renderCommands = () => (
    <div className="commands-modal-backdrop" onClick={() => setShowCommands(false)}>
      <div className="commands-modal" role="dialog" aria-label="Commands" onClick={(e) => e.stopPropagation()}>
        <div className="commands-modal-header">
          <span className="commands-modal-title">Commands</span>
          <button className="ui-icon-btn" onClick={() => setShowCommands(false)} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="commands-modal-body">
          {commands.map((cmd) => (
            <button
              key={cmd.name}
              className="commands-modal-item"
              onClick={() => { onCommandClick(cmd.name); setShowCommands(false); }}
            >
              <span className="commands-modal-cmd">/lsc:{cmd.name}</span>
              <span className="commands-modal-desc">{cmd.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const toggleTitle = `${collapsed ? "Show" : "Hide"} sidebar (⌘\\)`;

  const rail = (
    <>
        <div className="sidebar-collapsed-head" />
        <button ref={railToggleRef} className="sidebar-collapsed-btn" onClick={toggle} title={toggleTitle} aria-label="Show sidebar" aria-keyshortcuts="Meta+Backslash">
          <PanelLeftOpen size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <div className="sidebar-collapsed-sep" />
        <OrgSwitcher runningOrgs={runningOrgs} compact />
        <button className="sidebar-collapsed-btn" onClick={onNewChat} title="New session" aria-label="New session">
          <SquarePen size={17} strokeWidth={1.75} />
        </button>
        <button className={`sidebar-collapsed-btn${studioActive ? " active" : ""}`} onClick={onOpenStudio} title="Studio" aria-label="Studio">
          <LayoutGrid size={17} strokeWidth={1.75} />
        </button>
        <button className={`sidebar-collapsed-btn${libraryActive ? " active" : ""}`} onClick={onOpenLibrary} title="Library" aria-label="Library">
          <Library size={17} strokeWidth={1.75} />
        </button>
        <button className="sidebar-collapsed-btn" onClick={() => setShowCommands(true)} title="Commands" aria-label="Commands">
          <Terminal size={17} strokeWidth={1.75} />
        </button>
    </>
  );

  const pinned = conversations.filter((c) => c.pinned);
  const recent = conversations.filter((c) => !c.pinned && c.org);
  const unlinked = conversations.filter((c) => !c.pinned && !c.org);
  // The session on screen stays visible even while its section is collapsed.
  const showUnlinked = unlinkedOpen || unlinked.some((c) => c.id === activeConversationId);

  const canMove = !!orgId && !!orgName;

  /** In search across orgs, sessions from another org say which one (opening them switches to it). */
  const elsewhere = (conv: Conversation): conv is Conversation & { org: NonNullable<Conversation["org"]> } =>
    searching && searchScope === "all" && !!conv.org && !(orgId && sameUsername(conv.org.username, orgId));

  const renderItem = (conv: Conversation) => (
    <div
      key={conv.id}
      className={`history-item${conv.id === activeConversationId ? " active" : ""}`}
      onClick={() => onLoadConversation(conv.id)}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {renamingId === conv.id ? (
          <input
            ref={renameInputRef}
            className="history-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => commitRename(conv.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(conv.id);
              if (e.key === "Escape") setRenamingId(null);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="history-item-title" title={conv.title}>
            {streamingConvIds.has(conv.id) && <span className="session-active-dot" />}
            <span className="history-item-text">{conv.title}</span>
            {elsewhere(conv) && (
              <span className="history-item-org" title={`In ${orgLabel(conv.org, orgs)}`}>
                {orgLabel(conv.org, orgs)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="history-item-actions" ref={menuOpenId === conv.id ? menuRef : undefined}>
        <button
          className="history-overflow-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpenId(menuOpenId === conv.id ? null : conv.id);
          }}
          title="More options"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={menuOpenId === conv.id}
        >
          <Ellipsis size={15} strokeWidth={2} />
        </button>
        {menuOpenId === conv.id && (
          <div className="history-overflow-menu" role="menu">
            <button role="menuitem" onClick={(e) => { e.stopPropagation(); handlePin(conv.id); }}>
              {conv.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              {conv.pinned ? "Unpin" : "Pin to top"}
            </button>
            {!conv.org && canMove && (
              <button role="menuitem" onClick={(e) => { e.stopPropagation(); moveToOrg([conv.id]); }}>
                <Building2 size={14} />
                <span className="history-overflow-label">Move to {orgName}</span>
              </button>
            )}
            <button role="menuitem" onClick={(e) => { e.stopPropagation(); startRename(conv); }}>
              <Pencil size={14} />
              Rename
            </button>
            <div className="history-overflow-sep" />
            <button role="menuitem" className="danger" onClick={(e) => { e.stopPropagation(); handleDelete(conv.id); }}>
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const full = (
    <>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img src={rozTileSrc(appIcon)} alt="" className="sidebar-logo" />
          <h1>Roz</h1>
        </div>
        <button ref={fullToggleRef} className="ui-icon-btn" onClick={toggle} title={toggleTitle} aria-label="Hide sidebar" aria-keyshortcuts="Meta+Backslash">
          <PanelLeftClose size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <OrgSwitcher runningOrgs={runningOrgs} />

      <nav className="sidebar-nav">
        <button className="sidebar-nav-item" onClick={onNewChat}>
          <SquarePen size={16} strokeWidth={1.75} />
          <span>New session</span>
        </button>
        <button className={`sidebar-nav-item${studioActive ? " active" : ""}`} onClick={onOpenStudio} aria-current={studioActive ? "page" : undefined}>
          <LayoutGrid size={16} strokeWidth={1.75} />
          <span>Studio</span>
        </button>
        <button className={`sidebar-nav-item${libraryActive ? " active" : ""}`} onClick={onOpenLibrary} aria-current={libraryActive ? "page" : undefined}>
          <Library size={16} strokeWidth={1.75} />
          <span>Library</span>
          {libraryCount > 0 && <span className="sidebar-nav-badge">{libraryCount}</span>}
        </button>
        <button className="sidebar-nav-item" onClick={() => setShowCommands(true)}>
          <Terminal size={16} strokeWidth={1.75} />
          <span>Commands</span>
        </button>
      </nav>

      <div className="sidebar-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") clearSearch();
          }}
          placeholder="Search sessions"
          aria-label="Search sessions"
          spellCheck={false}
        />
        {searching && (
          <button className="ui-icon-btn sm" onClick={() => { clearSearch(); searchInputRef.current?.focus(); }} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="sidebar-sessions">
        {searching ? (
          <>
            <Segmented
              className="sidebar-search-scope"
              size="sm"
              aria-label="Search in"
              value={searchScope}
              onChange={setSearchScope}
              options={[
                { value: "org", label: "This org", title: orgName ? `Sessions in ${orgName}` : undefined },
                { value: "all", label: "All orgs" },
              ]}
            />
            {results === null ? (
              <div className="sidebar-search-status">
                <Spinner size={14} />
              </div>
            ) : searchError ? (
              <StateView
                kind="error"
                layout="inline"
                title="Couldn't search sessions"
                detail={searchError}
                actions={<button className="studio-btn sm" onClick={() => setSearchRun((n) => n + 1)}>Retry</button>}
              />
            ) : results.length === 0 ? (
              <StateView
                kind="empty"
                layout="inline"
                icon={SearchX}
                title="No sessions match"
                detail={searchScope === "org" && orgName ? `Nothing in ${orgName} mentions “${query.trim()}”.` : `No session mentions “${query.trim()}”.`}
                actions={
                  searchScope === "org" ? (
                    <button className="studio-btn sm" onClick={() => setSearchScope("all")}>Search all orgs</button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="sidebar-section-title">
                  {results.length === 1 ? "1 session" : `${results.length} sessions`}
                </div>
                {results.map(renderItem)}
              </>
            )}
          </>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <div className="sidebar-section-title">Pinned</div>
                {pinned.map(renderItem)}
              </>
            )}
            {recent.length > 0 && (
              <>
                <div className="sidebar-section-title">
                  {pinned.length > 0 ? "Recent" : "Sessions"}
                </div>
                {recent.map(renderItem)}
              </>
            )}
            {loaded && recent.length === 0 && pinned.length === 0 && (
              <SessionsEmpty
                hasOrg={!!orgName}
                elsewhere={sessionsElsewhere(allSessions, orgId, orgs)}
                unlinked={unlinked.length}
                onSwitch={(key) => selectOrg(key)}
              />
            )}
            {unlinked.length > 0 && (
              <>
                <div className="sidebar-section-head">
                  <button
                    className="sidebar-section-toggle"
                    onClick={toggleUnlinked}
                    aria-expanded={showUnlinked}
                    title="Sessions from before Roz tied each session to an org. One joins the org you're in when you send it a message, or move them here."
                  >
                    <ChevronRight size={12} className="sidebar-section-chevron" aria-hidden="true" />
                    <span className="sidebar-section-label">Not linked to an org</span>
                    <span className="count">{unlinked.length}</span>
                  </button>
                  <div className="history-item-actions" ref={menuOpenId === UNLINKED_MENU ? menuRef : undefined}>
                    <button
                      className="history-overflow-btn"
                      onClick={() => setMenuOpenId(menuOpenId === UNLINKED_MENU ? null : UNLINKED_MENU)}
                      aria-label="Sessions not linked to an org: more options"
                      aria-haspopup="menu"
                      aria-expanded={menuOpenId === UNLINKED_MENU}
                    >
                      <Ellipsis size={15} strokeWidth={2} />
                    </button>
                    {menuOpenId === UNLINKED_MENU && (
                      <div className="history-overflow-menu wide" role="menu">
                        {canMove && (
                          <>
                            <button role="menuitem" onClick={() => moveToOrg(unlinked.map((c) => c.id))}>
                              <Building2 size={14} />
                              <span className="history-overflow-label">Move all to {orgName}</span>
                            </button>
                            <div className="history-overflow-sep" />
                          </>
                        )}
                        <button role="menuitem" className="danger" onClick={() => deleteAll(unlinked.map((c) => c.id))}>
                          <Trash2 size={14} />
                          {unlinked.length === 1 ? "Delete 1 session…" : `Delete ${unlinked.length} sessions…`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {showUnlinked && unlinked.map(renderItem)}
              </>
            )}
          </>
        )}
      </div>
    </>
  );

  // Both layers are always mounted so the width can animate between them; the one that isn't
  // showing is inert (no focus, not read out) and fades out.
  const inertAttr = (off: boolean) => ({ inert: off ? "" : undefined } as Record<string, string | undefined>);
  return (
    <div
      ref={rootRef}
      className={`sidebar${collapsed ? " collapsed" : ""}${dragging ? " resizing" : ""}${animating ? " animating" : ""}`}
      style={{ "--sidebar-width": `${width}px` } as React.CSSProperties}
    >
      <div className="sidebar-layer sidebar-full" aria-hidden={collapsed} {...inertAttr(collapsed)}>
        {full}
      </div>
      <div className="sidebar-layer sidebar-rail" aria-hidden={!collapsed} {...inertAttr(!collapsed)}>
        {rail}
      </div>
      {!collapsed && (
        <ResizeHandle
          value={width}
          min={SIDEBAR_WIDTH.min}
          max={SIDEBAR_WIDTH.max}
          onChange={onResize}
          onReset={onResetWidth}
          onDragging={setDragging}
          label="Resize sidebar"
        />
      )}
      {showCommands && renderCommands()}
    </div>
  );
}

/** The org has no sessions of its own: say where the user's sessions are, and offer to go there. */
function SessionsEmpty({
  hasOrg,
  elsewhere,
  unlinked,
  onSwitch,
}: {
  hasOrg: boolean;
  elsewhere: { total: number; orgs: OrgSessions[] };
  unlinked: number;
  onSwitch: (key: string) => void;
}) {
  const shown = elsewhere.orgs.slice(0, 3);
  const parts: string[] = [];
  if (elsewhere.total > 0) {
    parts.push(elsewhere.total === 1 ? "You have 1 session in another org." : `You have ${elsewhere.total} in other orgs.`);
  }
  if (unlinked > 0) parts.push(unlinked === 1 ? "An older one, not linked to an org, is below." : "Older ones not linked to an org are below.");
  if (!parts.length) parts.push(hasOrg ? "Ask Roz something about this org to start one." : "Ask Roz something to start one.");
  return (
    <StateView
      kind="empty"
      layout="inline"
      className="sidebar-sessions-empty"
      icon={MessagesSquare}
      title={hasOrg ? "No sessions in this org yet" : "No sessions yet"}
      detail={parts.join(" ")}
      actions={
        shown.length > 0 ? (
          <div className="sidebar-sessions-empty-orgs">
            {shown.map((o) => (
              <button
                key={o.key}
                className="studio-btn sm"
                onClick={() => onSwitch(o.key)}
                title={`Switch to ${o.key} (${o.count === 1 ? "1 session" : `${o.count} sessions`})`}
              >
                <span className="sidebar-sessions-empty-org">Go to {o.key}</span>
                <span className="count">{o.count}</span>
              </button>
            ))}
          </div>
        ) : undefined
      }
    />
  );
}
