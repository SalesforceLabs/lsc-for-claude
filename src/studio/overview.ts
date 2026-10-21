/**
 * collectSetupOverview() — org-wide signals for Studio's Setup Overview: what
 * blocks every feature at once (license capacity, stale or missing metadata
 * caches, changes not yet published to the iPad, an inactive territory model).
 * Per-feature verdicts come from `studio_readiness`; this is only what no
 * single feature owns.
 */

import { collectCategoryRecords } from "../config/collect.js";
import { describeSObject } from "../salesforce/cli.js";
import { chunkIds } from "../tools/helpers.js";
import {
  cloneGaps,
  duplicateLine,
  duplicateSettings,
  emptySettings,
  isLscPermission,
  overrideLine,
  permLabel,
  settingOverrides,
  type CloneGap,
  type PermSet,
} from "./admin-console-checks.js";
import { count, inList, plural, query, type Row } from "./helpers.js";
import { runCheck } from "./readiness/index.js";
import { cachesByProfile, daysSince, unpublishedChanges, type ProfileCache } from "./overview-logic.js";
import type { ReadinessCheck } from "./types.js";
import { fetchConfigEdits } from "./unpublished.js";
import { memoFocus, withProfileFocus } from "./profile-focus.js";
import { ipadProfiles } from "./scope.js";

export interface SetupOverview {
  org: string;
  collectedAt: string;
  checks: ReadinessCheck[];
  /** Profiles whose iPads are behind the Admin Console (for "Publish to iPad"). */
  unpublishedProfiles: string[];
  /** How many configuration changes are not on iPads yet (distinct records). */
  unpublishedChanges: number;
  /** Per profile, how many of those reach it — the Admin Console part of that profile's `studio_unpublished`. Most first. */
  unpublishedByProfile: { profile: string; changes: number }[];
  /** The profile it was checked for; missing for every profile. */
  profile?: string;
}
/** A live cache older than this is worth a nudge even with no recorded changes. */
const OLD_CACHE_DAYS = 90;
/** How far back unpublished changes are looked for; a cache older than this is compared against what this window holds. */
const CHANGES_LOOKBACK_DAYS = 180;
/** The LSC license, matched like `LSC_PSL` in scope.ts, collectors/territory-users.ts and the user trace. */
const LSC_PSL = "(PermissionSetLicense.DeveloperName LIKE '%LSC4CE%' OR PermissionSetLicense.DeveloperName LIKE '%LifeScienceCommercial%')";

export interface LscProfile {
  id: string;
  name: string;
  users: number;
}

/** The Overview's checks for every profile or (`profile`, a profile name) for one. */
export function collectSetupOverview(org: string, profile?: string): Promise<SetupOverview> {
  return withProfileFocus(profile, async () => ({ ...(await gatherOverview(org)), ...(profile ? { profile } : {}) }));
}

