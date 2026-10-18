import mermaid from "mermaid";
import { useEffect, useState } from "react";
import { cssToken, useColorScheme, type ColorScheme } from "./theme";

/** Rendered SVGs by palette and source, so re-mounts don't flash "Generating…". */
const svgCache = new Map<string, string>();
const cacheKey = (scheme: ColorScheme, chart: string) => `${scheme}\n${chart}`;

let renderId = 0;
// mermaid.initialize is global: renders run one at a time so each gets its own palette.
let queue: Promise<unknown> = Promise.resolve();

/** Offscreen container for mermaid.render() so temp SVGs never flash on screen */
function offscreenContainer(): HTMLElement {
  let el = document.getElementById("mermaid-offscreen");
  if (!el) {
    el = document.createElement("div");
    el.id = "mermaid-offscreen";
    el.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;";
    document.body.appendChild(el);
  }
  return el;
}

/** Diagram colours from the app's tokens (styles.css), so diagrams match the palette on screen. */
function configure(scheme: ColorScheme): void {
  mermaid.initialize({
    startOnLoad: false,
    // Only "base" takes every themeVariable; "dark" keeps its own derived shades, which suit the dark palette.
    theme: scheme === "dark" ? "dark" : "base",
    themeVariables: {
      darkMode: scheme === "dark",
      background: cssToken("--bg-primary"),
      primaryColor: cssToken("--diagram-node"),
      primaryTextColor: cssToken("--diagram-node-text"),
      primaryBorderColor: cssToken("--accent-hover"),
      lineColor: cssToken("--text-muted"),
      secondaryColor: cssToken("--diagram-secondary"),
      tertiaryColor: cssToken("--diagram-tertiary"),
    },
    flowchart: { htmlLabels: true, curve: "basis" },
    securityLevel: "loose",
  });
}

/** Renders a Mermaid chart in the given palette; rejects on a syntax error. */
export function renderMermaid(chart: string, scheme: ColorScheme): Promise<string> {
  const key = cacheKey(scheme, chart);
  const cached = svgCache.get(key);
  if (cached) return Promise.resolve(cached);
  const run = queue.then(async () => {
    const done = svgCache.get(key);
    if (done) return done;
    configure(scheme);
    const id = `mermaid-${++renderId}-${Date.now()}`;
    try {
      const { svg } = await mermaid.render(id, chart, offscreenContainer());
      svgCache.set(key, svg);
      return svg;
    } catch (err) {
      document.getElementById(`d${id}`)?.remove();
      offscreenContainer().innerHTML = "";
      throw err;
    }
  });
  queue = run.catch(() => {});
  return run;
}

/**
 * A chart's SVG in the current palette, re-rendered when the palette changes (the previous SVG stays
 * up meanwhile). `delayMs` debounces charts that are still streaming in.
 */
export function useMermaidSvg(chart: string, delayMs = 0): { svg: string | null; error: boolean } {
  const scheme = useColorScheme();
  const source = chart.trim();
  const key = cacheKey(scheme, source);
  const [state, setState] = useState(() => ({ key, svg: svgCache.get(key) ?? null, error: false }));

  useEffect(() => {
    const cached = svgCache.get(key);
    if (cached) {
      setState({ key, svg: cached, error: false });
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      renderMermaid(source, scheme).then(
        (svg) => live && setState({ key, svg, error: false }),
        () => live && setState((prev) => ({ key, svg: prev.svg, error: true }))
      );
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, source, scheme, delayMs]);

  return { svg: state.svg, error: state.key === key && state.error };
}
