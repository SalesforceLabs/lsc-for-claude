/**
 * collectSetupOverview() — org-wide signals for Studio's Setup Overview: what
 * blocks every feature at once (license capacity, stale or missing metadata
 * caches, changes not yet published to the iPad, an inactive territory model).
 * Per-feature verdicts come from `studio_readiness`; this is only what no
 * single feature owns.
 */

import { inList, plural, query, type Row } from "./helpers.js";
import { runCheck } from "./readiness/index.js";
import { cachesByProfile, daysSince, unpublishedChanges, type ConfigChange } from "./overview-logic.js";
import type { ReadinessCheck } from "./types.js";

export interface SetupOverview {
  org: string;
  collectedAt: string;
  checks: ReadinessCheck[];
  /** Profiles whose iPads are behind the Admin Console (for "Publish to iPad"). */
  unpublishedProfiles: string[];
  /** How many configuration changes are not on iPads yet (distinct records). */
  unpublishedChanges: number;
}

/** Admin Console categories whose records end up in a profile's mobile metadata cache. */
const MOBILE_CATEGORIES = ["DbSchema", "UISchema", "QuickAction", "CustomAction", "ApplicationSettings", "ProfileBasedAppSettings"];
/** A live cache older than this is worth a nudge even with no recorded changes. */
const OLD_CACHE_DAYS = 90;
const LSC_PSL = "PermissionSetLicense.DeveloperName LIKE '%LSC4CE%'";

interface LscProfile {
  id: string;
  name: string;
  users: number;
}

