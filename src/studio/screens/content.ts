/** Intelligent Content grid (CLMGridViewController) — what the viewer's iPad shows. */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ID_PATTERN, inList, query, type Row } from "../helpers.js";
import { dataPath, downloadToFile } from "../../salesforce/cli.js";
import type { ScreenContext } from "./context.js";
import { privateTmp } from "../../private-tmp.js";

const run = promisify(execFile);

export interface PublishedContentCard {
  id: string;
  name: string;
  type: string;
  /** Linked active pages (CLMPresentationItemViewModel.slideNames.count; for ZIP the app counts .html files, which we don't open). */
  pages: number;
  /** Medium date in the viewer's locale and zone (actualLastModifiedDate). */
  date: string;
  isCustom: boolean;
  ownedByViewer: boolean;
  /** cansendbyemail: the card gets a share button. */
  shareable: boolean;
  /** Downscaled first-page image as a data URL; undefined = the #E5E5E5 placeholder. */
  thumbnail?: string;
  /** Images of later pages (index 0 = page 2), rendered read-only from the page files; a missing entry shows a stand-in. */
  pageThumbnails?: (string | null)[];
}

export interface PublishedContentSection {
  /** "" renders as "No Category". */
  title: string;
  cardIds: string[];
}

export interface PublishedContent {
  /** CLMGridViewController: 4 columns with orgHasContentLibEnhancements (assumed on; its endpoint isn't readable), else 3. */
  columns: number;
  /** Segments: "Presentations" | "My Presentations" (ManageCustomPresentation) | "Favorites". */
  segments: string[];
  /** "+ New": ManageCustomPresentation and Presentation creatable. */
  canCreate: boolean;
  cards: PublishedContentCard[];
  /** Whether sections come from topics (the Topic table is synced); false = one untitled section. */
  hasTags: boolean;
  sections: PublishedContentSection[];
}

const DEFAULT_SCOPE = "Status = 'Active' AND (DeactivationDate = NULL OR DeactivationDate >= TODAY)";
const THUMBNAIL_CARDS = 12;
/** Later pages rendered per PDF presentation (the viewer shows stand-ins past this). */
const PAGE_THUMBNAILS = 5;
/** Larger files keep the placeholder: the whole file is downloaded to draw one page. */
const THUMBNAIL_MAX_BYTES = 25 << 20;

/** Today's date (yyyy-mm-dd) in the viewer's zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** DateFormatter .medium date, no time, in the viewer's locale and zone. */
export function mediumDate(iso: string, format: { timeZone: string; locale: string }): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(format.locale, { timeZone: format.timeZone, dateStyle: "medium" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(d);
  }
}

/** CLMDataService: activation null or <= today, deactivation null or > today (dates compare as yyyy-mm-dd). */
export function isCurrent(activation: unknown, deactivation: unknown, today: string): boolean {
  const a = typeof activation === "string" ? activation : "";
  const d = typeof deactivation === "string" ? deactivation : "";
  return (!a || a <= today) && (!d || d > today);
}

/** Case-insensitive title order (localizedCaseInsensitiveCompare). */
export function byTitle(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}

const TAG_ORDER = (title: string) => (title === "" ? "3_" : `2_${title}`);

/**
 * CLMGridPresenter sections: a presentation sits in every section whose topic
 * it has, none = "No Category" (last); topics alphabetical; cards by title.
 */
export function buildSections(cards: { id: string; name: string }[], topicsById: Map<string, string[]>, hasTags: boolean): PublishedContentSection[] {
  const sorted = [...cards].sort(byTitle);
  if (!hasTags) return [{ title: "", cardIds: sorted.map((c) => c.id) }];
  const by = new Map<string, string[]>();
  for (const c of sorted) {
    const topics = topicsById.get(c.id);
    for (const t of topics?.length ? topics : [""]) by.set(t, [...(by.get(t) ?? []), c.id]);
  }
  return [...by]
    .sort(([a], [b]) => TAG_ORDER(a).localeCompare(TAG_ORDER(b), undefined, { sensitivity: "base" }))
    .map(([title, cardIds]) => ({ title, cardIds }));
}

