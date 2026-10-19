import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import {
  ArrowUp, Bookmark, Building2, BookmarkCheck, Check, ChevronDown, ChevronRight, Circle, CircleAlert, Copy, ExternalLink, FileText,
  Maximize2, Minimize2, Minus, Paperclip, Plus, RotateCcw, Scan, Square, TriangleAlert, Workflow, Wrench, X,
} from "lucide-react";
import { ChatMessage, ContentBlock, ToolCall, ImageAttachment } from "../hooks/useChat";
import { pickModel, type ModelOption } from "../models";
import { rozTileSrc, useAppIcon } from "../app-icon";
import Spinner from "./ui/Spinner";
import { useMermaidSvg } from "../mermaid";
import { useSmoothText } from "../hooks/useSmoothText";
import { openMermaidFence, replyActivity, summarizeTools, toolDetail, toolLabel, type Activity } from "../chat-activity";
import { hostOf, KIND_LABEL, type SessionOrgView } from "../orgs";

/** Lucide defaults for icons in chat chrome. */
const ICON = { size: 14, strokeWidth: 1.9, "aria-hidden": true } as const;

/** The text of a reply for copying: its text blocks as separate paragraphs. */
function replyText(msg: ChatMessage): string {
  return msg.blocks
    .flatMap((b) => (b.type === "text" && b.text.trim() ? [b.text.trim()] : []))
    .join("\n\n");
}

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

/** What a reply's Markdown needs from the chat view; read through a ref so its components never change. */
interface ReplyEnv {
  copy: (text: string, id: string) => void;
  openDiagram: (chart: string) => void;
  saveDiagram: (svg: string, chart: string) => void;
  openDocFile: (filePath: string) => void;
  openGuideSection: (guideSlug: string, sectionSlug: string, page?: number, highlight?: string) => void;
}

/** Where a Markdown node starts in its source — a stable key for its copy button. */
type MdNode = { position?: { start?: { offset?: number } } };
function nodeOffset(node: unknown): number {
  return (node as MdNode | undefined)?.position?.start?.offset ?? 0;
}

/**
 * One text block of a reply. Its Markdown components are made once, so streaming new text
 * re-renders the tree instead of remounting it (diagrams and copy buttons keep their state), and
 * finished blocks don't re-render at all. While `live` the text is revealed at a steady pace, and
 * a diagram whose fence hasn't closed is shown as being drawn rather than drawn half-written.
 */
const ReplyMarkdown = React.memo(function ReplyMarkdown({
  text,
  copyKey,
  live,
  copiedId,
  savedDiagrams,
  env,
}: {
  text: string;
  copyKey: string;
  live: boolean;
  copiedId: string | null;
  savedDiagrams?: Set<string>;
  env: React.MutableRefObject<ReplyEnv>;
}) {
  const shown = useSmoothText(text, live);
  const source = useMemo(() => preprocessMarkdown(shown), [shown]);
  const drawingFrom = live || shown.length < text.length ? openMermaidFence(source) : -1;
  const state = useRef({ copyKey, copiedId, savedDiagrams, drawingFrom });
  state.current = { copyKey, copiedId, savedDiagrams, drawingFrom };

  const components = useMemo<Components>(() => ({
    table: ({ children, node: _node, ...props }) => (
      <CopyableTable
        onCopy={env.current.copy}
        copyId={`${state.current.copyKey}-table-${nodeOffset(_node)}`}
        copiedId={state.current.copiedId}
      >
        <table {...props}>{children}</table>
      </CopyableTable>
    ),
    pre: ({ children, node: _node, ...props }) => {
      // Diagrams draw their own card.
      const child = React.Children.toArray(children)[0];
      if (React.isValidElement(child) && (child.props as { className?: string })?.className === "language-mermaid") {
        return <>{children}</>;
      }
      return (
        <CopyableCode
          onCopy={env.current.copy}
          copyId={`${state.current.copyKey}-code-${nodeOffset(_node)}`}
          copiedId={state.current.copiedId}
        >
          <pre {...props}>{children}</pre>
        </CopyableCode>
      );
    },
    code: ({ className, children, node: _node, ...props }) => {
      if (className === "language-mermaid") {
        const chart = String(children).replace(/\n$/, "");
        const { drawingFrom: from, savedDiagrams: saved } = state.current;
        return (
          <MermaidDiagram
            chart={chart}
            drawing={from >= 0 && nodeOffset(_node) >= from}
            onOpen={env.current.openDiagram}
            saved={saved?.has(chart)}
            onSave={env.current.saveDiagram}
          />
        );
      }
      return <code className={className} {...props}>{children}</code>;
    },
    a: ({ href, children, node: _node, ...props }) => {
      if (href?.startsWith("lsc-file://")) {
        const filePath = href.slice("lsc-file://".length);
        return (
          <a
            {...props}
            className="doc-link"
            onClick={(e) => { e.preventDefault(); env.current.openDocFile(filePath); }}
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
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); env.current.openGuideSection(guideSlug, sectionSlug, page, highlight); }}
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
  }), [env]);

  return (
    <div className="message-content">
      <Markdown remarkPlugins={[remarkGfm]} urlTransform={(url) => url} components={components}>
        {source}
      </Markdown>
    </div>
  );
});

