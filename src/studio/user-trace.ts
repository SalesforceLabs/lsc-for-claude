/**
 * traceUser() — "why can't this rep …?" Walks the chain a field user needs,
 * in order (active user → profile → licenses → permission sets → territory →
 * what syncs to their iPad → metadata cache → last sync), optionally narrowed
 * to one feature, and stops pointing at the first broken link.
 */

import type { ConfigRecord } from "../config/types.js";
import { actionAudience, fetchCategories } from "./collectors/shared.js";
import { LSC_PSL } from "./collectors/territory-users.js";
import { getFeature, type FeatureDefinition } from "./features.js";
import { audienceOf, inList, matchesAny, plural, query, type Row } from "./helpers.js";
import { runCheck } from "./readiness/index.js";
import { assertId } from "./change-helpers.js";
import type { Audience, ReadinessCheck, StudioFix } from "./types.js";

export interface UserTrace {
  org: string;
  collectedAt: string;
  userId: string;
  userName: string;
  profile: string | null;
  featureId: string | null;
  checks: ReadinessCheck[];
}

/** A cache older than this many days at the user's last sync is suspect; config newer than the cache is what matters. */
const STALE_SYNC_DAYS = 14;

function rel(r: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v as Row | undefined)?.[k], r);
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const ieq = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

interface UserInfo {
  id: string;
  name: string;
  username: string;
  active: boolean;
  profileId: string | null;
  profile: string | null;
  license: string | null;
  role: string | null;
}

/** Everything the checks share, each read once and in parallel. A failed read rejects only the checks that need it. */
interface Facts {
  psls: Promise<{ assigned: Row[]; available: Row[] }>;
  assignments: Promise<Row[]>;
  territories: Promise<Row[]>;
  dbSchema: Promise<ConfigRecord[]>;
  actions: Promise<ConfigRecord[]>;
  caches: Promise<Row[]>;
  syncs: Promise<Row[]>;
}

export async function traceUser(userId: string, featureId: string | null, org: string): Promise<UserTrace> {
  assertId(userId);
  const feature = featureId ? getFeature(featureId) : undefined;
  if (featureId && !feature) throw new Error(`Unknown feature: ${featureId}`);

  const rows = await query(
    `SELECT Id, Name, Username, IsActive, ProfileId, Profile.Name, Profile.UserLicense.Name, UserRole.Name FROM User WHERE Id = '${userId}'`,
    org
  );
  const u = rows[0];
  if (!u) throw new Error(`User ${userId} not found`);
  const user: UserInfo = {
    id: userId,
    name: str(u.Name),
    username: str(u.Username),
    active: u.IsActive === true,
    profileId: str(u.ProfileId) || null,
    profile: str(rel(u, "Profile.Name")) || null,
    license: str(rel(u, "Profile.UserLicense.Name")) || null,
    role: str(rel(u, "UserRole.Name")) || null,
  };

  const facts = gather(user, org);
  // Rejections are consumed by the checks that await them; this keeps unused ones from surfacing as unhandled.
  for (const p of Object.values(facts)) p.catch(() => undefined);

  const checks = await Promise.all([
    checkActive(user),
    checkLicense(user),
    checkLscPsl(user, facts, org),
    checkPermissions(user, feature, facts, org),
    checkTerritory(user, facts),
    checkDbSchema(user, feature, facts),
    ...(feature ? [checkActions(user, feature, facts)] : []),
    checkCache(user, facts),
    checkLastSync(user, facts),
  ]);

  return {
    org,
    collectedAt: new Date().toISOString(),
    userId,
    userName: user.name,
    profile: user.profile,
    featureId: feature?.id ?? null,
    checks,
  };
}

