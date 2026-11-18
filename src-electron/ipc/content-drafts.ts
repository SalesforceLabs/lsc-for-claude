import { BrowserWindow, ipcMain } from "electron";
import { readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import type { LLMProvider } from "../llm/provider.js";
import type { McpClient } from "../mcp/client.js";
import { parseStudioResult, type StudioCall } from "../engine/app-builder.js";
import {
  ContentDrafter,
  sqliteDraftStore,
  type ContentDraftStore,
  type DraftSync,
} from "../engine/content-drafter.js";
import type { ContentDraft, ContentDraftEvent } from "../engine/content-draft-types.js";
import { isClmRootServed, isEngineClmRoot, registerClmRoot } from "../clm-files.js";

/**
 * Studio → Build → Intelligent Content: pages Roz drafts (content-drafter.ts). The draft's files are laid
 * out in the engine's CLM folder and served to the live player like an org page; the slide thumbnails
 * the iPad shows in its slide strip are drawn here, in a hidden window, and written beside the slides.
 */

export interface ContentDraftDeps {
  mainWindow: BrowserWindow;
  llm: () => LLMProvider | null;
  model: () => string | undefined;
  readyMcpClient: () => Promise<McpClient | null>;
  selectedOrg: () => Promise<{ username: string } | null>;
  store?: ContentDraftStore;
}

const DRAFT_ID = /^[0-9a-f-]{36}$/;
const THUMB_W = 200;
const THUMB_H = 150;

/** `02_x.html` → `02_thumbnail.jpg`, as the server and the iPad name them. */
const thumbnailFor = (slide: string) => {
  const cut = slide.indexOf("_");
  return `${cut >= 0 ? slide.slice(0, cut) : slide}_thumbnail.jpg`;
};

let draftBase: string | null = null;
/** The engine's CLM folder, as the last preview reported it. */
let clmRoot: string | null = null;

/** Where the engine keeps its CLM folder when it could use its usual temp folder (src/private-tmp.ts). */
const usualClmRoot = () =>
  path.join(os.tmpdir(), `lsc-${process.getuid?.() ?? os.userInfo().username}`, "lsc-studio-clm");

/** The draft's first-slide thumbnail as a data URL, when one has been drawn. */
export function draftThumbnail(draftId: string, roots = [clmRoot, usualClmRoot()]): string | undefined {
  if (!DRAFT_ID.test(draftId)) return undefined;
  for (const root of roots) {
    if (!root || !isEngineClmRoot(root)) continue;
    try {
      const jpeg = readFileSync(path.join(root, "drafts", draftId, "thumbnail.jpg"));
      return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    } catch {
      // not drawn yet
    }
  }
  return undefined;
}

const withThumbnail = (d: ContentDraft | null): ContentDraft | null =>
  d && { ...d, thumbnail: draftThumbnail(d.id) };
const reply = (r: ContentDraft | { error: string }) => ("error" in r ? r : withThumbnail(r)!);

/** The URL prefix the CLM folder is served under for drafts, registered again when it was dropped. */
function servedBase(root: string): string | null {
  if (draftBase && isClmRootServed(draftBase)) return draftBase;
  draftBase = registerClmRoot(root);
  return draftBase;
}

/** Loads each slide in a hidden 1024×768 window and writes a small JPEG of it into the draft's folder. */
async function drawThumbnails(draftId: string, sync: DraftSync, names: string[]): Promise<void> {
  if (!DRAFT_ID.test(draftId) || !isEngineClmRoot(sync.player.root)) return;
  clmRoot = sync.player.root;
  const base = servedBase(sync.player.root);
  if (!base) return;
  const dir = path.join(sync.player.root, "drafts", draftId);
  const want = new Set(names);
  const slides = sync.player.slides.filter(
    (s) => want.has(s.name) && s.file.startsWith(`drafts/${draftId}/`)
  );
  if (!slides.length) return;
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setAudioMuted(true);
  try {
    for (const slide of slides) {
      try {
        await Promise.race([
          win.loadURL(base + slide.file),
          new Promise((r) => setTimeout(r, 8_000)),
        ]);
        // Let fonts, images and entry animations settle.
        await new Promise((r) => setTimeout(r, 700));
        const image = (await win.webContents.capturePage()).resize({
          width: THUMB_W,
          height: THUMB_H,
          quality: "good",
        });
        if (image.isEmpty()) continue;
        const jpeg = image.toJPEG(80);
        writeFileSync(path.join(dir, thumbnailFor(slide.name)), jpeg, { mode: 0o600 });
        if (slide === sync.player.slides[0])
          writeFileSync(path.join(dir, "thumbnail.jpg"), jpeg, { mode: 0o600 });
      } catch {
        // one slide that won't draw doesn't stop the others
      }
    }
  } finally {
    win.destroy();
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function registerContentDraftHandlers(deps: ContentDraftDeps): void {
  const call: StudioCall = async (tool, args, timeoutMs = 120_000) => {
    const client = await deps.readyMcpClient();
    if (!client) throw new Error("Engine not started");
    return parseStudioResult(await client.callTool(tool, args, { timeoutMs }));
  };
  const emit = (draftId: string, event: ContentDraftEvent) => {
    if (!deps.mainWindow.isDestroyed())
      deps.mainWindow.webContents.send("contentDraft:event", {
        draftId,
        event: event.type === "draft" ? { ...event, draft: withThumbnail(event.draft)! } : event,
      });
  };
  const store = deps.store ?? sqliteDraftStore;
  store.recoverInterrupted();
  const drafter = new ContentDrafter({
    llm: deps.llm,
    model: deps.model,
    call,
    store,
    emit,
    drawThumbnails,
  });
  const org = async () => (await deps.selectedOrg())?.username.toLowerCase() ?? "";
  const id = (v: unknown) => (typeof v === "string" && DRAFT_ID.test(v) ? v : null);

  ipcMain.handle("contentDraft:list", async () => {
    const o = await org();
    return o ? drafter.list(o).map((d) => withThumbnail(d)!) : [];
  });
  ipcMain.handle("contentDraft:get", (_e, draftId: unknown) =>
    id(draftId) ? withThumbnail(drafter.get(id(draftId)!)) : null
  );
  ipcMain.handle("contentDraft:create", async (_e, prompt: unknown) => {
    const o = await org();
    if (!o) return { error: "Select an org first." };
    if (typeof prompt !== "string") return { error: "Say what the slides should cover." };
    return drafter.create(o, prompt);
  });
  ipcMain.handle("contentDraft:send", (_e, draftId: unknown, prompt: unknown) =>
    id(draftId) && typeof prompt === "string"
      ? reply(drafter.send(id(draftId)!, prompt))
      : { error: "That draft is gone." }
  );
  ipcMain.handle("contentDraft:stop", (_e, draftId: unknown) => {
    if (id(draftId)) drafter.stop(id(draftId)!);
  });
  ipcMain.handle("contentDraft:rename", (_e, draftId: unknown, name: unknown) =>
    id(draftId) && typeof name === "string"
      ? reply(drafter.rename(id(draftId)!, name))
      : { error: "That draft is gone." }
  );
  ipcMain.handle("contentDraft:delete", async (_e, draftId: unknown) => {
    if (id(draftId)) await drafter.delete(id(draftId)!);
  });
  // The player for a draft, served like studio:contentPlayer's: the folder's path stays in this process.
  ipcMain.handle("contentDraft:preview", async (_e, draftId: unknown) => {
    if (!id(draftId)) return { error: "That draft is gone." };
    try {
      const sync = await drafter.preview(id(draftId)!);
      const base = isEngineClmRoot(sync.player.root) ? servedBase(sync.player.root) : null;
      if (base) clmRoot = sync.player.root;
      if (!base) return { error: "The slides weren't laid out where the app can show them." };
      const { root: _root, ...player } = sync.player;
      return { data: { ...player, base, checks: sync.checks } };
    } catch (error) {
      return { error: errorText(error) };
    }
  });
}
