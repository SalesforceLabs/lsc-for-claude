/**
 * collectSetupOverview() — org-wide signals for Studio's Setup Overview: what
 * blocks every feature at once (license capacity, stale or missing metadata
 * caches, changes not yet published to the iPad, an inactive territory model).
 * Per-feature verdicts come from `studio_readiness`; this is only what no
 * single feature owns.
 */

import { chunkIds } from "../tools/helpers.js";
import { count, inList, plural, query, type Row } from "./helpers.js";
import { runCheck } from "./readiness/index.js";
import { cachesByProfile, daysSince, unpublishedChanges } from "./overview-logic.js";
import type { ReadinessCheck } from "./types.js";
import { fetchConfigEdits } from "./unpublished.js";

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
}
/** A live cache older than this is worth a nudge even with no recorded changes. */
const OLD_CACHE_DAYS = 90;
/** How far back unpublished changes are looked for; a cache older than this is compared against what this window holds. */
const CHANGES_LOOKBACK_DAYS = 180;
/** The LSC license, matched like `LSC_PSL` in collectors/territory-users.ts and the user trace. */
const LSC_PSL = "(PermissionSetLicense.DeveloperName LIKE '%LSC4CE%' OR PermissionSetLicense.DeveloperName LIKE '%LifeScienceCommercial%')";

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
  // Only the LSC profiles' caches are read — an org-wide read would be cut off by a row cap.
  const caches = memo(async () => cachesByProfile(await fetchCacheRows(org, (await lscProfiles()).map((p) => p.id))));
  const unpublished = memo(async () => {
    const [byProfile, profiles] = await Promise.all([caches(), lscProfiles()]);
    const names = new Map(profiles.map((p) => [p.id, p.name]));
    const live = [...byProfile.values()].filter((c) => c.activeAt !== undefined && names.has(c.profileId));
    const floor = Date.now() - CHANGES_LOOKBACK_DAYS * 86_400_000;
    const oldest = Math.min(...live.map((c) => c.activeStartedAt ?? c.activeAt!));
    const capped = live.length > 0 && oldest < floor;
    // The same edits, rules and boundary (generation start) as the iPad preview's "not on iPads yet".
    const edits = live.length ? await fetchConfigEdits(org, Math.max(oldest, floor)) : [];
    const list = unpublishedChanges(byProfile, edits)
      .filter((u) => names.has(u.profileId))
      .map((u) => ({ ...u, name: names.get(u.profileId)! }))
      .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
    return Object.assign(list, { cappedAtDays: capped ? CHANGES_LOOKBACK_DAYS : undefined });
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
        const where =
          `FROM User WHERE IsActive = true AND UserType = 'Standard' AND (NOT Profile.Name LIKE '%Admin%') ` +
          `AND Id IN (SELECT AssigneeId FROM PermissionSetLicenseAssign WHERE ${LSC_PSL}) ` +
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