function gather(user: UserInfo, org: string): Facts {
  const id = user.id;
  return {
    psls: Promise.all([
      query(
        `SELECT Id, PermissionSetLicenseId, PermissionSetLicense.MasterLabel, PermissionSetLicense.DeveloperName FROM PermissionSetLicenseAssign WHERE AssigneeId = '${id}'`,
        org
      ),
      query(
        `SELECT Id, MasterLabel, DeveloperName, TotalLicenses, UsedLicenses, Status FROM PermissionSetLicense WHERE DeveloperName LIKE '%LSC4CE%' OR DeveloperName LIKE '%LifeScienceCommercial%'`,
        org
      ),
    ]).then(([assigned, available]) => ({ assigned, available })),
    assignments: query(
      `SELECT PermissionSetId, PermissionSet.Label, PermissionSet.Name, PermissionSetGroupId FROM PermissionSetAssignment WHERE AssigneeId = '${id}' AND PermissionSet.IsOwnedByProfile = false`,
      org
    ),
    territories: query(
      `SELECT Territory2Id, Territory2.Name, Territory2.Territory2Model.State FROM UserTerritory2Association WHERE UserId = '${id}'`,
      org
    ),
    dbSchema: fetchCategories(org, ["DbSchema"], true),
    actions: fetchCategories(org, ["QuickAction", "CustomAction"], true),
    caches: user.profile
      ? query(
          `SELECT Id, Status, IntegrationStatus, IntegrationErrorMessage, LastModifiedDate, Profile.Name FROM LifeSciMobileMetadataRecord WHERE ParentMobileMetadataRecId != null AND Profile.Name = '${user.profile.replace(/'/g, "\\'")}' ORDER BY LastModifiedDate DESC LIMIT 20`,
          org
        )
      : Promise.resolve([]),
    syncs: query(
      `SELECT Id, Type, DownloadStart, DownloadEnd, CreatedDate FROM DeviceSyncSummary WHERE CreatedById = '${id}' AND Type != 'clm' ORDER BY CreatedDate DESC LIMIT 20`,
      org
    ),
  };
}

// ─── Switched on ────────────────────────────────────────────────────────────

function checkActive(user: UserInfo): Promise<ReadinessCheck> {
  return runCheck(
    {
      id: "user.enabled.active",
      stage: "enabled",
      title: "User is active",
      severity: "error",
      why: "A deactivated user can't log in to the iPad or web app.",
      steps: ["Setup > Users > Users, open the user, and re-activate them (or ask an admin to)."],
      uiPath: "Setup > Users > Users",
    },
    async () => ({ pass: user.active, detail: user.active ? `${user.username} is active.` : `${user.username} is deactivated.` })
  );
}

function checkLicense(user: UserInfo): Promise<ReadinessCheck> {
  return runCheck(
    {
      id: "user.enabled.profile",
      stage: "enabled",
      title: "Profile and user license",
      severity: "error",
      why: "The profile decides the user's iPad configuration (DB Schema, actions, tabs, metadata cache) and its license decides what they can be assigned.",
      steps: ["Setup > Users > Users, edit the user and set the profile the field team uses."],
      uiPath: "Setup > Users > Users",
    },
    async () => ({
      pass: Boolean(user.profile),
      detail: user.profile ? `${user.profile} · ${user.license ?? "unknown license"}${user.role ? ` · role ${user.role}` : " · no role"}` : "The user has no readable profile.",
    })
  );
}

// ─── Access ─────────────────────────────────────────────────────────────────

