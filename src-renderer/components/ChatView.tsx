import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import mermaid from "mermaid";
import { ChatMessage, ContentBlock, ToolCall, ImageAttachment, getFullText } from "../hooks/useChat";
import { pickModel, type ModelOption } from "../models";

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    darkMode: true,
    background: "#0a0f1a",
    primaryColor: "#3b82f6",
    primaryTextColor: "#f1f5f9",
    primaryBorderColor: "#2563eb",
    lineColor: "#64748b",
    secondaryColor: "#1f2937",
    tertiaryColor: "#111827",
  },
  flowchart: { htmlLabels: true, curve: "basis" },
  securityLevel: "loose",
});

/**
 * Wrap ASCII art / diagram blocks in code fences so the Markdown
 * renderer doesn't mangle them (e.g., treating | as table syntax).
 *
 * Detects: Unicode box-drawing, +---+ borders, structural | lines,
 * arrow patterns, and keeps blank lines inside a diagram block.
 */
function preprocessMarkdown(text: string): string {
  // Already inside a fenced code block — skip those regions entirely
  const BOX_CHARS = /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬╭╮╰╯▼▲◆●○►◄]/;
  const ASCII_BORDER = /^[\s]*\+[-=+]+\+\s*$/;
  const ARROW = /--|->|<-|=>|==>|<==|──|──>|<──|═|═>|<═/;
  // A line that looks structural: has | used as a vertical border (not markdown table)
  // Heuristic: line has | and is mostly whitespace/structural chars, or has multiple |
  const STRUCTURAL_PIPE = /^\s*\|/;
  const MULTI_PIPE = /\|.*\|/;
  // Lines that are primarily made of diagram characters
  const DIAGRAM_LINE = /^[\s|/\\+\-=_:.<>^v*#]+$/;

  // Markdown thematic breaks: ---, ***, ___ (optionally with spaces)
  const THEMATIC_BREAK = /^\s*([-*_])\s*\1\s*\1\s*$/;
  // Table separator row: | --- | --- | or |:---:|
  const TABLE_SEPARATOR = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/;

  const lines = text.split("\n");

  // Pre-scan: identify markdown table regions so we never wrap them as diagrams
  const tableLineSet = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (TABLE_SEPARATOR.test(lines[i])) {
      tableLineSet.add(i); // separator
      if (i > 0) tableLineSet.add(i - 1); // header row
      for (let j = i + 1; j < lines.length; j++) {
        if (MULTI_PIPE.test(lines[j])) {
          tableLineSet.add(j);
        } else {
          break;
        }
      }
    }
  }

  function isDiagramLine(line: string, lineIdx: number): boolean {
    // Never wrap markdown tables or horizontal rules as diagram
    if (tableLineSet.has(lineIdx)) return false;
    if (THEMATIC_BREAK.test(line)) return false;
    if (BOX_CHARS.test(line)) return true;
    if (ASCII_BORDER.test(line)) return true;
    if (ARROW.test(line) && !line.startsWith("#")) return true;
    if (STRUCTURAL_PIPE.test(line)) return true;
    if (MULTI_PIPE.test(line)) return true;
    // Line is almost entirely structural characters (and at least 5 chars long)
    if (line.trim().length >= 5 && DIAGRAM_LINE.test(line)) return true;
    return false;
  }
  const result: string[] = [];
  let inBlock = false;
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Track existing code fences to avoid double-wrapping
    if (/^```/.test(line.trim())) {
      inCodeFence = !inCodeFence;
      if (inBlock) {
        result.push("```");
        inBlock = false;
      }
      result.push(line);
      continue;
    }

    if (inCodeFence) {
      result.push(line);
      continue;
    }

    const isDiag = isDiagramLine(line, i);

    if (isDiag && !inBlock) {
      result.push("```");
      result.push(line);
      inBlock = true;
    } else if (inBlock) {
      if (isDiag) {
        result.push(line);
      } else if (line.trim() === "") {
        // Blank line — peek ahead to see if diagram continues
        result.push(line);
      } else {
        // Non-diagram, non-blank line — close the block
        result.push("```");
        inBlock = false;
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }

  if (inBlock) result.push("```");

  // Clean up: remove trailing blank lines inside code fences
  // (blank lines right before ``` closing)
  return result.join("\n").replace(/\n\n+```/g, "\n```");
}

/** Derive a meaningful title from mermaid chart source */
function deriveDiagramTitle(chart: string): string {
  const lines = chart.trim().split("\n");
  const first = lines[0]?.trim() ?? "";

  // Extract diagram type from first line (e.g., "graph TD", "sequenceDiagram", "flowchart LR")
  const typeMatch = first.match(/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitgraph|journey|mindmap|timeline|quadrantChart|sankey|xychart|block)/i);
  const typeLabels: Record<string, string> = {
    graph: "Flowchart",
    flowchart: "Flowchart",
    sequencediagram: "Sequence Diagram",
    classdiagram: "Class Diagram",
    statediagram: "State Diagram",
    erdiagram: "ER Diagram",
    gantt: "Gantt Chart",
    pie: "Pie Chart",
    gitgraph: "Git Graph",
    journey: "User Journey",
    mindmap: "Mind Map",
    timeline: "Timeline",
    quadrantchart: "Quadrant Chart",
    sankey: "Sankey Diagram",
    xychart: "XY Chart",
    block: "Block Diagram",
  };
  const diagramType = typeMatch ? typeLabels[typeMatch[1].toLowerCase()] || "Diagram" : "Diagram";

  // Try to find a title directive: "title Some Title"
  const titleLine = lines.find((l) => /^\s*title\s+/i.test(l));
  if (titleLine) {
    const title = titleLine.replace(/^\s*title\s+/i, "").trim();
    if (title) return title;
  }

  // Extract first meaningful node label from the chart
  // Matches: A[Label], A(Label), A{Label}, A["Label"], A((Label))
  const labelMatch = chart.match(/[\w]+\s*[\[({]+\s*"?([^"\]})]+)"?\s*[\]})]/);
  if (labelMatch?.[1]) {
    const label = labelMatch[1].trim();
    if (label.length > 3 && label.length <= 50) {
      return `${diagramType}: ${label}`;
    }
  }

  return diagramType;
}

