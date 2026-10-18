/**
 * Finding and resolving the users a performance plan tests: user search for
 * the GUI, "the N heaviest users with this profile" personas, and a batched
 * pre-flight lookup of every user a plan names.
 */

import { territoryAccountCounts, type OrgQuerier } from "./sync-volume.js";
import { DEFAULT_TELEMETRY_DAYS, type NfrProfile, type Persona } from "./nfr.js";

type Row = Record<string, unknown>;

export interface PerfUser {
  id: string;
  username: string;
  name: string;
  profile: string;
  /** Territories in the active territory model. */
  territories: number;
  /** Account rows aligned to the user's territories (a shared account counts once per territory); absent when not ranked by volume. */
  accounts?: number;
  /** DeviceSyncSummary rows in the telemetry window; absent when the org's sync telemetry can't be read. */
  syncs?: number;
}

/** Users a `select` persona picks when the plan doesn't say how many. */
export const DEFAULT_SELECT_COUNT = 3;

const ACTIVE_MODEL = "Territory2.Territory2Model.State = 'Active'";

function soqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function likeValue(text: string): string {
  return soqlString(text).replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function rows(org: OrgQuerier, soql: string): Promise<Row[]> {
  const result = await org.soql(soql);
  if (!result.success) throw new Error(result.error || "Query failed");
  return (result.data?.records ?? []) as Row[];
}

const inList = (values: string[]) => values.map((v) => `'${soqlString(v)}'`).join(",");
const profileName = (u: Row) => String((u.Profile as { Name?: string } | null)?.Name ?? "");
const territoryCount = (r: Row) => Number(r.cnt ?? r.expr0 ?? 0);

function toPerfUser(u: Row, territories: number): PerfUser {
  return {
    id: String(u.Id),
    username: String(u.Username),
    name: String(u.Name),
    profile: profileName(u),
    territories,
  };
}

const byLoad = (a: PerfUser, b: PerfUser) =>
  (b.accounts ?? 0) - (a.accounts ?? 0) || b.territories - a.territories || a.name.localeCompare(b.name);

/** Candidates ranked by territory count that are re-ranked by data volume; bounds the volume queries. */
const CANDIDATE_POOL = 25;

/**
 * Attach each user's aligned account volume: their active-model territories in
 * one query, then those territories' Account counts in chunked aggregates (a
 * bounded handful of queries). Users come back unchanged when the volumes can't
 * be read, so ranking falls back to territory count.
 */
async function withAccountVolume(org: OrgQuerier, users: PerfUser[]): Promise<PerfUser[]> {
  if (users.length === 0) return users;
  try {
    const assigned = await rows(
      org,
      `SELECT UserId, Territory2Id FROM UserTerritory2Association WHERE UserId IN (${inList(users.map((u) => u.id))}) AND ${ACTIVE_MODEL}`
    );
    const byUser = new Map<string, string[]>();
    for (const a of assigned) {
      const key = idKey(String(a.UserId));
      byUser.set(key, [...(byUser.get(key) ?? []), String(a.Territory2Id)]);
    }
    const territories = [...new Set(assigned.map((a) => String(a.Territory2Id)))].map((id) => ({ id }));
    const sizes = await territoryAccountCounts(org, territories);
    return users.map((u) => ({
      ...u,
      accounts: (byUser.get(idKey(u.id)) ?? []).reduce((n, t) => n + (sizes.get(idKey(t)) ?? 0), 0),
    }));
  } catch {
    return users;
  }
}

/** 15- and 18-character ids of the same record share their first 15 characters. */
const idKey = (id: string) => id.slice(0, 15);

const syncWindow = (days: number) => `CreatedDate = LAST_N_DAYS:${Math.max(1, Math.floor(days))}`;

/**
 * DeviceSyncSummary rows per user (keyed by idKey) in the last `days` days, or
 * null when the org's sync telemetry can't be read — callers then say nothing
 * about syncs rather than reporting everyone as idle.
 */
export async function recentSyncCounts(org: OrgQuerier, userIds: string[], days: number): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  try {
    const counts = await rows(
      org,
      `SELECT CreatedById, COUNT(Id) cnt FROM DeviceSyncSummary WHERE CreatedById IN (${inList(userIds)}) AND ${syncWindow(days)} GROUP BY CreatedById`
    );
    for (const r of counts) out.set(idKey(String(r.CreatedById)), territoryCount(r));
    return out;
  } catch {
    return null;
  }
}

async function withSyncs(org: OrgQuerier, users: PerfUser[], days: number | undefined): Promise<PerfUser[]> {
  if (days === undefined || users.length === 0) return users;
  const counts = await recentSyncCounts(org, users.map((u) => u.id), days);
  return counts ? users.map((u) => ({ ...u, syncs: counts.get(idKey(u.id)) ?? 0 })) : users;
}

