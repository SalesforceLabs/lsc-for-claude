import { useSyncExternalStore } from "react";

/** The Roz icons Settings offers — a copy of ROZ_ICONS in src-electron/app-icon.ts, kept equal by a test. */
export const ROZ_ICONS = [
  { id: "bold", label: "Bold" },
  { id: "brand", label: "Brand" },
  { id: "closeup", label: "Close-up" },
  { id: "happy", label: "Happy" },
  { id: "light", label: "Light" },
] as const;
export type RozIcon = (typeof ROZ_ICONS)[number]["id"];

export function rozIcon(value: unknown): RozIcon {
  return ROZ_ICONS.some((icon) => icon.id === value) ? (value as RozIcon) : ROZ_ICONS[0].id;
}

/** The icon cropped to its tile, for logos inside the app. */
export function rozTileSrc(icon: RozIcon): string {
  return `roz/tile-${icon}.png`;
}

let current: RozIcon = ROZ_ICONS[0].id;
let loaded = false;
const listeners = new Set<() => void>();

/** Call after Settings saves a new icon; the main process changes the Dock icon itself. */
export function setAppIcon(icon: RozIcon): void {
  current = icon;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    window.lscApi.getSettings().then((s) => setAppIcon(rozIcon(s.appIcon)));
  }
  return () => listeners.delete(listener);
}

/** The chosen Roz icon. */
export function useAppIcon(): RozIcon {
  return useSyncExternalStore(subscribe, () => current);
}
