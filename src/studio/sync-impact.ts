/**
 * Studio "What if": predicted sync volume before and after pending DB Schema
 * changes, per affected profile, without writing anything. Read-only.
 *
 * Counts follow src/perf/sync-volume.ts: one representative user per profile,
 * DB Schema records (not the compiled archive), COUNT() queries as the
 * connected admin. Unchanged tables are identical on both sides, so only the
 * changed ones are counted again for the "after" side.
 */

import { z } from "zod";
import { runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import {
  loadDbSchemaEntries,
  loadUserContext,
  mapWithConcurrency,
  memoizeQuerier,
  profileTerritory,
  selectApplicableTables,
  type OrgQuerier,
  type DbSchemaEntry,
} from "../perf/sync-volume.js";
import { findHeaviestUsers } from "../perf/users.js";
import {
  affectedProfiles,
  applyChanges,
  changedSobjects,
  diffVolumes,
  planRecount,
  touchesDbSchema,
  type TableDiff,
  type FailingFilter,
  type Unmodeled,
} from "../perf/what-if.js";

export const syncImpactInput = {
  changes: z.array(z.object({ kind: z.string().max(60) }).passthrough()).max(200),
  profiles: z.array(z.string().max(255)).max(50).optional(),
};

/** Profiles estimated at once. */
const PROFILE_CONCURRENCY = 3;
/** Profiles estimated per request; the rest are listed in the notes. */
export const MAX_PROFILES = 5;

export interface ProfileImpact {
  profile: string;
  user: { id: string; username: string; name: string };
  territory: string | null;
  /** Why this territory was counted, e.g. "largest of 3 (1,240 accounts)"; absent when the user has none. */
  territoryNote?: string;
  totalBefore: number;
  totalAfter: number;
  delta: number;
  /** Percent change; null when nothing synced before. */
  pct: number | null;
  /** Only the tables whose count changed or that the changes touched. */
  tables: TableDiff[];
  /** Filters that ran before but fail after (e.g. a WhereSoql syntax error). */
  failing: FailingFilter[];
  /** Set when this profile could not be estimated. */
  error?: string;
}

export interface SyncImpactResult {
  profiles: ProfileImpact[];
  unmodeled: Unmodeled[];
  notes: string[];
  /** COUNT()/id queries issued against the org. */
  queries: number;
}

export interface SyncImpactDeps {
  querier: (org: string) => OrgQuerier;
}

const defaultDeps: SyncImpactDeps = {
  querier: (org) => ({
    soql: (q, options) => runSoqlQuery(q, org, options),
    tooling: (q) => runToolingQuery(q, org),
  }),
};


async function profileNamesById(org: OrgQuerier, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const list = ids.filter((i) => /^[A-Za-z0-9]{15,18}$/.test(i)).map((i) => `'${i}'`);
  if (list.length === 0) return [];
  const res = await org.soql(`SELECT Name FROM Profile WHERE Id IN (${list.join(",")})`);
  if (!res.success) return [];
  return (res.data?.records ?? []).map((r) => String(r.Name));
}

export async function syncImpact(
  orgName: string,
  input: { changes: Record<string, unknown>[]; profiles?: string[] },
  deps: SyncImpactDeps = defaultDeps
): Promise<SyncImpactResult> {
  const raw = deps.querier(orgName);
  let queries = 0;
  const org: OrgQuerier = memoizeQuerier({
    soql: (q, options) => (queries++, raw.soql(q, options)),
    tooling: (q) => (queries++, raw.tooling(q)),
  });

  const relevant = input.changes.filter(touchesDbSchema);
  const notes: string[] = [];
  const skipped = input.changes.length - relevant.length;
  if (skipped > 0) notes.push(`${skipped} pending ${skipped === 1 ? "change doesn't" : "changes don't"} touch DB Schema and aren't part of this estimate.`);
  if (relevant.length === 0) return { profiles: [], unmodeled: [], notes: [...notes, "No pending DB Schema changes."], queries };

  const before: DbSchemaEntry[] = await loadDbSchemaEntries(org);
  const applied = applyChanges(before, relevant);

  let names: string[];
  if (input.profiles?.length) {
    names = input.profiles;
  } else {
    const found = affectedProfiles(before, applied.entries, applied.touched);
    // Assignments made before the profile names were recorded only carry ids.
    const fromIds = await profileNamesById(org, [...found.ids]);
    // Created records and profile edits name profiles directly.
    const named = new Set([...found.names, ...fromIds]);
    for (const f of relevant) {
      if (f.kind === "setProfileAssignments") [...((f.from as string[]) ?? []), ...((f.to as string[]) ?? [])].forEach((n) => named.add(n));
    }
    names = [...named].sort();
  }
  if (names.length > MAX_PROFILES) {
    notes.push(`Estimated ${MAX_PROFILES} of ${names.length} affected profiles (${names.slice(MAX_PROFILES).join(", ")} not estimated).`);
    names = names.slice(0, MAX_PROFILES);
  }
  if (names.length === 0) notes.push("No profile is affected by these changes (permission-set-only records aren't estimated).");

  // Profiles are independent: each picks its heaviest user and counts before/after. The memoized org
  // answers an identical query once (the id sources both sides read, a table that did not change).
  const profiles: ProfileImpact[] = await mapWithConcurrency(names, PROFILE_CONCURRENCY, async (profile): Promise<ProfileImpact> => {
    try {
      const users = await findHeaviestUsers(org, { profile, limit: 1 });
      const user = users[0];
      if (!user) return emptyImpact(profile, `No active user on ${profile}`);
      const ctx = await loadUserContext(org, user.id);
      const { territory, note: territoryNote } = await pickTerritory(org, ctx.territories);
      const tablesBefore = selectApplicableTables(before, ctx);
      const tablesAfter = selectApplicableTables(applied.entries, ctx);
      const changed = changedSobjects(tablesBefore, tablesAfter);

      let diff;
      if (changed.size === 0) {
        const beforeVol = await profileTerritory(org, ctx, territory, tablesBefore);
        diff = diffVolumes(beforeVol.tables, [], changed, false);
      } else {
        const plan = planRecount(tablesAfter, changed);
        // The two sides only read, so they run together.
        const [beforeVol, afterVol] = await Promise.all([
          profileTerritory(org, ctx, territory, tablesBefore),
          profileTerritory(org, ctx, territory, plan.after),
        ]);
        diff = diffVolumes(beforeVol.tables, afterVol.tables, changed, plan.full);
      }
      return {
        profile,
        user: { id: user.id, username: ctx.username, name: ctx.name },
        territory: territory?.name ?? null,
        ...(territoryNote ? { territoryNote } : {}),
        ...diff,
      };
    } catch (e) {
      return emptyImpact(profile, e instanceof Error ? e.message : String(e));
    }
  });

  notes.unshift(
    "Each profile is estimated for its heaviest active user, from DB Schema records (not the compiled metadata archive), counted as the connected admin; org-wide counts may exceed what a rep downloads."
  );
  return { profiles, unmodeled: applied.unmodeled, notes, queries };
}

/** The territory with the most aligned accounts (one grouped query); the first when sizes can't be read. */
async function pickTerritory(
  org: OrgQuerier,
  territories: Array<{ id: string; name: string }>
): Promise<{ territory: { id: string; name: string } | null; note?: string }> {
  if (territories.length === 0) return { territory: null };
  if (territories.length === 1) return { territory: territories[0] };
  const ids = territories.filter((t) => /^[A-Za-z0-9]{15,18}$/.test(t.id)).map((t) => `'${t.id}'`);
  const res = ids.length
    ? await org.soql(`SELECT Territory2Id, COUNT(Id) cnt FROM ObjectTerritory2Association WHERE Territory2Id IN (${ids.join(",")}) GROUP BY Territory2Id`)
    : null;
  const sizes = new Map<string, number>();
  for (const r of res?.success ? (res.data?.records ?? []) : []) sizes.set(String(r.Territory2Id), Number(r.cnt ?? r.expr0 ?? 0));
  let best = territories[0];
  for (const t of territories) if ((sizes.get(t.id) ?? 0) > (sizes.get(best.id) ?? 0)) best = t;
  const count = sizes.get(best.id);
  return {
    territory: best,
    note:
      count === undefined
        ? `first of ${territories.length} territories (sizes unavailable)`
        : `largest of ${territories.length} territories (${count.toLocaleString()} aligned records)`,
  };
}

function emptyImpact(profile: string, error: string): ProfileImpact {
  return {
    profile,
    user: { id: "", username: "", name: "" },
    territory: null,
    totalBefore: 0,
    totalAfter: 0,
    delta: 0,
    pct: null,
    tables: [],
    failing: [],
    error,
  };
}

