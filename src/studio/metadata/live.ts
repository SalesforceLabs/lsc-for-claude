/**
 * The live page layout behind a block in the iPad preview: its sections, fields
 * and related lists as they are in the org now (the preview shows the last
 * publish), which profiles use it, whether the org is production, and the
 * fields and related lists that could be added. The renderer lines the
 * published layout up against it before offering edits. Compact layouts (the
 * record header) likewise: their fields, the fields that could be added, and
 * the record types assigned them. Lightning pages likewise: their regions and
 * components, the profiles and apps they're assigned in, and whether they're managed.
 */

import * as fs from "fs";
import * as path from "path";
import { apiRequest, cachedDescribeSObject, retrieveMetadata, type SObjectDescribeResult } from "../../salesforce/cli.js";
import { assertId } from "../change-helpers.js";
import { query, type Row } from "../helpers.js";
import type { LayoutFieldOption, LiveCompactLayout, LiveFlexiPage, LiveLayout, LiveListView, RelatedListOption } from "../types.js";
import { listBooleanFilter, listColumns, listFilters, listFilterScope } from "./listview-ops.js";
import { compactFields } from "./compact-ops.js";
import { withDoc } from "./doc.js";
import { componentOf, facetsOf, identifierOf, itemsOf, propertiesOf, regionName, regionsOf } from "./flexipage-ops.js";
import { childText, childrenNamed, parseXml, unescapeXml, type XmlNode } from "./xml.js";

const soqlString = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** Whether an org is production never changes, so the answer (not a failed lookup) is kept for the session. */
const productionOrgs = new Map<string, boolean>();
export async function isProductionOrg(org: string): Promise<boolean> {
  const known = productionOrgs.get(org);
  if (known !== undefined) return known;
  try {
    const [rec] = await query("SELECT IsSandbox FROM Organization LIMIT 1", org);
    if (!rec) return false;
    const production = rec.IsSandbox === false;
    productionOrgs.set(org, production);
    return production;
  } catch {
    return false;
  }
}

/** Drop everything remembered about an org (for tests, and after a connection changes). */
export function forgetLiveOrg(org: string): void {
  productionOrgs.delete(org);
  appCache.delete(org);
  assignmentsCache.delete(org);
}

/** Profiles assigned the layout (any record type), sorted; null when the layout can't be found in Tooling. */
export async function layoutProfiles(fullName: string, org: string): Promise<string[] | null> {
  try {
    const dash = fullName.indexOf("-");
    const object = fullName.slice(0, dash);
    const name = decodeURIComponent(fullName.slice(dash + 1));
    const layouts = await query(`SELECT Id, TableEnumOrId FROM Layout WHERE Name = ${soqlString(name)}`, org, true);
    const table = object === "PersonAccount" ? "Account" : object;
    const layout = layouts.length === 1 ? layouts[0] : layouts.find((l) => l.TableEnumOrId === table);
    if (!layout) return null;
    assertId(String(layout.Id));
    const rows = await query(`SELECT Profile.Name FROM ProfileLayout WHERE LayoutId = '${layout.Id}'`, org, true);
    return [...new Set(rows.map((r) => (r.Profile as Row | null)?.Name).filter((n): n is string => typeof n === "string" && !!n))].sort();
  } catch {
    return null;
  }
}

/** System and audit fields Studio doesn't offer to add. */
const SYSTEM_FIELDS = new Set([
  "Id",
  "IsDeleted",
  "MasterRecordId",
  "CreatedDate",
  "CreatedById",
  "LastModifiedDate",
  "LastModifiedById",
  "SystemModstamp",
  "LastActivityDate",
  "LastViewedDate",
  "LastReferencedDate",
  "PersonContactId",
  "IsPersonAccount",
  "PhotoUrl",
  "Jigsaw",
  "JigsawCompanyId",
  "CleanStatus",
  "ConnectionReceivedId",
  "ConnectionSentId",
]);

/** The object a layout is for: "PersonAccount-HCP Layout" → Account. */
export function layoutObject(fullName: string): string {
  const object = fullName.slice(0, fullName.indexOf("-"));
  return object === "PersonAccount" ? "Account" : object;
}

/**
 * Fields that could go on the layout but aren't on it: readable (the describe
 * only lists those), not system or audit fields, not a compound field's parts
 * (the layout names the compound), and on a business account layout no
 * person-account fields. Sorted by label.
 */