async function gatherOverview(org: string): Promise<SetupOverview> {
  // Shared by several checks; each check turns a rejection into "unknown".
  const memo = memoFocus;
  // The iPad profiles of the org's scope (or the picked one): the ones whose users download a metadata cache.
  const lscProfiles = memo(async (): Promise<LscProfile[]> => (await ipadProfiles(org)).map((p) => ({ id: p.id, name: p.name, users: p.users })));
  // Only the LSC profiles' caches are read — an org-wide read would be cut off by a row cap.
  const caches = memo(async () => cachesByProfile(await fetchCacheRows(org, (await lscProfiles()).map((p) => p.id))));
  const unpublished = memo(async () => {
    const [byProfile, profiles] = await Promise.all([caches(), lscProfiles()]);
    return profilesBehind(org, byProfile, new Map(profiles.map((p) => [p.id, p.name])));
  });
  const psls = memo(() => fetchPsls(org));
  const settings = memo(() => fetchSettings(org));

  const checks = await Promise.all([
    runCheck(
      {
        id: "overview.access.psl-full",
        stage: "access",
        title: "LSC licenses have room for new users",
        severity: "error",
        why: "A permission set license with no seats left can't be assigned, so new reps can't be given access.",
        uiPath: "Setup > Company Information > Permission Set Licenses",
      },
      async () => {
        const full = (await psls()).filter((p) => p.used >= p.total);
        return { pass: full.length === 0, detail: full.length ? `${full.length} at capacity` : undefined, examples: full.map(pslLabel) };
      }
    ),
    runCheck(
      {
        id: "overview.access.psl-near-full",
        stage: "access",
        title: "LSC licenses are below 90% used",
        severity: "warning",
        why: "Running close to the license limit leaves little room to add users.",
        uiPath: "Setup > Company Information > Permission Set Licenses",
      },
      async () => {
        const near = (await psls()).filter((p) => p.used < p.total && p.used / p.total >= 0.9);
        return { pass: near.length === 0, detail: near.length ? `${near.length} nearly full` : undefined, examples: near.map(pslLabel) };
      }
    ),
    runCheck(
      {
        id: "overview.access.package-license",
        stage: "access",
        title: "Life Sciences package has seats available",
        severity: "error",
        why: "The managed package license caps how many users can use LSC at all.",
        uiPath: "Setup > Installed Packages > Manage Licenses",
      },
      async () => {
        const rows = await query(
          `SELECT NamespacePrefix, AllowedLicenses, UsedLicenses FROM PackageLicense WHERE NamespacePrefix = 'lsc4ce'`,
          org
        );
        const r = rows[0];
        const allowed = Number(r?.AllowedLicenses);
        if (!r || !(allowed > 0)) return { pass: true, skip: true, detail: "Unlimited or no package license found." };
        const used = Number(r.UsedLicenses ?? 0);
        return { pass: used < allowed, detail: `${used} of ${allowed} seats used` };
      }
    ),
    runCheck(
      {
        id: "overview.access.cloned-permission-sets",
        stage: "access",
        title: "Copies of the standard LSC permission sets have their LSC permissions",
        severity: "warning",
        why: "A permission set cloned from a standard LSC one keeps only what the standard set had on the day it was copied. Permissions Salesforce adds to the standard set later, or that were left off the copy, never reach the users who hold the copy, and the features behind them stay hidden or fail for them.",
        steps: ["Open each permission set listed", "Switch on the system permissions it lacks, or assign the standard set alongside it"],
        uiPath: "Setup > Permission Sets > System Permissions",
      },
      async () => {
        const gaps = await fetchCloneGaps(org);
        if (gaps === null) return { pass: true, skip: true, detail: "No custom permission sets on the LSC license." };
        return {
          pass: gaps.length === 0,
          detail: gaps.length ? `${plural(gaps.length, "copied permission set")} leave active users without LSC permissions the standard set gives` : "Every copy has the standard set's LSC permissions, or its users get them elsewhere.",
          examples: gaps.map(
            (g) => `${g.clone.label} (like ${g.source.label}, ${plural(g.users, "user")}): lacks ${g.missing.slice(0, 4).map(permLabel).join(", ")}${g.missing.length > 4 ? ` and ${g.missing.length - 4} more` : ""}`
          ),
        };
      }
    ),
    runCheck(
      {
        id: "overview.config.setting-overrides",
        stage: "config",
        title: "Profile and user settings that differ from the org-level setting",
        severity: "info",
        why: "When an Admin Console setting has a record for a profile or user, the app reads that record and ignores the org-level one. A change made on the org-level record then doesn't reach those users, which looks like the setting doesn't work.",
        steps: ["If a change you made isn't showing for some users, check the records listed here", "Change the value on the profile or user record too, or delete it so the org-level record applies"],
        uiPath: "Admin Console > Settings",
      },
      async () => {
        const list = settingOverrides(await settings());
        return {
          pass: list.length === 0,
          detail: list.length ? `${plural(list.length, "profile or user record")} override the org-level setting` : undefined,
          examples: list.map(overrideLine),
        };
      }
    ),
    runCheck(
      {
        id: "overview.config.duplicate-settings",
        stage: "config",
        title: "Each Admin Console setting has one record per profile or user",
        severity: "warning",
        why: "Two active records of the same setting for one profile, one user or the org level compete. Which one the app reads depends on order, so a change can seem to work for some users and not others.",
        steps: ["Open the setting in Admin Console", "Keep one record for each profile or user listed; switch off or delete the others"],
        uiPath: "Admin Console > Settings",
      },
      async () => {
        const list = duplicateSettings(await settings());
        return {
          pass: list.length === 0,
          detail: list.length ? `${plural(list.length, "setting")} with competing records` : undefined,
          examples: list.map(duplicateLine),
        };
      }
    ),
    runCheck(
      {
        id: "overview.config.empty-settings",
        stage: "config",
        title: "No active Admin Console record is missing its values",
        severity: "warning",
        why: "A record saved without values still counts as the setting for whoever it's assigned to, so they get nothing where others get the configured behavior (an empty planner or call discussion setting, for example).",
        steps: ["Open each record listed in Admin Console", "Fill in its values, or switch it off"],
        uiPath: "Admin Console > Settings",
      },
      async () => {
        const list = emptySettings(await settings());
        return {
          pass: list.length === 0,
          detail: list.length ? `${plural(list.length, "record")} with no values` : undefined,
          examples: list.map((r) => `${r.category} › ${r.label ?? r.developerName}`),
        };
      }
    ),
    runCheck(
      {
        id: "overview.data.territory-model",
        stage: "data",
        title: "Exactly one Territory Model is active",
        severity: "error",
        why: "Account access, activity plans and sync filters all follow the active territory model. With none active nothing is aligned; only one can be active at a time.",
        uiPath: "Setup > Territory Models",
      },
      async () => {
        const rows = await query(`SELECT Id, Name, State FROM Territory2Model`, org);
        if (rows.length === 0) return { pass: true, skip: true, detail: "No territory models in this org." };
        const active = rows.filter((r) => r.State === "Active");
        return { pass: active.length === 1, detail: `${active.length} of ${plural(rows.length, "model")} active`, examples: active.map((r) => String(r.Name)) };
      }
    ),
    runCheck(
      {
        id: "overview.data.users-without-territory",
        stage: "data",
        title: "Every iPad user is in a territory",
        severity: "warning",
        why: "A rep with no territory in the active model sees no accounts and syncs almost nothing.",
        uiPath: "Setup > Territory Models > Active model > Assign Users",
      },
      async () => {
        const [model] = await query(`SELECT Id FROM Territory2Model WHERE State = 'Active' LIMIT 1`, org);
        if (!model) return { pass: true, skip: true, detail: "No active territory model." };
        const ids = (await lscProfiles()).map((p) => p.id);
        if (!ids.length) return { pass: true, skip: true, detail: "No iPad profiles found." };
        const where =
          `FROM User WHERE IsActive = true AND UserType = 'Standard' AND ProfileId IN (${inList(ids)}) ` +
          `AND Id NOT IN (SELECT UserId FROM UserTerritory2Association WHERE Territory2.Territory2ModelId = '${model.Id}')`;
        // The number is a COUNT(); LIMIT only bounds the names listed.
        const [total, rows] = await Promise.all([count(`SELECT COUNT() ${where}`, org), query(`SELECT Id, Name ${where} ORDER BY Name LIMIT 200`, org)]);
        return {
          pass: total === 0,
          detail: total ? `${plural(total, "user")} with no territory` : undefined,
          examples: rows.map((r) => String(r.Name)),
        };
      }
    ),
    runCheck(
      {
        id: "overview.mobile.cache-missing",
        stage: "mobile",
        title: "Every iPad profile has a published metadata cache",
        severity: "error",
        why: "Without an Active metadata cache for their profile, reps' iPads have nothing to download.",
        uiPath: "Admin Console > Mobile > Metadata Cache",
      },
      async () => {
        const [profiles, byProfile] = await Promise.all([lscProfiles(), caches()]);
        const missing = profiles.filter((p) => byProfile.get(p.id)?.activeAt === undefined);
        return {
          pass: missing.length === 0,
          skip: profiles.length === 0,
          detail: missing.length ? `${plural(missing.length, "profile")} never published` : undefined,
          examples: missing.map((p) => `${p.name} (${plural(p.users, "user")})`),
        };
      }
    ),
    runCheck(
      {
        id: "overview.mobile.cache-failed",
        stage: "mobile",
        title: "Latest metadata cache build succeeded for every profile",
        severity: "error",
        why: "When the newest cache build fails, the iPad keeps the older one (or nothing) and your changes don't reach it.",
        uiPath: "Admin Console > Mobile > Metadata Cache",
      },
      async () => {
        const [profiles, byProfile] = await Promise.all([lscProfiles(), caches()]);
        const failed = profiles.filter((p) => byProfile.get(p.id)?.failed);
        return {
          pass: failed.length === 0,
          skip: profiles.length === 0,
          detail: failed.length ? byProfile.get(failed[0].id)!.failed!.message.slice(0, 200) : undefined,
          examples: failed.map((p) => p.name),
        };
      }
    ),
    runCheck(
      {
        id: "overview.mobile.unpublished",
        stage: "mobile",
        title: "iPads have the latest Admin Console configuration",
        severity: "warning",
        why: "Mobile settings, DB Schema, tabs and actions reach the iPad only when the profile's metadata cache is regenerated. Changes after the last publish aren't on reps' devices yet. Deleted records leave nothing to compare, so a deletion alone isn't flagged here.",
        uiPath: "Admin Console > Mobile > Metadata Cache",
      },
      async () => {
        const list = await unpublished();
        const distinct = new Set(list.flatMap((u) => u.items.map((i) => i.id)));
        return {
          pass: list.length === 0,
          detail:
            [
              list.length ? `${plural(distinct.size, "configuration change")} not on iPads yet · ${plural(list.length, "profile")} affected` : undefined,
              list.cappedAtDays ? `Looked back ${list.cappedAtDays} days only; a profile published longer ago may be missing older changes.` : undefined,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
          examples: list.map((u) => `${u.name} (${plural(u.items.length, "change")})`),
        };
      }
    ),
    runCheck(
      {
        id: "overview.mobile.cache-old",
        stage: "mobile",
        title: `Metadata caches were published in the last ${OLD_CACHE_DAYS} days`,
        severity: "info",
        why: "Salesforce metadata changes (layouts, Lightning pages, permissions) aren't tracked here; republishing now and then keeps the iPad current.",
        uiPath: "Admin Console > Mobile > Metadata Cache",
      },
      async () => {
        const [profiles, byProfile] = await Promise.all([lscProfiles(), caches()]);
        const old = profiles.filter((p) => {
          const at = byProfile.get(p.id)?.activeAt;
          return at !== undefined && daysSince(at) > OLD_CACHE_DAYS;
        });
        return {
          pass: old.length === 0,
          skip: profiles.length === 0,
          detail: old.length ? `${plural(old.length, "profile")} not published in over ${OLD_CACHE_DAYS} days` : undefined,
          examples: old.map((p) => `${p.name} (${daysSince(byProfile.get(p.id)!.activeAt!)} days ago)`),
        };
      }
    ),
  ]);

  // Reuse the memoised work for the structured part; a failure leaves it empty.
  const affected = await unpublished().catch(() => []);
  return {
    org,
    collectedAt: new Date().toISOString(),
    checks,
    unpublishedProfiles: affected.map((u) => u.name),
    unpublishedChanges: new Set(affected.flatMap((u) => u.items.map((i) => i.id))).size,
    unpublishedByProfile: affected.map((u) => ({ profile: u.name, changes: u.items.length })),
  };
}

/**
 * The named profiles whose live cache is behind the Admin Console, most changes first — the same edits,
 * rules and boundary (generation start) as the iPad preview's "not on iPads yet". `cappedAtDays` is set
 * when a cache is older than the lookback, so older changes may be missing.
 */
export async function profilesBehind(org: string, byProfile: Map<string, ProfileCache>, names: Map<string, string>) {
  const live = [...byProfile.values()].filter((c) => c.activeAt !== undefined && names.has(c.profileId));
  const floor = Date.now() - CHANGES_LOOKBACK_DAYS * 86_400_000;
  const oldest = Math.min(...live.map((c) => c.activeStartedAt ?? c.activeAt!));
  const capped = live.length > 0 && oldest < floor;
  const edits = live.length ? await fetchConfigEdits(org, Math.max(oldest, floor)) : [];
  const list = unpublishedChanges(byProfile, edits)
    .filter((u) => names.has(u.profileId))
    .map((u) => ({ ...u, name: names.get(u.profileId)! }))
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  return Object.assign(list, { cappedAtDays: capped ? CHANGES_LOOKBACK_DAYS : undefined });
}

// ─── Queries ────────────────────────────────────────────────────────────────

interface Psl {
  name: string;
  used: number;
  total: number;
}

const pslLabel = (p: Psl) => `${p.name} (${p.used}/${p.total})`;

async function fetchPsls(org: string): Promise<Psl[]> {
  const rows = await query(
    `SELECT MasterLabel, DeveloperName, TotalLicenses, UsedLicenses FROM PermissionSetLicense WHERE Status = 'Active' AND TotalLicenses > 0 AND (DeveloperName LIKE '%LSC%' OR DeveloperName LIKE 'LifeSci%')`,
    org
  );
  return rows.map((r) => ({ name: String(r.MasterLabel ?? r.DeveloperName), used: Number(r.UsedLicenses ?? 0), total: Number(r.TotalLicenses) }));
}

/** Profiles of active users who hold an LSC permission set license, with how many. */
export async function fetchLscProfiles(org: string): Promise<LscProfile[]> {
  const rows = await query(
    `SELECT Profile.Name pn, ProfileId pid, COUNT(Id) cnt FROM User WHERE IsActive = true AND UserType = 'Standard' ` +
      `AND Id IN (SELECT AssigneeId FROM PermissionSetLicenseAssign WHERE ${LSC_PSL}) GROUP BY Profile.Name, ProfileId ORDER BY COUNT(Id) DESC`,
    org
  );
  return rows.filter((r) => r.pid).map((r) => ({ id: String(r.pid), name: String(r.pn), users: Number(r.cnt ?? r.expr0 ?? 0) }));
}

/** Every Admin Console record outside DB Schema and UI Settings (those have their own checks); a failed read throws. */
function fetchSettings(org: string) {
  return collectCategoryRecords(
    org,
    `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category NOT IN ('DbSchema', 'UISchema') ORDER BY Category`,
    { strict: true, cache: true }
  );
}

/** The standard LSC permission sets clones are compared with. */
const STANDARD_LSC_SETS = ["LifeSciencesCommercialAdmin", "LifeSciencesFieldMedical", "LifeSciencesFieldSalesRepresentative", "LifeSciencesKeyAccountManager"];
/** Clone assignees looked at per copy; enough to tell whether anyone is short. */
const MAX_CLONE_USERS = 2000;

/**
 * Custom permission sets on the standard LSC sets' license (or with the LSC user permission) that lack
 * LSC permissions their closest standard set has, with how many active holders get those permissions
 * from no other assignment (profile, set or group). Null when there is no such custom set.
 */
async function fetchCloneGaps(org: string): Promise<(CloneGap & { users: number })[] | null> {
  const described = await describeSObject("PermissionSet", org);
  if (!described.success || !described.data) throw new Error(described.error ?? "Couldn't describe PermissionSet.");
  const perms = described.data.fields.map((f) => f.name).filter(isLscPermission);
  if (perms.length === 0) return null;
  const toSet = (r: Row): PermSet => ({ id: String(r.Id), name: String(r.Name), label: String(r.Label ?? r.Name), perms: new Set(perms.filter((p) => r[p] === true)) });
  const cols = `Id, Name, Label, LicenseId, ${perms.join(", ")}`;
  const standardRows = await query(`SELECT ${cols} FROM PermissionSet WHERE Name IN (${inList(STANDARD_LSC_SETS)}) AND IsCustom = false`, org);
  if (standardRows.length === 0) return null;
  const licenses = [...new Set(standardRows.map((r) => r.LicenseId).filter(Boolean).map(String))];
  const licensed = licenses.length ? `LicenseId IN (${inList(licenses)}) OR ` : "";
  const cloneRows = await query(
    `SELECT ${cols} FROM PermissionSet WHERE IsCustom = true AND IsOwnedByProfile = false AND Type = 'Regular' AND (${licensed}PermissionsIndustriesLSC4CEUser = true)`,
    org
  );
  if (cloneRows.length === 0) return null;
  const gaps = cloneGaps(standardRows.map(toSet), cloneRows.map(toSet));

  const out: (CloneGap & { users: number })[] = [];
  for (const g of gaps) {
    const holders = await query(
      `SELECT AssigneeId FROM PermissionSetAssignment WHERE PermissionSetId = '${g.clone.id}' AND Assignee.IsActive = true LIMIT ${MAX_CLONE_USERS}`,
      org
    );
    const users = [...new Set(holders.map((h) => String(h.AssigneeId)))];
    if (users.length === 0) continue;
    // A holder is short when some missing permission comes from none of their assignments.
    const short = new Set<string>();
    const missing: string[] = [];
    for (const p of g.missing) {
      const covered = new Set<string>();
      for (const chunk of chunkIds(users)) {
        const rows = await query(`SELECT AssigneeId FROM PermissionSetAssignment WHERE AssigneeId IN (${inList(chunk)}) AND PermissionSet.${p} = true`, org);
        for (const r of rows) covered.add(String(r.AssigneeId));
      }
      const lacking = users.filter((u) => !covered.has(u));
      if (lacking.length) missing.push(p);
      for (const u of lacking) short.add(u);
    }
    if (short.size) out.push({ ...g, missing, users: short.size });
  }
  return out;
}

/** Every cache record of the given profiles (no row cap; a read cut off by the size limit throws). */
async function fetchCacheRows(org: string, profileIds: string[]): Promise<Row[]> {
  const groups = await Promise.all(
    chunkIds(profileIds).map((chunk) =>
      query(
        `SELECT Id, Status, IntegrationStatus, IntegrationErrorCode, IntegrationErrorMessage, CreatedDate, LastModifiedDate, ProfileId FROM LifeSciMobileMetadataRecord WHERE ProfileId IN (${inList(chunk)}) ORDER BY LastModifiedDate DESC`,
        org
      )
    )
  );
  return groups.flat();
}
