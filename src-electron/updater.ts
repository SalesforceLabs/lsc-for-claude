import { readFileSync } from "node:fs";
import { app, ipcMain, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, updateBlocker, updateErrorMessage, type UpdateState } from "./update-state.js";

const { autoUpdater } = electronUpdater;

/**
 * Keeps the installed Mac app current from the GitHub Releases feed (`publish` in electron-builder.yml;
 * each release attaches `latest-mac.yml`). Checks shortly after launch and every few hours, downloads in
 * the background, and installs when the app quits or on Restart to update. The repo is public, so no
 * token ships with the app; requests go through Electron's net stack (system proxies and certificates).
 */
export function startUpdater(getWindow: () => BrowserWindow | null): void {
  const version = app.isPackaged ? app.getVersion() : repoVersion();
  const blocker = updateBlocker({
    packaged: app.isPackaged,
    platform: process.platform,
    appPath: app.getAppPath(),
    disabled: process.env.ROZ_UPDATES === "0",
  });
  let state: UpdateState = blocker ? { status: "unsupported", version, reason: blocker } : { status: "idle", version };

  const set = (next: UpdateState) => {
    state = next;
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send("update:state", state);
  };

  ipcMain.handle("update:get", () => state);
  ipcMain.handle("update:check", async () => {
    await check();
    return state;
  });
  ipcMain.handle("update:install", () => {
    if (state.status !== "ready") return false;
    // Closes the windows and relaunches into the new version.
    setImmediate(() => autoUpdater.quitAndInstall());
    return true;
  });

  if (blocker) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => set({ status: "checking", version }));
  autoUpdater.on("update-not-available", () => set({ status: "idle", version, checkedAt: Date.now() }));
  autoUpdater.on("update-available", (info) => set({ status: "downloading", version, next: info.version, percent: 0 }));
  autoUpdater.on("download-progress", (p) => {
    if (state.status === "downloading") set({ ...state, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => set({ status: "ready", version, next: info.version }));
  autoUpdater.on("error", (err) => {
    // A failed check or download leaves a ready update alone; the next check tries again.
    if (state.status !== "ready") set({ status: "error", version, message: updateErrorMessage(err) });
  });

  async function check(): Promise<void> {
    // Nothing to do while one is running or an update is waiting to install.
    if (blocker || state.status === "checking" || state.status === "downloading" || state.status === "ready") return;
    // Errors also arrive on the "error" event, which sets the state.
    await autoUpdater.checkForUpdates().catch(() => {});
  }

  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void check(), CHECK_INTERVAL_MS);
}

/** Started as `electron dist-electron/main.js`, app.getVersion() is Electron's own; read the repo's instead. */
function repoVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return app.getVersion();
  }
}
