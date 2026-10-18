/**
 * Mobile Sync — org-wide view of what LSC Mobile (iPad) syncs and for whom:
 * DB Schema records, per-profile coverage, navigation tabs, metadata cache
 * status, and app/sync settings.
 */

import type { ConfigRecord } from "../../config/types.js";
import type { CustomCollector } from "../collect.js";
import type { StudioFinding, StudioFix, StudioItem } from "../types.js";
import {
  assignedTo,
  audienceOf,
  buildSurface,
  configItem,
  inList,
  item,
  query,
  scalar,
  plural,
  profileAudience,
  settle,
  splitList,
  unwrap,
  type Row,
} from "../helpers.js";
import { addProfileFix, busiestProfile, byCategory, fetchCategories, isNavTab, navTabsSurface, newDbSchema, profilesOf } from "./shared.js";

export const SETTINGS_CATEGORIES = ["ApplicationSettings", "ProfileBasedAppSettings"];
const SYNC_CATEGORIES = ["SyncTransactionConfig", "SyncProcessorConfiguration", "SyncTransactionAdminView", "LogSettings"];

/** The effective sync query a DB Schema record describes. */
export function syncSoql(r: ConfigRecord): string | null {
  const fields = splitList(r.fields.MandatoryFields);
  if (fields.length === 0 && !r.fields.WhereSoql) return null;
  const select = fields.length ? fields.map((f) => `  ${f}`).join(",\n") : "  …";
  const where = r.fields.WhereSoql ? `\nWHERE ${r.fields.WhereSoql}` : "";
  return `SELECT\n${select}\nFROM ${r.fields.SObject}${where}`;
}

/** CONFIGURATION records sync an Admin Console category rather than a business object. */
export function dbSchemaLabel(r: ConfigRecord): string {
  if (r.fields.Type === "CONFIGURATION" && r.fields.Category) return `Admin Console · ${r.fields.Category}`;
  return String(r.fields.SObject || r.label || r.developerName);
}

function dbSchemaItem(r: ConfigRecord, duplicates: Map<string, string[]>): StudioItem {
  const it = configItem(r, dbSchemaLabel(r), [r.fields.Type, assignedTo(r) ?? "Unassigned"].filter(Boolean).join(" · "));
  // The field list and filter are shown as the sync query instead.
  const fieldCount = splitList(r.fields.MandatoryFields).length;
  delete it.properties.MandatoryFields;
  delete it.properties.WhereSoql;
  it.properties["Developer name"] = r.developerName;
  it.audience = audienceOf(r);
  if (fieldCount) it.properties["Synced fields"] = fieldCount;
  it.properties.Filter = r.fields.WhereSoql ? "Yes" : "None — all accessible records";

  const soql = syncSoql(r);
  if (soql) it.code = { language: "soql", text: soql };

  if (r.fields.Errors) {
    it.findings.push({ severity: "error", title: "DB Schema reports errors", detail: String(r.fields.Errors) });
  }
  if (r.isActive && r.assignments.length === 0 && !r.isOrgLevel) {
    it.findings.push({
      severity: "warning",
      title: "Not assigned to any profile",
      detail: "The record is active but isn't org-level or assigned to a profile, so nothing syncs from it.",
    });
  }
  for (const profile of duplicates.get(r.developerName) ?? []) {
    it.findings.push({
      severity: "warning",
      title: `Duplicate for ${profile}`,
      detail: `${profile} has more than one active DB Schema record for ${dbSchemaLabel(r)}. Keep one so the sync filter is predictable.`,
    });
  }
  return it;
}

/** developerName → profiles where another active record syncs the same object. */
export function findDuplicates(records: ConfigRecord[]): Map<string, string[]> {
  const byKey = new Map<string, ConfigRecord[]>();
  for (const r of records.filter((r) => r.isActive)) {
    for (const p of profilesOf(r)) {
      const key = `${dbSchemaLabel(r).toLowerCase()}|${p}`;
      byKey.set(key, [...(byKey.get(key) ?? []), r]);
    }
  }
  const out = new Map<string, string[]>();
  for (const [key, recs] of byKey) {
    if (recs.length < 2) continue;
    const profile = key.split("|")[1];
    for (const r of recs) out.set(r.developerName, [...(out.get(r.developerName) ?? []), profile]);
  }
  return out;
}

