/**
 * Share one promise between identical concurrent calls. A cold Studio load can outlast the
 * call timeout while the server keeps working; without this the next call starts a second one.
 */
export function createInFlight<T>() {
  const pending = new Map<string, Promise<T>>();
  return (key: string, start: () => Promise<T>): Promise<T> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const p = start().finally(() => pending.delete(key));
    pending.set(key, p);
    return p;
  };
}