export async function collectSetupOverview(org: string): Promise<SetupOverview> {
  // Shared by several checks; each check turns a rejection into "unknown".
  const memo = <T>(fn: () => Promise<T>) => {
    let p: Promise<T> | undefined;
    return () => (p ??= fn());
  };
  const lscProfiles = memo(() => fetchLscProfiles(org));
  const caches = memo(async () => cachesByProfile(await fetchCacheRows(org)));
  const unpublished = memo(async () => {
    const [byProfile, profiles] = await Promise.all([caches(), lscProfiles()]);
    const live = [...byProfile.values()].filter((c) => c.activeAt !== undefined);
    const changes = await fetchChanges(org, Math.min(...live.map((c) => c.activeAt!)), live.length === 0);
    const names = new Map(profiles.map((p) => [p.id, p.name]));
    return unpublishedChanges(byProfile, changes).filter((u) => names.has(u.profileId)).map((u) => ({ ...u, name: names.get(u.profileId)! }));
  });
  const psls = memo(() => fetchPsls(org));

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
        why: "Running close to the license limit leaves little room to onboard users before go-live.",
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
        title: "Every LSC field user is in a territory",
        severity: "warning",
        why: "A rep with no territory in the active model sees no accounts and syncs almost nothing.",
        uiPath: "Setup > Territory Models > Active model > Assign Users",
      },
      async () => {
        const [model] = await query(`SELECT Id FROM Territory2Model WHERE State = 'Active' LIMIT 1`, org);
        if (!model) return { pass: true, skip: true, detail: "No active territory model." };
        const rows = await query(
          `SELECT Id, Name FROM User WHERE IsActive = true AND UserType = 'Standard' AND (NOT Profile.Name LIKE '%Admin%') ` +
            `AND Id IN (SELECT AssigneeId FROM PermissionSetLicenseAssign WHERE ${LSC_PSL}) ` +
            `AND Id NOT IN (SELECT UserId FROM UserTerritory2Association WHERE Territory2.Territory2ModelId = '${model.Id}') ORDER BY Name LIMIT 200`,
          org
        );
        return {
          pass: rows.length === 0,
          detail: rows.length ? `${plural(rows.length, "user")} with no territory` : undefined,
          examples: rows.map((r) => String(r.Name)),
        };
      }
    ),
    runCheck(
      {
        id: "overview.mobile.cache-missing",
        stage: "mobile",
        title: "Every LSC profile has a published iPad metadata cache",
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
        why: "Mobile settings, DB Schema, tabs and actions reach the iPad only when the profile's metadata cache is regenerated. Changes after the last publish aren't on reps' devices yet.",
        uiPath: "Admin Console > Mobile > Metadata Cache",
      },
      async () => {
        const list = await unpublished();
        const distinct = new Set(list.flatMap((u) => u.changes.map((c) => c.label)));
        return {
          pass: list.length === 0,
          detail: list.length ? `${plural(distinct.size, "configuration change")} not on iPads yet · ${plural(list.length, "profile")} affected` : undefined,
          examples: list.map((u) => u.name),
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
    unpublishedChanges: new Set(affected.flatMap((u) => u.changes.map((c) => c.label))).size,
  };
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
async function fetchLscProfiles(org: string): Promise<LscProfile[]> {
  const rows = await query(
    `SELECT Profile.Name pn, ProfileId pid, COUNT(Id) cnt FROM User WHERE IsActive = true AND UserType = 'Standard' ` +
      `AND Id IN (SELECT AssigneeId FROM PermissionSetLicenseAssign WHERE ${LSC_PSL}) GROUP BY Profile.Name, ProfileId ORDER BY COUNT(Id) DESC`,
    org
  );
  return rows.filter((r) => r.pid).map((r) => ({ id: String(r.pid), name: String(r.pn), users: Number(r.cnt ?? r.expr0 ?? 0) }));
}

function fetchCacheRows(org: string): Promise<Row[]> {
  return query(
    `SELECT Id, Status, IntegrationStatus, IntegrationErrorCode, IntegrationErrorMessage, LastModifiedDate, ProfileId FROM LifeSciMobileMetadataRecord WHERE ProfileId != null ORDER BY LastModifiedDate DESC LIMIT 2000`,
    org
  );
}

/** Mobile-relevant Admin Console records (or their assignments) edited after `since`. */
async function fetchChanges(org: string, since: number, none: boolean): Promise<ConfigChange[]> {
  if (none || !Number.isFinite(since)) return [];
  const iso = new Date(since).toISOString();
  const [edited, reassigned] = await Promise.all([
    query(`SELECT Id FROM LifeSciConfigRecord WHERE LastModifiedDate > ${iso}`, org, true),
    query(`SELECT LifeSciConfigRecordId FROM LifeSciConfigAssignment WHERE LastModifiedDate > ${iso}`, org, true),
  ]);
  const ids = [...new Set([...edited.map((r) => String(r.Id)), ...reassigned.map((r) => String(r.LifeSciConfigRecordId))])];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const out: ConfigChange[] = [];
  for (const chunk of chunks) {
    const [records, assignments] = await Promise.all([
      query(
        `SELECT Id, DeveloperName, IsOrgLevel, LastModifiedDate, LifeSciConfigCategory.Category FROM LifeSciConfigRecord WHERE Id IN (${inList(chunk)})`,
        org,
        true
      ),
      query(
        `SELECT LifeSciConfigRecordId, AssignedToId, AssignmentLevel, LastModifiedDate FROM LifeSciConfigAssignment WHERE LifeSciConfigRecordId IN (${inList(chunk)})`,
        org,
        true
      ),
    ]);
    for (const r of records) {
      const category = (r.LifeSciConfigCategory as Row | null)?.Category;
      if (!MOBILE_CATEGORIES.includes(String(category))) continue;
      const mine = assignments.filter((a) => a.LifeSciConfigRecordId === r.Id);
      const at = Math.max(Date.parse(String(r.LastModifiedDate)), ...mine.map((a) => Date.parse(String(a.LastModifiedDate))));
      out.push({
        label: `${category}: ${r.DeveloperName}`,
        at,
        profileIds: mine.filter((a) => a.AssignmentLevel === "Profile").map((a) => String(a.AssignedToId)),
        allProfiles: r.IsOrgLevel === true || mine.some((a) => a.AssignmentLevel !== "Profile"),
      });
    }
  }
  return out;
}
