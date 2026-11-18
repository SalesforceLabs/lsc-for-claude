/**
 * Enough Mustache for CLM slides: LSC Mobile renders each slide as a Mustache template before loading it
 * (SlideViewController.swift, after replacing `{{{.}}}` with the data as JSON). Variables (`{{a.b}}` escaped,
 * `{{{a.b}}}` / `{{& a.b}}` raw), sections over lists and truthy values, inverted sections, `{{.}}` and comments.
 * Partials and delimiter changes are left as written.
 */

type Ctx = unknown[];

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "/": "&#x2F;",
  "`": "&#x60;",
  "=": "&#x3D;",
};
const escape = (s: string) => s.replace(/[&<>"'`=/]/g, (c) => ESC[c]);

function lookup(stack: Ctx, name: string): unknown {
  if (name === ".") return stack[stack.length - 1];
  const parts = name.split(".");
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (frame && typeof frame === "object" && parts[0] in (frame as object)) {
      let v: unknown = frame;
      for (const p of parts)
        v = v && typeof v === "object" ? (v as Record<string, unknown>)[p] : undefined;
      return v;
    }
  }
  return undefined;
}

const str = (v: unknown) =>
  v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
const falsy = (v: unknown) => !v || (Array.isArray(v) && v.length === 0);

const TAG = /\{\{(\{|&|#|\^|\/|!|>|=)?\s*([^}]*?)\s*\}?\}\}/g;

/** Index just past the `{{/name}}` that closes the section opened before `from`, and where that tag starts. */
function findClose(tpl: string, name: string, from: number): { start: number; end: number } | null {
  let depth = 1;
  const re = new RegExp(TAG.source, "g");
  re.lastIndex = from;
  for (let m = re.exec(tpl); m; m = re.exec(tpl)) {
    if ((m[1] === "#" || m[1] === "^") && m[2] === name) depth++;
    else if (m[1] === "/" && m[2] === name && --depth === 0)
      return { start: m.index, end: re.lastIndex };
  }
  return null;
}

function render(tpl: string, stack: Ctx): string {
  let out = "";
  let at = 0;
  const re = new RegExp(TAG.source, "g");
  for (let m = re.exec(tpl); m; m = re.exec(tpl)) {
    out += tpl.slice(at, m.index);
    at = re.lastIndex;
    const [whole, kind, name] = m;
    if (kind === "!") continue;
    if (kind === ">" || kind === "=" || kind === "/") {
      out += kind === "/" ? "" : whole;
      continue;
    }
    if (kind === "#" || kind === "^") {
      const close = findClose(tpl, name, at);
      if (!close) {
        out += whole;
        continue;
      }
      const inner = tpl.slice(at, close.start);
      const v = lookup(stack, name);
      if (kind === "^") {
        if (falsy(v)) out += render(inner, stack);
      } else if (Array.isArray(v)) {
        for (const item of v) out += render(inner, [...stack, item]);
      } else if (!falsy(v)) {
        out += render(inner, typeof v === "object" ? [...stack, v] : stack);
      }
      at = close.end;
      re.lastIndex = close.end;
      continue;
    }
    const v = str(lookup(stack, name));
    out += kind === "{" || kind === "&" ? v : escape(v);
  }
  return out + tpl.slice(at);
}

/** The slide as LSC Mobile loads it: `{{{.}}}` becomes the data as JSON, then the page is rendered as a template. */
export function renderSlideTemplate(html: string, data: unknown): string {
  if (!html.includes("{{")) return html;
  return render(html.split("{{{.}}}").join(JSON.stringify(data)), [data]);
}
