import { BrowserWindow, nativeTheme } from "electron";

/** Appearance choices in Settings; "system" follows macOS (or the OS) light/dark setting. */
export const APP_THEMES = ["system", "light", "dark"] as const;
export type AppTheme = (typeof APP_THEMES)[number];

export function appTheme(value: unknown): AppTheme {
  return APP_THEMES.includes(value as AppTheme) ? (value as AppTheme) : "system";
}

/** --bg-primary of each palette in styles.css, so the window never flashes the other colour before paint. */
const WINDOW_BACKGROUND = { dark: "#0a0f1a", light: "#ffffff" } as const;

export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light;
}

/**
 * Sets the app's appearance. The renderer's prefers-color-scheme follows nativeTheme.themeSource,
 * as do the traffic lights, scrollbars, context menus and native dialogs.
 */
export function applyTheme(value: unknown, window?: BrowserWindow | null): void {
  nativeTheme.themeSource = appTheme(value);
  window?.setBackgroundColor(windowBackground());
}

/** Keeps the window background right when the OS switches while the app follows "system". */
export function watchSystemTheme(getWindow: () => BrowserWindow | null): void {
  nativeTheme.on("updated", () => getWindow()?.setBackgroundColor(windowBackground()));
}