/** A profile's users, most territories first, with users with no territories filling any remaining places. */
async function heaviestOfProfile(org: OrgQuerier, profile: string, limit: number, exclude: string[]): Promise<PerfUser[]> {
  if (limit <= 0) return [];
  const p = soqlString(profile);
  const notIn = (field: string, ids: string[]) => (ids.length ? ` AND ${field} NOT IN (${inList(ids)})` : "");
  const ranked = await rows(
    org,
    `SELECT UserId, COUNT(Id) cnt FROM UserTerritory2Association WHERE User.Profile.Name = '${p}' AND User.IsActive = true AND User.UserType = 'Standard' AND ${ACTIVE_MODEL}${notIn("UserId", exclude)} GROUP BY UserId ORDER BY COUNT(Id) DESC LIMIT ${Math.max(limit, CANDIDATE_POOL)}`
  );
  const counts = new Map(ranked.map((r) => [String(r.UserId), territoryCount(r)]));
  const loaded = counts.size
    ? await rows(org, `SELECT Id, Username, Name, Profile.Name FROM User WHERE Id IN (${inList([...counts.keys()])})`)
    : [];
  const users = (await withAccountVolume(org, loaded.map((u) => toPerfUser(u, counts.get(String(u.Id)) ?? 0))))
    .sort(byLoad)
    .slice(0, limit);
  if (users.length < limit) {
    const fill = await rows(
      org,
      `SELECT Id, Username, Name, Profile.Name FROM User WHERE IsActive = true AND UserType = 'Standard' AND Profile.Name = '${p}'${notIn("Id", [...exclude, ...users.map((u) => u.id)])} ORDER BY Name LIMIT ${limit - users.length}`
    );
    users.push(...fill.map((u) => toPerfUser(u, 0)));
  }
  return users;
}

/**
 * A profile's users who synced in the last `days` days, most territories then
 * most syncs first. Empty when the org's sync telemetry can't be read.
 */