export function availableFields(fullName: string, described: SObjectDescribeResult, onLayout: Set<string>): LayoutFieldOption[] {
  const business = fullName.startsWith("Account-");
  return described.fields
    .filter(
      (f) =>
        !onLayout.has(f.name) &&
        !SYSTEM_FIELDS.has(f.name) &&
        f.type !== "id" &&
        !f.compoundFieldName &&
        !f.deprecatedAndHidden &&
        !(business && (/^Person[A-Z]/.test(f.name) || f.name.endsWith("__pc")))
    )
    .map((f) => ({ field: f.name, label: f.label, type: f.type }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.field.localeCompare(b.field));
}

/** The fields on the layout, with the describe's label and type (an item the describe doesn't list, such as a custom component, is left out). */
export function placedFields(described: SObjectDescribeResult, onLayout: Set<string>): LayoutFieldOption[] {
  return described.fields.filter((f) => onLayout.has(f.name)).map((f) => ({ field: f.name, label: f.label, type: f.type }));
}

/** Child objects that are never a layout's related list. */
const NOT_RELATED_LIST = /(Share|Feed|History|ChangeEvent|__hd|__e)$/;

/**
 * The related lists a layout of `object` can hold, by relationship name — the
 * org's own list (Tooling `RelatedListDefinition`, `IsLayoutable`). A describe
 * lists far more child relationships than that (activities, notes, files,
 * approvals, system objects), which a layout deploy refuses. Null when the org
 * won't say, so the caller shows the describe's list instead.
 */
export async function layoutableRelatedLists(object: string, org: string): Promise<Set<string> | null> {
  try {
    if (!/^[A-Za-z0-9_]+$/.test(object)) return null;
    const rows = await query(
      `SELECT RelatedListName FROM RelatedListDefinition WHERE ParentEntityDefinitionId = '${object}' AND IsLayoutable = true`,
      org,
      true
    );
    return rows.length ? new Set(rows.map((r) => String(r.RelatedListName))) : null;
  } catch {
    return null;
  }
}

/**
 * The object's child relationships not already on the layout, by the name the
 * layout XML uses: custom children and custom lookups are Child.Field, the rest
 * their relationship name. Custom objects first, then by object. With
 * `layoutable` (from `layoutableRelatedLists`) only relationships the org lets a
 * layout hold are offered.
 */
export function relatedListOptions(
  described: SObjectDescribeResult,
  onLayout: string[],
  layoutable?: Set<string> | null
): (RelatedListOption & { relationshipName: string })[] {
  const placed = new Set(onLayout);
  const seen = new Set<string>();
  return (described.childRelationships ?? [])
    .flatMap((c) => {
      if (!c.relationshipName || c.deprecatedAndHidden || NOT_RELATED_LIST.test(c.childSObject)) return [];
      if (layoutable && !layoutable.has(c.relationshipName)) return [];
      const dotted = `${c.childSObject}.${c.field}`;
      const relatedList = c.childSObject.endsWith("__c") || c.field.endsWith("__c") ? dotted : c.relationshipName;
      if (placed.has(relatedList) || placed.has(dotted) || placed.has(c.relationshipName) || seen.has(relatedList)) return [];
      seen.add(relatedList);
      return [{ relatedList, object: c.childSObject, relationshipName: c.relationshipName }];
    })
    .sort((a, b) => Number(b.object.endsWith("__c")) - Number(a.object.endsWith("__c")) || a.object.localeCompare(b.object) || a.relatedList.localeCompare(b.relatedList));
}

export async function readLiveLayout(fullName: string, org: string): Promise<LiveLayout> {
  const [structure, profiles, production, described, layoutable] = await Promise.all([
    withDoc("Layout", fullName, org, async ({ root }) => {
      const seen = new Map<string, number>();
      const sections = childrenNamed(root, "layoutSections").map((s) => {
        const label = childText(s, "label") ?? "";
        const nth = seen.get(label) ?? 0;
        seen.set(label, nth + 1);
        return {
          label,
          nth,
          heading: childText(s, "detailHeading") === "true",
          columns: childrenNamed(s, "layoutColumns").map((c) =>
            childrenNamed(c, "layoutItems").flatMap((i) => {
              const field = childText(i, "field");
              return field ? [{ field, behavior: childText(i, "behavior") ?? "Edit" }] : [];
            })
          ),
        };
      });
      const relatedLists = childrenNamed(root, "relatedLists").map((r) => childText(r, "relatedList") ?? "");
      return { sections, relatedLists };
    }),
    layoutProfiles(fullName, org),
    isProductionOrg(org),
    cachedDescribeSObject(layoutObject(fullName), org).catch(() => null),
    layoutableRelatedLists(layoutObject(fullName), org),
  ]);
  const desc = described?.success ? described.data : undefined;
  const placed = new Set(structure.sections.flatMap((s) => s.columns.flat().map((i) => i.field)));
  return {
    type: "Layout",
    fullName,
    ...structure,
    profiles,
    production,
    available: desc ? availableFields(fullName, desc, placed) : null,
    placed: desc ? placedFields(desc, placed) : null,
    availableRelated: desc ? relatedListOptions(desc, structure.relatedLists, layoutable).map(({ relatedList, object }) => ({ relatedList, object })) : null,
  } as LiveLayout;
}

/** Describe types a compact layout can't hold (text areas, multi-select picklists) or that aren't fields to show. */
const NOT_COMPACT = new Set(["textarea", "multipicklist", "base64", "id", "address", "location"]);

/** "Account.LSC_Compact" → ["Account", "LSC_Compact"]; throws on anything else. */
export function splitCompactName(fullName: string): [string, string] {
  const m = /^(\w+)\.(\w+)$/.exec(fullName);
  if (!m) throw new Error(`Invalid compact layout name: ${fullName}`);
  return [m[1], m[2]];
}

/** Record types assigned the compact layout ("Master" for the object's default), sorted; null when that can't be read. */
export async function compactLayoutRecordTypes(fullName: string, org: string): Promise<string[] | null> {
  try {
    const [object, name] = splitCompactName(fullName);
    const res = await apiRequest<{ recordTypeCompactLayoutMappings?: { compactLayoutName?: string; recordTypeName?: string }[] }>(
      `/services/data/v66.0/sobjects/${object}/describe/compactLayouts`,
      "GET",
      undefined,
      org
    );
    if (!res.success || !res.data) return null;
    const names = (res.data.recordTypeCompactLayoutMappings ?? []).flatMap((m) =>
      m.compactLayoutName === name && m.recordTypeName ? [m.recordTypeName] : []
    );
    return [...new Set(names)].sort();
  } catch {
    return null;
  }
}

export async function readLiveCompactLayout(fullName: string, org: string): Promise<LiveCompactLayout> {
  const [object] = splitCompactName(fullName);
  const [doc, available, recordTypes, production] = await Promise.all([
    withDoc("CompactLayout", fullName, org, async ({ root }) => ({ label: childText(root, "label") ?? fullName, fields: compactFields(root) })),
    cachedDescribeSObject(object, org).then(
      (r) => (r.success && r.data ? r.data.fields.filter((f) => !NOT_COMPACT.has(f.type)).map((f) => ({ name: f.name, label: f.label, type: f.type })) : []),
      () => []
    ),
    compactLayoutRecordTypes(fullName, org),
    isProductionOrg(org),
  ]);
  return { type: "CompactLayout", fullName, ...doc, available, recordTypes, production };
}

// --- Lightning pages -------------------------------------------------------------------

/** Standard profiles' Metadata API names, as Profile.Name has them. */
const STANDARD_PROFILES: Record<string, string> = {
  Admin: "System Administrator",
  Standard: "Standard User",
  ReadOnly: "Read Only",
  SolutionManager: "Solution Manager",
  MarketingProfile: "Marketing User",
  ContractManager: "Contract Manager",
  StandardAul: "Standard Platform User",
};
export const profileName = (metadataName: string) => STANDARD_PROFILES[metadataName] ?? decodeURIComponent(metadataName);

interface PageAssignments {
  /** Page name → profiles it's assigned to in some app. */
  profiles: Map<string, Set<string>>;
  /** Page name → apps whose default page it is. */
  appDefaults: Map<string, Set<string>>;
}

const ASSIGNMENTS_TTL_MS = 30_000;
export const assignmentsCache = new Map<string, { at: number; value: Promise<PageAssignments | null>; settled?: PageAssignments }>();

/** One app's page overrides, however they were read: only what the reach needs. */
export interface AppOverrides {
  /** The app's Metadata API name (`standard__LightningSales`, `MyApp`, `ns__MyApp`). */
  fullName: string;
  label: string;
  profileActionOverrides: { content?: string; profile?: string; formFactor?: string }[];
  actionOverrides: { content?: string; formFactor?: string }[];
}

/** Fold apps' overrides into the page → profiles / apps maps (large form factors only). */
function assignmentsOf(apps: AppOverrides[]): PageAssignments {
  const out: PageAssignments = { profiles: new Map(), appDefaults: new Map() };
  const add = (m: Map<string, Set<string>>, page: string, v: string) => m.set(page, (m.get(page) ?? new Set()).add(v));
  const large = (o: { formFactor?: string }) => (o.formFactor ?? "Large") === "Large";
  for (const app of apps) {
    for (const o of app.profileActionOverrides) {
      if (o.content && o.profile && large(o)) add(out.profiles, o.content, profileName(o.profile));
    }
    for (const o of app.actionOverrides) {
      if (o.content && large(o)) add(out.appDefaults, o.content, app.label);
    }
  }
  return out;
}

/** Apps read one at a time over Tooling, this many in flight (the shared limiter caps the rest). */
const APP_READS_IN_FLIGHT = 8;
/** An app read this soon after its last change might predate a same-second save; read it again next time. */
const APP_SETTLE_MS = 2500;

interface CachedApp {
  /** The `LastModifiedDate` the read was validated against. */
  modified: string;
  readAt: number;
  app: AppOverrides;
}
const appCache = new Map<string, Map<string, CachedApp>>();
const appLoads = new Map<string, Promise<AppOverrides[] | null>>();

async function loadAppsViaTooling(org: string): Promise<AppOverrides[] | null> {
  try {
    const list = await query(
      "SELECT Id, DeveloperName, NamespacePrefix, Label, ManageableState, LastModifiedDate FROM CustomApplication",
      org,
      true
    );
    const rows = list.filter((r) => r.ManageableState !== "installed");
    const cache = appCache.get(org) ?? new Map<string, CachedApp>();
    appCache.set(org, cache);
    const live = new Set(rows.map((r) => String(r.Id)));
    for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);
    const apps: (AppOverrides | null)[] = new Array(rows.length).fill(null);
    const stale: number[] = [];
    rows.forEach((r, i) => {
      const hit = cache.get(String(r.Id));
      const modified = String(r.LastModifiedDate ?? "");
      if (hit && modified && hit.modified === modified && hit.readAt > Date.parse(modified) + APP_SETTLE_MS) apps[i] = hit.app;
      else stale.push(i);
    });
    let next = 0;
    const worker = async () => {
      for (let n = next++; n < stale.length; n = next++) {
        const i = stale[n];
        const id = String(rows[i].Id);
        assertId(id);
        const readAt = Date.now();
        const [row] = await query(`SELECT Label, DeveloperName, NamespacePrefix, Metadata FROM CustomApplication WHERE Id = '${id}'`, org, true);
        const m = row?.Metadata as Row | null | undefined;
        if (!m) throw new Error(`No metadata for app ${id}`);
        const rowsOf = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
        const str = (v: unknown) => (typeof v === "string" ? v : undefined);
        const dev = String(row.DeveloperName ?? "");
        const ns = typeof row.NamespacePrefix === "string" && row.NamespacePrefix ? row.NamespacePrefix : "";
        const app: AppOverrides = {
          fullName: ns ? `${ns}__${dev}` : dev,
          label: str(m.label) || dev,
          profileActionOverrides: rowsOf(m.profileActionOverrides).map((o) => ({ content: str(o.content), profile: str(o.profile), formFactor: str(o.formFactor) })),
          actionOverrides: rowsOf(m.actionOverrides).map((o) => ({ content: str(o.content), formFactor: str(o.formFactor) })),
        };
        apps[i] = app;
        cache.set(id, { modified: String(rows[i].LastModifiedDate ?? ""), readAt, app });
      }
    };
    await Promise.all(Array.from({ length: Math.min(APP_READS_IN_FLIGHT, stale.length) }, worker));
    return apps as AppOverrides[];
  } catch {
    return null;
  }
}

