import { shell } from "electron";

/**
 * Opening a URL with the OS hands it to whatever app claims its scheme (file:, smb:, an installed
 * app's own scheme…), so only web pages and mail go out. Links reach here from model output and
 * from the renderer, neither of which picks the scheme safely.
 */
export function isOpenableUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Opens a web or mail link in the system's app; anything else is ignored. True when it was opened. */
export function openExternalSafely(url: unknown): boolean {
  if (!isOpenableUrl(url)) return false;
  void shell.openExternal(url);
  return true;
}