async function syncingOfProfile(org: OrgQuerier, profile: string, limit: number, days: number): Promise<PerfUser[]> {
  let synced: Row[];
  try {
    synced = await rows(
      org,
      `SELECT CreatedById, COUNT(Id) cnt FROM DeviceSyncSummary WHERE CreatedBy.Profile.Name = '${soqlString(profile)}' AND CreatedBy.IsActive = true AND CreatedBy.UserType = 'Standard' AND ${syncWindow(days)} GROUP BY CreatedById ORDER BY COUNT(Id) DESC LIMIT 200`
    );
  } catch {
    return [];
  }
  if (synced.length === 0) return [];
  const syncs = new Map(synced.map((r) => [idKey(String(r.CreatedById)), territoryCount(r)]));
  const ids = synced.map((r) => String(r.CreatedById));
  const [loaded, counts] = await Promise.all([
    rows(org, `SELECT Id, Username, Name, Profile.Name FROM User WHERE Id IN (${inList(ids)})`),
    rows(
      org,
      `SELECT UserId, COUNT(Id) cnt FROM UserTerritory2Association WHERE UserId IN (${inList(ids)}) AND ${ACTIVE_MODEL} GROUP BY UserId`
    ),
  ]);
  const territories = new Map(counts.map((r) => [idKey(String(r.UserId)), territoryCount(r)]));
  const withVolume = await withAccountVolume(
    org,
    loaded.map((u) => ({ ...toPerfUser(u, territories.get(idKey(String(u.Id))) ?? 0), syncs: syncs.get(idKey(String(u.Id))) ?? 0 }))
  );
  return withVolume
    .sort((a, b) => (b.accounts ?? 0) - (a.accounts ?? 0) || b.territories - a.territories || (b.syncs ?? 0) - (a.syncs ?? 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * Active standard users, most territories in the active model first — the
 * heaviest users are the ones worth testing.
 *
 * With a search, up to 200 name-ordered matches are ranked. Without one, a
 * profile's users are ranked across all of its territory assignments, so the
 * result really is that profile's heaviest users; users with no territories
 * fill any remaining places. `preferSynced` puts the profile's users who
 * synced in the last `days` days first, so field telemetry has data.
 *
 * With `days`, each user carries their sync count in that window.
 */
export async function findHeaviestUsers(
  org: OrgQuerier,
  filters: { search?: string; profile?: string; limit: number; days?: number; preferSynced?: boolean }
): Promise<PerfUser[]> {
  const limit = Math.max(1, Math.floor(filters.limit));
  const search = filters.search?.trim();

  if (!search && filters.profile) {
    const days = filters.days ?? DEFAULT_TELEMETRY_DAYS;
    const first = filters.preferSynced ? await syncingOfProfile(org, filters.profile, limit, days) : [];
    const rest = await heaviestOfProfile(org, filters.profile, limit - first.length, first.map((u) => u.id));
    return [...first, ...(await withSyncs(org, rest, filters.days ?? (filters.preferSynced ? days : undefined)))];
  }

  const where = ["IsActive = true", "UserType = 'Standard'"];
  if (search) {
    const v = likeValue(search);
    where.push(`(Name LIKE '%${v}%' OR Username LIKE '%${v}%')`);
  }
  if (filters.profile) where.push(`Profile.Name = '${soqlString(filters.profile)}'`);
  const users = await rows(
    org,
    `SELECT Id, Username, Name, Profile.Name FROM User WHERE ${where.join(" AND ")} ORDER BY Name LIMIT 200`
  );
  if (users.length === 0) return [];
  const counts = await rows(
    org,
    `SELECT UserId, COUNT(Id) cnt FROM UserTerritory2Association WHERE UserId IN (${inList(users.map((u) => String(u.Id)))}) AND ${ACTIVE_MODEL} GROUP BY UserId`
  );
  const byUser = new Map(counts.map((r) => [String(r.UserId), territoryCount(r)]));
  const byTerritories = users.map((u) => toPerfUser(u, byUser.get(String(u.Id)) ?? 0)).sort(byLoad);
  const ranked = (await withAccountVolume(org, byTerritories.slice(0, CANDIDATE_POOL))).sort(byLoad).slice(0, limit);
  return withSyncs(org, ranked, filters.days);
}

const sameUser = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The users a persona tests, in order: its explicit users, then the users its
 * `select` picks that aren't already listed.
 */
export async function resolvePersonaUsers(
  org: OrgQuerier,
  persona: Pick<Persona, "users" | "select">,
  days: number = DEFAULT_TELEMETRY_DAYS
): Promise<{ users: string[]; selected: PerfUser[] }> {
  const users: string[] = [];
  for (const u of persona.users ?? []) {
    if (u.trim() && !users.some((x) => sameUser(x, u))) users.push(u.trim());
  }
  let selected: PerfUser[] = [];
  if (persona.select) {
    selected = await findHeaviestUsers(org, {
      profile: persona.select.profile,
      limit: persona.select.count ?? DEFAULT_SELECT_COUNT,
      days,
      preferSynced: persona.select.preferSynced,
    });
    for (const s of selected) {
      if (!users.some((x) => sameUser(x, s.username) || sameUser(x, s.id))) users.push(s.username);
    }
  }
  return { users, selected };
}

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

export interface CheckedUser {
  ref: string;
  found: boolean;
  active: boolean;
  username?: string;
  name?: string;
  profile?: string;
  territories: Array<{ id: string; name: string }>;
  /** DeviceSyncSummary rows in the plan's telemetry window; absent when sync telemetry can't be read. */
  syncs?: number;
}

export interface PlanIssue {
  persona: string;
  level: "error" | "warning";
  message: string;
}

export interface PlanCheck {
  org: string;
  issues: PlanIssue[];
  personas: Array<{ name: string; users: CheckedUser[]; territoryMatched?: boolean }>;
}

const isUserId = (ref: string) => /^005[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/.test(ref);

/**
 * Look up users by username or id in one query, with their active-model
 * territories in a second and, given `days`, their sync counts in a third.
 */
export async function lookupUsers(org: OrgQuerier, refs: string[], days?: number): Promise<Map<string, CheckedUser>> {
  const unique = [...new Set(refs.map((r) => r.trim()).filter(Boolean))];
  const out = new Map<string, CheckedUser>();
  if (unique.length === 0) return out;
  const ids = unique.filter(isUserId);
  const names = unique.filter((r) => !isUserId(r));
  const where = [names.length ? `Username IN (${inList(names)})` : "", ids.length ? `Id IN (${inList(ids)})` : ""]
    .filter(Boolean)
    .join(" OR ");
  const found = await rows(org, `SELECT Id, Username, Name, IsActive, Profile.Name FROM User WHERE ${where}`);

  const territories = new Map<string, Array<{ id: string; name: string }>>();
  if (found.length) {
    const assignments = await rows(
      org,
      `SELECT UserId, Territory2Id, Territory2.Name FROM UserTerritory2Association WHERE UserId IN (${inList(found.map((u) => String(u.Id)))}) AND ${ACTIVE_MODEL} ORDER BY Territory2.Name`
    );
    for (const a of assignments) {
      const list = territories.get(idKey(String(a.UserId))) ?? [];
      list.push({ id: String(a.Territory2Id), name: String((a.Territory2 as { Name?: string } | null)?.Name ?? "") });
      territories.set(idKey(String(a.UserId)), list);
    }
  }
  const syncs = days !== undefined && found.length ? await recentSyncCounts(org, found.map((u) => String(u.Id)), days) : null;

  for (const ref of unique) {
    const u = found.find((r) => (isUserId(ref) ? idKey(String(r.Id)) === idKey(ref) : sameUser(String(r.Username), ref)));
    out.set(
      ref.toLowerCase(),
      u
        ? {
            ref,
            found: true,
            active: u.IsActive === true,
            username: String(u.Username),
            name: String(u.Name),
            profile: profileName(u),
            territories: territories.get(idKey(String(u.Id))) ?? [],
            ...(syncs ? { syncs: syncs.get(idKey(String(u.Id))) ?? 0 } : {}),
          }
        : { ref, found: false, active: false, territories: [] }
    );
  }
  return out;
}

/** Problems that would make a plan's run fail or mislead, found before running it. */
export async function checkPlan(org: OrgQuerier, orgName: string, plan: NfrProfile): Promise<PlanCheck> {
  const issues: PlanIssue[] = [];
  const resolved = [];
  const days = plan.telemetry?.days ?? DEFAULT_TELEMETRY_DAYS;
  for (const persona of plan.personas) {
    const { users, selected } = await resolvePersonaUsers(org, persona, days);
    if (persona.select && selected.length === 0) {
      issues.push({
        persona: persona.name,
        level: "error",
        message: `No active users have the profile “${persona.select.profile}”.`,
      });
    }
    resolved.push({ persona, users });
  }

  const lookup = await lookupUsers(org, resolved.flatMap((r) => r.users), days);
  const personas: PlanCheck["personas"] = [];
  for (const { persona, users } of resolved) {
    const checked = users.map((ref) => lookup.get(ref.trim().toLowerCase()) ?? { ref, found: false, active: false, territories: [] });
    for (const u of checked) {
      if (!u.found) issues.push({ persona: persona.name, level: "error", message: `User not found: ${u.ref}` });
      else if (!u.active) issues.push({ persona: persona.name, level: "error", message: `User is inactive: ${u.username}` });
    }
    if (persona.select) {
      const explicit = new Set((persona.users ?? []).map((u) => u.trim().toLowerCase()));
      for (const u of checked) {
        if (u.found && explicit.has(u.ref.toLowerCase()) && u.profile && !sameUser(u.profile, persona.select.profile)) {
          issues.push({
            persona: persona.name,
            level: "warning",
            message: `${u.username} has the profile “${u.profile}”, not “${persona.select.profile}”.`,
          });
        }
      }
    }
    const live = checked.filter((u) => u.found && u.active);
    if (live.length && live.every((u) => u.syncs === 0)) {
      issues.push({
        persona: persona.name,
        level: "warning",
        message:
          `None of this persona's users synced in the last ${days} days, so its field-telemetry metrics will show No data.` +
          (persona.select && !persona.select.preferSynced ? " Turn on “prefer users who synced” or widen the telemetry window." : " Add a user who syncs or widen the telemetry window."),
      });
    }
    let territoryMatched: boolean | undefined;
    if (persona.territory) {
      const wanted = persona.territory.toLowerCase();
      territoryMatched = checked.some((u) => u.territories.some((t) => t.name.toLowerCase() === wanted || t.id === persona.territory));
      if (!territoryMatched && checked.some((u) => u.found)) {
        issues.push({
          persona: persona.name,
          level: "warning",
          message: `None of this persona's users is in the territory “${persona.territory}”, so their records are counted with no territory.`,
        });
      }
    }
    personas.push({ name: persona.name, users: checked, ...(territoryMatched === undefined ? {} : { territoryMatched }) });
  }
  return { org: orgName, issues, personas };
}

/** Active-model territories across a persona's users, with how many of those users are in each. */
export async function personaTerritories(
  org: OrgQuerier,
  persona: Pick<Persona, "users" | "select">
): Promise<Array<{ id: string; name: string; users: number }>> {
  const { users } = await resolvePersonaUsers(org, persona);
  const lookup = await lookupUsers(org, users);
  const byId = new Map<string, { id: string; name: string; users: number }>();
  for (const u of lookup.values()) {
    for (const t of u.territories) {
      const entry = byId.get(t.id) ?? { id: t.id, name: t.name, users: 0 };
      entry.users++;
      byId.set(t.id, entry);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