/**
 * Every app's overrides over the Tooling API: the app list with each app's last-modified time (one query), then
 * the Metadata of the apps that are new or changed since they were last read. Tooling serves an app's Metadata
 * one row at a time, but a read is ~0.1-0.3 s where a wildcard Metadata API retrieve takes ~1 s per app (two
 * minutes for a hundred apps). Apps installed from a package are left out, as a wildcard retrieve leaves them
 * out. Null when any read fails, so the caller can fall back. Reads in flight are shared.
 */
export function appOverridesViaTooling(org: string): Promise<AppOverrides[] | null> {
  const running = appLoads.get(org);
  if (running) return running;
  const load = loadAppsViaTooling(org).finally(() => appLoads.delete(org));
  appLoads.set(org, load);
  return load;
}

/** The same, from a wildcard Metadata API retrieve of every app (slow: kept as the fallback and as the reference the Tooling read is checked against). */
export async function appOverridesViaRetrieve(org: string): Promise<AppOverrides[] | null> {
  const result = await retrieveMetadata("", "CustomApplication", org);
  if (!result.success || !result.data) return null;
  const { outputDir } = result.data;
  try {
    return appFiles(outputDir).map((file) => {
      const root = parseXml(fs.readFileSync(file, "utf-8"));
      const fullName = path.basename(file).replace(/\.app-meta\.xml$/, "");
      return {
        fullName,
        label: childText(root, "label") || fullName,
        profileActionOverrides: childrenNamed(root, "profileActionOverrides").map((o) => ({
          content: childText(o, "content"),
          profile: childText(o, "profile"),
          formFactor: childText(o, "formFactor"),
        })),
        actionOverrides: childrenNamed(root, "actionOverrides").map((o) => ({ content: childText(o, "content"), formFactor: childText(o, "formFactor") })),
      };
    });
  } catch {
    return null;
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

/**
 * Names of the apps with any override (any profile, any screen) for the Lightning page: the only apps a copy of
 * the page can be pointed from. Null when the apps couldn't be read over Tooling (the caller reads them all).
 */
export async function appsReferencingPage(page: string, org: string): Promise<string[] | null> {
  const apps = await appOverridesViaTooling(org);
  if (!apps) return null;
  return apps.filter((a) => a.profileActionOverrides.some((o) => o.content === page) || a.actionOverrides.some((o) => o.content === page)).map((a) => a.fullName);
}

/** Every app's Lightning page assignments (profile overrides and app defaults) on large form factors. */
async function pageAssignments(org: string): Promise<PageAssignments | null> {
  const hit = assignmentsCache.get(org);
  if (hit && Date.now() - hit.at < ASSIGNMENTS_TTL_MS) return hit.value;
  const value = (async (): Promise<PageAssignments | null> => {
    const apps = (await appOverridesViaTooling(org)) ?? (await appOverridesViaRetrieve(org));
    return apps ? assignmentsOf(apps) : null;
  })();
  const entry: { at: number; value: Promise<PageAssignments | null>; settled?: PageAssignments } = { at: Date.now(), value };
  assignmentsCache.set(org, entry);
  value.then((v) => {
    if (v) entry.settled = v;
    else if (assignmentsCache.get(org)?.value === value) assignmentsCache.delete(org);
  });
  return value;
}

/** Page assignments from the given apps as sorted arrays, for checking one source against the other. */
export function pageAssignmentsOf(apps: AppOverrides[]): { profiles: [string, string[]][]; appDefaults: [string, string[]][] } {
  const all = assignmentsOf(apps);
  const flat = (m: Map<string, Set<string>>) => [...m].map(([k, v]): [string, string[]] => [k, [...v].sort()]).sort((a, b) => a[0].localeCompare(b[0]));
  return { profiles: flat(all.profiles), appDefaults: flat(all.appDefaults) };
}

function appFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? appFiles(full) : e.name.endsWith(".app-meta.xml") ? [full] : [];
  });
}

