import { useSyncExternalStore } from "react";

/** The appearances Settings offers — a copy of APP_THEMES in src-electron/theme.ts, kept equal by a test. */
export const APP_THEMES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;
export type AppTheme = (typeof APP_THEMES)[number]["id"];

export function appTheme(value: unknown): AppTheme {
  return APP_THEMES.some((theme) => theme.id === value) ? (value as AppTheme) : "system";
}

export type ColorScheme = "light" | "dark";

// The main process sets nativeTheme.themeSource from Settings; prefers-color-scheme follows it.
let lightQuery: MediaQueryList | undefined;
const query = () => (lightQuery ??= window.matchMedia("(prefers-color-scheme: light)"));

function subscribe(listener: () => void): () => void {
  query().addEventListener("change", listener);
  return () => query().removeEventListener("change", listener);
}

/** The palette on screen now — what "system" resolves to, or the chosen one. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, () => (query().matches ? "light" : "dark"));
}

/** A colour token's current value, e.g. cssToken("--bg-primary"), for code that can't use var() (Mermaid). */
export function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