function checkLscPsl(user: UserInfo, facts: Facts, _org: string): Promise<ReadinessCheck> {
  return runCheck(
    {
      id: "user.access.lsc-psl",
      stage: "access",
      title: "Life Sciences Commercial license assigned",
      severity: "error",
      why: "Without the Life Sciences Commercial permission set license the user can't be given LSC permission sets, and the iPad app won't let them in.",
      steps: ["Setup > Users > Users > the user > Permission Set License Assignments > Edit Assignments, and add Life Sciences Commercial."],
      uiPath: "Setup > Users > Users > Permission Set License Assignments",
    },
    async () => {
      const { assigned, available } = await facts.psls;
      const have = assigned.filter((a) => LSC_PSL.test(str(rel(a, "PermissionSetLicense.DeveloperName"))));
      if (have.length) return { pass: true, detail: have.map((a) => str(rel(a, "PermissionSetLicense.MasterLabel"))).join(", ") };
      const lsc = available.filter((p) => LSC_PSL.test(str(p.DeveloperName)));
      const withSeats = lsc.filter((p) => p.Status === "Active" && Number(p.TotalLicenses) > Number(p.UsedLicenses));
      // Only one license with seats is an unambiguous fix; with several, which one is the admin's call.
      const open = withSeats.length === 1 ? withSeats[0] : undefined;
      if (withSeats.length > 1) {
        return { pass: false, detail: `None assigned. ${withSeats.length} LSC licenses have free seats: ${withSeats.map((p) => str(p.MasterLabel)).join(", ")}.` };
      }
      const fixes: StudioFix[] = open
        ? [{ kind: "assignPsl", label: `Assign ${str(open.MasterLabel)} to ${user.name}`, userId: user.id, userName: user.name, pslId: str(open.Id), pslLabel: str(open.MasterLabel) }]
        : [];
      return {
        pass: false,
        detail: open
          ? `None assigned. ${str(open.MasterLabel)} has ${Number(open.TotalLicenses) - Number(open.UsedLicenses)} of ${open.TotalLicenses} seats free.`
          : lsc.length
            ? "None assigned, and no Life Sciences Commercial licenses are free — buy or release seats first."
            : "None assigned, and the org has no Life Sciences Commercial license.",
        fixes,
      };
    }
  );
}

/** Objects the user needs to read for the feature, or the primary objects of any LSC feature when none is chosen. */
function featureObjects(feature: FeatureDefinition | undefined): string[] {
  return feature ? feature.objects : [];
}

function checkPermissions(user: UserInfo, feature: FeatureDefinition | undefined, facts: Facts, org: string): Promise<ReadinessCheck> {
  const objects = featureObjects(feature);
  return runCheck(
    {
      id: "user.access.permissions",
      stage: "access",
      title: feature ? `Can read ${feature.title} objects` : "Has LSC permission sets",
      severity: "error",
      why: feature
        ? "Objects the user can't read are left off their iPad and hidden on the web, whatever the DB Schema says."
        : "LSC features are unlocked by permission sets (or groups); a user with none sees an empty app.",
      steps: ["Setup > Users > Users > the user > Permission Set Assignments, and add the permission set or group your LSC team uses for this feature."],
      uiPath: "Setup > Users > Users > Permission Set Assignments",
    },
    async () => {
      const assignments = await facts.assignments;
      const setNames = [...new Set(assignments.map((a) => str(rel(a, "PermissionSet.Label"))).filter(Boolean))];
      if (!objects.length) {
        return { pass: setNames.length > 0, detail: setNames.length ? `${plural(setNames.length, "permission set")}: ${setNames.slice(0, 6).join(", ")}` : "No permission sets or groups assigned." };
      }
      const parentIds = new Set(assignments.map((a) => str(a.PermissionSetId)).filter(Boolean));
      // A group's own permission set holds its combined permissions only once the group has
      // recalculated, so the member permission sets are read as well.
      const groupIds = [...new Set(assignments.map((a) => str(a.PermissionSetGroupId)).filter(Boolean))];
      if (groupIds.length) {
        // A muting set's Read takes access away, so it isn't a source of access.
        const members = await query(
          `SELECT PermissionSetId FROM PermissionSetGroupComponent WHERE PermissionSetGroupId IN (${inList(groupIds)}) AND PermissionSet.Type != 'Muting'`,
          org
        );
        for (const m of members) parentIds.add(str(m.PermissionSetId));
      }
      if (user.profileId) {
        const own = await query(`SELECT Id FROM PermissionSet WHERE ProfileId = '${user.profileId}'`, org);
        for (const r of own) parentIds.add(str(r.Id));
      }
      if (!parentIds.size) return { pass: false, detail: "No permission sets or profile permissions found.", fixes: [] };
      // View All Data / Modify All Data read every object without any object permission rows.
      const sets = await query(`SELECT Id, PermissionsViewAllData, PermissionsModifyAllData FROM PermissionSet WHERE Id IN (${inList([...parentIds])})`, org);
      if (sets.some((r) => r.PermissionsViewAllData === true || r.PermissionsModifyAllData === true)) return { pass: true, detail: `Reads all ${objects.length} objects through View All Data or Modify All Data.` };
      const perms = await query(
        `SELECT SobjectType, PermissionsRead FROM ObjectPermissions WHERE SobjectType IN (${inList(objects)}) AND ParentId IN (${inList([...parentIds])})`,
        org
      );
      const readable = new Set(perms.filter((p) => p.PermissionsRead === true).map((p) => str(p.SobjectType)));
      const missing = objects.filter((o) => !readable.has(o));
      return {
        pass: missing.length === 0,
        detail: missing.length
          ? `No read access to ${missing.join(", ")}. Permission sets: ${setNames.slice(0, 5).join(", ") || "none"}.`
          : `Reads all ${objects.length} objects through ${plural(setNames.length, "permission set")} and the profile.`,
        examples: missing,
      };
    }
  );
}

