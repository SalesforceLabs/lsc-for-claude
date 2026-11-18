/**
 * One presentation's slides for the iPad preview's live CLM player, laid out on disk the way LSC Mobile
 * keeps them (lifesciences-ios module/CLM): one folder per page, `<pageId>_<contentVersionId>`, holding
 * the page's unzipped ZIP; every top-level `.html` is a slide, in file-name order (CLMDataService.swift:370-390);
 * the slides are rendered as Mustache templates and written beside the original as `<slide>.mustache.html`
 * with the player script in `<head>`. A PDF presentation is one `content.pdf` and each linked page one PDF
 * page; those are drawn here as images. The Electron app serves the folder to a sandboxed frame.
 *
 * Downloads are untrusted: they're unpacked into this user's private temp folder, entries that would land
 * outside it and links are refused, and sizes are capped.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { ID_PATTERN, inList, query, type Row } from "../helpers.js";
import { dataPath, downloadToFile } from "../../salesforce/cli.js";
import { privateTmp } from "../../private-tmp.js";
import { CLM_BRIDGE_FILE, CLM_BRIDGE_JS, injectBridgeTag } from "./clm-bridge.js";
import { renderSlideTemplate } from "./mustache-lite.js";

const run = promisify(execFile);

/** The folder the Electron app agrees to serve (src-electron/clm-files.ts checks the same name). */
export const CLM_ROOT_NAME = "lsc-studio-clm";
/** A page ZIP or presentation PDF larger than this isn't downloaded. */
export const MAX_FILE_BYTES = 150 << 20;
/** Unpacked size per page ZIP. */
export const MAX_UNZIPPED_BYTES = 400 << 20;
export const MAX_ZIP_ENTRIES = 2000;
/** PDF pages drawn per presentation. */
export const MAX_PDF_PAGES = 80;
export const RENDERED = ".mustache.html";
const ASSET_PREFIX = "isadditionalcontent_";
/** PDF pages drawn for one additional-content asset. */
export const MAX_ASSET_PAGES = 40;
const IMAGE_TYPES = new Set(["PNG", "JPG", "JPEG", "GIF"]);

export interface PlayerSlide {
  /** Position in the flattened slide list. */
  index: number;
  pageId: string;
  pageName: string;
  /** Index of the page among the presentation's pages that have slides. */
  pageIndex: number;
  /** The slide's id: its file name (`01_intro.html`), or `pdf page N`. */
  name: string;
  kind: "html" | "pdf";
  /** Path under the root to load: the rendered slide, or the page image for PDF. */
  file: string;
  /** Path under the root of the slide's thumbnail, when the page has one. */
  thumbnail?: string;
  mandatory: boolean;
}

export interface PlayerAsset {
  pageId: string;
  /** The page name gotoSlide matches (`isadditionalcontent_Prescribing_information`). */
  name: string;
  /** What the app's viewer shows as its title: the name without `isadditionalcontent_` (ShowContentViewController.swift:35). */
  title: string;
  /** Images to show top to bottom under the root (a PDF's pages, or the image itself); empty when it can't be shown here. */
  files: string[];
}

export interface PlayerPage {
  id: string;
  name: string;
  sourceSystemIdentifier: string;
}

