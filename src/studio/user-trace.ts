/**
 * traceUser() — "why can't this rep …?" Walks the chain a field user needs,
 * in order (active user → profile → licenses → permission sets → territory →
 * what syncs to their iPad → metadata cache → last sync), optionally narrowed
 * to one feature, and stops pointing at the first broken link.
 */

import type { ConfigRecord } from "../config/types.js";
import {
  DEFAULT_PROFILE_OPTIONS,
  profileTerritory,
  type ApplicableTable,
  type OrgQuerier,
  type UserContext,
} from "../perf/sync-volume.js";
import { runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import { actionAudience, fetchCategories } from "./collectors/shared.js";
import { LSC_PSL } from "./collectors/territory-users.js";
import { getFeature, type FeatureDefinition } from "./features.js";
import { audienceOf, count, inList, matchesAny, plural, query, type Row } from "./helpers.js";
import { runCheck } from "./readiness/index.js";
import { assertId } from "./change-helpers.js";
import { loadPublishedCore, TAB_FILTER_REASONS, type SnapshotCore } from "./published.js";
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
  /** The feature's objects split by whether the org has them; an object the org doesn't have is no one's access problem. */
  objects: Promise<FeatureObjects>;
  /** Null when the rep has no territory in the active model. */
  accountReach: Promise<AccountReach | null>;
  /** The rep's published iPad (tab bar and why tabs are left off), null when the profile has never been published. */
  published: Promise<SnapshotCore | null>;
}

/** How long the tab check waits for the profile's metadata cache to be read (it's kept on disk once read). */
export const PUBLISHED_TIMEOUT_MS = 60_000;

interface FeatureObjects {
  present: string[];
  absent: string[];
}