export interface CacheRecord {
  row: Row;
  profile: string | null;
}

export async function fetchCache(org: string): Promise<CacheRecord[]> {
  const rows = await query(
    `SELECT Id, Name, Status, IntegrationStatus, IntegrationErrorCode, IntegrationErrorMessage, ErrorLog, LastModifiedDate, ProfileId FROM LifeSciMobileMetadataRecord ORDER BY LastModifiedDate DESC LIMIT 200`,
    org
  );
  const ids = [...new Set(rows.map((r) => r.ProfileId).filter(Boolean) as string[])];
  const names = new Map<string, string>();
  if (ids.length) {
    for (const p of await query(`SELECT Id, Name FROM Profile WHERE Id IN (${inList(ids)})`, org)) {
      names.set(String(p.Id), String(p.Name));
    }
  }
  return rows.map((row) => ({
    row,
    profile: row.ProfileId ? (names.get(String(row.ProfileId)) ?? String(row.ProfileId)) : null,
  }));
}

export const isLiveCache = (c: CacheRecord) => c.row.Status === "Active" || c.row.Status === "Published";

function cacheFindings(r: Row): StudioFinding[] {
  const message = r.IntegrationErrorMessage || r.IntegrationErrorCode;
  if (message || /error|fail/i.test(String(r.IntegrationStatus || ""))) {
    return [
      {
        severity: "error",
        title: "Cache generation failed",
        detail: String(message || `Integration status: ${r.IntegrationStatus}`),
      },
    ];
  }
  return [];
}

/** "No profile app settings", suggesting a copy of another profile's settings (never made-up values). */
export function noAppSettings(profile: string, profileId: string | undefined, profileSettings: ConfigRecord[], all: ConfigRecord[]): StudioFinding {
  const finding: StudioFinding = {
    severity: "info",
    title: "No profile app settings",
    detail: "No ProfileBasedAppSettings record — the org defaults apply.",
  };
  const source = profileSettings.find((r) => r.isActive && !r.isOrgLevel && profilesOf(r).length > 0);
  if (!profileId || !source) return finding;
  const from = profilesOf(source)[0];
  return {
    ...finding,
    fixes: [
      {
        kind: "createConfigRecord",
        label: `Copy app settings from ${from}`,
        category: "ProfileBasedAppSettings",
        copyFrom: source.developerName,
        developerName: `ProfileBasedAppSettings_${profileId}`,
        recordLabel: `ProfileBasedAppSettings_${profileId}`,
        fields: [],
        profiles: [profile],
        permissionSets: [],
        active: true,
      },
    ],
  };
}

/** "No navigation tabs", suggesting the tabs of the profile that has the most. */
export function noNavTabs(profile: string, activeTabs: ConfigRecord[]): StudioFinding {
  const finding: StudioFinding = { severity: "info", title: "No navigation tabs", detail: "The iPad will show only default navigation." };
  const ref = busiestProfile(activeTabs, profilesOf, profile);
  if (!ref) return finding;
  const fixes = activeTabs
    .filter((t) => profilesOf(t).includes(ref))
    .map((t) => addProfileFix(t, profile, `Show the ${t.label ?? t.developerName} tab to ${profile}`))
    .filter((f): f is StudioFix => f !== null);
  return fixes.length ? { ...finding, detail: `${finding.detail} ${ref} has ${plural(fixes.length, "tab")} you can give it too.`, fixes } : finding;
}

