/**
 * What changed in the org after a profile's metadata cache was generated: the third state between
 * "on iPads" (the cache) and "in the tray" (queued, not applied). A handful of batched queries
 * (documents, record types, tabs, Admin Console records); one kind failing is reported, never
 * mistaken for "nothing changed".
 */

import { chunkIds } from "../tools/helpers.js";
import { inList, query, type Row } from "./helpers.js";
import { findProfileApp } from "./metadata/live-app.js";
import {
  MOBILE_CATEGORIES,
  compactLayoutItems,
  configItems,
  appItems,
  flexiPageItems,
  isAfter,
  layoutItems,
  listViewItems,
  nameIndex,
  recordTypeItems,
  soqlTime,
  sortItems,
  tabItems,
  type ConfigEdit,
  type KnownDocuments,
  type UnpublishedItem,
  type UnpublishedResult,
} from "./unpublished-logic.js";

const soqlString = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const nested = (r: Row, key: string): Row => (r[key] && typeof r[key] === "object" ? (r[key] as Row) : {});

interface LiveCache {
  profileId: string;
  startedAt: number;
  generatedAt: number;
}

/** The profile's newest Active cache record, or the profile's id alone when it has none. */
async function liveCache(profile: string, org: string): Promise<{ profileId: string; cache: LiveCache | null }> {
  const profiles = await query(`SELECT Id, Name FROM Profile WHERE Name = ${soqlString(profile)}`, org);
  const found = profiles.find((p) => text(p.Name).toLowerCase() === profile.toLowerCase());
  if (!found) throw new Error(`Profile not found: ${profile}`);
  const profileId = text(found.Id);
  const rows = await query(
    `SELECT Id, CreatedDate, LastModifiedDate FROM LifeSciMobileMetadataRecord
     WHERE ProfileId = '${profileId}' AND ParentMobileMetadataRecId != null AND Status = 'Active'
     ORDER BY LastModifiedDate DESC LIMIT 1`,
    org
  );
  const r = rows[0];
  if (!r) return { profileId, cache: null };
  const generatedAt = Date.parse(text(r.LastModifiedDate));
  const startedAt = Date.parse(text(r.CreatedDate));
  if (!Number.isFinite(generatedAt)) throw new Error("The profile's metadata cache has no generation time.");
  return { profileId, cache: { profileId, generatedAt, startedAt: Number.isFinite(startedAt) ? Math.min(startedAt, generatedAt) : generatedAt } };
}

/** Admin Console records, their value rows or their assignments edited after `since`, with the editor of the latest edit. */
export async function fetchConfigEdits(org: string, since: number): Promise<ConfigEdit[]> {
  const iso = soqlTime(since);
  const [edited, valued, reassigned] = await Promise.all([
    query(`SELECT Id, LastModifiedDate, LastModifiedBy.Name FROM LifeSciConfigRecord WHERE LastModifiedDate > ${iso}`, org, true),
    query(`SELECT LifeSciConfigRecordId, LastModifiedDate, LastModifiedBy.Name FROM LifeSciConfigFieldValue WHERE LastModifiedDate > ${iso}`, org, true),
    query(`SELECT LifeSciConfigRecordId, LastModifiedDate, LastModifiedBy.Name FROM LifeSciConfigAssignment WHERE LastModifiedDate > ${iso}`, org, true),
  ]);
  // The newest touch per record, from any of the three tables.
  const touched = new Map<string, { at: number; by: string | null }>();
  const touch = (id: string, row: Row) => {
    const at = Date.parse(text(row.LastModifiedDate));
    if (!id || !Number.isFinite(at)) return;
    const prev = touched.get(id);
    if (!prev || at > prev.at) touched.set(id, { at, by: text(nested(row, "LastModifiedBy").Name) || null });
  };
  for (const r of edited) touch(text(r.Id), r);
  for (const r of valued) touch(text(r.LifeSciConfigRecordId), r);
  for (const r of reassigned) touch(text(r.LifeSciConfigRecordId), r);

  const out: ConfigEdit[] = [];
  await Promise.all(
    chunkIds([...touched.keys()], 150).map(async (chunk) => {
      const [records, assignments] = await Promise.all([
        query(`SELECT Id, DeveloperName, IsOrgLevel, LifeSciConfigCategory.Category FROM LifeSciConfigRecord WHERE Id IN (${inList(chunk)})`, org, true),
        query(`SELECT LifeSciConfigRecordId, AssignedToId, AssignmentLevel FROM LifeSciConfigAssignment WHERE LifeSciConfigRecordId IN (${inList(chunk)})`, org, true),
      ]);
      for (const r of records) {
        const category = text(nested(r, "LifeSciConfigCategory").Category);
        if (!MOBILE_CATEGORIES.includes(category)) continue;
        const mine = assignments.filter((a) => a.LifeSciConfigRecordId === r.Id);
        const t = touched.get(text(r.Id))!;
        out.push({
          recordId: text(r.Id),
          category,
          developerName: text(r.DeveloperName),
          at: t.at,
          by: t.by,
          allProfiles: r.IsOrgLevel === true || mine.some((a) => a.AssignmentLevel !== "Profile"),
          profileIds: mine.filter((a) => a.AssignmentLevel === "Profile").map((a) => text(a.AssignedToId)),
        });
      }
    })
  );
  return out;
}

