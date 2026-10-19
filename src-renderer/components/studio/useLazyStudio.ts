import { useCallback, useEffect, useRef, useState } from "react";

/** A Studio read made on demand: loading, then the answer or why it failed (with a retry). */
export type Lazy<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

type Response = { data?: unknown; error?: string };

/** The state an IPC answer puts a lazy read in; `pick` may throw to say the answer is unusable. */
export function lazyFromResponse<T>(res: Response | null | undefined, pick: (data: unknown) => T): Lazy<T> {
  if (!res) return { status: "error", message: "No answer from Studio." };
  const inner = (res.data as { error?: string } | undefined)?.error;
  if (res.error || inner) return { status: "error", message: res.error || (inner as string) };
  try {
    return { status: "ready", data: pick(res.data) };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Runs `call` when `key` changes (and on `retry`), ignoring answers that arrive after the key moved on.
 * The preview never waits on these: they are read when a screen that needs them opens.
 */
export function useLazyStudio<T>(key: string, call: () => Promise<Response>, pick: (data: unknown) => T): { state: Lazy<T>; retry: () => void } {
  const [state, setState] = useState<Lazy<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ call, pick });
  latest.current = { call, pick };
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    latest.current
      .call()
      .then((res) => lazyFromResponse(res, latest.current.pick))
      .catch((err): Lazy<T> => ({ status: "error", message: err instanceof Error ? err.message : String(err) }))
      .then((next) => {
        if (live) setState(next);
      });
    return () => {
      live = false;
    };
  }, [key, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
