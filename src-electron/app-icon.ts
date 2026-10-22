import path from "path";
import { fileURLToPath } from "url";
import { app, BrowserWindow, nativeImage } from "electron";

/** The Roz icons Settings offers (drawn by build/icon-src/roz.py); the first is the one the app ships with. */
export const ROZ_ICONS = ["bold", "brand", "closeup", "happy", "light"] as const;
export type RozIcon = (typeof ROZ_ICONS)[number];

export function rozIcon(value: unknown): RozIcon {
  return ROZ_ICONS.includes(value as RozIcon) ? (value as RozIcon) : ROZ_ICONS[0];
}

/** The renderer's public folder: copied into dist-renderer by Vite, read from the source in dev. */
function iconPath(icon: RozIcon): string {
  const dir = app.isPackaged ? "dist-renderer" : path.join("src-renderer", "public");
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", dir, "roz", `${icon}.png`);
}

/**
 * Shows the chosen icon in the Dock (macOS) or on the window (Windows, Linux) while the app runs.
 * Finder and Launchpad keep the bundle's icon, which is always the default.
 */
export function applyAppIcon(value: unknown, window?: BrowserWindow | null): void {
  const image = nativeImage.createFromPath(iconPath(rozIcon(value)));
  if (image.isEmpty()) return;
  if (process.platform === "darwin") app.dock?.setIcon(image);
  else window?.setIcon(image);
}
