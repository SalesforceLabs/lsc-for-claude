import { useCallback, useEffect, useRef, useState } from "react";
import type { PublishStatus } from "./types";

const POLL_MS = 5000;

function responseError(res: { data?: unknown; error?: string }): string | undefined {
  return res.error || (res.data as { error?: string } | undefined)?.error;
}

/** The last publish that finished, kept after the job is cleared so the release bar can say "Published 2 min ago". */
export interface LastPublish {
  at: string;
  profiles: string[];
}

export interface PublishJob {
  /** The job being polled, or the last one to finish (until `clear`). */
  status: PublishStatus | null;
  /** Starting the job, or polling it, failed. */
  error: string | null;
  starting: boolean;
  last: LastPublish | null;
  /** The profiles and org of the last start, for Retry. */
  lastStart: { profiles: string[]; org: string } | null;
  start: (profiles: string[], org: string) => Promise<void>;
  /** Forget the finished job (a running one keeps going). */
  clear: () => void;
}

/**
 * "Publish to iPad" as a job owned by Studio rather than its dialog: it keeps polling
 * `studio_publish_status` every 5 s until the cache is done or failed, with the dialog
 * open or closed, and calls `onDone` with the profiles once it is done.
 */
export function usePublishJob(onDone: (profiles: string[]) => void): PublishJob {
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [last, setLast] = useState<LastPublish | null>(null);
  const [lastStart, setLastStart] = useState<{ profiles: string[]; org: string } | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (status?.state !== "running") return;
    const timer = setTimeout(async () => {
      const res = await window.lscApi.studioPublishStatus(status.parentId);
      const err = responseError(res);
      if (err) {
        // A failed poll isn't a failed publish: say so and keep polling — generation goes on in Salesforce.
        setError(err);
        setStatus((s) => s && { ...s });
        return;
      }
      const next = res.data as PublishStatus;
      setError(null);
      setStatus(next);
      if (next.state === "done") {
        setLast({ at: new Date().toISOString(), profiles: next.profiles });
        done.current(next.profiles);
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const start = useCallback(async (profiles: string[], org: string) => {
    setStarting(true);
    setError(null);
    setLastStart({ profiles, org });
    const res = await window.lscApi.studioPublishMobile(profiles, org);
    setStarting(false);
    const err = responseError(res);
    if (err) setError(err);
    else setStatus(res.data as PublishStatus);
  }, []);

  const clear = useCallback(() => {
    setStatus((s) => (s?.state === "running" ? s : null));
    setError(null);
  }, []);

  return { status, error, starting, last, lastStart, start, clear };
}
