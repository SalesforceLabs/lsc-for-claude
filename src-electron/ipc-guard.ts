import { ipcMain, type IpcMainInvokeEvent } from "electron";

/**
 * Every IPC handler answers only the app's own page in its main window. Webviews, the PDF window and
 * the live preview frames have no preload, so this is the second lock: should one of them ever reach
 * ipcRenderer, or the window be navigated elsewhere, its calls are refused before any handler runs.
 * Installed once, before the handlers are registered.
 */
export function answerOnlyFromApp(isTrusted: (event: IpcMainInvokeEvent) => boolean): void {
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    handle(channel, (event, ...args) => {
      if (!isTrusted(event)) throw new Error(`Refused ${channel}: not from the app's window.`);
      return listener(event, ...args);
    });
}
