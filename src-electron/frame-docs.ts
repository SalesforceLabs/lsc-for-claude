import { randomUUID } from "crypto";

/**
 * The live LWC previews (the iPad preview's inline components and the app builder's frame) run code
 * compiled from the org or written by the model. They were srcdoc frames, which take the window's
 * Content-Security-Policy, so the window's could never be strict. Each document is now held here and
 * served as lsc-frame://doc/<id> with its own policy: inline scripts run, but the frame can't reach the
 * network (its data comes over postMessage), load pages, or submit forms. Images from Salesforce hosts
 * still load, as on the iPad.
 */

export const FRAME_SCHEME = "lsc-frame";

export const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob: https://*.salesforce.com https://*.force.com https://*.sfdcstatic.com",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** Documents kept at most; a frame that's still open is released by its own view, so this is a safety net. */
const MAX_DOCS = 32;

const docs = new Map<string, string>();

/** Holds a frame's HTML and returns the URL that serves it. */
export function registerFrameDoc(html: unknown): string | null {
  if (typeof html !== "string") return null;
  const id = randomUUID();
  docs.set(id, html);
  while (docs.size > MAX_DOCS) docs.delete(docs.keys().next().value!);
  return `${FRAME_SCHEME}://doc/${id}`;
}

/** Drops a document once its frame is gone. */
export function releaseFrameDoc(url: unknown): void {
  const id = typeof url === "string" ? frameDocId(url) : null;
  if (id) docs.delete(id);
}

function frameDocId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === `${FRAME_SCHEME}:` && u.hostname === "doc" ? u.pathname.replace(/^\//, "") : null;
  } catch {
    return null;
  }
}

/** The protocol's answer: the document with the frame policy, else 404. */
export function frameDocResponse(url: string): Response {
  const id = frameDocId(url);
  const html = id ? docs.get(id) : undefined;
  if (html === undefined) return new Response("Not found", { status: 404 });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": FRAME_CSP, "Cache-Control": "no-store" },
  });
}