/** Who gets a Lightning page: the profiles it's assigned to and the apps it's the default of; null when the apps couldn't be read. */
export async function flexiPageReach(fullName: string, org: string): Promise<{ profiles: string[]; appDefaults: string[] } | null> {
  try {
    const all = await pageAssignments(org);
    if (!all) return null;
    return { profiles: [...(all.profiles.get(fullName) ?? [])].sort(), appDefaults: [...(all.appDefaults.get(fullName) ?? [])].sort() };
  } catch {
    return null;
  }
}

/** A page's reach if every app was read lately (e.g. by the inspector), without reading them now; undefined when not known yet. */
export function knownFlexiPageReach(fullName: string, org: string): { profiles: string[]; appDefaults: string[] } | undefined {
  const hit = assignmentsCache.get(org);
  if (!hit?.settled || Date.now() - hit.at >= ASSIGNMENTS_TTL_MS) return undefined;
  return { profiles: [...(hit.settled.profiles.get(fullName) ?? [])].sort(), appDefaults: [...(hit.settled.appDefaults.get(fullName) ?? [])].sort() };
}

/** True when the page was installed from a managed package and can't be deployed. */
export async function isManagedFlexiPage(fullName: string, org: string): Promise<boolean> {
  const sep = fullName.indexOf("__");
  const [ns, name] = sep > 0 ? [fullName.slice(0, sep), fullName.slice(sep + 2)] : [null, fullName];
  try {
    const rows = await query(
      `SELECT ManageableState FROM FlexiPage WHERE DeveloperName = ${soqlString(name)} AND NamespacePrefix ${ns ? `= ${soqlString(ns)}` : "= null"}`,
      org,
      true
    );
    return rows.some((r) => r.ManageableState === "installed");
  } catch {
    return false;
  }
}

