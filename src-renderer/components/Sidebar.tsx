import React, { useState, useEffect, useCallback, useRef } from "react";
import { Ellipsis, LayoutGrid, Library, PanelLeft, Pencil, Pin, PinOff, SquarePen, Terminal, Trash2, X } from "lucide-react";
import { rozTileSrc, useAppIcon } from "../app-icon";

interface Conversation {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SidebarProps {
  commands: Array<{ name: string; description: string }>;
  providerType: string;
  activeConversationId: string | null;
  streamingConvIds: Set<string>;
  libraryCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCommandClick: (name: string) => void;
  onNewChat: () => void;
  onLoadConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
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
  libraryCount,
  onCommandClick,
  onNewChat,
  onLoadConversation,
  collapsed,
  onToggleCollapse,
  onDeleteConversation,
  onRenameConversation,
  onTogglePin,
  onOpenLibrary,
  studioActive,
  libraryActive,
  onOpenStudio,
}: SidebarProps) {
  const appIcon = useAppIcon();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showCommands, setShowCommands] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const refreshHistory = useCallback(async () => {
    if (!window.lscApi) return;
    const list = await window.lscApi.listConversations();
    setConversations(list);
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory, activeConversationId]);

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
    onDeleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
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

  if (collapsed) {
    return (
      <div className="sidebar collapsed">
        <div className="sidebar-collapsed-head" />
        <button className="sidebar-collapsed-btn" onClick={onToggleCollapse} title="Show sidebar" aria-label="Show sidebar">
          <PanelLeft size={17} strokeWidth={1.75} />
        </button>
        <div className="sidebar-collapsed-sep" />
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
        {showCommands && renderCommands()}
      </div>
    );
  }

  const pinned = conversations.filter((c) => c.pinned);
  const unpinned = conversations.filter((c) => !c.pinned);

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

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img src={rozTileSrc(appIcon)} alt="" className="sidebar-logo" />
          <h1>Roz</h1>
        </div>
        <button className="ui-icon-btn" onClick={onToggleCollapse} title="Hide sidebar" aria-label="Hide sidebar">
          <PanelLeft size={17} strokeWidth={1.75} />
        </button>
      </div>

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

      <div className="sidebar-sessions">
        {pinned.length > 0 && (
          <>
            <div className="sidebar-section-title">Pinned</div>
            {pinned.map(renderItem)}
          </>
        )}
        {unpinned.length > 0 && (
          <>
            <div className="sidebar-section-title">
              {pinned.length > 0 ? "Recent" : "Sessions"}
            </div>
            {unpinned.map(renderItem)}
          </>
        )}
        {conversations.length === 0 && <div className="sidebar-sessions-empty">Your sessions will appear here.</div>}
      </div>

      {showCommands && renderCommands()}
    </div>
  );
}