export interface ContentPlayer {
  /** Absolute folder the files below are relative to. */
  root: string;
  presentation: {
    id: string;
    name: string;
    type: string;
    /** TapTop | TapBottom | SwipeUp | SwipeDown (default SwipeUp, OCEDBPresentation.swift:15-20). */
    gesture: string;
    pinchZoom: boolean;
    doubleTapZoom: boolean;
  };
  pages: PlayerPage[];
  slides: PlayerSlide[];
  /** Additional-content pages: not slides, opened full screen by gotoSlide with their name as the page id. */
  assets: PlayerAsset[];
  /** What the preview couldn't do the way the iPad does, in plain words. */
  notes: string[];
}

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** Top-level slide files of a page folder in the app's order: names containing ".html", not the rendered copies. */
export function slideFiles(names: string[]): string[] {
  return names
    .filter((n) => n.includes(".html") && !n.endsWith(RENDERED))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `02_x.html` → `02_thumbnail.jpg` (CLMDataService.swift:362-368). */
export function thumbnailFor(slide: string): string {
  const cut = slide.indexOf("_");
  return `${cut >= 0 ? slide.slice(0, cut) : slide}_thumbnail.jpg`;
}

/** Normalized `PlayerGestureSectionSide`, defaulting to SwipeUp. */
export function gestureOf(v: unknown): string {
  const g = s(v).replace(/[\s_]/g, "").toLowerCase();
  return (
    { taptop: "TapTop", tapbottom: "TapBottom", swipeup: "SwipeUp", swipedown: "SwipeDown" }[g] ??
    "SwipeUp"
  );
}

/** Whether a ZIP listing is safe to unpack: no absolute paths, no `..`, within the entry count. */
export function safeEntries(names: string[]): boolean {
  if (names.length > MAX_ZIP_ENTRIES) return false;
  return names.every(
    (n) => !n.startsWith("/") && !/^[A-Za-z]:/.test(n) && !n.split(/[\\/]/).includes("..")
  );
}

/** Removes every link under `dir` (a ZIP can carry symlinks that point outside it). */
function dropLinks(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) rmSync(p, { force: true });
    else if (st.isDirectory()) dropLinks(p);
  }
}

async function download(org: string, version: string, dest: string): Promise<void> {
  const res = await downloadToFile(
    await dataPath(org, `/sobjects/ContentVersion/${version}/VersionData`),
    dest,
    org,
    180_000
  );
  if (!res.success) throw new Error(res.error || "Download failed");
}

