/**
 * Pages Roz drafts for Intelligent Content (Studio → Build → Intelligent Content → Draft pages with Roz).
 * A draft is a page folder like one unpacked from an HTML ZIP page, kept in the engine's CLM folder at
 * `drafts/<draftId>` so the live player serves it the way it serves the org's pages. Its slides are
 * rendered with the template data a rep outside a visit gets; the app writes the slide thumbnails
 * (`NN_thumbnail.jpg`, `thumbnail.jpg`) after each write. On apply, `zipDraft` packs the folder
 * (without the rendered copies or the bridge) for upload as a new PresentationPage.
 */

import archiver from "archiver";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { privateTmp } from "../../private-tmp.js";
import { CLM_BRIDGE_FILE, CLM_BRIDGE_JS, injectBridgeTag } from "../screens/clm-bridge.js";
import {
  CLM_ROOT_NAME,
  RENDERED,
  slideFiles,
  thumbnailFor,
  type ContentPlayer,
  type PlayerSlide,
} from "../screens/content-player.js";
import { renderSlideTemplate } from "../screens/mustache-lite.js";
import type { DraftCheck, DraftFile } from "./types.js";

export const DRAFT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_DRAFT_FILES = 60;
export const MAX_DRAFT_FILE_BYTES = 2 << 20;
export const MAX_DRAFT_BYTES = 10 << 20;
const PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const EXTENSIONS = new Set([
  "html",
  "css",
  "js",
  "json",
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "woff",
  "woff2",
  "txt",
]);
const THUMBS = /(^|\/)(\d+_)?thumbnail\.jpg$/i;

/** Where draft `id`'s files are (made when missing). */
export function draftDir(id: string): string {
  if (!DRAFT_ID.test(id)) throw new Error("Not a draft id.");
  return privateTmp(CLM_ROOT_NAME, "drafts", id);
}

export function draftExists(id: string): boolean {
  return DRAFT_ID.test(id) && slideFiles(readdirSync(draftDir(id))).length > 0;
}

/** What's wrong with a file list before anything is written (paths, types, sizes). Empty when it can be written. */
export function fileProblems(files: DraftFile[]): string[] {
  const out: string[] = [];
  if (files.length > MAX_DRAFT_FILES) out.push(`At most ${MAX_DRAFT_FILES} files.`);
  let total = 0;
  const seen = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    if (
      parts.length > 2 ||
      !parts.every((p) => PART.test(p)) ||
      parts.some((p) => p.startsWith("."))
    )
      out.push(`${f.path}: use a plain name, at most one folder deep (like img/logo.svg).`);
    const ext = f.path.split(".").pop()!.toLowerCase();
    if (!EXTENSIONS.has(ext)) out.push(`${f.path}: .${ext} files aren't kept.`);
    if (f.path.endsWith(RENDERED) || f.path === CLM_BRIDGE_FILE)
      out.push(`${f.path}: that name is used by the player.`);
    if (THUMBS.test(f.path)) out.push(`${f.path}: thumbnails are drawn by the app.`);
    if (parts.length > 1 && ext === "html")
      out.push(`${f.path}: slides go at the top, not in a folder.`);
    if (seen.has(f.path.toLowerCase())) out.push(`${f.path} is in the list twice.`);
    seen.add(f.path.toLowerCase());
    const bytes = f.base64 ? Buffer.byteLength(f.content, "base64") : Buffer.byteLength(f.content);
    if (bytes > MAX_DRAFT_FILE_BYTES)
      out.push(`${f.path} is over ${MAX_DRAFT_FILE_BYTES >> 20} MB.`);
    total += bytes;
  }
  if (total > MAX_DRAFT_BYTES) out.push(`The files come to over ${MAX_DRAFT_BYTES >> 20} MB.`);
  return out;
}