export function liveFlexiPageOf(fullName: string, root: XmlNode): Omit<LiveFlexiPage, "profiles" | "appDefaults" | "managed" | "production"> {
  const templateName = childText(childrenNamed(root, "template")[0] ?? { tag: "template", children: [] }, "name") ?? "";
  return {
    type: "FlexiPage",
    fullName,
    label: childText(root, "masterLabel") ?? fullName,
    pageType: childText(root, "type") ?? "",
    template: templateName.includes(":") ? templateName.split(":")[1] : templateName,
    sobjectType: childText(root, "sobjectType") ?? null,
    regions: regionsOf(root).map((r) => ({
      name: regionName(r),
      facet: childText(r, "type") === "Facet",
      items: itemsOf(r).map((item) => ({
        component: componentOf(item),
        identifier: identifierOf(item),
        properties: Object.fromEntries(Object.entries(propertiesOf(item)).filter(([, v]) => v.length <= 1000)),
        facets: facetsOf(root, item),
      })),
    })),
  };
}

/** How long a page read waits for its reach before answering without it (it keeps loading, shared through the assignments cache). */
const REACH_WAIT_MS = 4000;

export async function readLiveFlexiPage(fullName: string, org: string, reachWaitMs = REACH_WAIT_MS): Promise<LiveFlexiPage> {
  const pending = Symbol("pending");
  const reachRead = flexiPageReach(fullName, org);
  const [structure, reach, managed, production] = await Promise.all([
    withDoc("FlexiPage", fullName, org, async ({ root }) => liveFlexiPageOf(fullName, root)),
    Promise.race([reachRead, new Promise<typeof pending>((r) => setTimeout(() => r(pending), reachWaitMs).unref?.())]),
    isManagedFlexiPage(fullName, org),
    isProductionOrg(org),
  ]);
  if (reach === pending) return { ...structure, profiles: null, appDefaults: null, reachPending: true, managed, production };
  return { ...structure, profiles: reach?.profiles ?? null, appDefaults: reach?.appDefaults ?? null, managed, production };
}

