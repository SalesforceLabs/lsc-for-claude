import { useEffect, useState } from "react";
import type { AssessmentResult } from "./perf-types";
import type { SimulationResult } from "./sim-types";
import { latestSimFor } from "./perf-compare";

/** The most recent finished First sync of a run's user, in the same org. */
export interface RunSim {
  id: string;
  startedAt: string;
  result: SimulationResult;
}

/** Simulations by lower-cased username. */
export type RunSims = Map<string, RunSim>;

const EMPTY: RunSims = new Map();

/**
 * For each user a run tested, the newest finished First sync stored for the same username and
 * instance URL. Reads stored history only; nothing is sent to the org. The run's org is a sf CLI
 * alias, so its instance URL comes from the sf CLI connection list; when that can't be resolved
 * the username alone matches.
 */
export function useRunSims(run: { id: string; result: AssessmentResult } | null): RunSims {
  const [sims, setSims] = useState<RunSims>(EMPTY);
  const runId = run?.id;

  useEffect(() => {
    if (!run) {
      setSims(EMPTY);
      return;
    }
    let stale = false;
    (async () => {
      const [list, orgs] = await Promise.all([window.lscApi.perfListSims(), window.lscApi.listSfOrgs().catch(() => null)]);
      const org = run.result.org.toLowerCase();
      const instanceUrl = orgs?.orgs?.find((o) => o.alias?.toLowerCase() === org || o.username.toLowerCase() === org)?.instanceUrl;
      const found: RunSims = new Map();
      const usernames = new Set(run.result.personas.flatMap((p) => p.volumes.map((v) => v.user.username)).filter(Boolean));
      for (const username of usernames) {
        const ref = latestSimFor(list, username, instanceUrl);
        const record = ref && (await window.lscApi.perfGetSim(ref.id));
        if (record?.result) found.set(username.toLowerCase(), { id: record.id, startedAt: record.startedAt, result: record.result as SimulationResult });
      }
      if (!stale) setSims(found);
    })().catch(() => {
      if (!stale) setSims(EMPTY);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return sims;
}