/** Local files a slide or style sheet points at (`src`, `href`, `url(...)`), and outside ones (http, https, //). */
export function references(text: string): { local: string[]; external: string[] } {
  const local = new Set<string>();
  const external = new Set<string>();
  const re =
    /(?:\b(?:src|href|poster)\s*=\s*["']([^"']+)["'])|(?:url\(\s*["']?([^"')]+)["']?\s*\))|(?:@import\s+["']([^"']+)["'])/gi;
  for (const m of text.matchAll(re)) {
    const ref = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (
      !ref ||
      ref.startsWith("#") ||
      /^(data|javascript|mailto|tel|about):/i.test(ref) ||
      ref.includes("{{")
    )
      continue;
    if (/^(https?:)?\/\//i.test(ref)) external.add(ref);
    else local.add(ref.split(/[?#]/)[0].replace(/^\.\//, ""));
  }
  return { local: [...local], external: [...external] };
}

const listFiles = (dir: string, prefix = ""): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? prefix
            ? []
            : listFiles(join(dir, e.name), `${e.name}/`)
          : e.isFile()
            ? [`${prefix}${e.name}`]
            : []
      )
    : [];

/** The draft's own files (not the rendered copies, the bridge or thumbnails). */
export function draftFiles(id: string): string[] {
  return listFiles(draftDir(id))
    .filter((f) => !f.endsWith(RENDERED) && f !== CLM_BRIDGE_FILE && !THUMBS.test(f))
    .sort();
}

/** How the draft would do as a page: what keeps it from being one (errors) and what the iPad does differently (warnings). */
export function checkDraft(id: string): DraftCheck[] {
  const dir = draftDir(id);
  const files = draftFiles(id);
  const have = new Set(files.map((f) => f.toLowerCase()));
  const checks: DraftCheck[] = [];
  const slides = slideFiles(files.filter((f) => !f.includes("/")));
  if (!slides.length)
    checks.push({
      level: "error",
      message: "There's no slide: add an .html file at the top, like 01_intro.html.",
    });
  for (const sl of slides) {
    if (!/^\d{2,}_/.test(sl))
      checks.push({
        level: "warning",
        file: sl,
        message:
          "The iPad orders slides by file name and finds each one's thumbnail by its number: name it like 01_intro.html.",
      });
    const html = readFileSync(join(dir, sl), "utf8");
    if (!/<meta[^>]+name=["']viewport["']/i.test(html))
      checks.push({
        level: "warning",
        file: sl,
        message:
          'No viewport tag: add <meta name="viewport" content="width=1024, height=768"> so it fits the iPad.',
      });
  }
  for (const f of files.filter((f) => /\.(html|css)$/i.test(f))) {
    const { local, external } = references(readFileSync(join(dir, f), "utf8"));
    for (const ref of external)
      checks.push({
        level: "error",
        file: f,
        message: `${ref} is on the internet. Reps often present offline, so everything must be in the page: put the file in the draft or leave it out.`,
      });
    const base = f.includes("/") ? `${f.slice(0, f.indexOf("/"))}/` : "";
    for (const ref of local) {
      const path = ref.startsWith("../") ? ref.slice(3) : `${base}${ref}`;
      if (!have.has(decodeURI(path).toLowerCase()) && !THUMBS.test(path))
        checks.push({ level: "error", file: f, message: `${ref} isn't in the draft.` });
    }
  }
  return checks;
}

/**
 * Writes `files` into draft `id` (all of them in place of the old ones when `replace`), then renders its slides.
 * Throws with the problems when the list can't be written.
 */
export function writeDraft(id: string, files: DraftFile[], replace: boolean): void {
  const problems = fileProblems(files);
  if (problems.length) throw new Error(problems.join(" "));
  const dir = draftDir(id);
  if (replace) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  for (const f of files) {
    const at = join(dir, f.path);
    mkdirSync(dirname(at), { recursive: true, mode: 0o700 });
    writeFileSync(at, f.base64 ? Buffer.from(f.content, "base64") : f.content, { mode: 0o600 });
  }
  const total = listFiles(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  if (total > MAX_DRAFT_BYTES * 2)
    throw new Error(`The draft is over ${(MAX_DRAFT_BYTES * 2) >> 20} MB.`);
}

export function deleteDraft(id: string): void {
  rmSync(draftDir(id), { recursive: true, force: true });
}

/** The draft as the live player plays it: rendered slides with a rep's template data outside a visit. */
export function draftPlayer(id: string, name: string): ContentPlayer {
  const root = privateTmp(CLM_ROOT_NAME);
  const dir = draftDir(id);
  const folder = `drafts/${id}`;
  const pageId = `new:${id}`;
  const files = slideFiles(readdirSync(dir));
  const slides: PlayerSlide[] = files.map((f, index) => {
    const thumb = thumbnailFor(f);
    return {
      index,
      pageId,
      pageName: name,
      pageIndex: 0,
      name: f,
      kind: "html",
      file: `${folder}/${f}${RENDERED}`,
      thumbnail: existsSync(join(dir, thumb)) ? `${folder}/${thumb}` : undefined,
      mandatory: false,
    };
  });
  const presentationData = {
    id: "",
    name,
    iscustom: false,
    sourcesystemidentifier: "",
    pages: [
      {
        id: pageId,
        sourcesystemidentifier: "",
        contentdocumentid: "",
        slides: files.map((name) => ({ name })),
      },
    ],
  };
  for (const sl of slides) {
    const data = {
      presentations: [presentationData],
      customers: [],
      visits: [],
      user: {},
      presentationindex: 0,
      pageindex: 0,
      slideindex: sl.index,
      state: "",
    };
    writeFileSync(
      join(dir, sl.name + RENDERED),
      injectBridgeTag(renderSlideTemplate(readFileSync(join(dir, sl.name), "utf8"), data))
    );
  }
  writeFileSync(join(dir, CLM_BRIDGE_FILE), CLM_BRIDGE_JS);
  return {
    root,
    presentation: {
      id: pageId,
      name,
      type: "ZIP",
      gesture: "SwipeUp",
      pinchZoom: true,
      doubleTapZoom: true,
    },
    pages: [{ id: pageId, name, sourceSystemIdentifier: "" }],
    slides,
    assets: [],
    notes: slides.length ? [] : ["The draft has no slide yet."],
  };
}

/** Packs draft `id` as an HTML ZIP page into a new file under the temp folder; returns its path. */
export async function zipDraft(id: string): Promise<string> {
  const dir = draftDir(id);
  const files = listFiles(dir).filter((f) => !f.endsWith(RENDERED) && f !== CLM_BRIDGE_FILE);
  if (!slideFiles(files.filter((f) => !f.includes("/"))).length)
    throw new Error("The draft has no slide.");
  const out = join(privateTmp("lsc-studio-content-upload"), `${id}-${Date.now()}.zip`);
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(out, { mode: 0o600 });
    const archive = archiver("zip", { zlib: { level: 9 } });
    stream.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(stream);
    for (const f of files) archive.file(join(dir, f), { name: f });
    void archive.finalize();
  });
  return out;
}