export async function traceUser(
  userId: string,
  featureId: string | null,
  org: string
): Promise<UserTrace> {
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

  const base = gather(user, feature, org);
  const facts: Facts = {
    ...base,
    accountReach: accountReach(user, base, org),
    published: publishedFor(user, org),
  };
  // Rejections are consumed by the checks that await them; this keeps unused ones from surfacing as unhandled.
  for (const p of Object.values(facts)) p.catch(() => undefined);

  const checks = await Promise.all([
    checkActive(user),
    checkLicense(user),
    checkLscPsl(user, facts, org),
    checkPermissions(user, feature, facts, org),
    checkTerritory(user, facts),
    checkAccounts(user, facts),
    checkAccountsMatch(facts),
    checkDbSchema(user, feature, facts),
    ...(feature ? [checkActions(user, feature, facts)] : []),
    checkTabs(user, feature, facts),
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

function gather(
  user: UserInfo,
  feature: FeatureDefinition | undefined,
  org: string
): Omit<Facts, "accountReach" | "published"> {
  const id = user.id;
  const objects = featureObjects(feature);
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
    objects: objects.length
      ? query(
          `SELECT QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName IN (${inList(objects)})`,
          org
        ).then(
          (rows) => {
            const have = new Set(rows.map((r) => str(r.QualifiedApiName).toLowerCase()));
            return {
              present: objects.filter((o) => have.has(o.toLowerCase())),
              absent: objects.filter((o) => !have.has(o.toLowerCase())),
            };
          },
          // Not knowing which objects exist shouldn't hide an access problem: judge them all.
          () => ({ present: objects, absent: [] })
        )
      : Promise.resolve({ present: [], absent: [] }),
  };
}

/** The user's permission sets for a detail line, LSC ones first since those are what an admin looks for. */
function setsNote(assignments: Row[]): string {
  const labels = [
    ...new Set(assignments.map((a) => str(rel(a, "PermissionSet.Label"))).filter(Boolean)),
  ];
  if (!labels.length) return "No permission sets assigned.";
  const lsc = (l: string) => /life ?sci|\blsc\b/i.test(l);
  const sorted = [...labels.filter(lsc), ...labels.filter((l) => !lsc(l))];
  const more = sorted.length > 5 ? ` and ${sorted.length - 5} more` : "";
  return `Permission sets: ${sorted.slice(0, 5).join(", ")}${more}.`;
}

/** "Not in this org: X." for objects the feature lists that the org doesn't have (not enabled or licensed). */
function absentNote(absent: string[]): string {
  return absent.length ? ` Not in this org: ${absent.join(", ")}.` : "";
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
    async () => ({
      pass: user.active,
      detail: user.active ? `${user.username} is active.` : `${user.username} is deactivated.`,
    })
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
      detail: user.profile
        ? `${user.profile} · ${user.license ?? "unknown license"}${user.role ? ` · role ${user.role}` : " · no role"}`
        : "The user has no readable profile.",
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
      steps: [
        "Setup > Users > Users > the user > Permission Set License Assignments > Edit Assignments, and add Life Sciences Commercial.",
      ],
      uiPath: "Setup > Users > Users > Permission Set License Assignments",
    },
    async () => {
      const { assigned, available } = await facts.psls;
      const have = assigned.filter((a) =>
        LSC_PSL.test(str(rel(a, "PermissionSetLicense.DeveloperName")))
      );
      if (have.length)
        return {
          pass: true,
          detail: have.map((a) => str(rel(a, "PermissionSetLicense.MasterLabel"))).join(", "),
        };
      const lsc = available.filter((p) => LSC_PSL.test(str(p.DeveloperName)));
      const withSeats = lsc.filter(
        (p) => p.Status === "Active" && Number(p.TotalLicenses) > Number(p.UsedLicenses)
      );
      // Only one license with seats is an unambiguous fix; with several, which one is the admin's call.
      const open = withSeats.length === 1 ? withSeats[0] : undefined;
      if (withSeats.length > 1) {
        return {
          pass: false,
          detail: `None assigned. ${withSeats.length} LSC licenses have free seats: ${withSeats.map((p) => str(p.MasterLabel)).join(", ")}.`,
        };
      }
      const fixes: StudioFix[] = open
        ? [
            {
              kind: "assignPsl",
              label: `Assign ${str(open.MasterLabel)} to ${user.name}`,
              userId: user.id,
              userName: user.name,
              pslId: str(open.Id),
              pslLabel: str(open.MasterLabel),
            },
          ]
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

function checkPermissions(
  user: UserInfo,
  feature: FeatureDefinition | undefined,
  facts: Facts,
  org: string
): Promise<ReadinessCheck> {
  return runCheck(
    {
      id: "user.access.permissions",
      stage: "access",
      title: feature ? `Can read ${feature.title} objects` : "Has LSC permission sets",
      severity: "error",
      why: feature
        ? "Objects the user can't read are left off their iPad and hidden on the web, whatever the DB Schema says."
        : "LSC features are unlocked by permission sets (or groups); a user with none sees an empty app.",
      steps: [
        "Setup > Users > Users > the user > Permission Set Assignments, and add the permission set or group your LSC team uses for this feature.",
      ],
      uiPath: "Setup > Users > Users > Permission Set Assignments",
    },
    async () => {
      const [assignments, { present: objects, absent }] = await Promise.all([
        facts.assignments,
        facts.objects,
      ]);
      const setNames = [
        ...new Set(assignments.map((a) => str(rel(a, "PermissionSet.Label"))).filter(Boolean)),
      ];
      if (!feature?.objects.length) {
        return {
          pass: setNames.length > 0,
          detail: setNames.length
            ? `${plural(setNames.length, "permission set")}: ${setNames.slice(0, 6).join(", ")}`
            : "No permission sets or groups assigned.",
        };
      }
      if (!objects.length)
        return {
          pass: true,
          skip: true,
          detail: `None of ${feature.title}'s objects are in this org (${absent.join(", ")}). The feature may not be enabled or licensed.`,
        };
      // Salesforce's own answer for what the user can read: object permissions, but also access that
      // has no object permission row (Event, Holiday, EmailTemplate, Topic, surveys, detail objects).
      const rows = await query(
        `SELECT EntityDefinition.QualifiedApiName, IsReadable FROM UserEntityAccess WHERE UserId = '${user.id}' AND EntityDefinition.QualifiedApiName IN (${inList(objects)})`,
        org
      );
      const readable = new Set(
        rows
          .filter((r) => r.IsReadable === true)
          .map((r) => str(rel(r, "EntityDefinition.QualifiedApiName")).toLowerCase())
      );
      const missing = objects.filter((o) => !readable.has(o.toLowerCase()));
      return {
        pass: missing.length === 0,
        detail: missing.length
          ? `No read access to ${missing.join(", ")}. ${setsNote(assignments)}${absentNote(absent)}`
          : `Reads all ${objects.length} objects.${absentNote(absent)}`,
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
      const active = rows.filter(
        (r) => str(rel(r, "Territory2.Territory2Model.State")) === "Active"
      );
      const names = active.map((r) => str(rel(r, "Territory2.Name")));
      if (active.length)
        return {
          pass: true,
          detail: `${plural(active.length, "territory")}: ${names.slice(0, 5).join(", ")}`,
        };
      return {
        pass: false,
        detail: rows.length
          ? `Only in territories of inactive models (${rows.length}).`
          : "Not assigned to any territory.",
      };
    }
  );
}

// ─── Data ───────────────────────────────────────────────────────────────────

/** Territories the iPad's Account filter is counted in, by name; the alignment counts cover all of them. */
const MAX_FILTER_TERRITORIES = 5;
/** Territories in one IN list for the alignment counts. */
const MAX_REACH_TERRITORIES = 200;

interface AccountReach {
  territories: { id: string; name: string }[];
  aligned: number;
  /** Aligned accounts with no provider territory info in any of the rep's territories. */
  noInfo: number;
  noInfoNames: string[];
  /** Info rows not available offline, which the standard Account filter leaves out. */
  hidden: number;
  hiddenNames: string[];
  offline: number;
  /** Info rows available offline for accounts not aligned to the territory: they still show on the iPad. */
  unaligned: number;
  unalignedNames: string[];
  /** Aligned accounts that are inactive; null when the org's Account has no IsActive. */
  inactive: number | null;
  /** The Account DB Schema record that reaches the rep, if any. */
  accountRecord: string | null;
  /** What the Account filter downloads per counted territory, or why it couldn't be counted. */
  filter: { territory: string; records: number | null; note?: string }[];
}

/** The DB Schema record the iPad uses for an object: profile matches before permission sets, then by DeveloperName. */
function tableFor(
  records: ConfigRecord[],
  sobject: string,
  user: UserInfo,
  setNames: string[]
): ApplicableTable | null {
  const candidates = records
    .filter(
      (r) =>
        r.isActive &&
        r.fields.Type !== "CONFIGURATION" &&
        ieq(str(r.fields.SObject), sobject) &&
        reaches(audienceOf(r), user, setNames)
    )
    .sort((a, b) => a.developerName.localeCompare(b.developerName));
  const byProfile = candidates.find((r) => {
    const a = audienceOf(r);
    return !a || (user.profile !== null && a.profiles.some((p) => ieq(p, user.profile!)));
  });
  const r = byProfile ?? candidates[0];
  if (!r) return null;
  return {
    entry: {
      developerName: r.developerName,
      sobject,
      type: str(r.fields.Type),
      whereSoql: str(r.fields.WhereSoql).trim() || null,
      profileIds: new Set(),
      profileNames: new Set(),
      permissionSets: new Set(),
    },
    matchedBy: byProfile ? "profile" : "permissionSet",
  };
}

async function accountReach(
  user: UserInfo,
  facts: Pick<Facts, "territories" | "dbSchema" | "assignments">,
  org: string
): Promise<AccountReach | null> {
  const [rows, records, assignments] = await Promise.all([
    facts.territories,
    facts.dbSchema,
    facts.assignments,
  ]);
  const territories = rows
    .filter((r) => str(rel(r, "Territory2.Territory2Model.State")) === "Active")
    .map((r) => ({ id: str(r.Territory2Id), name: str(rel(r, "Territory2.Name")) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!territories.length) return null;
  const list = inList(territories.slice(0, MAX_REACH_TERRITORIES).map((t) => t.id));
  const ot2a = `FROM ObjectTerritory2Association WHERE SobjectType = 'Account' AND Territory2Id IN (${list})`;
  const noInfo = `ObjectId NOT IN (SELECT AccountId FROM ProviderAcctTerritoryInfo WHERE Territory2Id IN (${list}))`;
  const pati = `FROM ProviderAcctTerritoryInfo WHERE Territory2Id IN (${list})`;
  const hidden = `${pati} AND IsAvailableOffline = false`;
  const unaligned = `AccountId NOT IN (SELECT ObjectId ${ot2a})`;

  const setNames = assignments
    .flatMap((a) => [str(rel(a, "PermissionSet.Label")), str(rel(a, "PermissionSet.Name"))])
    .filter(Boolean);
  const accountTable = tableFor(records, "Account", user, setNames);
  const ot2aTable = tableFor(records, "ObjectTerritory2Association", user, setNames);
  const querier: OrgQuerier = {
    soql: (q, options) => runSoqlQuery(q, org, options),
    tooling: (q) => runToolingQuery(q, org),
  };
  const context: UserContext = {
    id: user.id,
    username: user.username,
    name: user.name,
    profileId: user.profileId ?? "",
    profileName: user.profile ?? "",
    permissionSets: new Set(setNames),
    territories,
  };
  const options = { ...DEFAULT_PROFILE_OPTIONS, idCache: new Map() };
  const filterIn = async (t: { id: string; name: string }) => {
    if (!accountTable) return { territory: t.name, records: null };
    const vol = await profileTerritory(
      querier,
      context,
      t,
      ot2aTable ? [ot2aTable, accountTable] : [accountTable],
      options
    );
    const acc = vol.tables.find((v) => v.sobject === "Account");
    return acc?.status === "counted" && !acc.lowerBound
      ? { territory: t.name, records: acc.records }
      : { territory: t.name, records: null, note: acc?.note ?? "not counted" };
  };

  // Names are only examples: a failed read leaves them out, never the counts.
  const names = (soql: string, field: string) =>
    query(soql, org).then(
      (rows) => [...new Set(rows.map((r) => str(rel(r, field))).filter(Boolean))],
      () => []
    );
  const [
    aligned,
    noInfoCount,
    noInfoNames,
    hiddenCount,
    hiddenNames,
    offline,
    unalignedCount,
    unalignedNames,
    inactive,
    filter,
  ] = await Promise.all([
    count(`SELECT COUNT() ${ot2a}`, org),
    count(`SELECT COUNT() ${ot2a} AND ${noInfo}`, org),
    names(`SELECT Object.Name ${ot2a} AND ${noInfo} ORDER BY Object.Name LIMIT 5`, "Object.Name"),
    count(`SELECT COUNT() ${hidden}`, org),
    names(`SELECT Account.Name ${hidden} ORDER BY Account.Name LIMIT 5`, "Account.Name"),
    count(`SELECT COUNT() ${pati} AND IsAvailableOffline = true`, org),
    count(`SELECT COUNT() ${pati} AND IsAvailableOffline = true AND ${unaligned}`, org),
    names(
      `SELECT Account.Name ${pati} AND IsAvailableOffline = true AND ${unaligned} ORDER BY Account.Name LIMIT 5`,
      "Account.Name"
    ),
    // Account.IsActive comes with LSC's account model; an org without it has no inactive accounts to hide.
    count(
      `SELECT COUNT() ${ot2a} AND ObjectId IN (SELECT Id FROM Account WHERE IsActive = false)`,
      org
    ).catch(() => null),
    Promise.all(territories.slice(0, MAX_FILTER_TERRITORIES).map(filterIn)),
  ]);
  return {
    territories,
    aligned,
    noInfo: noInfoCount,
    noInfoNames,
    hidden: hiddenCount,
    hiddenNames,
    offline,
    unaligned: unalignedCount,
    unalignedNames,
    inactive,
    accountRecord: accountTable?.entry.developerName ?? null,
    filter,
  };
}

const NO_TERRITORY =
  "No territory in the active model, so no accounts are aligned to them. See the territory check.";

function checkAccounts(user: UserInfo, facts: Facts): Promise<ReadinessCheck> {
  return runCheck(
    {
      id: "user.data.accounts",
      stage: "data",
      title: "Accounts reach their iPad",
      severity: "error",
      why: "The iPad lists the accounts the Account DB Schema filter returns for the rep's territory. The standard filter reads the territory's provider account territory info (PATI) rows that are available offline, so accounts aligned on the web with no such row never reach the iPad.",
      steps: [
        "Align accounts to the rep's territory (Setup > Territories, or the alignment rules).",
        "Run Align Account to Territory (Admin Console > Territory Management Jobs) so each aligned account gets its territory info row.",
        "Check the Account DB Schema record's filter in Admin Console > Mobile > DB Schema.",
      ],
      uiPath: "Admin Console > Territory Management Jobs",
    },
    async () => {
      const r = await facts.accountReach;
      if (!r) return { pass: true, skip: true, detail: NO_TERRITORY };
      const where =
        r.territories.length === 1
          ? r.territories[0].name
          : `their ${plural(r.territories.length, "territory")}`;
      const counts = `${plural(r.aligned, "account")} aligned to ${where}, ${r.offline} with territory info available offline.`;
      if (r.aligned === 0 && r.offline === 0)
        return { pass: false, detail: `No accounts are aligned to ${where}.` };
      if (r.offline === 0)
        return { pass: false, detail: `${counts} Run Align Account to Territory.` };
      if (!r.accountRecord)
        return {
          pass: false,
          detail: `No active Account DB Schema record reaches ${user.profile ?? "them"}, so no accounts sync. ${counts}`,
        };
      const counted = r.filter.filter((f) => f.records !== null);
      const uncounted = r.filter.filter((f) => f.records === null);
      const empty = counted.filter((f) => f.records === 0);
      const filterLine = counted.length
        ? `The Account filter (${r.accountRecord}) downloads ${counted.map((f) => `${plural(f.records ?? 0, "account")} in ${f.territory}`).join(", ")}. `
        : "";
      const more =
        r.territories.length > r.filter.length
          ? ` The filter was counted in the first ${r.filter.length} territories by name.`
          : "";
      const note = uncounted.length
        ? ` Couldn't count the filter in ${uncounted.map((f) => f.territory).join(", ")}: ${uncounted[0].note}.`
        : "";
      return {
        pass: empty.length === 0,
        detail: `${filterLine}${counts}${more}${note}`,
        examples: empty.map((f) => `No accounts in ${f.territory}`),
      };
    }
  );
}

function checkAccountsMatch(facts: Facts): Promise<ReadinessCheck> {
  return runCheck(
    {
      id: "user.data.accounts-match",
      stage: "data",
      title: "Their iPad accounts match the alignment",
      severity: "warning",
      why: "An aligned account shows on the iPad only when it has a territory info row available offline in the rep's territory, and a row left behind after an account is unaligned keeps it showing. Inactive accounts stay aligned but reps can't work them.",
      steps: [
        "Run Align Account to Territory (Admin Console > Territory Management Jobs) to create missing territory info rows and clear old ones.",
        "Set Is Available Offline on the territory info rows that should show on the iPad.",
        "Reactivate accounts that should still be called on, or remove their alignment.",
      ],
      uiPath: "Admin Console > Territory Management Jobs",
    },
    async () => {
      const r = await facts.accountReach;
      if (!r) return { pass: true, skip: true, detail: NO_TERRITORY };
      if (r.aligned === 0 && r.offline === 0)
        return { pass: true, skip: true, detail: "No accounts are aligned to them yet." };
      const territory = r.territories.length === 1 ? "the territory" : "their territories";
      const parts = [
        r.noInfo ? `${plural(r.noInfo, "aligned account")} with no territory info` : "",
        r.hidden ? `${plural(r.hidden, "territory info row")} not available offline` : "",
        r.unaligned
          ? `${plural(r.unaligned, "territory info row")} for accounts not aligned to ${territory}, which still show on the iPad`
          : "",
        r.inactive ? `${plural(r.inactive, "aligned account")} inactive` : "",
      ].filter(Boolean);
      const examples = [
        ...r.noInfoNames.map((n) => `${n} (no territory info)`),
        ...r.hiddenNames.map((n) => `${n} (not available offline)`),
        ...r.unalignedNames.map((n) => `${n} (not aligned)`),
      ];
      return parts.length
        ? { pass: false, detail: `${parts.join("; ")}.`, examples }
        : {
            pass: true,
            detail: `All ${plural(r.aligned, "aligned account")} have territory info available offline.`,
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

function checkDbSchema(
  user: UserInfo,
  feature: FeatureDefinition | undefined,
  facts: Facts
): Promise<ReadinessCheck> {
  return runCheck(
    {
      id: "user.mobile.db-schema",
      stage: "mobile",
      title: feature
        ? `${feature.title} objects sync to the iPad`
        : "DB Schema syncs data to the iPad",
      severity: "error",
      why: "An object only reaches the iPad when an active DB Schema record for it is assigned to the user's profile or one of their permission sets.",
      steps: [
        "Admin Console > Mobile > DB Schema: activate or create the object's record and assign it to the user's profile.",
      ],
      uiPath: "Admin Console > Mobile > DB Schema",
    },
    async () => {
      const [records, assignments, { present: objects, absent }] = await Promise.all([
        facts.dbSchema,
        facts.assignments,
        facts.objects,
      ]);
      const setNames = assignments
        .flatMap((a) => [str(rel(a, "PermissionSet.Label")), str(rel(a, "PermissionSet.Name"))])
        .filter(Boolean);
      const mine = records.filter(
        (r) =>
          r.isActive && r.fields.Type !== "CONFIGURATION" && reaches(audienceOf(r), user, setNames)
      );
      if (!feature?.objects.length)
        return {
          pass: mine.length > 0,
          detail: `${plural(mine.length, "active DB Schema object")} sync for ${user.profile ?? "this user"}.`,
        };
      if (!objects.length)
        return {
          pass: true,
          skip: true,
          detail: `None of ${feature.title}'s objects are in this org (${absent.join(", ")}).`,
        };
      const synced = new Set(mine.map((r) => str(r.fields.SObject).toLowerCase()));
      const missing = objects.filter((o) => !synced.has(o.toLowerCase()));
      // Only the primary object (the first the org has) is required to sync; secondary objects are reported but don't fail the chain alone.
      const primaryMissing = missing.includes(objects[0]);
      return {
        pass: !primaryMissing && missing.length < objects.length,
        detail:
          (missing.length
            ? `Not synced: ${missing.join(", ")}.`
            : `All ${objects.length} objects sync.`) + absentNote(absent),
        examples: missing,
      };
    }
  );
}

function checkActions(
  user: UserInfo,
  feature: FeatureDefinition,
  facts: Facts
): Promise<ReadinessCheck> {
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
      const setNames = assignments
        .flatMap((a) => [str(rel(a, "PermissionSet.Label")), str(rel(a, "PermissionSet.Name"))])
        .filter(Boolean);
      const related = records.filter(
        (r) =>
          r.isActive &&
          matchesAny(
            `${r.developerName} ${r.label ?? ""} ${Object.values(r.fields)
              .filter((v) => typeof v === "string")
              .join(" ")}`,
            feature.actionKeywords
          )
      );
      if (!related.length)
        return {
          skip: true,
          pass: true,
          detail: "The org has no active actions for this feature.",
        };
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

function publishedFor(user: UserInfo, org: string): Promise<SnapshotCore | null> {
  if (!user.profile) return Promise.resolve(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            "Reading the profile's published metadata took too long. Check again in a minute; it's quicker once read."
          )
        ),
      PUBLISHED_TIMEOUT_MS
    );
  });
  const load = loadPublishedCore(user.profile, org, user.id).then((r) =>
    "missing" in r ? null : r
  );
  return Promise.race([load, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The tab bar the rep's iPad builds from the published cache, the way the app filters it: a tab
 * is left off when it's hidden on the profile and permission sets, when its object isn't synced
 * for the rep, or when the app has no screen for it. A tab added after the publish isn't there.
 */
function checkTabs(
  user: UserInfo,
  feature: FeatureDefinition | undefined,
  facts: Facts
): Promise<ReadinessCheck> {
  const keywords = feature?.tabKeywords;
  return runCheck(
    {
      id: "user.mobile.tabs",
      stage: "mobile",
      title: keywords ? `${feature!.title} tab is on the iPad` : "Tabs on the iPad",
      severity: "warning",
      why: "The iPad's tab bar comes from the profile's published metadata: the tabs of its Lightning app and UI Settings, minus tabs hidden on the profile, tabs whose object doesn't sync to the rep, and tabs the app has no screen for.",
      steps: [
        "Make the tab Default On in the profile (or a permission set the rep has) and add it to the profile's Lightning app.",
        "For an object tab, sync the object to the rep in DB Schema.",
        "Publish to iPad for the profile, then have the rep log out and in.",
      ],
      uiPath: "Setup > Profiles > Object Settings, App Manager, and Admin Console > Mobile",
    },
    async () => {
      const published = await facts.published;
      if (!published)
        return {
          pass: false,
          detail: `${user.profile ?? "The user's profile"} has no published metadata, so the iPad has no tabs to show.`,
        };
      const shown = published.tabs.filter((t) => t.kind !== "recent");
      const names = (tabs: { label: string }[]) => tabs.map((t) => t.label).join(", ");
      const date = published.cache.generatedAt.slice(0, 10);
      if (!keywords) {
        const hiddenNote = published.hiddenTabs.length
          ? ` Left off: ${published.hiddenTabs.map((t) => `${t.label} (${t.reason})`).join("; ")}.`
          : "";
        return {
          pass: shown.length > 0,
          detail: `${plural(shown.length, "tab")} as published on ${date}: ${names(shown) || "none"}.${hiddenNote}`,
        };
      }
      const about = (t: { fullName: string; label: string; sobject?: string }) =>
        matchesAny(`${t.fullName} ${t.label} ${t.sobject ?? ""}`, keywords);
      const mine = shown.filter(about);
      if (mine.length)
        return { pass: true, detail: `On the tab bar: ${names(mine)} (published ${date}).` };
      const hidden = published.hiddenTabs.filter(about);
      if (hidden.length) {
        // ProcessMetadataOperation.parseNavigation drops these by name, whatever their visibility.
        const samplesNote = hidden.some((t) => t.reason === TAB_FILTER_REASONS.samples)
          ? " Reps give samples from the visit; for a list of their inventory, add an object tab for ProductItem or InventoryOperation instead."
          : "";
        return {
          pass: false,
          detail: `Left off the tab bar: ${hidden.map((t) => `${t.label} (${t.reason})`).join("; ")}.${samplesNote}`,
          examples: hidden.map((t) => t.label),
        };
      }
      // Not every feature needs its own tab (samples are given from the visit), so having none isn't a failure.
      return {
        pass: true,
        skip: true,
        detail: `The cache published on ${date} has no ${feature!.title} tab. Its tabs: ${names(shown) || "none"}. To give reps one, add it to the profile's Lightning app, or publish again if it was added after ${date}.`,
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
          detail: latest
            ? `No Active cache for ${user.profile}; the latest is ${str(latest.Status)}${latest.IntegrationErrorMessage ? ` (${str(latest.IntegrationErrorMessage)})` : ""}.`
            : `${user.profile} has never been published.`,
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
      steps: [
        "Have the rep log in on the iPad and let the first sync finish; check connectivity if it keeps failing.",
      ],
      uiPath: "Reports > Device Sync Summaries",
    },
    async () => {
      const rows = await facts.syncs;
      if (!rows.length)
        return { pass: false, detail: "No sync has ever been reported for this user." };
      const done = rows.find((r) => r.DownloadEnd);
      const latest = rows[0];
      if (!done)
        return {
          pass: false,
          detail: `${plural(rows.length, "sync")} reported, none finished downloading.`,
        };
      const days = Math.floor((Date.now() - Date.parse(str(done.DownloadEnd))) / 86_400_000);
      const when = str(done.DownloadEnd).slice(0, 10);
      if (days > STALE_SYNC_DAYS)
        return { pass: false, detail: `Last finished sync was ${when} (${days} days ago).` };
      // An attempt started in the last half hour may still be running.
      const inProgress =
        Date.now() - Date.parse(str(latest.DownloadStart || latest.CreatedDate)) < 30 * 60_000;
      const failedSince = latest !== done && !latest.DownloadEnd && !inProgress;
      return {
        pass: !failedSince,
        detail: failedSince
          ? `Last finished sync ${when}, but the latest attempt (${str(latest.CreatedDate).slice(0, 10)}) didn't finish.`
          : `Last finished sync ${when}.`,
      };
    }
  );
}
