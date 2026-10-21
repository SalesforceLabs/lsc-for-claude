/** Which objects an active DB Schema record syncs to the iPad, shared briefly across the builder's calls. */

import { runSoqlQuery, runToolingQuery } from "../../salesforce/cli.js";
import {
  loadDbSchemaEntries,
  loadUserContext,
  selectApplicableTables,
  type OrgQuerier,
  type UserContext,
} from "../../perf/sync-volume.js";
import { syncedObjects } from "../component-catalog.js";

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: Promise<Set<string> | null> }>();

/** The synced objects of an org, or null when they couldn't be read. */
export function syncedObjectsOf(org: string): Promise<Set<string> | null> {
  const hit = cache.get(org);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = syncedObjects(org).then(
    (s) => s,
    () => null
  );
  cache.set(org, { at: Date.now(), value });
  return value;
}

export function forgetSyncedObjects(org?: string): void {
  if (org) cache.delete(org);
  else cache.clear();
}

const soql = (v: string) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Who the check is for: a user (by Id or username) or just a profile name. */
export interface SyncFor {
  userId?: string;
  profile?: string;
}

/** The objects the DB Schema records assigned to that user's (or profile's) profile sync, or null when they couldn't be worked out. */
export async function syncedObjectsFor(org: string, who: SyncFor): Promise<Set<string> | null> {
  if (!who.userId && !who.profile) return syncedObjectsOf(org);
  try {
    const querier: OrgQuerier = {
      soql: (q, o) => runSoqlQuery(q, org, o),
      tooling: (q) => runToolingQuery(q, org),
    };
    let user: Pick<UserContext, "profileId" | "profileName" | "permissionSets">;
    if (who.userId) {
      user = await loadUserContext(querier, who.userId);
    } else {
      const res = await querier.soql(
        `SELECT Id, Name FROM Profile WHERE Name = '${soql(who.profile as string)}' LIMIT 1`
      );
      const row = res.success ? res.data?.records?.[0] : undefined;
      if (!row) return null;
      user = {
        profileId: String(row.Id),
        profileName: String(row.Name),
        permissionSets: new Set(),
      };
    }
    const entries = await loadDbSchemaEntries(querier);
    return new Set(selectApplicableTables(entries, user).map((t) => t.entry.sobject));
  } catch {
    return null;
  }
}
