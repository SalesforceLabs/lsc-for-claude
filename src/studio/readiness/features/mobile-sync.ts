/** Mobile Sync readiness: its validation rules plus Studio's own checks. */

import {
  TAG_ACCOUNT_IDS,
  TAG_OT2A_IDS,
  TAG_STI_IDS,
  loadDbSchemaEntries,
  resolveScalarTags,
  substituteIdTag,
  type OrgQuerier,
} from "../../../perf/sync-volume.js";
import { apiRequest, dataPath, runSoqlQuery, runToolingQuery } from "../../../salesforce/cli.js";
import { dbSchemaLabel, fetchCache, findDuplicates, isLiveCache, noAppSettings, noNavTabs, SETTINGS_CATEGORIES } from "../../collectors/mobile-sync.js";
import { byCategory, fetchCategories, isNavTab, profilesOf } from "../../collectors/shared.js";
import { count, inList, plural, query } from "../../helpers.js";
import type { StudioFix } from "../../types.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { cacheFreshResult, lscProfiles, profilesWithApps } from "./_mobile-sync-shared.js";
import { once } from "./_visit-shared.js";

/** Standard objects that grow without bound; synced unfiltered they swamp the first sync. */
const HIGH_VOLUME = ["Task", "Event", "EmailMessage", "Attachment", "ContentDocumentLink", "Case", "ProviderVisit"];
/** Row count past which an unfiltered object is worth a filter. */
const HIGH_VOLUME_ROWS = 50_000;

/** A WHERE clause error that means the filter is wrong, as opposed to the object not being queryable by this user. */
const FILTER_ERROR = /INVALID_FIELD|MALFORMED_QUERY|INVALID_TYPE|No such column|unexpected token|didn't understand|is not supported/i;
/** An object the probe touches (the record's own or one in a subquery) isn't queryable by the admin — says nothing about the filter. */
const objectUnavailable = (error: string) => /sObject type '[^']*' is not supported/i.test(error);

/** The filter with the app's tags replaced by placeholder values, ready to run with LIMIT 1. */
function probeSoql(sobject: string, where: string): string {
  let w = resolveScalarTags(where, { userId: "005000000000000", territoryName: "x", territoryId: "0MI000000000000" });
  for (const tag of [TAG_ACCOUNT_IDS, TAG_OT2A_IDS, TAG_STI_IDS, "{related.entities}", "{cont.docs}", "{attachments}"]) {
    w = substituteIdTag(w, tag, ["000000000000000"]);
  }
  return `SELECT Id FROM ${sobject} WHERE ${w} LIMIT 1`;
}

/**
 * Row counts from the org's storage statistics (`/limits/recordCount`), which Salesforce keeps
 * without scanning the table — close enough to tell a big table from a small one. Objects it
 * doesn't report are absent; the caller counts those itself.
 */
async function recordCounts(objects: string[], org: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const res = await apiRequest<{ sObjects?: Array<{ name: string; count: number }> }>(
    await dataPath(org, `/limits/recordCount?sObjects=${encodeURIComponent([...new Set(objects)].join(","))}`),
    "GET",
    undefined,
    org
  );
  for (const o of (res.success && res.data?.sObjects) || []) out.set(o.name.toLowerCase(), o.count);
  return out;
}

