/**
 * A process-wide cap on concurrent Salesforce calls (sf CLI spawns and direct
 * REST requests). Collectors fan out with Promise.all freely; this is where
 * the fan-out is metered, so a big org can't start hundreds of ~100 MB `sf`
 * processes at once or trip the org's concurrent-request limits.
 *
 * Slots are held only around a single leaf call (one spawn, one HTTP request),
 * never across nested calls, so the limiter cannot deadlock.
 */

const DEFAULT_LIMIT = 6;

function configuredLimit(): number {
  const n = Number(process.env.LSC_SF_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_LIMIT;
}

export class Limiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: () => number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Calls running and waiting, for tests and diagnostics. */
  stats(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.waiters.length };
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit()) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    // Hand the slot straight to the next waiter; the active count is unchanged.
    if (next) next();
    else this.active--;
  }
}

export const sfLimiter = new Limiter(configuredLimit);