function checkTerritory(user: UserInfo, facts: Facts): Promise<ReadinessCheck> {
  return runCheck(
    {
      id: "user.access.territory",
      stage: "access",
      title: "In a territory of the active model",
      severity: "error",
      why: "Accounts, sync filters and goals follow the user's territories. A rep outside the active model sees no aligned accounts.",
      steps: ["Setup > Territories > open the territory in the active model > Assign Users."],
      uiPath: "Setup > Territories",
    },
    async () => {
      const rows = await facts.territories;
      const active = rows.filter((r) => str(rel(r, "Territory2.Territory2Model.State")) === "Active");
      const names = active.map((r) => str(rel(r, "Territory2.Name")));
      if (active.length) return { pass: true, detail: `${plural(active.length, "territory")}: ${names.slice(0, 5).join(", ")}` };
      return {
        pass: false,
        detail: rows.length ? `Only in territories of inactive models (${rows.length}).` : "Not assigned to any territory.",
      };
    }
  );
}

// ─── iPad ───────────────────────────────────────────────────────────────────

function reaches(audience: Audience | undefined, user: UserInfo, setNames: string[]): boolean {
  if (!audience) return true;
  if (user.profile && audience.profiles.some((p) => ieq(p, user.profile!))) return true;
  return audience.permissionSets.some((p) => setNames.some((s) => ieq(s, p)));
}

function checkDbSchema(user: UserInfo, feature: FeatureDefinition | undefined, facts: Facts): Promise<ReadinessCheck> {
  const objects = featureObjects(feature);
  return runCheck(
    {
      id: "user.mobile.db-schema",
      stage: "mobile",
      title: feature ? `${feature.title} objects sync to the iPad` : "DB Schema syncs data to the iPad",
      severity: "error",
      why: "An object only reaches the iPad when an active DB Schema record for it is assigned to the user's profile or one of their permission sets.",
      steps: ["Admin Console > Mobile > DB Schema: activate or create the object's record and assign it to the user's profile."],
      uiPath: "Admin Console > Mobile > DB Schema",
    },
    async () => {
      const [records, assignments] = await Promise.all([facts.dbSchema, facts.assignments]);
      const setNames = assignments.flatMap((a) => [str(rel(a, "PermissionSet.Label")), str(rel(a, "PermissionSet.Name"))]).filter(Boolean);
      const mine = records.filter((r) => r.isActive && r.fields.Type !== "CONFIGURATION" && reaches(audienceOf(r), user, setNames));
      if (!objects.length) return { pass: mine.length > 0, detail: `${plural(mine.length, "active DB Schema object")} sync for ${user.profile ?? "this user"}.` };
      const synced = new Set(mine.map((r) => str(r.fields.SObject).toLowerCase()));
      const missing = objects.filter((o) => !synced.has(o.toLowerCase()));
      // Only the primary object is required to sync; secondary objects are reported but don't fail the chain alone.
      const primaryMissing = missing.includes(objects[0]);
      return {
        pass: !primaryMissing && missing.length < objects.length,
        detail: missing.length ? `Not synced: ${missing.join(", ")}.` : `All ${objects.length} objects sync.`,
        examples: missing,
      };
    }
  );
}

