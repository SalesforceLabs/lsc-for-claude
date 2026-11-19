import { randomUUID } from "crypto";
import { createReadStream, realpathSync, statSync } from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { FRAME_SCHEME } from "./frame-docs.js";

/**
 * The iPad preview's live CLM player (src/studio/screens/content-player.ts) unpacks a presentation's
 * pages into the engine's private temp folder, `<tmp>/lsc-<user>/lsc-studio-clm`. Slides are HTML from
 * the org, so each opened presentation folder is given a random token and served here as
 * lsc-frame://clm/<token>/<page folder>/<file> to a sandboxed frame (scripts, no same-origin). Its policy
 * lets the slide load only files under its own token: no network, no other documents, no forms. Paths
 * are resolved and refused unless they stay inside the folder, links followed.
 */

export const CLM_HOST = "clm";
const ROOT_NAME = "lsc-studio-clm";
/** Presentations served at once; opening another drops the oldest. */
const MAX_ROOTS = 8;

const roots = new Map<string, string>();

function real(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/** Whether `dir` is the engine's CLM folder, `<tmp>/lsc-<user>/lsc-studio-clm`, links followed. */
export function isEngineClmRoot(dir: unknown, tmp: string = os.tmpdir()): boolean {
  if (typeof dir !== "string" || !path.isAbsolute(dir)) return false;
  const base = real(tmp);
  const at = real(dir);
  if (!base || !at) return false;
  const parts = path.relative(base, at).split(path.sep);
  return parts.length === 2 && parts[0].startsWith("lsc-") && parts[1] === ROOT_NAME;
}

/** Serves `dir` under a new token and returns the URL prefix its files are under, or null when it isn't the CLM folder. */
export function registerClmRoot(dir: unknown, tmp?: string): string | null {
  if (!isEngineClmRoot(dir, tmp)) return null;
  const token = randomUUID();
  roots.set(token, real(dir as string)!);
  while (roots.size > MAX_ROOTS) roots.delete(roots.keys().next().value!);
  return `${FRAME_SCHEME}://${CLM_HOST}/${token}/`;
}

/** Stops serving a presentation once its player is closed. */
export function releaseClmRoot(prefix: unknown): void {
  const token =
    typeof prefix === "string"
      ? /^lsc-frame:\/\/clm\/([0-9a-f-]{36})\//.exec(prefix)?.[1]
      : undefined;
  if (token) roots.delete(token);
}

/** The policy each served file carries: everything only from its own token's folder. */
export function clmCsp(token: string): string {
  const self = `${FRAME_SCHEME}://${CLM_HOST}/${token}/`;
  return [
    "default-src 'none'",
    `script-src ${self} 'unsafe-inline' 'unsafe-eval'`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob:`,
    `media-src ${self} data: blob:`,
    `font-src ${self} data:`,
    `connect-src ${self}`,
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

/** The file a CLM URL names, inside its token's folder, else null. */
export function clmFilePath(url: string): { token: string; file: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${FRAME_SCHEME}:` || u.hostname !== CLM_HOST) return null;
  const m = /^\/([0-9a-f-]{36})\/(.+)$/.exec(u.pathname);
  const root = m ? roots.get(m[1]) : undefined;
  if (!m || !root) return null;
  let rest: string;
  try {
    rest = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (rest.includes("\0")) return null;
  const file = real(path.join(root, path.posix.normalize("/" + rest)));
  if (!file) return null;
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return { token: m[1], file };
}

/** The protocol's answer for lsc-frame://clm/…: the file with its type and policy, a byte range when asked, else 404. */
export function clmResponse(request: Request): Response {
  const hit = clmFilePath(request.url);
  if (!hit) return new Response("Not found", { status: 404 });
  let size: number;
  try {
    const st = statSync(hit.file);
    if (!st.isFile()) return new Response("Not found", { status: 404 });
    size = st.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": TYPES[path.extname(hit.file).toLowerCase()] ?? "application/octet-stream",
    "Content-Security-Policy": clmCsp(hit.token),
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    }
    start = Math.max(0, start);
    return new Response(
      Readable.toWeb(createReadStream(hit.file, { start, end })) as ReadableStream,
      {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        },
      }
    );
  }
  return new Response(Readable.toWeb(createReadStream(hit.file)) as ReadableStream, {
    status: 200,
    headers: { ...headers, "Content-Length": String(size) },
  });
}

/** Whether a prefix `registerClmRoot` returned is still served (opening several presentations drops the oldest). */
export function isClmRootServed(prefix: unknown): boolean {
  const token =
    typeof prefix === "string"
      ? /^lsc-frame:\/\/clm\/([0-9a-f-]{36})\//.exec(prefix)?.[1]
      : undefined;
  return !!token && roots.has(token);
}