/** Group consecutive tool blocks together so they can be collapsed as one unit. */
type BlockGroup =
  | { type: "text"; text: string }
  | { type: "tools"; tools: ToolCall[] };

function groupBlocks(blocks: ContentBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      groups.push({ type: "text", text: block.text });
    } else {
      const last = groups[groups.length - 1];
      if (last && last.type === "tools") {
        last.tools.push(block.tool);
      } else {
        groups.push({ type: "tools", tools: [block.tool] });
      }
    }
  }
  return groups;
}

/** Summarize tool names: "check_lsc_setup, describe_sobject x7, run_soql" */
function summarizeTools(tools: ToolCall[]): string {
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t.name, (counts.get(t.name) || 0) + 1);
  return Array.from(counts.entries())
    .map(([name, count]) => (count > 1 ? `${name} \u00d7${count}` : name))
    .join(", ");
}

/** Inline mermaid card — renders SVG, calls onOpen when clicked */
let mermaidIdCounter = 0;
/** Cache rendered SVGs so re-mounts don't flash "Generating..." */
const mermaidSvgCache = new Map<string, string>();

/** Offscreen container for mermaid.render() so temp SVGs never flash on screen */
function getMermaidContainer(): HTMLElement {
  let el = document.getElementById("mermaid-offscreen");
  if (!el) {
    el = document.createElement("div");
    el.id = "mermaid-offscreen";
    el.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;";
    document.body.appendChild(el);
  }
  return el;
}

function MermaidDiagram({ chart, onOpen, onSave, saved }: { chart: string; onOpen?: (svg: string) => void; onSave?: (svg: string, chart: string) => void; saved?: boolean }) {
  const [svg, setSvg] = useState<string | null>(() => mermaidSvgCache.get(chart.trim()) ?? null);
  const [error, setError] = useState<string | null>(null);
  const renderAttempt = useRef(0);

  useEffect(() => {
    const trimmed = chart.trim();
    const cached = mermaidSvgCache.get(trimmed);
    if (cached) { setSvg(cached); return; }

    const attempt = ++renderAttempt.current;
    const timer = setTimeout(async () => {
      if (attempt !== renderAttempt.current) return;
      const id = `mermaid-${++mermaidIdCounter}-${Date.now()}`;
      try {
        const container = getMermaidContainer();
        const { svg: rendered } = await mermaid.render(id, trimmed, container);
        if (attempt === renderAttempt.current) {
          mermaidSvgCache.set(trimmed, rendered);
          setSvg(rendered);
          setError(null);
        }
      } catch {
        document.getElementById(`d${id}`)?.remove();
        getMermaidContainer().innerHTML = "";
        if (attempt === renderAttempt.current && chart.includes("\n")) {
          setError("Diagram syntax error");
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [chart]);

  if (error) {
    return (
      <pre className="mermaid-fallback">
        <code>{chart}</code>
      </pre>
    );
  }

  return (
    <div className="mermaid-card" onClick={() => svg && onOpen?.(svg)}>
      <div className="mermaid-card-header">
        <span className="mermaid-card-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" />
          </svg>
        </span>
        <div className="mermaid-card-info">
          <span className="mermaid-card-title">Diagram</span>
          <span className="mermaid-card-meta">
            {!svg ? (
              <><span className="mermaid-inline-dot" /> Generating...</>
            ) : saved ? (
              "Saved to Library"
            ) : (
              "Click to explore"
            )}
          </span>
        </div>
        {svg && onSave && (
          <button
            className={`mermaid-save-btn${saved ? " mermaid-save-btn-saved" : ""}`}
            onClick={(e) => { e.stopPropagation(); if (!saved) onSave(svg, chart); }}
            title={saved ? "Saved to Library" : "Save to Library"}
          >
            {saved ? <IconBookmarkFilled /> : <IconBookmark />}
          </button>
        )}
      </div>
    </div>
  );
}

/** Reusable zoom/pan controls for SVG diagrams. Renders a toolbar + viewport. */
export function useDiagramControls() {
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const diagramRef = useRef<HTMLDivElement>(null);

  const zoomIn = useCallback(() => setZoom((z) => z + 0.25), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.25, 0.1)), []);
  const zoomReset = useCallback(() => setZoom(1), []);
  const zoomFit = useCallback(() => {
    const vp = viewportRef.current;
    const diag = diagramRef.current;
    if (!vp || !diag) return;
    const svgEl = diag.querySelector("svg");
    const naturalW = svgEl ? svgEl.getBoundingClientRect().width / zoom : diag.scrollWidth / zoom;
    const naturalH = svgEl ? svgEl.getBoundingClientRect().height / zoom : diag.scrollHeight / zoom;
    if (naturalW === 0 || naturalH === 0) return;
    const fitZoom = Math.min(vp.clientWidth / naturalW, vp.clientHeight / naturalH);
    setZoom(Math.max(0.1, fitZoom * 0.95));
  }, [zoom]);

  const panState = useRef({ active: false, startX: 0, startY: 0, scrollX: 0, scrollY: 0 });
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const vp = viewportRef.current;
    if (!vp) return;
    panState.current = { active: true, startX: e.clientX, startY: e.clientY, scrollX: vp.scrollLeft, scrollY: vp.scrollTop };
    vp.setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const ps = panState.current;
    if (!ps.active) return;
    const vp = viewportRef.current;
    if (!vp) return;
    vp.scrollLeft = ps.scrollX - (e.clientX - ps.startX);
    vp.scrollTop = ps.scrollY - (e.clientY - ps.startY);
  }, []);
  const onPointerUp = useCallback(() => { panState.current.active = false; }, []);
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom((z) => Math.max(0.1, z - e.deltaY * 0.002));
    }
  }, []);

  return { zoom, zoomIn, zoomOut, zoomReset, zoomFit, viewportRef, diagramRef, onPointerDown, onPointerMove, onPointerUp, onWheel };
}

