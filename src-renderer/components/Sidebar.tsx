import React, { useState, useEffect, useCallback, useRef } from "react";

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
  onOpenStudio,
}: SidebarProps) {
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

  if (collapsed) {
    return (
      <div className="sidebar collapsed">
        <button className="sidebar-expand-btn" onClick={onToggleCollapse} title="Expand sidebar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button className="sidebar-collapsed-btn" onClick={onNewChat} title="New Session">
          <IconPlus />
        </button>
        <button className="sidebar-collapsed-btn" onClick={onOpenStudio} title="Studio">
          <IconStudio />
        </button>
        <button className="sidebar-collapsed-btn" onClick={onOpenLibrary} title="Library">
          <IconLibrary />
        </button>
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
          <div
            className="history-item-title"
            style={{
              color:
                conv.id === activeConversationId
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
            }}
          >
            {streamingConvIds.has(conv.id) && (
              <span className="session-active-dot" />
            )}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {conv.title}
            </span>
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
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
          </svg>
        </button>
        {menuOpenId === conv.id && (
          <div className="history-overflow-menu">
            <button onClick={(e) => { e.stopPropagation(); handlePin(conv.id); }}>
              {conv.pinned ? "Unpin" : "Pin to top"}
            </button>
            <button onClick={(e) => { e.stopPropagation(); startRename(conv); }}>
              Rename
            </button>
            <button className="danger" onClick={(e) => { e.stopPropagation(); handleDelete(conv.id); }}>
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src="lsc-logo-2026.png" alt="" className="sidebar-logo" />
            <h1>LSC Assistant</h1>
          </div>
          <button className="sidebar-collapse-btn" onClick={onToggleCollapse} title="Collapse sidebar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Navigation menu items */}
      <div className="sidebar-nav">
        <button className="sidebar-nav-item" onClick={onNewChat}>
          <IconPlus />
          <span>New session</span>
        </button>
        <button className={`sidebar-nav-item${studioActive ? " active" : ""}`} onClick={onOpenStudio}>
          <IconStudio />
          <span>Studio</span>
        </button>
        <button className="sidebar-nav-item" onClick={onOpenLibrary}>
          <IconLibrary />
          <span>Library</span>
          {libraryCount > 0 && <span className="sidebar-nav-badge">{libraryCount}</span>}
        </button>
        <button className="sidebar-nav-item" onClick={() => setShowCommands(true)}>
          <IconTerminal />
          <span>Commands</span>
        </button>
      </div>

      {/* Session history */}
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
      </div>

      {/* Commands Modal */}
      {showCommands && (
        <div className="commands-modal-backdrop" onClick={() => setShowCommands(false)}>
          <div className="commands-modal" onClick={(e) => e.stopPropagation()}>
            <div className="commands-modal-header">
              <span className="commands-modal-title">Commands</span>
              <button className="commands-modal-close" onClick={() => setShowCommands(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
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
      )}
    </div>
  );
}

/* ─── Icons ─── */

const iconProps = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function IconPlus() {
  return (
    <svg {...iconProps}>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconLibrary() {
  return (
    <svg {...iconProps}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function IconStudio() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" /><path d="M10 6.5h4M17.5 10v4" />
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg {...iconProps}>
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

