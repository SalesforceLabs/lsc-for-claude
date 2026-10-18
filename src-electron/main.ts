import { app, BrowserWindow, shell, protocol, net, session } from "electron";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { STUDIO_BROWSER_PARTITION } from "./studio-browser.js";
import { applyAppIcon } from "./app-icon.js";
import { loadSettings } from "./settings.js";

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
]);

let mainWindow: BrowserWindow | null = null;

/** Partitions Studio's preview browsers have attached with, to recognize their guests. */
const previewPartitions = new Set<string>();

// Packaged builds were named "LSC Assistant" before the rename to Roz; keep their data folder.
if (app.isPackaged) app.setPath("userData", path.join(app.getPath("appData"), "LSC Assistant"));

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 600,
    minHeight: 400,
    title: "Roz for LSC",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "..", "src-electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  // Log renderer console messages to stdout for debugging
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const levels = ["DEBUG", "INFO", "WARN", "ERROR"];
    console.log(`[Renderer ${levels[level] || level}] ${message} (${sourceId}:${line})`);
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

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // <webview> guests never get Node or a preload. Studio's preview browser is held to its own session and
  // https pages; its popups are refused rather than opened in the system browser.
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    if (params.partition?.startsWith(STUDIO_BROWSER_PARTITION)) {
      previewPartitions.add(params.partition);
      webPreferences.sandbox = true;
      if (params.src && params.src !== "about:blank" && !params.src.startsWith("https:")) event.preventDefault();
    }
  });
  mainWindow.webContents.on("did-attach-webview", (_event, guest) => {
    if ([...previewPartitions].some((p) => session.fromPartition(p) === guest.session)) {
      guest.setWindowOpenHandler(() => ({ action: "deny" }));
      guest.on("will-navigate", (e, url) => {
        if (!url.startsWith("https:")) e.preventDefault();
      });
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Handle lsc-local:// protocol — serves files from the project directory.
  // URL format: lsc-local://file/documentation/some-file.pdf
  const projectRoot = path.resolve(__dirname, "..");
  protocol.handle("lsc-local", (request) => {
    const url = new URL(request.url);
    // pathname is like /documentation/some-file.pdf
    const filePath = path.join(projectRoot, decodeURIComponent(url.pathname));
    return net.fetch(pathToFileURL(filePath).toString());
  });

  createWindow();
  applyAppIcon(loadSettings().appIcon, mainWindow);
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