/** Unpacks a page ZIP into `<root>/<folder>` once; later opens reuse it. */
async function ensurePageFolder(
  org: string,
  root: string,
  folder: string,
  version: string
): Promise<string> {
  const dir = join(root, folder);
  if (existsSync(join(dir, ".ok"))) return dir;
  const work = join(root, `.work-${randomUUID()}`);
  mkdirSync(work, { recursive: true, mode: 0o700 });
  try {
    const zip = join(work, "page.zip");
    await download(org, version, zip);
    const { stdout } = await run("unzip", ["-Z1", zip], { timeout: 30_000, maxBuffer: 8 << 20 });
    const names = stdout.split("\n").filter(Boolean);
    if (!safeEntries(names))
      throw new Error("The page's ZIP has paths outside its folder or too many files.");
    const { stdout: listing } = await run("unzip", ["-l", zip], {
      timeout: 30_000,
      maxBuffer: 8 << 20,
    });
    const total = Number(/^\s*(\d+)\s+\d+\s+files?\s*$/m.exec(listing)?.[1] ?? 0);
    if (total > MAX_UNZIPPED_BYTES) throw new Error("The page's ZIP is too large to unpack here.");
    const out = join(work, "x");
    await run("unzip", ["-q", "-o", zip, "-d", out], { timeout: 120_000 });
    dropLinks(out);
    rmSync(dir, { recursive: true, force: true });
    renameSync(out, dir);
    writeFileSync(join(dir, ".ok"), version);
    return dir;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Draws the PDF's pages `numbers` as `page-N.jpg` in `<root>/<folder>`, downloading `content.pdf` once. */
async function ensurePdfPages(
  org: string,
  root: string,
  folder: string,
  version: string,
  numbers: number[]
): Promise<string> {
  const dir = join(root, folder);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pdf = join(dir, "content.pdf");
  if (!existsSync(join(dir, ".ok"))) {
    const tmp = join(dir, `.content-${randomUUID()}.pdf`);
    try {
      await download(org, version, tmp);
      renameSync(tmp, pdf);
      writeFileSync(join(dir, ".ok"), version);
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  for (const n of numbers) {
    const out = join(dir, `page-${n}`);
    if (existsSync(`${out}.jpg`)) continue;
    await run(
      "pdftoppm",
      ["-f", String(n), "-l", String(n), "-jpeg", "-singlefile", "-scale-to", "1600", pdf, out],
      { timeout: 60_000 }
    ).catch(async () => {
      if (n !== 1) return; // sips draws only the first page
      await run("sips", ["-s", "format", "jpeg", "-Z", "1600", pdf, "--out", `${out}.jpg`], {
        timeout: 60_000,
      });
    });
  }
  return dir;
}

/** An additional-content file as images in `<root>/<folder>`: a PDF's first pages, or the image as it is. */
async function ensureAsset(
  org: string,
  root: string,
  folder: string,
  version: Row
): Promise<string[]> {
  const dir = join(root, folder);
  const id = s(version.Id);
  const type = s(version.FileType).toUpperCase();
  const listed = () =>
    readdirSync(dir)
      .filter((n) => /^(page-\d+\.jpg|asset\.(png|jpg|jpeg|gif))$/.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((n) => `${folder}/${n}`);
  if (existsSync(join(dir, ".ok"))) return listed();
  if (type !== "PDF" && !IMAGE_TYPES.has(type)) return [];
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (type === "PDF") {
    const pdf = join(dir, "content.pdf");
    await download(org, id, pdf);
    await run(
      "pdftoppm",
      ["-l", String(MAX_ASSET_PAGES), "-jpeg", "-scale-to", "1600", pdf, join(dir, "page")],
      { timeout: 120_000 }
    ).catch(() =>
      run("sips", ["-s", "format", "jpeg", "-Z", "1600", pdf, "--out", join(dir, "page-1.jpg")], {
        timeout: 60_000,
      })
    );
  } else {
    await download(org, id, join(dir, `asset.${type.toLowerCase()}`));
  }
  writeFileSync(join(dir, ".ok"), id);
  return listed();
}

/** Runs `fn` over `items` at most `n` at a time, keeping order. */
async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export async function loadContentPlayer(
  org: string,
  presentationId: string,
  userId: string
): Promise<ContentPlayer> {
  if (!ID_PATTERN.test(presentationId)) throw new Error("Not a presentation Id.");
  const [pres] = await query(
    `SELECT Id, Name, Type, IsCustom, SourceSystemIdentifier, PlayerGestureSectionSide, IsPinchZoomEnabled, IsDoubleTapZoomEnabled
     FROM Presentation WHERE Id = '${presentationId}'`,
    org
  );
  if (!pres) throw new Error("That presentation isn't in the org any more.");
  const links = await query(
    `SELECT DisplayOrder, PresentationPageId, PresentationPage.Name, PresentationPage.PageNumber, PresentationPage.ContentDocumentId,
            PresentationPage.IsMandatory, PresentationPage.IsAdditionalContent, PresentationPage.SourceSystemIdentifier
     FROM PresentationLinkedPage
     WHERE PresentationId = '${presentationId}' AND PresentationPageId != null AND PresentationPage.Status = 'Active'
     ORDER BY DisplayOrder`,
    org
  );
  const users = ID_PATTERN.test(userId)
    ? await query(
        `SELECT Id, Name, FirstName, LastName, Email, Username FROM User WHERE Id = '${userId}'`,
        org
      ).catch(() => [] as Row[])
    : [];

  const pageOf = (l: Row) => (l.PresentationPage ?? {}) as Row;
  const docs = [
    ...new Set(links.map((l) => s(pageOf(l).ContentDocumentId)).filter((d) => ID_PATTERN.test(d))),
  ];
  const versions = docs.length
    ? await query(
        `SELECT Id, ContentDocumentId, FileType, ContentSize FROM ContentVersion WHERE IsLatest = true AND ContentDocumentId IN (${inList(docs)})`,
        org
      )
    : [];
  const versionOf = new Map(versions.map((v) => [s(v.ContentDocumentId), v]));

  const root = privateTmp(CLM_ROOT_NAME);
  const type = s(pres.Type).toUpperCase();
  const notes: string[] = [];
  const pages: PlayerPage[] = [];
  const slides: PlayerSlide[] = [];
  const assets: ContentPlayer["assets"] = [];
  const sizeOk = (v: Row | undefined) => {
    if (!v) return false;
    if (Number(v.ContentSize) > MAX_FILE_BYTES) {
      notes.push(
        `A file over ${MAX_FILE_BYTES >> 20} MB wasn't downloaded; its slides are missing here.`
      );
      return false;
    }
    return /^068[a-zA-Z0-9]{12,15}$/.test(s(v.Id));
  };

  for (const l of links.filter((l) => pageOf(l).IsAdditionalContent === true)) {
    const name = s(pageOf(l).Name);
    const v = versionOf.get(s(pageOf(l).ContentDocumentId));
    let files: string[] = [];
    if (sizeOk(v)) {
      try {
        files = await ensureAsset(org, root, `asset_${s(v!.Id)}`, v!);
      } catch (err) {
        notes.push(
          `"${name}" couldn't be downloaded: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (
        !files.length &&
        !IMAGE_TYPES.has(s(v!.FileType).toUpperCase()) &&
        s(v!.FileType).toUpperCase() !== "PDF"
      )
        notes.push(
          `"${name}" is a ${s(v!.FileType) || "file"} the preview can't show; the iPad opens it full screen.`
        );
    }
    assets.push({
      pageId: s(l.PresentationPageId),
      name,
      title: name.startsWith(ASSET_PREFIX) ? name.slice(ASSET_PREFIX.length) : name,
      files,
    });
  }
  const main = links.filter((l) => pageOf(l).IsAdditionalContent !== true);

  if (type === "PDF") {
    // One content.pdf; each linked page is page `pagenumber` (or `displayorder`) of it (CLMPlayerCoordinator.swift:242-249).
    const v = versionOf.get(s(pageOf(main[0] ?? {}).ContentDocumentId));
    const numbered = main
      .slice(0, MAX_PDF_PAGES)
      .map((l) => ({ l, n: Number(pageOf(l).PageNumber) || Number(l.DisplayOrder) || 1 }));
    if (main.length > MAX_PDF_PAGES)
      notes.push(`Only the first ${MAX_PDF_PAGES} pages are drawn here.`);
    if (sizeOk(v)) {
      const folder = `pdf_${s(v!.Id)}`;
      try {
        const dir = await ensurePdfPages(
          org,
          root,
          folder,
          s(v!.Id),
          numbered.map((x) => x.n)
        );
        numbered.forEach(({ l, n }, i) => {
          const page = pageOf(l);
          const file = `${folder}/page-${n}.jpg`;
          if (!existsSync(join(dir, `page-${n}.jpg`))) {
            notes.push(`Page ${n} of the PDF couldn't be drawn here.`);
            return;
          }
          pages.push({
            id: s(l.PresentationPageId),
            name: s(page.Name),
            sourceSystemIdentifier: s(page.SourceSystemIdentifier),
          });
          slides.push({
            index: slides.length,
            pageId: s(l.PresentationPageId),
            pageName: s(page.Name),
            pageIndex: i,
            name: `pdf page ${n}`,
            kind: "pdf",
            file,
            thumbnail: file,
            mandatory: page.IsMandatory === true,
          });
        });
      } catch (err) {
        notes.push(
          `The PDF couldn't be downloaded: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } else {
    const folders = await mapLimit(main, 3, async (l) => {
      const v = versionOf.get(s(pageOf(l).ContentDocumentId));
      if (!sizeOk(v)) return null;
      const folder = `${s(l.PresentationPageId)}_${s(v!.Id)}`;
      try {
        return { folder, dir: await ensurePageFolder(org, root, folder, s(v!.Id)) };
      } catch (err) {
        notes.push(
          `"${s(pageOf(l).Name)}" couldn't be opened: ${err instanceof Error ? err.message : String(err)}`
        );
        return null;
      }
    });
    main.forEach((l, i) => {
      const got = folders[i];
      if (!got) return;
      const page = pageOf(l);
      const files = slideFiles(readdirSync(got.dir));
      if (!files.length) {
        notes.push(
          `"${s(page.Name)}" has no .html file at the top of its ZIP, so the iPad shows no slide for it.`
        );
        return;
      }
      pages.push({
        id: s(l.PresentationPageId),
        name: s(page.Name),
        sourceSystemIdentifier: s(page.SourceSystemIdentifier),
      });
      for (const f of files) {
        const thumb = thumbnailFor(f);
        slides.push({
          index: slides.length,
          pageId: s(l.PresentationPageId),
          pageName: s(page.Name),
          pageIndex: pages.length - 1,
          name: f,
          kind: "html",
          file: `${got.folder}/${f}${RENDERED}`,
          thumbnail: existsSync(join(got.dir, thumb)) ? `${got.folder}/${thumb}` : undefined,
          mandatory: page.IsMandatory === true,
        });
      }
    });

    // Template data (CLMTemplateDataBuilder.swift): the presentation, the viewer; no visit or account is open in the preview.
    const user = users[0];
    const presentationData = {
      id: s(pres.Id),
      name: s(pres.Name),
      iscustom: pres.IsCustom === true,
      sourcesystemidentifier: s(pres.SourceSystemIdentifier),
      pages: pages.map((p) => ({
        id: p.id,
        sourcesystemidentifier: p.sourceSystemIdentifier,
        contentdocumentid: s(
          pageOf(main.find((l) => s(l.PresentationPageId) === p.id) ?? {}).ContentDocumentId
        ),
        slides: slides.filter((x) => x.pageId === p.id).map((x) => ({ name: x.name })),
      })),
    };
    let tagged = false;
    for (const slide of slides) {
      const folder = slide.file.slice(0, slide.file.indexOf("/"));
      const dir = join(root, folder);
      const original = readFileSync(join(dir, slide.name), "utf8");
      if (original.includes("{{")) tagged = true;
      const data = {
        presentations: [presentationData],
        customers: [],
        visits: [],
        user: user
          ? {
              id: s(user.Id),
              name: s(user.Name),
              firstname: s(user.FirstName),
              lastname: s(user.LastName),
              email: s(user.Email),
              username: s(user.Username),
            }
          : {},
        presentationindex: 0,
        pageindex: slide.pageIndex,
        slideindex: slide.index,
        state: "",
      };
      writeFileSync(
        join(dir, slide.name + RENDERED),
        injectBridgeTag(renderSlideTemplate(original, data))
      );
      writeFileSync(join(dir, CLM_BRIDGE_FILE), CLM_BRIDGE_JS);
    }
    if (tagged)
      notes.push(
        "Some slides fill in account or visit data. The preview has no visit open, so those parts are blank, as when a rep opens the presentation outside a visit."
      );
  }

  if (!slides.length && !notes.length)
    notes.push("This presentation has no active pages with content.");
  // Paths stay inside the root (folders are Ids; file names come from readdir of the page's own folder).
  for (const sl of slides)
    if (relative(root, join(root, sl.file)).startsWith("..")) throw new Error("Bad slide path.");

  return {
    root,
    presentation: {
      id: s(pres.Id),
      name: s(pres.Name),
      type,
      gesture: gestureOf(pres.PlayerGestureSectionSide),
      pinchZoom: pres.IsPinchZoomEnabled !== false,
      doubleTapZoom: pres.IsDoubleTapZoomEnabled !== false,
    },
    pages,
    slides,
    assets,
    notes: [...new Set(notes)],
  };
}
