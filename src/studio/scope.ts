/**
 * Who Studio checks: every profile with active users, put in one of four groups so the
 * Overview and every feature's checks look at the same people, and so the Overview's
 * "Readiness for" picker can list the profiles with LSC users.
 *
 * - `ipad` — the profile has LSC Mobile app settings, DB Schema records or a published
 *   metadata cache. Everything is checked for it.
 * - `web` — its users hold the LSC license but it has no iPad setup. License, access and
 *   (when the admin says so) territory are checked; iPad checks never are.
 * - `admin` — administrators and integration users. Not counted as reps.
 * - `out` — no LSC. Ignored.
 *
 * With a profile picked (`profile-focus.ts`), `ipadProfiles` answers
 * with that profile only, whatever its group.
 */

import { sharedRead } from "../config/read-cache.js";
import { chunkIds } from "../tools/helpers.js";
import { fetchCategories, profilesOf } from "./collectors/shared.js";
import { inList, query, type Row } from "./helpers.js";
import { focusedProfile } from "./profile-focus.js";

export type ScopeGroup = "ipad" | "web" | "admin" | "out";

export interface ScopeProfile {
  id: string;
  name: string;
  /** Active standard users. */
  users: number;
  /** Of those, how many hold the LSC license. */
  licensed: number;
  group: ScopeGroup;
  /** What Studio found, in plain words ("Has LSC Mobile app settings"). */
  reason: string;
}

export interface OrgScope {
  profiles: ScopeProfile[];
}

/** The LSC license, matched like `LSC_PSL` in overview.ts and the user trace. */
const LSC_PSL = "(PermissionSetLicense.DeveloperName LIKE '%LSC4CE%' OR PermissionSetLicense.DeveloperName LIKE '%LifeScienceCommercial%')";

export interface ScopeFacts {
  id: string;
  name: string;
  users: number;
  licensed: number;
  /** Modify All Data, or an integration license or name. */
  admin: boolean;
  appSettings: boolean;
  dbSchema: boolean;
  cache: boolean;
  /** Another profile has the same name, so app settings and DB Schema (assigned by name) may be the other one's. */
  sharedName?: boolean;
}

/** Studio's own grouping of one profile, and why. */
export function detectGroup(f: ScopeFacts): { group: ScopeGroup; reason: string } {
  if (f.admin && (f.licensed || f.appSettings || f.dbSchema || f.cache)) return { group: "admin", reason: "Administrator or integration profile" };
  if (f.admin) return { group: "out", reason: "Administrator or integration profile, no LSC" };
  // Two profiles named alike: setup assigned by name counts only for the one whose users are licensed.
  const byName = !f.sharedName || f.licensed > 0;
  const ipad = [byName && f.appSettings && "LSC Mobile app settings", byName && f.dbSchema && "DB Schema records", f.cache && "an iPad metadata cache"].filter(Boolean);
  if (ipad.length) return { group: "ipad", reason: `Has ${ipad.join(", ").replace(/, ([^,]*)$/, " and $1")}` };
  if (f.licensed) return { group: "web", reason: "LSC license, no iPad setup" };
  if (f.sharedName && (f.appSettings || f.dbSchema)) return { group: "out", reason: "No LSC license. Another profile has the same name; the iPad setup named for it is taken as that one's" };
  return { group: "out", reason: "No LSC license" };
}

export function groupProfiles(facts: ScopeFacts[]): ScopeProfile[] {
  return facts
    .map((f) => ({ id: f.id, name: f.name, users: f.users, licensed: f.licensed, ...detectGroup(f) }))
    .sort((a, b) => b.users - a.users || a.name.localeCompare(b.name));
}

/** Every profile with active users, grouped. Shared for a minute. */
export function lscScope(org: string): Promise<OrgScope> {
  return sharedRead(org, "scope", async () => ({ profiles: groupProfiles(await readFacts(org)) }));
}

async function readFacts(org: string): Promise<ScopeFacts[]> {
  const [all, licensed, settings] = await Promise.all([
    query(`SELECT ProfileId pid, Profile.Name pn, COUNT(Id) cnt FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY ProfileId, Profile.Name`, org),
    query(
      `SELECT ProfileId pid, COUNT(Id) cnt FROM User WHERE IsActive = true AND UserType = 'Standard' ` +
        `AND Id IN (SELECT AssigneeId FROM PermissionSetLicenseAssign WHERE ${LSC_PSL}) GROUP BY ProfileId`,
      org
    ),
    // An org without LSC has no Admin Console; that only means no profile has iPad setup.
    fetchCategories(org, ["ProfileBasedAppSettings", "DbSchema"]).catch(() => []),
  ]);
  const ids = all.map((r) => String(r.pid ?? "")).filter(Boolean);
  const [profiles, caches] = await Promise.all([
    byIds(ids, (chunk) => query(`SELECT Id, Name, PermissionsModifyAllData, UserLicense.Name FROM Profile WHERE Id IN (${inList(chunk)})`, org)),
    byIds(ids, (chunk) =>
      query(`SELECT ProfileId pid, COUNT(Id) cnt FROM LifeSciMobileMetadataRecord WHERE ProfileId IN (${inList(chunk)}) AND Status IN ('Active', 'Published') GROUP BY ProfileId`, org)
    ).catch(() => [] as Row[]),
  ]);
  const licensedBy = new Map(licensed.map((r) => [String(r.pid), Number(r.cnt ?? r.expr0 ?? 0)]));
  const profileBy = new Map(profiles.map((r) => [String(r.Id), r]));
  const cached = new Set(caches.map((r) => String(r.pid)));
  const names = (category: string) =>
    new Set(settings.filter((r) => r.category === category && (category !== "DbSchema" || r.isActive)).flatMap(profilesOf).map((n) => n.toLowerCase()));
  const appSettings = names("ProfileBasedAppSettings");
  const dbSchema = names("DbSchema");
  const nameCount = new Map<string, number>();
  for (const r of all) nameCount.set(String(r.pn ?? "").toLowerCase(), (nameCount.get(String(r.pn ?? "").toLowerCase()) ?? 0) + 1);

  return all
    .filter((r) => r.pid)
    .map((r) => {
      const id = String(r.pid);
      const name = String(r.pn ?? id);
      const p = profileBy.get(id);
      const license = String((p?.UserLicense as { Name?: string } | undefined)?.Name ?? "");
      return {
        id,
        name,
        users: Number(r.cnt ?? r.expr0 ?? 0),
        licensed: licensedBy.get(id) ?? 0,
        admin: p?.PermissionsModifyAllData === true || /integration/i.test(license) || /integration/i.test(name),
        appSettings: appSettings.has(name.toLowerCase()),
        dbSchema: dbSchema.has(name.toLowerCase()),
        cache: cached.has(id),
        sharedName: (nameCount.get(name.toLowerCase()) ?? 0) > 1,
      };
    });
}

async function byIds(ids: string[], read: (chunk: string[]) => Promise<Row[]>): Promise<Row[]> {
  return (await Promise.all(chunkIds(ids).map(read))).flat();
}

/** The iPad profiles — the reps every check looks at — or the picked profile, whatever its group. */
export async function ipadProfiles(org: string): Promise<ScopeProfile[]> {
  const picked = focusedProfile()?.toLowerCase();
  const { profiles } = await lscScope(org);
  return profiles.filter((p) => (picked ? p.name.toLowerCase() === picked : p.group === "ipad"));
}
