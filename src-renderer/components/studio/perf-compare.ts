// Predicted sync volume (a Performance run) against what a First sync simulation actually downloaded,
// joined in the renderer from stored history — no org calls. Pure so it can be unit-tested.

import type { TableVolume, UserVolume } from "./perf-types";
import { asSimSummary, type SimTable, type SimulationResult } from "./sim-types";

/** A table or total counts as different when simulated and predicted records are further apart than this. */
export const DIFF_PCT = 10;
/** Differences smaller than this many records are never flagged, so 3 vs 4 isn't "33% off". */
export const MIN_ABS_DIFF = 5;

export type TableFlag = "match" | "differs" | "only-predicted" | "only-simulated" | "unreliable";

export interface TableComparison {
  sobject: string;
  predicted?: number;
  simulated?: number;
  /** (simulated − predicted) / predicted, in percent; absent when predicted is missing or zero. */
  diffPct?: number;
  flag: TableFlag;
  /** Why a table is "unreliable": not counted by the prediction, or skipped, failed or cut short in the simulation. */
  reason?: string;
}

export interface VolumeComparison {
  /** The territory the prediction was read from: the one the simulation ran in. */
  territory: string | null;
  /** False when the simulation's territory has no prediction, so another territory's was used. */
  territoryMatched: boolean;
  predictedTotal: number;
  simulatedTotal: number;
  totalDiffPct?: number;
  totalDiffers: boolean;
  /** Some tables were not counted, skipped, failed or truncated, so the totals are partial. */
  partial: boolean;
  /** Flagged tables first (largest gap first), then the matching ones. */
  tables: TableComparison[];
  flagged: number;
}

export function differs(predicted: number, simulated: number): boolean {
  const gap = Math.abs(simulated - predicted);
  if (gap < MIN_ABS_DIFF) return false;
  return predicted === 0 ? true : (gap / predicted) * 100 > DIFF_PCT;
}

const diffPct = (predicted: number, simulated: number) => (predicted > 0 ? ((simulated - predicted) / predicted) * 100 : undefined);

function simProblem(t: SimTable): string | undefined {
  if (t.skipped) return `skipped in the simulation (${t.skipped})`;
  if (t.error) return `failed in the simulation (${t.error})`;
  if (t.truncated) return `cut short in the simulation (${t.truncated}), so its count is a lower bound`;
  return undefined;
}

function predictedTerritory(user: UserVolume, wanted: string | undefined) {
  const byName = wanted ? user.territories.find((t) => t.territory?.name.toLowerCase() === wanted.toLowerCase()) : undefined;
  if (byName) return { terr: byName, matched: true };
  const none = user.territories.find((t) => !t.territory);
  if (!wanted && none) return { terr: none, matched: true };
  const first = user.territories[0];
  return first ? { terr: first, matched: !wanted && !first.territory } : undefined;
}

/** Null when the user's prediction failed or covers no territory. */
export function compareVolume(user: UserVolume, sim: Pick<SimulationResult, "tables" | "user">): VolumeComparison | null {
  if (user.error) return null;
  const picked = predictedTerritory(user, sim.user.territory);
  if (!picked) return null;

  const predicted = new Map<string, TableVolume>(picked.terr.tables.map((t) => [t.sobject.toLowerCase(), t]));
  const simulated = new Map<string, SimTable>(sim.tables.map((t) => [t.sobject.toLowerCase(), t]));
  const keys = [...new Set([...predicted.keys(), ...simulated.keys()])];

  let partial = false;
  let predictedTotal = 0;
  let simulatedTotal = 0;
  const tables: TableComparison[] = keys.map((key) => {
    const p = predicted.get(key);
    const s = simulated.get(key);
    const sobject = p?.sobject ?? s?.sobject ?? key;
    const counted = p?.status === "counted" ? p.records : undefined;
    const problem = s ? simProblem(s) : undefined;
    const got = s && !s.skipped && !s.error ? s.records : undefined;
    if (counted !== undefined) predictedTotal += counted;
    if (got !== undefined) simulatedTotal += got;

    if (p && p.status !== "counted") {
      partial = true;
      return { sobject, simulated: got, flag: "unreliable", reason: `${p.status === "error" ? "prediction query failed" : "not estimated"}${p.note ? ` (${p.note})` : ""}` };
    }
    if (problem) {
      partial = true;
      return { sobject, predicted: counted, simulated: got, flag: "unreliable", reason: problem };
    }
    if (!s) return { sobject, predicted: counted, flag: "only-predicted" };
    if (!p) return { sobject, simulated: got, flag: "only-simulated" };
    return {
      sobject,
      predicted: counted,
      simulated: got,
      diffPct: diffPct(counted ?? 0, got ?? 0),
      flag: differs(counted ?? 0, got ?? 0) ? "differs" : "match",
    };
  });

  const rank = (t: TableComparison) => (t.flag === "match" ? 1 : 0);
  const gap = (t: TableComparison) => Math.abs((t.simulated ?? 0) - (t.predicted ?? 0));
  tables.sort((a, b) => rank(a) - rank(b) || gap(b) - gap(a) || a.sobject.localeCompare(b.sobject));

  return {
    territory: picked.terr.territory?.name ?? null,
    territoryMatched: picked.matched,
    predictedTotal,
    simulatedTotal,
    totalDiffPct: diffPct(predictedTotal, simulatedTotal),
    totalDiffers: differs(predictedTotal, simulatedTotal),
    partial,
    tables,
    flagged: tables.filter((t) => t.flag !== "match").length,
  };
}

// ---------- picking the simulation to compare with ----------

/** The parts of a stored simulation row needed to pick one (see PerfSimRecord). */
export interface SimRef {
  id: string;
  /** Instance URL the simulation ran against. */
  org: string;
  status: "done" | "cancelled";
  startedAt: string;
  summary: unknown;
}

/** Lower-cased origin, so `https://X.my.salesforce.com/` and `https://x.my.salesforce.com` compare equal. */
export function normalizeInstance(url: string): string {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return url.trim().replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * The most recent finished simulation for a username in an org. A cancelled run covers only part of
 * the tables, so it is never compared. With no known instance URL for the org, username alone matches.
 */
export function latestSimFor(sims: SimRef[], username: string, instanceUrl: string | null | undefined): SimRef | undefined {
  const user = username.toLowerCase();
  const instance = instanceUrl ? normalizeInstance(instanceUrl) : null;
  return sims
    .filter((s) => s.status === "done" && asSimSummary(s.summary)?.username.toLowerCase() === user && (!instance || normalizeInstance(s.org) === instance))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

/** Metadata plus data download seconds of a simulation: network time only. */
export function simulatedSeconds(sim: Pick<SimulationResult, "metadata" | "totals">): number {
  return sim.metadata.seconds + sim.totals.seconds;
}
