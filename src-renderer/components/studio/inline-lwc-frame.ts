/**
 * The document an inline LWC runs in for the live preview: SLDS (with the touch
 * overrides LSC Mobile uses), the context the stand-in modules read, and the
 * compiled component (src/studio/lwc/compile.ts). It runs in an
 * `allow-scripts` sandbox and only talks to the host page with postMessage
 * (lightning/studioBridge).
 */

export interface InlineLwcContext {
  componentName: string;
  recordId?: string;
  objectApiName?: string;
  userId?: string;
  locale?: string;
  timeZone?: string;
}

/** Messages the frame posts to the host. */
export type FrameMessage =
  | { __studio: "request"; id: number; method: "GET" | "POST"; path: string; body?: unknown }
  | { __studio: "toast"; toast: { title?: string; message?: string; variant?: string } }
  | { __studio: "navigate"; pageReference: { type?: string; attributes?: Record<string, unknown>; state?: Record<string, unknown> } }
  | { __studio: "error"; message: string; mounted: boolean }
  | { __studio: "warn"; message: string };

/** Script text safe inside an inline `<script>`: no early `</script>` or `<!--`. */
function inlineScript(code: string): string {
  return code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

export function inlineLwcFrame(script: string, css: string, context: InlineLwcContext): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>${css.replace(/<\/(style)/gi, "<\\/$1")}</style>
<style>html,body{margin:0;background:#fff;font-size:13px}body{overflow:auto}#root{min-height:100%}</style>
<script>globalThis.__studioContext = ${inlineScript(JSON.stringify(context))};</script>
</head><body class="slds-scope"><div id="root"></div>
<script>${inlineScript(script)}</script>
</body></html>`;
}