/** Inline mermaid card — renders SVG, calls onOpen with the chart when clicked */
function MermaidDiagram({ chart, drawing, onOpen, onSave, saved }: { chart: string; drawing?: boolean; onOpen?: (chart: string) => void; onSave?: (svg: string, chart: string) => void; saved?: boolean }) {
  // A chart still streaming in is drawn once, when its fence closes.
  const { svg, error } = useMermaidSvg(drawing ? "" : chart);

  if (error) {
    return (
      <pre className="mermaid-fallback">
        <code>{chart}</code>
      </pre>
    );
  }

  return (
    <div
      className={`mermaid-card${svg ? "" : " pending"}`}
      role="button"
      tabIndex={svg ? 0 : -1}
      onClick={() => svg && onOpen?.(chart)}
      onKeyDown={(e) => {
        if (svg && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen?.(chart);
        }
      }}
    >
      <span className="mermaid-card-icon">
        <Workflow size={16} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="mermaid-card-info">
        <span className="mermaid-card-title">Diagram</span>
        <span className="mermaid-card-meta">
          {!svg ? (
            <><Spinner size={11} /> {drawing ? "Drawing…" : "Rendering…"}</>
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
          aria-label={saved ? "Saved to Library" : "Save to Library"}
        >
          {saved ? <BookmarkCheck {...ICON} /> : <Bookmark {...ICON} />}
        </button>
      )}
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
      <button onClick={zoomOut} title="Zoom out" aria-label="Zoom out" disabled={zoom <= 0.1}><Minus {...ICON} /></button>
      <button className="zoom-level" onClick={zoomReset} title="Reset zoom">{Math.round(zoom * 100)}%</button>
      <button onClick={zoomIn} title="Zoom in" aria-label="Zoom in"><Plus {...ICON} /></button>
      <button onClick={zoomFit} title="Fit in window" aria-label="Fit in window"><Scan {...ICON} /></button>
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
function MermaidViewerPanel({ chart, onClose }: { chart: string; onClose: () => void }) {
  const { svg } = useMermaidSvg(chart);
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
    <button
      onClick={() => setIsFullscreen((f) => !f)}
      title={isFullscreen ? "Exit full screen" : "Full screen"}
      aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
    >
      {isFullscreen ? <Minimize2 {...ICON} /> : <Maximize2 {...ICON} />}
    </button>
  );

  return (
    <div
      className={`mermaid-panel${isFullscreen ? " mermaid-panel-fullscreen" : ""}`}
      ref={panelRef}
      style={!isFullscreen && panelWidth ? { width: panelWidth } : undefined}
    >
      {!isFullscreen && <div className="mermaid-panel-resize" onPointerDown={onResizePointerDown} />}
      <div className="mermaid-panel-header drag-region">
        <span className="mermaid-card-label">
          <Workflow size={15} strokeWidth={1.75} aria-hidden="true" />
          Diagram
        </span>
        <DiagramZoomToolbar controls={controls} extraButtons={fullscreenBtn} />
        <button className="ui-icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <X size={16} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>
      <DiagramViewport svg={svg ?? ""} controls={controls} />
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
      <div className="doc-panel-header drag-region">
        <div className="doc-panel-title-row">
          <FileText size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="doc-panel-title">{title}</span>
        </div>
        <div className="doc-panel-actions">
          {isGuide && pdfFileName && (
            <button
              className="studio-btn sm"
              title="Open in Preview"
              onClick={() => window.lscApi.openPdfAtPage(pdfFileName, page || startPage || 1)}
            >
              <ExternalLink {...ICON} />
              Open in Preview
            </button>
          )}
          <button className="ui-icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
            <X size={16} strokeWidth={1.9} aria-hidden="true" />
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

/** A compact pill that shows the chosen model; the native select sits invisibly on top so the menu stays native. */
function ModelPicker({ value, options, onChange }: { value: string; options: ModelOption[]; onChange: (value: string) => void }) {
  const current = options.find((o) => o.value === value);
  return (
    <label className="model-pill" title="Model">
      <span className="model-pill-label">{current?.label ?? value}</span>
      <ChevronDown size={12} strokeWidth={2.25} aria-hidden="true" />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Model">
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
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
  /** The org this session works in (a new session: the selected org); null with none. */
  org?: SessionOrgView | null;
  /** Log in to the session's org again, when its login has expired. */
  onOrgLogin?: () => void;
  waitingLogin?: boolean;
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
  org,
  onOrgLogin,
  waitingLogin,
}: ChatViewProps) {
  const appIcon = useAppIcon();
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
  const [diagramChart, setDiagramChart] = useState<string | null>(null);
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
      setDiagramChart(null);
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
      setDiagramChart(null);
    }
  }, []);

  const replyEnv = useRef<ReplyEnv>(null!);
  replyEnv.current = {
    copy,
    openDiagram: setDiagramChart,
    saveDiagram: (svg, chart) =>
      onSaveToLibrary({
        title: deriveDiagramTitle(chart),
        content: chart,
        contentType: "diagram",
        svg,
        sourceConversationId: conversationId ?? undefined,
      }),
    openDocFile,
    openGuideSection,
  };

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
    setDiagramChart(null);
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

  // While a reply streams its text grows between renders (it's revealed a frame at a time), so
  // follow its height rather than the messages: stay pinned to the bottom unless the user scrolled up.
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container || !isStreaming) return;
    const follow = () => {
      if (restoringScrollRef.current || userScrolledRef.current) return;
      container.style.scrollBehavior = "auto";
      container.scrollTop = container.scrollHeight;
      container.style.scrollBehavior = "";
    };
    const observer = new ResizeObserver(follow);
    for (const child of Array.from(container.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [isStreaming, messages.length]);

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
  };

  // Fit the textarea to its text, including text set from code (prefill, history, submit)
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "44px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [input]);

  const orgNotice = org && org.state !== "ok" && (
    <div className="composer-notice" role="status">
      <TriangleAlert {...ICON} />
      <span className="composer-notice-text">
        {org.state === "expired"
          ? `Your login to ${org.label} has expired. Tools that read or change the org will fail until you log in again.`
          : `${org.label} isn't in your sf CLI connections any more. Log in to it again to use its data in this session.`}
      </span>
      {onOrgLogin && (
        <button className="studio-btn sm" onClick={onOrgLogin} disabled={waitingLogin}>
          {waitingLogin && <Spinner size={12} />}
          {waitingLogin ? "Waiting for login…" : "Log in again"}
        </button>
      )}
    </div>
  );

  const inputArea = (
    <div className="input-area">
      {orgNotice}
      <div
        className={`input-card${dragActive ? " drag-active" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {autocomplete.length > 0 && (
          <div className="autocomplete-popup" role="listbox" aria-label="Commands">
            {autocomplete.map((cmd, i) => (
              <div
                key={cmd.name}
                role="option"
                aria-selected={i === selectedIdx}
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
                <button className="image-remove-btn" onClick={() => removeImage(img.id)} aria-label="Remove image">
                  <X size={12} strokeWidth={2.25} aria-hidden="true" />
                </button>
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
              ? "Ask about LSC, run a command, or type / to see options…"
              : "Reply…"
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
              aria-label="Attach image"
            >
              <Paperclip size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {org && (
              <span
                className="composer-org"
                title={`This session works in ${org.label}\n${org.ref.username}${org.ref.instanceUrl ? `\n${hostOf(org.ref.instanceUrl)}` : ""}`}
              >
                <Building2 {...ICON} />
                <span className="composer-org-name">{org.label}</span>
                {org.kind === "production" && <span className="ui-pill warning">{KIND_LABEL.production}</span>}
              </span>
            )}
          </div>
          <div className="input-toolbar-right">
            <ModelPicker value={model} options={modelOptions} onChange={setModel} />
            {isStreaming ? (
              <button
                className="toolbar-send stop"
                onClick={onAbort}
                title="Stop generating"
                aria-label="Stop generating"
              >
                <Square size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />
              </button>
            ) : (
              <button
                className="toolbar-send"
                onClick={handleSubmit}
                disabled={!input.trim()}
                title="Send (Enter)"
                aria-label="Send"
              >
                <ArrowUp size={16} strokeWidth={2.25} aria-hidden="true" />
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
        <div className="pane-toolbar drag-region" />
        <div className="welcome">
          <div className="welcome-logo-wrap">
            <img src={rozTileSrc(appIcon)} alt="" className="welcome-logo" />
          </div>
          <h2>Roz for LSC</h2>
          <p>
            Ask how a feature works, review your org's setup, or get help
            configuring something new. Type <strong>/</strong> for commands.
          </p>
        </div>
        {inputArea}
      </div>
    );
  }

  const hasPanel = diagramChart || docPanel;

  return (
    <div className={`main-area${hasPanel ? " with-panel" : ""}`}>
      <div className="main-area-chat">
      <div className="pane-toolbar bordered drag-region" />
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
                {groupBlocks(msg.blocks).map((group, gi, groups) =>
                  group.type === "text" ? (
                    <ReplyMarkdown
                      key={gi}
                      text={group.text}
                      copyKey={`${msg.id}-${gi}`}
                      live={!!msg.isStreaming && gi === groups.length - 1}
                      copiedId={copiedId}
                      savedDiagrams={savedDiagramContents}
                      env={replyEnv}
                    />
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
                {(() => {
                  const activity = replyActivity(msg);
                  return activity && <ReplyActivity key={activity.key} activity={activity} />;
                })()}
                {/* Action bar */}
                {!msg.isStreaming && msg.blocks.length > 0 && (
                  <div className="message-actions">
                    <button
                      className="action-btn"
                      title="Copy"
                      aria-label="Copy reply"
                      onClick={() => copy(replyText(msg), msg.id)}
                    >
                      {copiedId === msg.id ? <Check {...ICON} className="copied" /> : <Copy {...ICON} />}
                    </button>
                    {getUserPromptFor(msg.id) && (
                      <button
                        className="action-btn"
                        title="Retry"
                        aria-label="Retry"
                        onClick={() => {
                          const prompt = getUserPromptFor(msg.id);
                          if (prompt) onRerun(prompt);
                        }}
                      >
                        <RotateCcw {...ICON} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {error && (
          <div className="error-banner" role="alert">
            <TriangleAlert size={15} strokeWidth={1.9} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {inputArea}
      </div>
      {diagramChart && !docPanel && (
        <MermaidViewerPanel chart={diagramChart} onClose={() => setDiagramChart(null)} />
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
        aria-label="Copy code"
      >
        {copiedId === copyId ? <Check {...ICON} className="copied" /> : <Copy {...ICON} />}
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
        {copiedId === copyId ? <Check {...ICON} size={12} className="copied" /> : <Copy {...ICON} size={12} />}
        {copiedId === copyId ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function ToolStatus({ status, label }: { status: ToolCall["status"]; label?: string }) {
  return (
    <span className={`tool-status ${status}`}>
      {status === "running" ? (
        <Spinner size={11} />
      ) : status === "pending" ? (
        <Circle size={11} strokeWidth={2} aria-hidden="true" />
      ) : status === "error" ? (
        <CircleAlert size={12} strokeWidth={2} aria-hidden="true" />
      ) : (
        <Check size={12} strokeWidth={2.25} aria-hidden="true" />
      )}
      {label}
    </span>
  );
}

/** What a streaming reply is doing now — the line under it until it's finished. */
function ReplyActivity({ activity }: { activity: Activity }) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.floor((now - started) / 1000);
  return (
    <div className="reply-activity" role="status">
      <Spinner size={12} />
      <span className="reply-activity-label">{activity.label}</span>
      {activity.detail && <span className="reply-activity-detail" title={activity.detail}>{activity.detail}</span>}
      {activity.timed && seconds >= 3 && <span className="reply-activity-time">{seconds}s</span>}
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
  const finished = tools.filter((t) => t.status === "success" || t.status === "error").length;
  const failed = tools.filter((t) => t.status === "error").length;
  const working = finished < tools.length;

  // No "Done" here: the reply may still be going — its activity line says so.
  const status: ToolCall["status"] = working ? "running" : failed ? "error" : "success";
  const statusLabel = working ? `${finished} of ${tools.length}` : failed ? `${failed} failed` : undefined;

  return (
    <div className="tool-group">
      <button
        type="button"
        className={`tool-group-header${expanded ? " expanded" : ""}`}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight className={`tool-chevron${expanded ? " open" : ""}`} size={12} strokeWidth={2.25} aria-hidden="true" />
        <Wrench className="tool-group-icon" size={13} strokeWidth={1.75} aria-hidden="true" />
        <span className="tool-group-summary">
          {tools.length} steps
        </span>
        <span className="tool-group-names">{summarizeTools(tools)}</span>
        <ToolStatus status={status} label={statusLabel} />
      </button>
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
  const detail = toolDetail(tool.input);
  const input = tool.input && Object.keys(tool.input).length > 0 ? JSON.stringify(tool.input, null, 2) : null;

  return (
    <div className="tool-call">
      <button type="button" className="tool-call-header" aria-expanded={isOpen} onClick={onToggle} title={tool.name}>
        <ChevronRight className={`tool-chevron${isOpen ? " open" : ""}`} size={12} strokeWidth={2.25} aria-hidden="true" />
        <span className="tool-name">{toolLabel(tool)}</span>
        {detail && <span className="tool-detail">{detail}</span>}
        <ToolStatus status={tool.status} label={tool.status === "error" ? "Failed" : undefined} />
      </button>
      <div className={`tool-call-body-wrapper${isOpen ? " open" : ""}`}>
        <div className="tool-call-body">
          <div className="tool-call-body-inner">
            <div className="tool-call-section-label">{tool.name}</div>
            {input && <div className="tool-call-input">{input.length > 2000 ? input.slice(0, 2000) + "\n…(truncated)" : input}</div>}
            {tool.result
              ? tool.result.length > 3000
                ? tool.result.slice(0, 3000) + "\n...(truncated)"
                : tool.result
              : tool.status === "pending"
                ? "Not started yet…"
                : "Waiting for result…"}
          </div>
        </div>
      </div>
    </div>
  );
}