export const collectMobileSync: CustomCollector = async (org) => {
  const dbSchema = settle(fetchCategories(org, ["DbSchema"]));
  const uiSchema = settle(fetchCategories(org, ["UISchema"]));
  const settings = settle(fetchCategories(org, SETTINGS_CATEGORIES));
  const sync = settle(fetchCategories(org, SYNC_CATEGORIES));
  const cache = settle(fetchCache(org));

  const surfaces = await Promise.all([
    buildSurface(
      {
        id: "syncedObjects",
        title: "Synced Objects",
        lane: "schema",
        description: "Active DB Schema records — the objects, fields, and filters LSC Mobile syncs to the iPad.",
      },
      async () => {
        const records = await unwrap(dbSchema);
        const dups = findDuplicates(records);
        const items = records
          .filter((r) => r.isActive)
          .sort((a, b) => dbSchemaLabel(a).localeCompare(dbSchemaLabel(b)))
          .map((r) => dbSchemaItem(r, dups));
        const unfiltered = items.filter((i) => i.properties.Filter !== "Yes").length;
        return {
          items,
          creates: [newDbSchema("", records, [])],
          findings: unfiltered
            ? [
                {
                  severity: "info",
                  title: `${unfiltered} objects sync without a filter`,
                  detail: "Every record the user can access is downloaded. Add a WhereSoql filter to high-volume objects to keep initial sync fast.",
                },
              ]
            : [],
        };
      }
    ),
    buildSurface(
      {
        id: "disabledObjects",
        title: "Disabled DB Schema",
        lane: "schema",
        description: "Inactive DB Schema records — these objects don't sync until re-enabled.",
      },
      async () => {
        const records = await unwrap(dbSchema);
        return {
          items: records
            .filter((r) => !r.isActive)
            .sort((a, b) => dbSchemaLabel(a).localeCompare(dbSchemaLabel(b)))
            .map((r) => dbSchemaItem(r, new Map())),
        };
      }
    ),
    buildSurface(
      {
        id: "mobileProfiles",
        title: "Mobile Profiles",
        lane: "profiles",
        description: "Each profile's mobile footprint — DB Schema, navigation tabs, app settings, and metadata cache.",
      },
      async () => {
        const [schema, ui, appSettings, caches] = await Promise.all([
          unwrap(dbSchema),
          unwrap(uiSchema),
          unwrap(settings),
          unwrap(cache),
        ]);
        const profileSettings = byCategory(appSettings, "ProfileBasedAppSettings");
        const orgCache = caches.find((c) => c.profile === null && isLiveCache(c));
        const names = new Set([
          ...schema.filter((r) => r.isActive).flatMap(profilesOf),
          ...profileSettings.flatMap(profilesOf),
          ...ui.filter(isNavTab).flatMap(profilesOf),
        ]);

        // ProfileBasedAppSettings records are named by profile Id; ids for the copy suggestion.
        const profileIds = new Map(
          names.size
            ? (await query(`SELECT Id, Name FROM Profile WHERE Name IN (${inList([...names])})`, org)).map((p) => [String(p.Name), String(p.Id)])
            : []
        );
        const activeTabs = ui.filter((r) => isNavTab(r) && r.isActive);

        const items = [...names].sort().map((profile) => {
          const has = (r: ConfigRecord) => r.isActive && profilesOf(r).includes(profile);
          const schemaCount = schema.filter(has).length;
          const tabs = ui.filter((r) => isNavTab(r) && has(r)).length;
          const app = profileSettings.find(has);
          const live = caches.find((c) => c.profile === profile && isLiveCache(c));
          const findings: StudioFinding[] = [];
          if (schemaCount > 0 && !live) {
            findings.push({
              severity: orgCache ? "info" : "warning",
              title: "No active metadata cache",
              detail: orgCache
                ? "Only the org-level cache is active. Generate a profile cache if this profile's schema differs."
                : "Generate the mobile metadata cache for this profile (Admin Console or /lsc:generate-metadata-cache) so the iPad picks up its schema.",
            });
          }
          if (!app) findings.push(noAppSettings(profile, profileIds.get(profile), profileSettings, appSettings));
          if (tabs === 0) findings.push(noNavTabs(profile, activeTabs));
          return item(`profile:${profile}`, profile, {
            sublabel: `${plural(schemaCount, "object")} · ${plural(tabs, "tab")}`,
            properties: {
              "DB Schema records": schemaCount,
              "Navigation tabs": tabs,
              "Mobile app": scalar(app?.fields.MobileAppName),
              "Sync interval (min)": scalar(app?.fields.MinuteInterval),
              "Metadata cache": live ? `${live.row.Status} · ${live.row.LastModifiedDate}` : "None",
            },
            audience: profileAudience(profile),
            checkProfile: profile,
            findings,
          });
        });
        return { items };
      }
    ),
    navTabsSurface(
      {
        id: "navigationTabs",
        title: "Navigation Tabs",
        lane: "ui",
        description: "LSC Mobile navigation tabs (Admin Console > Mobile > UI Settings).",
      },
      uiSchema
    ),
    buildSurface(
      {
        id: "uiResources",
        title: "UI Resources",
        lane: "ui",
        description: "Other UISchema records — logos, icons, and static resources used by the iPad app.",
      },
      async () => ({
        items: (await unwrap(uiSchema))
          .filter((r) => !isNavTab(r))
          .map((r) => configItem(r, r.label, String(r.fields.Type ?? r.developerName))),
      })
    ),
    buildSurface(
      {
        id: "metadataCache",
        title: "Metadata Cache",
        lane: "ui",
        description: "LifeSciMobileMetadataRecord — the generated schema package the iPad downloads, per profile.",
      },
      async () => ({
        items: (await unwrap(cache)).map(({ row, profile }) =>
          item(String(row.Id), profile ?? "Org level", {
            sublabel: `${row.Name} · ${row.Status}`,
            active: isLiveCache({ row, profile }),
            properties: {
              Status: scalar(row.Status),
              "Integration status": scalar(row.IntegrationStatus),
              "Last generated": scalar(row.LastModifiedDate),
              Profile: profile ?? "Org level",
            },
            code: row.ErrorLog ? { language: "log", text: String(row.ErrorLog) } : undefined,
            // The org-level cache is the base template every profile downloads.
            audience: profile ? profileAudience(profile) : undefined,
            findings: isLiveCache({ row, profile }) ? cacheFindings(row) : [],
          })
        ),
      })
    ),
    buildSurface(
      {
        id: "appSettings",
        title: "Application Settings",
        lane: "settings",
        description: "Org-level and per-profile LSC Mobile application settings.",
      },
      async () => ({
        items: (await unwrap(settings)).map((r) => {
          const profiles = profilesOf(r);
          const label = r.isOrgLevel ? "Org defaults" : profiles.length ? profiles.join(", ") : r.label;
          const it = configItem(r, label, r.category === "ApplicationSettings" ? "Application settings" : "Profile app settings");
          if (r.category === "ProfileBasedAppSettings") it.audience = audienceOf(r);
          return it;
        }),
      })
    ),
    buildSurface(
      {
        id: "syncSettings",
        title: "Sync & Logging",
        lane: "settings",
        description: "Sync transaction, sync processor, and log settings.",
      },
      async () => ({
        items: (await unwrap(sync)).map((r) => configItem(r, r.label, r.category)),
      })
    ),
  ]);

  const synced = surfaces.find((s) => s.id === "syncedObjects")!;
  const profiles = surfaces.find((s) => s.id === "mobileProfiles")!;
  return {
    summary: `${synced.items.length} synced objects · ${profiles.items.length} profiles`,
    lanes: [
      { id: "schema", title: "Sync schema" },
      { id: "profiles", title: "Profiles" },
      { id: "ui", title: "iPad UI & cache" },
      { id: "settings", title: "Settings" },
    ],
    surfaces,
    // What one profile's iPad gets, in the order an admin would fix it.
    checkTitle: "iPad readiness",
    checklist: [
      { surface: "mobileProfiles", label: "Mobile access", missing: "Not one of the {total} mobile profiles" },
      { surface: "syncedObjects", label: "Synced objects", missing: "None of the {total} synced objects are assigned" },
      { surface: "navigationTabs", label: "Navigation tabs", missing: "None of the {total} tabs are assigned" },
      { surface: "metadataCache", label: "Metadata cache", missing: "No active cache for this profile", publish: true },
      { surface: "uiResources", label: "UI resources" },
      { surface: "appSettings", label: "App settings" },
      { surface: "syncSettings", label: "Sync & logging" },
    ],
  };
};