const chunks = <T>(list: T[], n: number): T[][] => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const s = (v: unknown) => (typeof v === "string" ? v : "");

export async function collectContent(ctx: ScreenContext): Promise<PublishedContent | undefined> {
  const { org, userId } = ctx;
  const scope = ctx.scope("Presentation");
  if (scope === undefined) return undefined; // the device doesn't sync presentations
  const today = todayIn(ctx.format.timeZone);

  const [settings, presentations] = await Promise.all([
    ctx.config(["PresentationSettings"]).catch(() => ({}) as Record<string, Row>),
    query(
      `SELECT Id, Name, Type, ActivationDate, DeactivationDate, LastModifiedDate, IsCustom, OwnerId, CanSendByEmail FROM Presentation WHERE ${scope || DEFAULT_SCOPE}`,
      org
    ),
  ]);
  const current = presentations.filter((p) => isCurrent(p.ActivationDate, p.DeactivationDate, today));
  const ids = current.map((p) => s(p.Id)).filter((id) => ID_PATTERN.test(id));

  // At least one active linked page, in display order; and the viewer's read access (sharing).
  const [links, readable] = await Promise.all([
    Promise.all(
      chunks(ids, 200).map((c) =>
        query(
          `SELECT PresentationId, DisplayOrder, PresentationPage.PageNumber, PresentationPage.ContentDocumentId FROM PresentationLinkedPage
           WHERE PresentationId IN (${inList(c)}) AND PresentationPage.Status = 'Active' ORDER BY PresentationId, DisplayOrder`,
          org
        )
      )
    ).then((r) => r.flat()),
    Promise.all(
      chunks(ids, 200).map((c) => query(`SELECT RecordId FROM UserRecordAccess WHERE UserId = '${userId}' AND HasReadAccess = true AND RecordId IN (${inList(c)})`, org))
    ).then((r) => new Set(r.flat().map((x) => s(x.RecordId).slice(0, 15)))),
  ]);
  const linked = new Map<string, Row[]>();
  for (const l of links) linked.set(s(l.PresentationId), [...(linked.get(s(l.PresentationId)) ?? []), l]);

  const visible = current.filter((p) => linked.has(s(p.Id)) && readable.has(s(p.Id).slice(0, 15)));
  const cards: PublishedContentCard[] = visible.map((p) => ({
    id: s(p.Id),
    name: s(p.Name),
    type: s(p.Type),
    pages: linked.get(s(p.Id))?.length ?? 0,
    date: mediumDate(s(p.LastModifiedDate), ctx.format), // OfflineLastModifiedDate isn't a queryable column; the app falls back to this
    isCustom: p.IsCustom === true,
    ownedByViewer: s(p.OwnerId).slice(0, 15) === userId.slice(0, 15),
    shareable: p.CanSendByEmail === true,
  }));
  cards.sort(byTitle);

  // PresentationSettings is a custom setting the Admin Console can't read (its configurations endpoint 404s from the CLI); when absent, assume the device's value (on).
  const manage = settings.PresentationSettings ? settings.PresentationSettings.ManageCustomPresentation === true : true;
  const [topics, canCreate] = await Promise.all([topicsByPresentation(cards.map((c) => c.id), org), manage ? canCreatePresentation(userId, org) : false]);

  await addThumbnails(cards.slice(0, THUMBNAIL_CARDS), linked, org);
  await addPageThumbnails(cards.slice(0, THUMBNAIL_CARDS), linked, org);

  return {
    columns: 4,
    segments: manage ? ["Presentations", "My Presentations", "Favorites"] : ["Presentations", "Favorites"],
    canCreate,
    cards,
    hasTags: topics !== undefined,
    sections: buildSections(cards, topics ?? new Map(), topics !== undefined),
  };
}

