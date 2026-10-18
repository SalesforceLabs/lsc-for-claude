/** Copy of `fixAffectsPublished` in src-electron/engine/studio-invalidation.ts (kept equal by a test). */
export function fixAffectsPublished(fix: unknown): boolean {
  const f = (fix ?? {}) as { kind?: unknown; doc?: { type?: unknown } | null };
  if (f.kind === "editMetadata") return f.doc?.type === "ListView";
  return f.kind === "copyForProfile";
}

/**
 * A result shown while a newer one loads (stale-while-revalidate). `stale` means a write made it
 * out of date and a reload is due; `refreshing` means that reload is running. Either way the
 * screen says it is refreshing instead of presenting the old answer as current.
 */
export interface Revalidating {
  stale?: boolean;
  refreshing?: boolean;
}

export const isRevalidating = (s: Revalidating | undefined): boolean => !!s && (s.stale === true || s.refreshing === true);

/**
 * After a write: finished results stay on screen marked stale (a reload is due); anything still loading
 * or failed is dropped, so it is requested again rather than trusted.
 */
export function markAllStale<T extends { status: string }>(states: Record<string, T>): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [id, s] of Object.entries(states)) {
    if (s.status === "ready") next[id] = { ...s, stale: true, refreshing: false } as T;
  }
  return next;
}

/** Whether to start a load now: nothing yet, or a result a write made stale that nobody is refreshing. */
export function needsLoad(state: ({ status: string } & Revalidating) | undefined): boolean {
  return !state || (state.status === "ready" && state.stale === true && state.refreshing !== true);
}
