/**
 * Studio changes the review dialog has previewed. studio_apply_fix over studio:call is refused for a
 * change that wasn't previewed first, exactly as given, within the last two hours, so nothing reaches the
 * org without its before/after having been put on screen. Each preview allows one apply.
 */
const TTL_MS = 2 * 60 * 60_000;
const MAX = 500;

export class PreviewedFixes {
  private seen = new Map<string, { count: number; at: number }>();

  constructor(private now: () => number = Date.now) {}

  add(fix: unknown): void {
    const key = JSON.stringify(fix ?? null);
    const entry = this.seen.get(key);
    this.seen.delete(key);
    this.seen.set(key, { count: (entry?.count ?? 0) + 1, at: this.now() });
    while (this.seen.size > MAX) this.seen.delete(this.seen.keys().next().value!);
  }

  /** True (and used up) when `fix` was previewed lately. */
  take(fix: unknown): boolean {
    const key = JSON.stringify(fix ?? null);
    const entry = this.seen.get(key);
    if (!entry) return false;
    if (this.now() - entry.at > TTL_MS) {
      this.seen.delete(key);
      return false;
    }
    if (--entry.count <= 0) this.seen.delete(key);
    return true;
  }
}