// --- List views ------------------------------------------------------------------------

/** "Account.AllAccounts" → ["Account", "AllAccounts"]; throws on anything else. */
export function splitListViewName(fullName: string): [string, string] {
  const m = /^(\w+)\.(\w+)$/.exec(fullName);
  if (!m) throw new Error(`Invalid list view name: ${fullName}`);
  return [m[1], m[2]];
}

/** A view installed from a managed package carries its namespace ("FSL__All"), which a view of the org's own never does. */
export const isManagedListView = (fullName: string): boolean => /^[A-Za-z][A-Za-z0-9]*__\w+$/.test(splitListViewName(fullName)[1]);

export function liveListViewOf(fullName: string, root: XmlNode): Omit<LiveListView, "available" | "production"> {
  const shared = childrenNamed(root, "sharedTo")[0];
  return {
    type: "ListView",
    fullName,
    label: childText(root, "label") ?? fullName,
    columns: listColumns(root),
    filterScope: listFilterScope(root),
    filters: listFilters(root),
    booleanFilter: listBooleanFilter(root),
    sharedTo: shared ? shared.children.map((c) => ({ kind: c.tag, name: unescapeXml(c.text ?? "") })) : null,
    managed: isManagedListView(fullName),
  };
}

export async function readLiveListView(fullName: string, org: string): Promise<LiveListView> {
  const [object] = splitListViewName(fullName);
  const [doc, available, production] = await Promise.all([
    withDoc("ListView", fullName, org, async ({ root }) => liveListViewOf(fullName, root)),
    cachedDescribeSObject(object, org).then(
      (r) =>
        r.success && r.data
          ? r.data.fields.filter((f) => f.type !== "base64").map((f) => ({ name: f.name, label: f.label, type: f.type, filterable: f.filterable !== false }))
          : [],
      () => []
    ),
    isProductionOrg(org),
  ]);
  return { ...doc, available, production };
}
