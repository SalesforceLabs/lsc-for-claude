import { app, BrowserWindow, protocol, net, session } from "electron";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { STUDIO_BROWSER_PARTITION } from "./studio-browser.js";
import { applyAppIcon } from "./app-icon.js";
import { applyTheme, watchSystemTheme, windowBackground } from "./theme.js";
import { loadSettings } from "./settings.js";
import { openExternalSafely } from "./external-url.js";
import { documentationDir, localProtocolPath } from "./app-files.js";
import { FRAME_SCHEME, frameDocResponse } from "./frame-docs.js";
import { answerOnlyFromApp } from "./ipc-guard.js";
import { fixPathForPackagedApp } from "./shell-path.js";
import { startUpdater } from "./updater.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// A FORCE_COLOR inherited from the terminal makes `sf ... --json` colour its
// JSON; the sf calls here and the MCP server spawned below inherit this env.
delete process.env.FORCE_COLOR;

// Only load the Vite dev server when explicitly told to (set by `electron:dev`).
// Running the built app (`electron:start`) leaves this unset so we load the
// bundled renderer directly instead of probing a dev server that isn't running.
const rendererDevUrl = process.env.LSC_RENDERER_URL;

// Register a custom protocol to serve local files (PDFs, etc.) to the renderer.
// This avoids file:// security restrictions in iframes.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "lsc-local",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  // The live LWC previews' documents (frame-docs.ts).
  { scheme: FRAME_SCHEME, privileges: { standard: true, secure: true } },
]);

let mainWindow: BrowserWindow | null = null;

/** Partitions Studio's preview browsers have attached with, to recognize their guests. */
const previewPartitions = new Set<string>();

/** The built renderer's page; in dev the Vite server's pages are the app too. */
const appPage = path.join(__dirname, "..", "dist-renderer", "index.html");
function isAppPage(url: string): boolean {
  if (rendererDevUrl && url.startsWith(rendererDevUrl)) return true;
  try {
    const u = new URL(url);
    return u.protocol === "file:" && path.resolve(fileURLToPath(u)) === path.resolve(appPage);
  } catch {
    return false;
  }
}

answerOnlyFromApp((event) => {
  const frame = event.senderFrame;
  const main = mainWindow?.webContents.mainFrame;
  return !!main && event.sender === mainWindow!.webContents && !!frame && frame.processId === main.processId && frame.routingId === main.routingId && isAppPage(frame.url);
});

/** A file: URL of one of the app's PDFs (documentation/), which the doc panel shows in a webview. */
function isDocumentationPdf(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "file:") return false;
    const file = path.resolve(fileURLToPath(u));
    return file.startsWith(documentationDir + path.sep) && file.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

// Packaged builds were named "LSC Assistant" before the rename to Roz; keep their data folder.
if (app.isPackaged) app.setPath("userData", path.join(app.getPath("appData"), "LSC Assistant"));
// Opened from Finder, the app has launchd's bare PATH; sf and the Node it runs on need the shell's.
fixPathForPackagedApp(app.isPackaged);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    title: "Roz for LSC",
    // Matches --bg-primary so the window never flashes the other palette before the renderer paints.
    backgroundColor: windowBackground(),
    titleBarStyle: "hiddenInset",
    // Centred in the 52px sidebar header (--toolbar-height).
    trafficLightPosition: { x: 18, y: 19 },
    webPreferences: {
      preload: path.join(__dirname, "..", "src-electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  // Log renderer console messages to stdout for debugging
  mainWindow.webContents.on("console-message", (event) => {
    console.log(`[Renderer ${event.level.toUpperCase()}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });

  // Register IPC handlers
  registerIpcHandlers(mainWindow);

  if (rendererDevUrl) {
    // Dev mode: try the Vite dev server, fall back to the built bundle if it's down.
    mainWindow.loadURL(rendererDevUrl).catch(() => {
      mainWindow!.loadFile(
        path.join(__dirname, "..", "dist-renderer", "index.html")
      );
    });
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "..", "dist-renderer", "index.html")
    );
  }

  // The window only ever shows the app. A link that would load another page in it (and give that page the
  // preload's API) opens in the system browser instead, if it's a web or mail link, and is dropped otherwise.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppPage(url)) return;
    event.preventDefault();
    openExternalSafely(url);
  });
  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (!isAppPage(url)) event.preventDefault();
  });
  // Frames in the window are the live LWC previews (lsc-frame:); they can't navigate anywhere else, which
  // would carry what they read out of the app.
  mainWindow.webContents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) return;
    if (!/^(lsc-frame:|about:)/.test(event.url)) event.preventDefault();
  });

  // <webview> guests never get Node or a preload. Only two kinds are attached: Studio's preview browser,
  // held to its own session and https pages, and the doc panel's PDF viewer, held to the app's own PDFs.
  // Popups are refused rather than opened in the system browser.
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.webSecurity = true;
    delete (params as { allowpopups?: string }).allowpopups;
    const src = params.src ?? "";
    if (params.partition?.startsWith(STUDIO_BROWSER_PARTITION)) {
      previewPartitions.add(params.partition);
      webPreferences.sandbox = true;
      if (src && src !== "about:blank" && !src.startsWith("https:")) event.preventDefault();
    } else if (params.partition || !isDocumentationPdf(src)) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("did-attach-webview", (_event, guest) => {
    guest.setWindowOpenHandler(() => ({ action: "deny" }));
    if ([...previewPartitions].some((p) => session.fromPartition(p) === guest.session)) {
      guest.on("will-navigate", (e, url) => {
        if (!url.startsWith("https:")) e.preventDefault();
      });
      guest.on("will-redirect", (e, url) => {
        if (!url.startsWith("https:")) e.preventDefault();
      });
    } else {
      // The PDF viewer stays on its PDF.
      guest.on("will-navigate", (e, url) => {
        if (!isDocumentationPdf(url)) e.preventDefault();
      });
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Handle lsc-local:// protocol — serves the app's PDFs (documentation/).
  // URL format: lsc-local://file/documentation/some-file.pdf
  protocol.handle("lsc-local", (request) => {
    const filePath = localProtocolPath(new URL(request.url).pathname);
    if (!filePath) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
  protocol.handle(FRAME_SCHEME, (request) => frameDocResponse(request.url));

  const settings = loadSettings();
  applyTheme(settings.theme);
  watchSystemTheme(() => mainWindow);
  createWindow();
  applyAppIcon(settings.appIcon, mainWindow);
  startUpdater(() => mainWindow);
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
