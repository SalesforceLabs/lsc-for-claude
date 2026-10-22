import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen, Code, FileText, LayoutGrid, List, Maximize2, MessageSquare, Minimize2, Search, Table2, Trash2, Workflow, X,
  type LucideIcon,
} from "lucide-react";
import { useDiagramControls, DiagramZoomToolbar, DiagramViewport } from "./ChatView";
import StateView from "./ui/StateView";
import Segmented from "./ui/Segmented";
import { sanitizeSavedSvg, useMermaidSvg } from "../mermaid";
import type { LibraryItem, OrgScope } from "../types";

interface LibraryPanelProps {
  items: LibraryItem[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  /** This org's items (plus those tied to none), or every org's. */
  scope: OrgScope;
  onScopeChange: (scope: OrgScope) => void;
  /** The selected org's name, for the empty state. */
  orgName?: string;
  /** How to name an item's org: its connection's current alias if it's still there. */
  labelOrg: (item: LibraryItem) => string;
  onClose: () => void;
  onDelete: (id: string) => void;
  onSearch: (query: string) => void;
  onGoToSession: (conversationId: string) => void;
  focusItemId?: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  response: "Response",
  code: "Code",
  diagram: "Diagram",
  table: "Table",
};

const TYPE_ICONS: Record<string, LucideIcon> = {
  diagram: Workflow,
  code: Code,
  table: Table2,
  response: FileText,
};

function TypeIcon({ type }: { type: string }) {
  const Icon = TYPE_ICONS[type] ?? FileText;
  return <Icon size={16} strokeWidth={1.75} aria-hidden="true" />;
}

function formatDate(dateStr: string) {
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
}

/** A saved diagram drawn in the current palette; the SVG saved with it shows until that's ready. */
function useLibrarySvg(item: LibraryItem): string {
  const drawn = useMermaidSvg(item.content).svg;
  return useMemo(() => drawn ?? (item.svg ? sanitizeSavedSvg(item.svg) : ""), [drawn, item.svg]);
}

function LibraryCardDiagram({ item }: { item: LibraryItem }) {
  return <div className="library-card-svg" dangerouslySetInnerHTML={{ __html: useLibrarySvg(item) }} />;
}

function LibraryDiagramDetail({ item }: { item: LibraryItem }) {
  const svg = useLibrarySvg(item);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const controls = useDiagramControls();

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const fullscreenBtn = (
    <button
      onClick={() => setIsFullscreen((f) => !f)}
      title={isFullscreen ? "Exit full screen" : "Full screen"}
      aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
    >
      {isFullscreen ? <Minimize2 size={14} strokeWidth={1.9} aria-hidden="true" /> : <Maximize2 size={14} strokeWidth={1.9} aria-hidden="true" />}
    </button>
  );

  if (isFullscreen) {
    return (
      <div className="mermaid-panel mermaid-panel-fullscreen">
        <div className="mermaid-panel-header drag-region">
          <span className="mermaid-card-label">
            <Workflow size={15} strokeWidth={1.75} aria-hidden="true" />
            Diagram
          </span>
          <DiagramZoomToolbar controls={controls} extraButtons={fullscreenBtn} />
        </div>
        <DiagramViewport svg={svg} controls={controls} />
      </div>
    );
  }

  return (
    <>
      <div className="library-detail-diagram-toolbar">
        <DiagramZoomToolbar controls={controls} extraButtons={fullscreenBtn} />
      </div>
      <div className="library-detail-diagram-viewport">
        <DiagramViewport svg={svg} controls={controls} />
      </div>
    </>
  );
}

export default function LibraryPanel({
  items,
  loading,
  error,
  onRetry,
  scope,
  onScopeChange,
  orgName,
  labelOrg,
  onClose,
  onDelete,
  onSearch,
  onGoToSession,
  focusItemId,
}: LibraryPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(focusItemId ?? null);
  const [viewMode, setViewMode] = useState<"list" | "cards">("cards");
  const [searchQuery, setSearchQuery] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const detailPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusItemId) setSelectedId(focusItemId);
  }, [focusItemId]);

  // Close on Escape — close detail first, then library
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedId) {
          setSelectedId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, selectedId]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => onSearch(q), 300);
  }, [onSearch]);

  const handleDelete = useCallback((id: string) => {
    onDelete(id);
    if (selectedId === id) setSelectedId(null);
  }, [onDelete, selectedId]);

  const selectedItem = selectedId ? items.find((i) => i.id === selectedId) : null;

  // Resize detail panel
  const [detailWidth, setDetailWidth] = useState<number | null>(null);
  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = detailPanelRef.current?.offsetWidth || 500;
    const onMove = (ev: PointerEvent) => {
      const newWidth = Math.max(280, Math.min(startWidth - (ev.clientX - startX), window.innerWidth - 400));
      setDetailWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  return (
    <div className={`library-panel${selectedItem ? " with-detail" : ""}`}>
      {/* Main list area */}
      <div className="library-main">
        <div className="library-panel-header drag-region">
          <span className="library-panel-title">Library</span>
          <Segmented
            size="sm"
            aria-label="Show items from"
            value={scope}
            onChange={onScopeChange}
            options={[
              { value: "org", label: "This org", title: orgName ? `Items from ${orgName}` : undefined },
              { value: "all", label: "All orgs" },
            ]}
          />
          <label className="library-search">
            <Search size={14} strokeWidth={1.9} aria-hidden="true" />
            <input
              type="text"
              placeholder="Search saved items"
              aria-label="Search saved items"
              value={searchQuery}
              onChange={handleSearchChange}
              spellCheck={false}
            />
          </label>
          <Segmented
            size="md"
            aria-label="View"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: "list", label: <span className="sr-only">List</span>, icon: List, title: "List view" },
              { value: "cards", label: <span className="sr-only">Cards</span>, icon: LayoutGrid, title: "Card view" },
            ]}
          />
          <button className="ui-icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close Library">
            <X size={16} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>

        <div className="library-panel-body">
          {error && items.length === 0 ? (
            <StateView
              kind="error"
              title="Couldn't load the Library"
              detail={error}
              actions={<button className="studio-btn" onClick={onRetry}>Retry</button>}
            />
          ) : loading && items.length === 0 ? (
            <StateView kind="loading" title="Loading saved items…" />
          ) : items.length === 0 ? (
            <StateView
              kind="empty"
              icon={searchQuery ? Search : BookOpen}
              title={searchQuery ? "No results" : scope === "org" && orgName ? `Nothing saved in ${orgName} yet` : "Nothing saved yet"}
              detail={
                searchQuery
                  ? `No saved items ${scope === "org" ? "in this org " : ""}match “${searchQuery}”.`
                  : scope === "org"
                  ? "Save diagrams from this org's sessions with the bookmark on a diagram card. Items from other orgs are under All orgs."
                  : "Save diagrams from your sessions with the bookmark on a diagram card."
              }
              actions={
                scope === "org" ? (
                  <button className="studio-btn" onClick={() => onScopeChange("all")}>
                    Show all orgs
                  </button>
                ) : undefined
              }
            />
          ) : viewMode === "list" ? (
            <div className="library-list">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`library-list-item${selectedId === item.id ? " selected" : ""}`}
                  onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}
                >
                  <span className="library-list-icon"><TypeIcon type={item.contentType} /></span>
                  <div className="library-list-info">
                    <span className="library-list-title">{item.title}</span>
                    <span className="library-list-meta">
                      {scope === "all" && <>{labelOrg(item)} &middot; </>}
                      {TYPE_LABELS[item.contentType] || item.contentType}
                      {item.sourceConversationTitle && <> &middot; {item.sourceConversationTitle}</>}
                      {" "}&middot; {formatDate(item.createdAt)}
                    </span>
                  </div>
                  <button
                    className="ui-icon-btn sm library-row-delete"
                    onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                    title="Delete"
                    aria-label={`Delete ${item.title}`}
                  >
                    <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="library-cards">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`library-card${selectedId === item.id ? " selected" : ""}`}
                  onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}
                >
                  <div className="library-card-preview">
                    {item.contentType === "diagram" && item.svg ? (
                      <LibraryCardDiagram item={item} />
                    ) : (
                      <div className="library-card-text">
                        {item.content.slice(0, 200)}
                      </div>
                    )}
                  </div>
                  <div className="library-card-footer">
                    <span className="library-card-icon"><TypeIcon type={item.contentType} /></span>
                    <span className="library-card-title">{item.title}</span>
                    {scope === "all" && (
                      <span className="ui-pill library-card-org" title={item.org?.username}>
                        {labelOrg(item)}
                      </span>
                    )}
                    <button
                      className="ui-icon-btn sm library-row-delete"
                      onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                      title="Delete"
                      aria-label={`Delete ${item.title}`}
                    >
                      <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel (right side) */}
      {selectedItem && (
        <div className="library-detail" ref={detailPanelRef} style={detailWidth ? { width: detailWidth } : undefined}>
          <div className="library-detail-resize" onPointerDown={onResizePointerDown} />
          <div className="library-detail-header drag-region">
            <div className="library-detail-title-row">
              <span className="library-detail-icon"><TypeIcon type={selectedItem.contentType} /></span>
              <span className="library-detail-title">{selectedItem.title}</span>
            </div>
            <div className="library-detail-actions">
              {selectedItem.sourceConversationId && (
                <button
                  className="ui-icon-btn"
                  onClick={() => onGoToSession(selectedItem.sourceConversationId!)}
                  title={selectedItem.sourceConversationTitle ? `Go to "${selectedItem.sourceConversationTitle}"` : "Go to session"}
                  aria-label="Go to session"
                >
                  <MessageSquare size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
              <button
                className="ui-icon-btn danger"
                onClick={() => handleDelete(selectedItem.id)}
                title="Delete item"
                aria-label="Delete item"
              >
                <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <button
                className="ui-icon-btn"
                onClick={() => setSelectedId(null)}
                title="Close panel"
                aria-label="Close panel"
              >
                <X size={16} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="library-detail-meta">
            {TYPE_LABELS[selectedItem.contentType] || selectedItem.contentType}
            {selectedItem.sourceConversationTitle && selectedItem.sourceConversationId && (
              <> &middot; from <a
                className="library-detail-session-link"
                onClick={(e) => { e.preventDefault(); onGoToSession(selectedItem.sourceConversationId!); }}
              >{selectedItem.sourceConversationTitle}</a></>
            )}
            {" "}&middot; {labelOrg(selectedItem)} &middot; {formatDate(selectedItem.createdAt)}
          </div>
          {selectedItem.contentType === "diagram" && selectedItem.svg ? (
            <LibraryDiagramDetail item={selectedItem} />
          ) : (
            <div className="library-detail-body">
              <div className="message-content">
                <Markdown remarkPlugins={[remarkGfm]}>{selectedItem.content}</Markdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
