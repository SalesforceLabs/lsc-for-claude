/**
 * A process-wide cap on concurrent Salesforce calls (sf CLI spawns and direct
 * REST requests). Collectors fan out with Promise.all freely; this is where
 * the fan-out is metered, so a big org can't start hundreds of ~100 MB `sf`
 * processes at once or trip the org's concurrent-request limits.
 *
 * Slots are held only around a single leaf call (one spawn, one HTTP request),
 * never across nested calls, so the limiter cannot deadlock.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_LIMIT = 6;
const URGENT_RESERVE = 2;
const urgentStore = new AsyncLocalStorage<boolean>();

/** Everything `fn` starts (across awaits) runs urgent: ahead of the queue, in the reserved slots. */
export function urgentScope<T>(fn: () => T): T {
  return urgentStore.run(true, fn);
}

function configuredLimit(): number {
  const n = Number(process.env.LSC_SF_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_LIMIT;
}

export class Limiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly urgentWaiters: Array<() => void> = [];
  /** Urgent calls running beyond the limit. */
  private extra = 0;

  constructor(private readonly limit: () => number) {}

  /**
   * Run `fn` in a slot. An `urgent` call (an apply a person is watching, run inside `urgentScope`)
   * skips the queue and may use up to `URGENT_RESERVE` slots beyond the limit, so a burst of
   * background reads can't make it wait behind hundreds of others.
   */
  async run<T>(fn: () => Promise<T>, options: { urgent?: boolean } = {}): Promise<T> {
    if (options.urgent ?? urgentStore.getStore()) return this.runUrgent(fn);
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Calls running and waiting, for tests and diagnostics. */
  stats(): { active: number; waiting: number } {
    return { active: this.active + this.extra, waiting: this.waiters.length + this.urgentWaiters.length };
  }

  private async runUrgent<T>(fn: () => Promise<T>): Promise<T> {
    if (this.extra >= URGENT_RESERVE) await new Promise<void>((resolve) => this.urgentWaiters.push(resolve));
    else this.extra++;
    try {
      return await fn();
    } finally {
      // Hand the reserved slot straight to the next urgent waiter.
      const next = this.urgentWaiters.shift();
      if (next) next();
      else this.extra--;
    }
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