const readiness: ReadinessModule = {
  ruleFiles: ["mobile-config.yaml"],
  checks: async (org) => {
    const schema = once(() => fetchCategories(org, ["DbSchema"], true));
    const uiSchema = once(() => fetchCategories(org, ["UISchema"], true));
    const settings = once(() => fetchCategories(org, SETTINGS_CATEGORIES, true));
    const caches = once(() => fetchCache(org));
    const dataRecords = async () => (await schema()).filter((r) => r.fields.Type !== "CONFIGURATION");
    const users = once(() => lscProfiles(org).catch(() => new Map<string, string>()));
    /**
     * Profiles that sync data: those the active DB Schema records are assigned to, plus every
     * LSC-licensed profile when a record is org-level. Profiles with no LSC-licensed active user
     * are left out (integration users, empty profiles) — unless the org has none at all, when the
     * license is named differently here and nothing is dropped.
     */
    const syncedProfiles = once(async () => {
      const active = (await dataRecords()).filter((r) => r.isActive);
      const lsc = await users();
      const names = new Map(active.flatMap(profilesOf).map((p) => [p.toLowerCase(), p]));
      if (active.some((r) => r.isOrgLevel)) for (const [k, p] of lsc) names.set(k, p);
      return [...names].filter(([k]) => !lsc.size || lsc.has(k)).map(([, p]) => p).sort();
    });

    return Promise.all([
      runCheck(
        {
          id: "mobile-sync.enabled.synced-objects",
          stage: "enabled",
          title: "Objects are set up to sync to the iPad",
          severity: "error",
          why: "The iPad only downloads objects that have an active DB Schema record. With none, the app signs in to an empty shell.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Create or switch on a record for each object the reps need, assigned to their profiles", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "syncedObjects",
        },
        async () => {
          const all = await dataRecords();
          const active = all.filter((r) => r.isActive);
          return {
            pass: active.length > 0,
            detail: `${plural(active.length, "active object")} syncing; ${all.length - active.length} switched off.`,
          };
        }
      ),
      runCheck(
        {
          id: "mobile-sync.access.profiles-exist",
          stage: "access",
          title: "Every profile named in DB Schema exists",
          severity: "error",
          why: "A DB Schema record assigned to a profile name that doesn't exist (a typo, or a profile renamed later) syncs to nobody, and nothing reports it.",
          steps: ["Open the record in Admin Console > Mobile > DB Schema", "Replace the unknown profile with the correct profile name"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "syncedObjects",
        },
        async () => {
          const profiles = new Set((await query(`SELECT Name FROM Profile`, org)).map((r) => String(r.Name).toLowerCase()));
          const bad = new Map<string, string[]>();
          for (const r of (await schema()).filter((r) => r.isActive)) {
            for (const p of profilesOf(r)) {
              if (!profiles.has(p.toLowerCase())) bad.set(p, [...(bad.get(p) ?? []), dbSchemaLabel(r)]);
            }
          }
          return bad.size
            ? {
                pass: false,
                detail: `${plural(bad.size, "profile name")} in DB Schema match no profile.`,
                examples: [...bad].map(([p, objs]) => `${p} (${objs.slice(0, 3).join(", ")}${objs.length > 3 ? "…" : ""})`),
              }
            : { pass: true, detail: "All profile names in active DB Schema records exist." };
        }
      ),
      runCheck(
        {
          id: "mobile-sync.config.assigned",
          stage: "config",
          title: "Every active DB Schema record is assigned to someone",
          severity: "warning",
          why: "An active record that is neither org-level nor assigned to a profile or permission set syncs nothing, so the object looks configured but never reaches a device.",
          steps: ["Open each record listed in Admin Console > Mobile > DB Schema", "Assign it to the reps' profiles, or switch it off if it is not needed"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "syncedObjects",
        },
        async () => {
          const orphans = (await schema()).filter((r) => r.isActive && !r.isOrgLevel && r.assignments.length === 0 && !r.fields.Profiles && !r.fields.PermissionSets);
          return orphans.length
            ? { pass: false, detail: `${plural(orphans.length, "active record")} not assigned to any profile.`, examples: orphans.map(dbSchemaLabel) }
            : { pass: true, detail: "Every active record is assigned." };
        }
      ),
      runCheck(
        {
          id: "mobile-sync.config.schema-errors",
          stage: "config",
          title: "No DB Schema record reports an error",
          severity: "error",
          why: "Admin Console writes validation problems (a missing field, an object that can't sync) to the record's Errors field. Cache generation fails or skips the object until they are fixed.",
          steps: ["Open the record and read its Errors value", "Fix the field or object it names, then regenerate the cache"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "syncedObjects",
        },
        async () => {
          const bad = (await schema()).filter((r) => r.isActive && r.fields.Errors);
          return bad.length
            ? { pass: false, detail: `${plural(bad.length, "record")} report errors.`, examples: bad.map((r) => `${dbSchemaLabel(r)}: ${String(r.fields.Errors).slice(0, 120)}`) }
            : { pass: true, detail: "No active record reports errors." };
        }
      ),
      runCheck(
        {
          id: "mobile-sync.config.duplicates",
          stage: "config",
          title: "No profile has two active records for the same object",
          severity: "warning",
          why: "Two records for one object and profile compete: which filter and field list the device gets depends on order, so the sync is unpredictable.",
          steps: ["Open the records listed in Admin Console > Mobile > DB Schema", "Keep one per object and profile, and switch the other off"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "syncedObjects",
        },
        async () => {
          const records = await schema();
          const dups = findDuplicates(records);
          const names = [...dups].map(([dev, profiles]) => `${dbSchemaLabel(records.find((r) => r.developerName === dev)!)} for ${profiles.join(", ")}`);
          return names.length
            ? { pass: false, detail: `${plural(dups.size, "record")} duplicate another for the same profile.`, examples: [...new Set(names)] }
            : { pass: true, detail: "One active record per object and profile." };
        }
      ),
      runCheck(
        {
          id: "mobile-sync.config.filters-valid",
          stage: "config",
          title: "Every sync filter is valid SOQL for its object",
          severity: "error",
          why: "A WhereSoql with a wrong field or a typo makes that object's download fail on the device, and the sync stops or the table stays empty.",
          steps: [
            "Open the record listed in Admin Console > Mobile > DB Schema",
            "Fix the field name or syntax in the WHERE filter (tags like {USER.ID} are fine)",
            "Publish to iPad",
          ],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "syncedObjects",
        },
        async () => {
          const querier: OrgQuerier = { soql: (q) => runSoqlQuery(q, org), tooling: (q) => runToolingQuery(q, org) };
          const filtered = (await loadDbSchemaEntries(querier)).filter((e) => e.whereSoql);
          if (!filtered.length) return { pass: true, skip: true, detail: "No active record has a filter." };
          const problems: string[] = [];
          // A few at a time: each probe is an sf CLI call.
          for (let i = 0; i < filtered.length; i += 4) {
            await Promise.all(
              filtered.slice(i, i + 4).map(async (e) => {
                const r = await runSoqlQuery(probeSoql(e.sobject, e.whereSoql!), org);
                if (!r.success && FILTER_ERROR.test(String(r.error)) && !objectUnavailable(String(r.error))) problems.push(`${e.sobject}: ${String(r.error).split("\n")[0].slice(0, 140)}`);
              })
            );
          }
          return problems.length
            ? { pass: false, detail: `${plural(problems.length, "filter")} fail to parse or reference an unknown field.`, examples: problems.sort() }
            : { pass: true, detail: `${plural(filtered.length, "filter")} checked; all parse.` };
        }
      ),
      runCheck(
        {
          id: "mobile-sync.config.unfiltered-high-volume",
          stage: "config",
          title: "High-volume objects sync with a filter",
          severity: "info",
          why: "Tasks, events, emails, attachments and cases grow every day. Synced without a filter, each device downloads all of them the user can see, which slows first sync and fills the iPad.",
          steps: ["Open the record in Admin Console > Mobile > DB Schema", "Add a WhereSoql filter, for example by owner, recency or record type", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "syncedObjects",
        },
        async () => {
          const unfiltered = (await dataRecords()).filter((r) => r.isActive && !r.fields.WhereSoql && HIGH_VOLUME.some((o) => o.toLowerCase() === String(r.fields.SObject ?? "").toLowerCase()));
          if (!unfiltered.length) return { pass: true, detail: "None of the usual high-volume objects sync without a filter." };
          const big: string[] = [];
          const uncounted: string[] = [];
          const counts = await recordCounts(unfiltered.map((r) => String(r.fields.SObject)), org);
          for (const r of unfiltered) {
            const n = counts.get(String(r.fields.SObject).toLowerCase()) ?? (await count(`SELECT COUNT() FROM ${String(r.fields.SObject)}`, org).catch(() => null));
            if (n === null) uncounted.push(String(r.fields.SObject));
            else if (n > HIGH_VOLUME_ROWS) big.push(`${String(r.fields.SObject)} (${n.toLocaleString("en-US")} rows)`);
          }
          if (!big.length && uncounted.length) throw new Error(`Couldn't count ${uncounted.join(", ")}.`);
          return big.length
            ? { pass: false, detail: `${plural(big.length, "object")} with over ${HIGH_VOLUME_ROWS.toLocaleString("en-US")} rows sync without a filter.`, examples: big }
            : { pass: true, detail: `${unfiltered.map((r) => String(r.fields.SObject)).join(", ")} sync without a filter but are small.` };
        }
      ),
      runCheck(
        {
          id: "mobile-sync.config.profile-app-settings",
          stage: "config",
          title: "Each synced profile has its own app settings",
          severity: "info",
          why: "Profile app settings carry the sync interval, search and notification options. A profile without a record of its own uses the org-level record; with neither, it runs on org defaults, which is usually not what a pilot group was told to expect.",
          steps: ["Open Admin Console > Mobile > Application Settings", "Add a profile-based settings record for the profile, or copy another profile's"],
          uiPath: "Admin Console > Mobile > Application Settings",
          surface: "appSettings",
        },
        async () => {
          const [profiles, all] = await Promise.all([syncedProfiles(), settings()]);
          const have = new Set(byCategory(all, "ProfileBasedAppSettings").filter((r) => r.isActive).flatMap(profilesOf).map((p) => p.toLowerCase()));
          const missing = profiles.filter((p) => !have.has(p.toLowerCase()));
          if (!missing.length) return { pass: true, detail: `${plural(profiles.length, "synced profile")} all have app settings.` };
          const orgLevel = byCategory(all, "ProfileBasedAppSettings").find((r) => r.isActive && r.isOrgLevel);
          if (orgLevel) {
            return {
              pass: true,
              detail: `No record of their own, so the org-level one (${orgLevel.label || orgLevel.developerName}) applies: ${missing.join(", ")}.`,
            };
          }
          const ids = new Map(
            (await query(`SELECT Id, Name FROM Profile WHERE Name IN (${inList(missing)})`, org)).map((p) => [String(p.Name), String(p.Id)])
          );
          const pbs = byCategory(all, "ProfileBasedAppSettings");
          const fixes = missing.flatMap((p) => noAppSettings(p, ids.get(p), pbs, all).fixes ?? []);
          return { pass: false, detail: `${plural(missing.length, "synced profile")} without app settings: ${missing.join(", ")}.`, examples: missing, fixes };
        }
      ),
      runCheck(
        {
          id: "mobile-sync.mobile.profile-cache",
          stage: "mobile",
          title: "Every synced profile has a published metadata cache",
          severity: "warning",
          why: "The iPad downloads the cache published for its profile. A profile with DB Schema records but no published cache gets no schema, so its reps see nothing.",
          steps: ["Open Admin Console > Mobile > Object Metadata Cache Configuration", "Generate the cache for the profile, or run /lsc:generate-metadata-cache"],
          uiPath: "Admin Console > Mobile > Object Metadata Cache Configuration",
          surface: "metadataCache",
        },
        async () => {
          const [profiles, all] = await Promise.all([syncedProfiles(), caches()]);
          if (!profiles.length) return { pass: true, skip: true, detail: "No profile is assigned DB Schema records." };
          const live = all.filter(isLiveCache);
          const missing = profiles.filter((p) => !live.some((c) => c.profile?.toLowerCase() === p.toLowerCase()));
          return missing.length
            ? { pass: false, detail: `${plural(missing.length, "synced profile")} without a published cache: ${missing.join(", ")}.`, examples: missing }
            : { pass: true, detail: `${plural(profiles.length, "synced profile")} all have a published cache.` };
        }
      ),
      runCheck(
        {
          id: "mobile-sync.mobile.cache-fresh",
          stage: "mobile",
          title: "The published cache includes your latest changes",
          severity: "warning",
          why: "The iPad runs the cache as last published, not the live Admin Console. DB Schema, tab or settings edits made afterwards are invisible to reps until you publish again.",
          steps: ["Open Admin Console > Mobile > Object Metadata Cache Configuration", "Regenerate the cache for the profiles listed (Publish to iPad in Studio, or /lsc:generate-metadata-cache)"],
          uiPath: "Admin Console > Mobile > Object Metadata Cache Configuration",
          surface: "metadataCache",
        },
        async () => {
          const records = [...(await schema()), ...(await uiSchema()), ...(await settings())];
          return cacheFreshResult(org, await caches(), ["DbSchema", "UISchema", ...SETTINGS_CATEGORIES], records);
        }
      ),
      runCheck(
        {
          id: "mobile-sync.mobile.nav-tabs",
          stage: "mobile",
          title: "Each synced profile has a tab bar",
          severity: "info",
          why: "The iPad's tab bar comes from the profile's Lightning app; UI Settings tabs are added to it. A profile that can open no Lightning app and has no UI Settings tabs has nothing to build the bar from.",
          steps: ["Give the profile access to the Lightning app its reps use (Setup > Profiles > Assigned Apps)", "Or add tabs for it in Admin Console > Mobile > UI Settings"],
          uiPath: "Setup > Profiles > Assigned Apps",
          surface: "navigationTabs",
        },
        async () => {
          const [profiles, ui] = await Promise.all([syncedProfiles(), uiSchema()]);
          const tabs = ui.filter((r) => isNavTab(r) && r.isActive);
          const noTabs = profiles.filter((p) => !tabs.some((t) => profilesOf(t).some((n) => n.toLowerCase() === p.toLowerCase())));
          const apps = await profilesWithApps(noTabs, org);
          const missing = noTabs.filter((p) => !apps.has(p.toLowerCase()));
          if (!missing.length) return { pass: true, detail: `${plural(profiles.length, "synced profile")} checked; each can open a Lightning app or has UI Settings tabs.` };
          const fixes: StudioFix[] = missing.flatMap((p) => noNavTabs(p, tabs).fixes ?? []);
          return { pass: false, detail: `${plural(missing.length, "synced profile")} with no Lightning app and no UI Settings tabs: ${missing.join(", ")}.`, examples: missing, fixes };
        }
      ),
    ]);
  },
};

export default readiness;
