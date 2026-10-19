import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_ORG_AHEAD, knownDocuments, type OrgAheadIndex, type UnpublishedResult, type UnpublishedState } from "./org-ahead";
import type { PublishedIpad } from "./published-types";

/** The index of documents changed in the org after the last publish, for the markers and the inspector. */
export const OrgAheadContext = createContext<OrgAheadIndex>(EMPTY_ORG_AHEAD);

/**
 * What changed in the org after `profile`'s metadata cache was generated. Runs after the preview has loaded
 * (it scopes the check to the documents the snapshot references) and again when something is written or
 * published (`version`), or the snapshot is a different cache.
 */
export function useUnpublished(profile: string | null, snapshot: PublishedIpad | null, version: number) {
  const [state, setState] = useState<UnpublishedState | undefined>(undefined);
  const ticket = useRef(0);
  const cacheKey = snapshot ? snapshot.cache.recordId : null;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const seenVersion = useRef(version);

  const run = useCallback(
    async (refresh: boolean) => {
      const snap = snapshotRef.current;
      if (!profile || !snap) return;
      const mine = ++ticket.current;
      setState((s) => (s?.status === "ready" ? s : { status: "loading" }));
      try {
        const res = await window.lscApi.studioUnpublished(profile, knownDocuments(snap), refresh);
        if (mine !== ticket.current) return;
        const error = res.error || (res.data as { error?: string } | undefined)?.error;
        if (error) setState({ status: "error", error });
        else setState({ status: "ready", result: res.data as UnpublishedResult, cachedAt: (res as { cachedAt?: string }).cachedAt });
      } catch (e) {
        if (mine === ticket.current) setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    },
    [profile]
  );

  useEffect(() => {
    if (!profile || !cacheKey) {
      ticket.current++;
      setState(undefined);
      return;
    }
    const wrote = seenVersion.current !== version;
    seenVersion.current = version;
    // A write keeps the last answer on screen while it is checked again; a new profile or cache starts over.
    if (!wrote) setState({ status: "loading" });
    void run(wrote);
  }, [profile, cacheKey, version, run]);

  return { state, retry: useCallback(() => run(true), [run]) };
}
