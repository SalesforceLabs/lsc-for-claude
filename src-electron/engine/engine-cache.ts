/** What the cache needs of an engine. */
export interface CachedEngine {
  abort(): void;
  /** True while a run (streaming or tool loop) is in progress. */
  isRunning(): boolean;
}

/**
 * Engines by session, least recently used first. An engine's history is rebuilt from the
 * saved messages on its next use, so idle ones past `maxIdle` are dropped; a running
 * one is never dropped, whatever its age.
 */
export class EngineCache<E extends CachedEngine> {
  private engines = new Map<string, E>();

  constructor(private maxIdle: number) {}

  /** The session's engine, marked as just used. */
  get(id: string): E | undefined {
    const engine = this.engines.get(id);
    if (engine) {
      this.engines.delete(id);
      this.engines.set(id, engine);
    }
    return engine;
  }

  set(id: string, engine: E): void {
    this.engines.delete(id);
    this.engines.set(id, engine);
    this.trim();
  }

  delete(id: string): void {
    this.engines.delete(id);
  }

  values(): IterableIterator<E> {
    return this.engines.values();
  }

  clear(): void {
    this.engines.clear();
  }

  get size(): number {
    return this.engines.size;
  }

  /** Drop the oldest idle engines beyond the limit. Call again when a run ends. */
  trim(): void {
    const idle = [...this.engines].filter(([, engine]) => !engine.isRunning());
    for (const [id, engine] of idle.slice(0, Math.max(0, idle.length - this.maxIdle))) {
      engine.abort();
      this.engines.delete(id);
    }
  }
}