export function DiagramZoomToolbar({ controls, extraButtons }: {
  controls: ReturnType<typeof useDiagramControls>;
  extraButtons?: React.ReactNode;
}) {
  const { zoom, zoomIn, zoomOut, zoomReset, zoomFit } = controls;
  return (
    <div className="mermaid-zoom-controls">
      <button onClick={zoomOut} title="Zoom out" disabled={zoom <= 0.1}>−</button>
      <button onClick={zoomReset} title="Reset zoom">{Math.round(zoom * 100)}%</button>
      <button onClick={zoomIn} title="Zoom in">+</button>
      <button onClick={zoomFit} title="Fit in window">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </button>
      {extraButtons}
    </div>
  );
}

export function DiagramViewport({ svg, controls }: { svg: string; controls: ReturnType<typeof useDiagramControls> }) {
  const { zoom, viewportRef, diagramRef, onPointerDown, onPointerMove, onPointerUp, onWheel } = controls;
  return (
    <div
      className="mermaid-panel-viewport"
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <div
        ref={diagramRef}
        className="mermaid-diagram"
        style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

/** Side panel viewer for mermaid diagrams — sits alongside the chat area */
function MermaidViewerPanel({ svg, onClose }: { svg: string; onClose: () => void }) {
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const controls = useDiagramControls();

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelRef.current?.offsetWidth || 500;
    const onMove = (ev: PointerEvent) => {
      const newWidth = Math.max(280, Math.min(startWidth - (ev.clientX - startX), window.innerWidth - 300));
      setPanelWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isFullscreen) setIsFullscreen(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isFullscreen]);

  const fullscreenBtn = (
    <button onClick={() => setIsFullscreen((f) => !f)} title={isFullscreen ? "Exit full screen" : "Full screen"}>
      {isFullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
    </button>
  );

  return (
    <div
      className={`mermaid-panel${isFullscreen ? " mermaid-panel-fullscreen" : ""}`}
      ref={panelRef}
      style={!isFullscreen && panelWidth ? { width: panelWidth } : undefined}
    >
      {!isFullscreen && <div className="mermaid-panel-resize" onPointerDown={onResizePointerDown} />}
      <div className="mermaid-panel-header">
        <span className="mermaid-card-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" />
          </svg>
          Diagram
        </span>
        <DiagramZoomToolbar controls={controls} extraButtons={fullscreenBtn} />
        <button className="mermaid-close-btn" onClick={onClose} title="Close (Esc)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <DiagramViewport svg={svg} controls={controls} />
    </div>
  );
}

/** Side panel viewer for documents — renders PDFs natively or markdown content */
function DocViewerPanel({
  title, content, path, onClose,
  guideSlug, guideTitle, pdfFileName, pdfPath, page, startPage, endPage,
}: {
  title: string; content: string; path: string; onClose: () => void;
  guideSlug?: string; guideTitle?: string; pdfFileName?: string; pdfPath?: string;
  page?: number; startPage?: number; endPage?: number;
}) {
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = panelRef.current?.offsetWidth || 500;
    const onMove = (ev: PointerEvent) => {
      const newWidth = Math.max(280, Math.min(startWidth - (ev.clientX - startX), window.innerWidth - 300));
      setPanelWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      setIsResizing(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isGuide = !!guideSlug;
  const hasPdf = !!pdfPath;
  const isMarkdown = path.endsWith(".md") && !hasPdf;

  // Build a file:// URL for the webview — Chromium's native PDF viewer handles #page=N
  const pdfFileUrl = hasPdf ? `file://${pdfPath}#page=${page || startPage || 1}` : "";

  return (
    <div className="doc-panel" ref={panelRef} style={panelWidth ? { width: panelWidth } : undefined}>
      <div className="mermaid-panel-resize" onPointerDown={onResizePointerDown} />
      <div className="doc-panel-header">
        <div className="doc-panel-title-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="doc-panel-title">{title}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {isGuide && pdfFileName && (
            <button
              className="doc-panel-pdf-btn"
              title="Open in Preview"
              onClick={() => window.lscApi.openPdfAtPage(pdfFileName, page || startPage || 1)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Open in Preview
            </button>
          )}
          <button className="mermaid-close-btn" onClick={onClose} title="Close (Esc)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div className="doc-panel-meta">
        {isGuide ? (
          <span className="doc-panel-guide">
            {guideTitle}{startPage && endPage ? ` — pages ${startPage}–${endPage}` : ""}
          </span>
        ) : (
          path
        )}
      </div>
      {hasPdf ? (
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {isResizing && <div style={{ position: "absolute", inset: 0, zIndex: 10 }} />}
          <webview
            key={pdfFileUrl}
            className="doc-panel-pdf-iframe"
            src={pdfFileUrl}
            // @ts-expect-error webview is an Electron-specific element not in React types
            plugins="true"
          />
        </div>
      ) : (
        <div className="doc-panel-body" ref={bodyRef}>
          {isMarkdown ? (
            <div className="message-content">
              <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} urlTransform={(url: string) => url}>
                {content}
              </Markdown>
            </div>
          ) : (
            <pre className="doc-panel-pre">{content}</pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Copy text to clipboard, show brief confirmation */
function useCopyAction() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);
  return { copiedId, copy };
}

/** Convert an HTML table element to tab-separated text for pasting into sheets */
function tableToText(table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  return rows
    .map((row) =>
      Array.from(row.querySelectorAll("th, td"))
        .map((cell) => cell.textContent?.trim() ?? "")
        .join("\t")
    )
    .join("\n");
}

interface LibraryItem {
  id: string;
  title: string;
  content: string;
  contentType: "response" | "code" | "diagram" | "table";
  svg?: string;
  sourceConversationId?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface ChatViewProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  commands: Array<{ name: string; description: string }>;
  conversationId: string | null;
  defaultModel?: string;
  /** The models the connection offers (see modelOptionsFor). */
  modelOptions: ModelOption[];
  onSend: (text: string, model?: string, images?: ImageAttachment[]) => void;
  onAbort: () => void;
  onRerun: (text: string) => void;
  onToggleTool: (messageId: string, toolId: string) => void;
  onSaveToLibrary: (input: { title: string; content: string; contentType: LibraryItem["contentType"]; svg?: string; sourceConversationId?: string }) => void;
  savedDiagramContents?: Set<string>;
  prefillInput?: string;
  onPrefillConsumed?: () => void;
}

/** Persistent scroll positions keyed by conversationId. Lives outside the component. */
const scrollPositions = new Map<string, number>();

/** Persistent doc panel state keyed by conversationId. */
type DocPanelState = {
  title: string;
  content: string;
  path: string;
  guideSlug?: string;
  guideTitle?: string;
  pdfFileName?: string;
  pdfPath?: string;
  page?: number;
  startPage?: number;
  endPage?: number;
};
const docPanelStates = new Map<string, DocPanelState>();

export default function ChatView({
  messages,
  isStreaming,
  error,
  commands,
  conversationId,
  defaultModel,
  modelOptions,
  onSend,
  onAbort,
  onRerun,
  onToggleTool,
  onSaveToLibrary,
  savedDiagramContents,
  prefillInput,
  onPrefillConsumed,
}: ChatViewProps) {
  const [input, setInput] = useState(prefillInput || "");

  // Consume prefilled input when it arrives
  useEffect(() => {
    if (prefillInput) {
      setInput(prefillInput);
      onPrefillConsumed?.();
      // Focus the textarea after prefilling
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [prefillInput]); // eslint-disable-line react-hooks/exhaustive-deps
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [diagramSvg, setDiagramSvg] = useState<string | null>(null);
  const [docPanel, setDocPanel] = useState<{
    title: string;
    content: string;
    path: string;
    guideSlug?: string;
    guideTitle?: string;
    pdfFileName?: string;
    pdfPath?: string;
    page?: number;
    startPage?: number;
    endPage?: number;
  } | null>(null);
  const [model, setModel] = useState(() => pickModel(defaultModel, modelOptions));
  // A saved default or earlier pick the provider doesn't serve falls back to one it does.
  useEffect(() => {
    setModel((current) => pickModel(current, modelOptions));
  }, [modelOptions]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autocompleteItemsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const { copiedId, copy } = useCopyAction();
  const prevConvIdRef = useRef<string | null>(null);
  const convIdRef = useRef<string | null>(conversationId);
  convIdRef.current = conversationId;
  const restoringScrollRef = useRef(false);
  const userScrolledRef = useRef(false);

  const imgIdCounter = useRef(0);

  const addImageFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        const mediaType = file.type;
        setImages((prev) => [
          ...prev,
          { data: base64, mediaType, id: `img-${++imgIdCounter.current}-${Date.now()}` },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      addImageFiles(e.dataTransfer.files);
    }
  }, [addImageFiles]);

  const openDocFile = useCallback(async (filePath: string) => {
    const result = await window.lscApi.readFile(filePath);
    if (result.ok && result.content) {
      const name = filePath.split("/").pop() || filePath;
      setDocPanel({ title: name, content: result.content, path: filePath });
      setDiagramSvg(null);
    }
  }, []);

  const openGuideSection = useCallback(async (guideSlug: string, sectionSlug: string, page?: number, _highlight?: string) => {
    const result = await window.lscApi.readGuideSection(guideSlug, sectionSlug);
    if (result.ok) {
      const targetPage = page || result.startPage || 1;
      setDocPanel({
        title: result.sectionTitle || sectionSlug,
        content: result.content || "",
        path: `${result.guideTitle} — pages ${result.startPage}–${result.endPage}`,
        guideSlug: result.guideSlug,
        guideTitle: result.guideTitle,
        pdfFileName: result.pdfFileName,
        pdfPath: result.pdfPath,
        page: targetPage,
        startPage: result.startPage,
        endPage: result.endPage,
      });
      setDiagramSvg(null);
    }
  }, []);

  /** Find the user message that precedes a given assistant message */
  const getUserPromptFor = useCallback(
    (assistantMsgId: string): string | null => {
      const idx = messages.findIndex((m) => m.id === assistantMsgId);
      if (idx <= 0) return null;
      const prev = messages[idx - 1];
      return prev.role === "user" ? prev.text : null;
    },
    [messages]
  );

  // Save scroll position continuously on every scroll event (always up-to-date).
  // Also detect user scroll-away during streaming.
  // Re-run when messages appear/disappear since the container div is conditionally rendered.
  const hasMessages = messages.length > 0;
  const lastScrollTopRef = useRef(0);
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      if (restoringScrollRef.current) return;
      const scrollTop = container.scrollTop;
      // Persist current position for this session
      const cid = convIdRef.current;
      if (cid) {
        scrollPositions.set(cid, scrollTop);
      }
      // "Near bottom" = within 120px of the bottom edge
      const atBottom = container.scrollHeight - scrollTop - container.clientHeight < 120;
      if (atBottom) {
        // Re-engage auto-scroll when near bottom
        userScrolledRef.current = false;
      } else if (scrollTop < lastScrollTopRef.current) {
        // Only disengage auto-scroll if the user actively scrolled UP.
        // Content growth (tables, tool results) increases scrollHeight
        // without changing scrollTop, so we don't penalise that.
        userScrolledRef.current = true;
      }
      lastScrollTopRef.current = scrollTop;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [hasMessages]);

  // Restore scroll position when switching conversations — immediate, no animation
  useEffect(() => {
    const container = chatContainerRef.current;

    if (conversationId && container) {
      const saved = scrollPositions.get(conversationId);
      if (saved !== undefined) {
        restoringScrollRef.current = true;
        // Disable CSS smooth scrolling so the jump is instant
        container.style.scrollBehavior = "auto";
        container.scrollTop = saved;
        // Re-apply after React finishes any pending DOM mutations
        const observer = new MutationObserver(() => {
          container.scrollTop = saved;
          observer.disconnect();
          container.style.scrollBehavior = "";
          restoringScrollRef.current = false;
        });
        observer.observe(container, { childList: true, subtree: true });
        // Safety fallback in case no mutations happen
        setTimeout(() => {
          observer.disconnect();
          container.scrollTop = saved;
          container.style.scrollBehavior = "";
          restoringScrollRef.current = false;
        }, 50);
      }
    }

    prevConvIdRef.current = conversationId;
  }, [conversationId]);

  // Save/restore doc panel when switching conversations
  const prevConvForPanelRef = useRef<string | null>(null);
  useEffect(() => {
    // Save outgoing panel state
    const prevId = prevConvForPanelRef.current;
    if (prevId) {
      if (docPanel) {
        docPanelStates.set(prevId, docPanel);
      } else {
        docPanelStates.delete(prevId);
      }
    }
    // Restore incoming panel state
    const saved = conversationId ? docPanelStates.get(conversationId) : null;
    setDocPanel(saved ?? null);
    setDiagramSvg(null);
    prevConvForPanelRef.current = conversationId;
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the per-conversation map in sync as the panel opens/closes
  useEffect(() => {
    if (!conversationId) return;
    if (docPanel) {
      docPanelStates.set(conversationId, docPanel);
    } else {
      docPanelStates.delete(conversationId);
    }
  }, [docPanel, conversationId]);

  // Re-enable auto-scroll when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      userScrolledRef.current = false;
    }
  }, [isStreaming]);

  // Focus input when agent finishes responding
  useEffect(() => {
    if (!isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isStreaming]);

  // Auto-scroll to bottom only while streaming and user hasn't scrolled away.
  // Use "instant" during streaming to avoid stacking smooth-scroll animations
  // (each text delta triggers a re-render — smooth animations pile up and jitter).
  useEffect(() => {
    if (restoringScrollRef.current) return;
    if (!userScrolledRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: isStreaming ? "instant" : "smooth" });
    }
  }, [messages, isStreaming]);

  // Compute autocomplete matches
  const autocomplete = useMemo(() => {
    if (!input.startsWith("/")) return [];
    const query = input.slice(1).toLowerCase(); // strip the leading /
    // Match against /lsc:name — user might type "/" or "/lsc:" or "/lsc:he"
    return commands.filter((cmd) => {
      const full = `lsc:${cmd.name}`;
      return full.toLowerCase().startsWith(query);
    });
  }, [input, commands]);

  // Reset selection when matches change
  useEffect(() => {
    setSelectedIdx(0);
    autocompleteItemsRef.current.clear();
  }, [autocomplete.length]);

  // Scroll selected item into view
  useEffect(() => {
    const el = autocompleteItemsRef.current.get(selectedIdx);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // Prompt history — collect user messages for up/down arrow cycling
  const promptHistory = useMemo(
    () => messages.filter((m) => m.role === "user").map((m) => m.text).reverse(),
    [messages]
  );
  const historyIdx = useRef(-1);
  const savedInput = useRef("");

  const acceptAutocomplete = useCallback(
    (cmd: { name: string }) => {
      setInput(`/lsc:${cmd.name} `);
      textareaRef.current?.focus();
    },
    []
  );

  const handleSubmit = useCallback(() => {
    if (input.trim() && !isStreaming) {
      onSend(input, model, images.length > 0 ? images : undefined);
      setInput("");
      setImages([]);
      historyIdx.current = -1;
      if (textareaRef.current) {
        textareaRef.current.style.height = "44px";
      }
    }
  }, [input, isStreaming, onSend, model, images]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Autocomplete navigation
    if (autocomplete.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, autocomplete.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        acceptAutocomplete(autocomplete[selectedIdx]);
        return;
      }
      if (e.key === "Escape") {
        setInput("");
        return;
      }
    }

    // Prompt history cycling (only when cursor is at start of input)
    if (e.key === "ArrowUp" && promptHistory.length > 0) {
      const el = textareaRef.current;
      if (el && el.selectionStart === 0 && el.selectionEnd === 0) {
        e.preventDefault();
        if (historyIdx.current === -1) savedInput.current = input;
        const nextIdx = Math.min(historyIdx.current + 1, promptHistory.length - 1);
        historyIdx.current = nextIdx;
        setInput(promptHistory[nextIdx]);
        return;
      }
    }
    if (e.key === "ArrowDown" && historyIdx.current >= 0) {
      const el = textareaRef.current;
      if (el && el.selectionStart === el.value.length) {
        e.preventDefault();
        const nextIdx = historyIdx.current - 1;
        historyIdx.current = nextIdx;
        setInput(nextIdx < 0 ? savedInput.current : promptHistory[nextIdx]);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    historyIdx.current = -1;
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "44px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  const inputArea = (
    <div className="input-area">
      <div
        className={`input-card${dragActive ? " drag-active" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {autocomplete.length > 0 && (
          <div className="autocomplete-popup">
            {autocomplete.map((cmd, i) => (
              <div
                key={cmd.name}
                ref={(el) => {
                  if (el) autocompleteItemsRef.current.set(i, el);
                  else autocompleteItemsRef.current.delete(i);
                }}
                className={`autocomplete-item${i === selectedIdx ? " selected" : ""}`}
                onMouseEnter={() => setSelectedIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  acceptAutocomplete(cmd);
                }}
              >
                <span className="autocomplete-cmd">/lsc:{cmd.name}</span>
                <span className="autocomplete-desc">{cmd.description}</span>
              </div>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="image-preview-strip">
            {images.map((img) => (
              <div key={img.id} className="image-preview-thumb">
                <img src={`data:${img.mediaType};base64,${img.data}`} alt="attachment" />
                <button className="image-remove-btn" onClick={() => removeImage(img.id)}>&times;</button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={
            messages.length === 0
              ? "Ask about LSC, run a command, or type / to see options..."
              : "Type a message..."
          }
          rows={1}
        />
        <div className="input-toolbar">
          <div className="input-toolbar-left">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files) addImageFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              className="toolbar-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image"
            >
              <IconPaperclip />
            </button>
          </div>
          <div className="input-toolbar-right">
            <select
              className="model-picker"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {isStreaming ? (
              <button
                className="toolbar-send stop"
                onClick={onAbort}
              >
                Stop
              </button>
            ) : (
              <button
                className="toolbar-send"
                onClick={handleSubmit}
                disabled={!input.trim()}
              >
                <IconSend />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (messages.length === 0) {
    return (
      <div className="main-area">
        <div className="welcome">
          <div className="welcome-logo-wrap">
            <img src="lsc-logo-2026.png" alt="LSC" className="welcome-logo" />
          </div>
          <h2>LSC Assistant</h2>
          <p>
            Ask questions about LSC, run SOQL queries, configure
            modules, or type <strong>/</strong> to see available commands.
          </p>
          <div className="model-selector">
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
        {inputArea}
      </div>
    );
  }

  const hasPanel = diagramSvg || docPanel;

  return (
    <div className={`main-area${hasPanel ? " with-panel" : ""}`}>
      <div className="main-area-chat">
      <div className="chat-messages" ref={chatContainerRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            {msg.role === "user" ? (
              <>
                {msg.images && msg.images.length > 0 && (
                  <div className="user-images">
                    {msg.images.map((img) => (
                      <img
                        key={img.id}
                        src={`data:${img.mediaType};base64,${img.data}`}
                        alt="attachment"
                        className="user-image-thumb"
                      />
                    ))}
                  </div>
                )}
                <div className="message-content">{msg.text}</div>
              </>
            ) : (
              <div className="assistant-blocks">
                {groupBlocks(msg.blocks).map((group, gi) =>
                  group.type === "text" ? (
                    <div
                      key={gi}
                      className={`message-content${
                        msg.isStreaming && gi === groupBlocks(msg.blocks).length - 1
                          ? " streaming-cursor"
                          : ""
                      }`}
                    >
                      <Markdown
                        remarkPlugins={[remarkGfm]}
                        urlTransform={(url) => url}
                        components={{
                          table: ({ children, ...props }) => (
                            <CopyableTable onCopy={copy} copyId={`${msg.id}-table-${gi}`} copiedId={copiedId}>
                              <table {...props}>{children}</table>
                            </CopyableTable>
                          ),
                          pre: (() => {
                            let codeIdx = 0;
                            return ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => {
                              // Skip pre wrapper for mermaid diagrams
                              const child = React.Children.toArray(children)[0];
                              if (React.isValidElement(child)) {
                                const childProps = child.props as Record<string, unknown>;
                                if (childProps?.className === "language-mermaid" || child.type === MermaidDiagram) {
                                  return <>{children}</>;
                                }
                              }
                              return (
                                <CopyableCode onCopy={copy} copyId={`${msg.id}-code-${gi}-${codeIdx++}`} copiedId={copiedId}>
                                  <pre {...props}>{children}</pre>
                                </CopyableCode>
                              );
                            };
                          })(),
                          code: ({ className, children, ...props }) => {
                            if (className === "language-mermaid") {
                              const text = String(children).replace(/\n$/, "");
                              return (
                                <MermaidDiagram
                                  chart={text}
                                  onOpen={setDiagramSvg}
                                  saved={savedDiagramContents?.has(text)}
                                  onSave={(svg, chart) => {
                                    onSaveToLibrary({
                                      title: deriveDiagramTitle(chart),
                                      content: chart,
                                      contentType: "diagram",
                                      svg,
                                      sourceConversationId: conversationId ?? undefined,
                                    });
                                  }}
                                />
                              );
                            }
                            return <code className={className} {...props}>{children}</code>;
                          },
                          a: ({ href, children, ...props }) => {
                            if (href?.startsWith("lsc-file://")) {
                              const filePath = href.slice("lsc-file://".length);
                              return (
                                <a
                                  {...props}
                                  className="doc-link"
                                  onClick={(e) => { e.preventDefault(); openDocFile(filePath); }}
                                >
                                  {children}
                                </a>
                              );
                            }
                            if (href?.startsWith("lsc-section://")) {
                              const url = new URL(href.replace("lsc-section://", "https://placeholder/"));
                              const parts = url.pathname.split("/").filter(Boolean);
                              const guideSlug = parts[0];
                              const sectionSlug = parts[1];
                              const page = url.searchParams.get("page") ? parseInt(url.searchParams.get("page")!) : undefined;
                              const highlight = url.searchParams.get("highlight") || undefined;
                              return (
                                <a
                                  className="doc-link"
                                  href="#"
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); openGuideSection(guideSlug, sectionSlug, page, highlight); }}
                                >
                                  {children}
                                </a>
                              );
                            }
                            if (href?.startsWith("lsc-pdf://")) {
                              const url = new URL(href.replace("lsc-pdf://", "https://placeholder/"));
                              const pdfFileName = url.pathname.replace(/^\//, "");
                              const page = url.searchParams.get("page") ? parseInt(url.searchParams.get("page")!) : 1;
                              return (
                                <a
                                  className="doc-link"
                                  href="#"
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.lscApi.openPdfAtPage(pdfFileName, page); }}
                                >
                                  {children}
                                </a>
                              );
                            }
                            if (href?.startsWith("http://") || href?.startsWith("https://")) {
                              return (
                                <a
                                  {...props}
                                  className="doc-link"
                                  onClick={(e) => { e.preventDefault(); window.lscApi.openExternal(href); }}
                                >
                                  {children}
                                </a>
                              );
                            }
                            return <a href={href} {...props}>{children}</a>;
                          },
                        }}
                      >
                        {preprocessMarkdown(group.text)}
                      </Markdown>
                    </div>
                  ) : group.tools.length === 1 ? (
                    <ToolCallBlock
                      key={group.tools[0].id}
                      tool={group.tools[0]}
                      onToggle={() => onToggleTool(msg.id, group.tools[0].id)}
                    />
                  ) : (
                    <ToolGroup
                      key={`tg-${gi}`}
                      tools={group.tools}
                      onToggleTool={(toolId) => onToggleTool(msg.id, toolId)}
                    />
                  )
                )}
                {msg.isStreaming && msg.blocks.length === 0 && (
                  <div className="thinking-indicator">
                    <span className="thinking-dot" />
                  </div>
                )}
                {/* Action bar */}
                {!msg.isStreaming && msg.blocks.length > 0 && (
                  <div className="message-actions">
                    <button
                      className="action-btn"
                      title="Copy"
                      onClick={() => copy(getFullText(msg), msg.id)}
                    >
                      {copiedId === msg.id ? <IconCheck /> : <IconCopy />}
                    </button>
                    {getUserPromptFor(msg.id) && (
                      <button
                        className="action-btn"
                        title="Retry"
                        onClick={() => {
                          const prompt = getUserPromptFor(msg.id);
                          if (prompt) onRerun(prompt);
                        }}
                      >
                        <IconRetry />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {error && (
          <div className="error-banner">{error}</div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {inputArea}
      </div>
      {diagramSvg && !docPanel && (
        <MermaidViewerPanel svg={diagramSvg} onClose={() => setDiagramSvg(null)} />
      )}
      {docPanel && (
        <DocViewerPanel
          title={docPanel.title}
          content={docPanel.content}
          path={docPanel.path}
          guideSlug={docPanel.guideSlug}
          guideTitle={docPanel.guideTitle}
          pdfFileName={docPanel.pdfFileName}
          pdfPath={docPanel.pdfPath}
          page={docPanel.page}
          startPage={docPanel.startPage}
          endPage={docPanel.endPage}
          onClose={() => setDocPanel(null)}
        />
      )}
    </div>
  );
}

const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function IconCopy() {
  return (
    <svg {...iconProps}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg {...iconProps} stroke="var(--success)">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconRetry() {
  return (
    <svg {...iconProps}>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function IconPaperclip() {
  return (
    <svg {...iconProps}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function IconBookmark() {
  return (
    <svg {...iconProps}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconBookmarkFilled() {
  return (
    <svg {...iconProps} fill="currentColor">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405Z" />
    </svg>
  );
}

function IconFullscreen() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function IconExitFullscreen() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function CopyableCode({
  children,
  onCopy,
  copyId,
  copiedId,
}: {
  children: React.ReactElement;
  onCopy: (text: string, id: string) => void;
  copyId: string;
  copiedId: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const handleCopy = () => {
    const code = ref.current?.querySelector("code");
    const text = code?.textContent ?? ref.current?.textContent ?? "";
    onCopy(text, copyId);
  };

  return (
    <div className="copyable-code" ref={ref}>
      {children}
      <button
        className="code-copy-btn"
        onClick={handleCopy}
        title="Copy code"
      >
        {copiedId === copyId ? <IconCheck /> : <IconCopy />}
      </button>
    </div>
  );
}

function CopyableTable({
  children,
  onCopy,
  copyId,
  copiedId,
}: {
  children: React.ReactElement;
  onCopy: (text: string, id: string) => void;
  copyId: string;
  copiedId: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const handleCopy = () => {
    const table = ref.current?.querySelector("table");
    if (table) onCopy(tableToText(table), copyId);
  };

  return (
    <div className="copyable-table" ref={ref}>
      {children}
      <button
        className="table-copy-btn"
        onClick={handleCopy}
        title="Copy table"
      >
        {copiedId === copyId ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function ToolGroup({
  tools,
  onToggleTool,
}: {
  tools: ToolCall[];
  onToggleTool: (toolId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const allDone = tools.every((t) => t.status !== "running");
  const hasError = tools.some((t) => t.status === "error");
  const runningCount = tools.filter((t) => t.status === "running").length;

  const statusClass = !allDone ? "running" : hasError ? "error" : "success";
  const statusLabel = !allDone
    ? `${runningCount} running`
    : hasError
      ? `${tools.filter((t) => t.status === "error").length} failed`
      : "Done";

  return (
    <div className="tool-group">
      <div
        className={`tool-group-header${expanded ? " expanded" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`tool-chevron${expanded ? " open" : ""}`}>&#9654;</span>
        <span className="tool-group-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </span>
        <span className="tool-group-summary">
          Used {tools.length} tools
        </span>
        <span className="tool-group-names">{summarizeTools(tools)}</span>
        <span className={`tool-status ${statusClass}`}>{statusLabel}</span>
      </div>
      {expanded && (
        <div className="tool-group-body">
          {tools.map((tool) => (
            <ToolCallBlock
              key={tool.id}
              tool={tool}
              onToggle={() => onToggleTool(tool.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({
  tool,
  onToggle,
}: {
  tool: ToolCall;
  onToggle: () => void;
}) {
  const isOpen = !tool.collapsed;
  const statusLabel =
    tool.status === "running"
      ? "Running"
      : tool.status === "error"
        ? "Error"
        : "Done";

  return (
    <div className="tool-call">
      <div className="tool-call-header" onClick={onToggle}>
        <span className={`tool-chevron${isOpen ? " open" : ""}`}>&#9654;</span>
        <span className="tool-name">{tool.name}</span>
        <span className={`tool-status ${tool.status}`}>{statusLabel}</span>
      </div>
      <div className={`tool-call-body-wrapper${isOpen ? " open" : ""}`}>
        <div className="tool-call-body">
          <div className="tool-call-body-inner">
            {tool.result
              ? tool.result.length > 3000
                ? tool.result.slice(0, 3000) + "\n...(truncated)"
                : tool.result
              : "Waiting for result..."}
          </div>
        </div>
      </div>
    </div>
  );
}