function checkActions(user: UserInfo, feature: FeatureDefinition, facts: Facts): Promise<ReadinessCheck> {
  return runCheck(
    {
      id: "user.mobile.actions",
      stage: "mobile",
      title: `${feature.title} actions are available`,
      severity: "warning",
      why: "Quick and custom actions are how reps start the feature's work from the iPad; an action assigned to other profiles never shows for this user.",
      steps: ["Admin Console > Mobile > Actions: add the user's profile to the action's Profiles."],
      uiPath: "Admin Console > Mobile > Actions",
    },
    async () => {
      const [records, assignments] = await Promise.all([facts.actions, facts.assignments]);
      const setNames = assignments.flatMap((a) => [str(rel(a, "PermissionSet.Label")), str(rel(a, "PermissionSet.Name"))]).filter(Boolean);
      const related = records.filter(
        (r) => r.isActive && matchesAny(`${r.developerName} ${r.label ?? ""} ${Object.values(r.fields).filter((v) => typeof v === "string").join(" ")}`, feature.actionKeywords)
      );
      if (!related.length) return { skip: true, pass: true, detail: "The org has no active actions for this feature." };
      const visible = related.filter((r) => reaches(actionAudience(r), user, setNames));
      const hidden = related.filter((r) => !visible.includes(r));
      return {
        pass: visible.length > 0,
        detail: `${visible.length} of ${plural(related.length, "action")} show for ${user.profile ?? "this user"}.`,
        examples: hidden.map((r) => r.label || r.developerName),
      };
    }
  );
}

function checkCache(user: UserInfo, facts: Facts): Promise<ReadinessCheck> {
  return runCheck(
    {
      id: "user.mobile.cache",
      stage: "mobile",
      title: "iPad metadata published for the profile",
      severity: "error",
      why: "The iPad downloads its layouts, tabs and actions from the profile's metadata cache. No Active cache means the app can't configure itself.",
      steps: ["Use Publish to iPad for this profile (or run generate_mobile_metadata_cache)."],
      uiPath: "Admin Console > Mobile > Metadata Cache",
    },
    async () => {
      const rows = await facts.caches;
      const active = rows.find((r) => r.Status === "Active");
      if (!user.profile) return { pass: false, detail: "No profile to publish for." };
      if (!active) {
        const latest = rows[0];
        return {
          pass: false,
          detail: latest ? `No Active cache for ${user.profile}; the latest is ${str(latest.Status)}${latest.IntegrationErrorMessage ? ` (${str(latest.IntegrationErrorMessage)})` : ""}.` : `${user.profile} has never been published.`,
        };
      }
      return { pass: true, detail: `Active since ${str(active.LastModifiedDate).slice(0, 10)}.` };
    }
  );
}

function checkLastSync(user: UserInfo, facts: Facts): Promise<ReadinessCheck> {
  return runCheck(
    {
      id: "user.mobile.last-sync",
      stage: "mobile",
      title: "Device has synced",
      severity: "warning",
      why: "Sync summaries come from the user's iPad after each sync. None means the app was never opened on a device, or sync never finished.",
      steps: ["Have the rep log in on the iPad and let the first sync finish; check connectivity if it keeps failing."],
      uiPath: "Reports > Device Sync Summaries",
    },
    async () => {
      const rows = await facts.syncs;
      if (!rows.length) return { pass: false, detail: "No sync has ever been reported for this user." };
      const done = rows.find((r) => r.DownloadEnd);
      const latest = rows[0];
      if (!done) return { pass: false, detail: `${plural(rows.length, "sync")} reported, none finished downloading.` };
      const days = Math.floor((Date.now() - Date.parse(str(done.DownloadEnd))) / 86_400_000);
      const when = str(done.DownloadEnd).slice(0, 10);
      if (days > STALE_SYNC_DAYS) return { pass: false, detail: `Last finished sync was ${when} (${days} days ago).` };
      // An attempt started in the last half hour may still be running.
      const inProgress = Date.now() - Date.parse(str(latest.DownloadStart || latest.CreatedDate)) < 30 * 60_000;
      const failedSince = latest !== done && !latest.DownloadEnd && !inProgress;
      return { pass: !failedSince, detail: failedSince ? `Last finished sync ${when}, but the latest attempt (${str(latest.CreatedDate).slice(0, 10)}) didn't finish.` : `Last finished sync ${when}.` };
    }
  );
}