/** Topic names per presentation; undefined when Topic can't be read (the app then shows one untitled section). */
async function topicsByPresentation(ids: string[], org: string): Promise<Map<string, string[]> | undefined> {
  try {
    const out = new Map<string, string[]>();
    for (const c of chunks(ids, 200)) {
      const rows = await query(`SELECT EntityId, Topic.Name FROM TopicAssignment WHERE EntityId IN (${inList(c)})`, org);
      for (const r of rows) {
        const name = s((r.Topic as Row | null)?.Name);
        if (name) out.set(s(r.EntityId), [...(out.get(s(r.EntityId)) ?? []), name]);
      }
    }
    return out;
  } catch {
    return undefined;
  }
}

/** Presentation creatable through any permission set the viewer holds (P canCreatePresentation). */
async function canCreatePresentation(userId: string, org: string): Promise<boolean> {
  try {
    const rows = await query(
      `SELECT Id FROM ObjectPermissions WHERE SobjectType = 'Presentation' AND PermissionsCreate = true
       AND ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${userId}')`,
      org
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * First-page images (CLMDataService L198-214): ZIP = 01_thumbnail.jpg in the
 * first linked page's file; PDF = the page numbered by the first linked page,
 * rendered here (the app uses a prebuilt <n-1>_thumbnail.jpg). Files go in a
 * fresh temp dir, are untrusted, and only a downscaled JPEG leaves it.
 */
async function addThumbnails(cards: PublishedContentCard[], linked: Map<string, Row[]>, org: string): Promise<void> {
  const first = new Map<string, { doc: string; page: number }>();
  for (const c of cards) {
    const l = linked.get(c.id)?.[0];
    const page = l?.PresentationPage as Row | null | undefined;
    if (page && ID_PATTERN.test(s(page.ContentDocumentId))) first.set(c.id, { doc: s(page.ContentDocumentId), page: Number(page.PageNumber) || 1 });
  }
  const docs = [...new Set([...first.values()].map((f) => f.doc))];
  if (!docs.length) return;
  let versions: Row[];
  try {
    versions = await query(`SELECT Id, ContentDocumentId, ContentSize FROM ContentVersion WHERE IsLatest = true AND ContentDocumentId IN (${inList(docs)})`, org);
  } catch {
    return;
  }
  const versionOf = new Map(versions.filter((v) => Number(v.ContentSize) <= THUMBNAIL_MAX_BYTES).map((v) => [s(v.ContentDocumentId), s(v.Id)]));
  const cache = privateTmp("lsc-studio-content-thumbs");
  await Promise.all(
    cards.map(async (c) => {
      const f = first.get(c.id);
      const version = f && versionOf.get(f.doc);
      if (!f || !version || !/^068[a-zA-Z0-9]{12,15}$/.test(version)) return;
      const file = join(cache, `${createHash("sha1").update(`${version}:${c.type}:${f.page}`).digest("hex")}.jpg`);
      try {
        if (!existsSync(file)) {
          const bytes = await renderThumbnail(version, c.type, f.page, org);
          if (!bytes) return;
          writeFileSync(file, bytes);
        }
        c.thumbnail = `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;
      } catch {
        /* placeholder */
      }
    })
  );
}

/**
 * Later pages (2..PAGE_THUMBNAILS+1): each linked page names its own file. PDF = that file's page number;
 * ZIP = the page's own file carries its 01_thumbnail.jpg (CLMDataService.thumbnailUrlFor: "<slide prefix>_thumbnail.jpg"
 * in the sequence folder, the same image the app's page strip shows). Page HTML is never opened.
 */
async function addPageThumbnails(cards: PublishedContentCard[], linked: Map<string, Row[]>, org: string): Promise<void> {
  const want = new Map<string, { doc: string; page: number }[]>();
  for (const c of cards) {
    const pages = (linked.get(c.id) ?? []).slice(1, 1 + PAGE_THUMBNAILS).map((l) => l.PresentationPage as Row | null | undefined);
    want.set(
      c.id,
      pages.map((p) => ({ doc: p && ID_PATTERN.test(s(p.ContentDocumentId)) ? s(p.ContentDocumentId) : "", page: Number(p?.PageNumber) || 1 }))
    );
  }
  const docs = [...new Set([...want.values()].flat().map((w) => w.doc).filter(Boolean))];
  if (!docs.length) return;
  let versions: Row[];
  try {
    versions = await query(`SELECT Id, ContentDocumentId, ContentSize FROM ContentVersion WHERE IsLatest = true AND ContentDocumentId IN (${inList(docs)})`, org);
  } catch {
    return;
  }
  const versionOf = new Map(versions.filter((v) => Number(v.ContentSize) <= THUMBNAIL_MAX_BYTES).map((v) => [s(v.ContentDocumentId), s(v.Id)]));
  const cache = privateTmp("lsc-studio-content-thumbs");
  await Promise.all(
    cards.map(async (c) => {
      const pages = want.get(c.id);
      if (!pages?.length) return;
      const out: (string | null)[] = [];
      for (const w of pages) {
        const version = versionOf.get(w.doc);
        if (!version || !/^068[a-zA-Z0-9]{12,15}$/.test(version)) {
          out.push(null);
          continue;
        }
        const file = join(cache, `${createHash("sha1").update(`${version}:${c.type}:${w.page}`).digest("hex")}.jpg`);
        try {
          if (!existsSync(file)) {
            const bytes = await renderThumbnail(version, c.type, w.page, org);
            if (!bytes) {
              out.push(null);
              continue;
            }
            writeFileSync(file, bytes);
          }
          out.push(`data:image/jpeg;base64,${readFileSync(file).toString("base64")}`);
        } catch {
          out.push(null);
        }
      }
      if (out.some(Boolean)) c.pageThumbnails = out;
    })
  );
}

/** Downloaded sources by version, shared by the thumbnails cut from one file (a deck's pages) and dropped after a minute. */
const sources = new Map<string, Promise<string>>();
const SOURCE_KEEP_MS = 60_000;

function sourceFile(org: string, version: string, type: string): Promise<string> {
  const key = `${org}\u0000${version}\u0000${type}`;
  const held = sources.get(key);
  if (held) return held;
  const dir = privateTmp("lsc-studio-content-src");
  const file = join(dir, `${createHash("sha1").update(key).digest("hex")}.${type === "PDF" ? "pdf" : "zip"}`);
  const fetched = dataPath(org, `/sobjects/ContentVersion/${version}/VersionData`).then((path) => downloadToFile(path, file, org, 120000)).then((res) => {
    if (!res.success) throw new Error(res.error || "Download failed");
    return file;
  });
  sources.set(key, fetched);
  const drop = () => {
    if (sources.get(key) === fetched) sources.delete(key);
    rmSync(file, { force: true });
  };
  fetched.then(
    () => setTimeout(drop, SOURCE_KEEP_MS).unref(),
    drop
  );
  return fetched;
}

async function renderThumbnail(version: string, type: string, page: number, org: string): Promise<Buffer | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "lsc-content-"));
  try {
    const src = await sourceFile(org, version, type);
    const out = join(dir, "out.jpg");
    if (type === "PDF") {
      try {
        await run("pdftoppm", ["-f", String(page), "-l", String(page), "-jpeg", "-singlefile", "-scale-to", "640", src, join(dir, "out")], { timeout: 60000 });
      } catch {
        if (page !== 1) return undefined; // sips renders only the first page
        await run("sips", ["-s", "format", "jpeg", "-Z", "640", src, "--out", out], { timeout: 60000 });
      }
    } else {
      const { stdout } = await run("unzip", ["-Z1", src], { timeout: 30000, maxBuffer: 4 << 20 });
      const entry = stdout.split("\n").find((n) => /(^|\/)01_thumbnail\.jpg$/.test(n));
      if (!entry) return undefined;
      await run("unzip", ["-o", "-j", src, entry, "-d", join(dir, "x")], { timeout: 30000 });
      await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "70", "-Z", "640", join(dir, "x", "01_thumbnail.jpg"), "--out", out], { timeout: 60000 });
    }
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