type Reader = { kind: string; read: () => Promise<UnpublishedItem[]> };

/**
 * The changes made in the org after `profile`'s live cache was generated that the iPad would show
 * differently. `known` (the snapshot's own documents) limits document changes to those the profile uses.
 */
export async function collectUnpublished(profile: string, org: string, known?: KnownDocuments): Promise<UnpublishedResult> {
  const { profileId, cache } = await liveCache(profile, org);
  const checkedAt = new Date().toISOString();
  const base = { profile, checkedAt, scoped: !!known };
  if (!cache) {
    // Nothing was ever published: there's nothing to compare against, and the profile has no iPad to be "up to date".
    return { ...base, cacheAt: null, cacheStartedAt: null, noCache: true, items: [], errors: [] };
  }
  const boundary = cache.startedAt;
  const since = `LastModifiedDate > ${soqlTime(boundary)}`;
  const recent = (rows: Row[]) => rows.filter((r) => isAfter(r.LastModifiedDate, boundary));
  const scopes = {
    layouts: nameIndex(known?.layouts),
    compactLayouts: nameIndex(known?.compactLayouts),
    flexiPages: nameIndex(known?.flexiPages),
    recordTypes: nameIndex(known?.recordTypes),
    listViews: nameIndex(known?.listViews),
    tabs: nameIndex(known?.tabs),
  };

  const readers: Reader[] = [
    {
      kind: "Page layouts",
      read: async () =>
        layoutItems(recent(await query(`SELECT Id, Name, TableEnumOrId, EntityDefinition.QualifiedApiName, LastModifiedDate, LastModifiedBy.Name FROM Layout WHERE ${since}`, org, true)), scopes.layouts),
    },
    {
      kind: "Compact layouts",
      read: async () =>
        compactLayoutItems(recent(await query(`SELECT Id, DeveloperName, MasterLabel, SobjectType, LastModifiedDate, LastModifiedBy.Name FROM CompactLayout WHERE ${since}`, org, true)), scopes.compactLayouts),
    },
    {
      // The Tooling FlexiPage has no LastModifiedBy: the editor stays unknown.
      kind: "Lightning pages",
      read: async () => flexiPageItems(recent(await query(`SELECT Id, DeveloperName, MasterLabel, LastModifiedDate FROM FlexiPage WHERE ${since}`, org, true)), scopes.flexiPages),
    },
    {
      // Only the app the profile's tab bar comes from, found by the tabs the snapshot knows (not guessed when two fit).
      kind: "Apps",
      read: async () => {
        if (!known?.tabs?.length) return [];
        const match = await findProfileApp(profile, known.tabs, org);
        if (!match.app) return [];
        return appItems(recent(await query(`SELECT Id, DeveloperName, NamespacePrefix, Label, LastModifiedDate, LastModifiedBy.Name FROM CustomApplication WHERE ${since}`, org, true)), match.app.fullName);
      },
    },
    {
      kind: "Record types",
      read: async () =>
        recordTypeItems(recent(await query(`SELECT Id, DeveloperName, Name, SobjectType, LastModifiedDate, LastModifiedBy.Name FROM RecordType WHERE ${since}`, org)), scopes.recordTypes),
    },
    {
      kind: "List views",
      read: async () =>
        listViewItems(recent(await query(`SELECT Id, DeveloperName, Name, SobjectType, LastModifiedDate, LastModifiedBy.Name FROM ListView WHERE ${since}`, org)), scopes.listViews),
    },
    {
      kind: "Tabs",
      read: async () => tabItems(recent(await query(`SELECT Id, DeveloperName, MasterLabel, LastModifiedDate, LastModifiedBy.Name FROM CustomTab WHERE ${since}`, org, true)), scopes.tabs),
    },
    {
      kind: "Admin Console",
      read: async () => configItems(await fetchConfigEdits(org, boundary), profileId, boundary),
    },
  ];

  const settled = await Promise.all(
    readers.map(async (r) => {
      try {
        return { kind: r.kind, items: await r.read() };
      } catch (err) {
        return { kind: r.kind, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );
  const items: UnpublishedItem[] = [];
  const errors: { kind: string; message: string }[] = [];
  for (const s of settled) {
    if ("error" in s && s.error !== undefined) errors.push({ kind: s.kind, message: s.error });
    else if ("items" in s && s.items) items.push(...s.items);
  }
  return {
    ...base,
    cacheAt: new Date(cache.generatedAt).toISOString(),
    cacheStartedAt: new Date(cache.startedAt).toISOString(),
    noCache: false,
    items: sortItems(items),
    errors,
  };
}
