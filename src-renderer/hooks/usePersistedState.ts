import { useCallback, useState } from "react";

/** State that survives a restart, kept in localStorage (UI layout only; nothing sensitive). */
export function usePersistedState<T>(key: string, initial: T, parse: (raw: string) => T | undefined, format: (v: T) => string) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw === null ? undefined : parse(raw);
      return parsed === undefined ? initial : parsed;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, format(next));
      } catch {
        // Private mode or a full quota: the layout just isn't remembered
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );
  return [value, set] as const;
}

export function usePersistedFlag(key: string, initial = false) {
  return usePersistedState<boolean>(key, initial, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));
}
