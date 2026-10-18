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
import type { LayoutFieldOption, LiveCompactLayout, LiveFlexiPage, LiveLayout, RelatedListOption } from "../types.js";
import { compactFields } from "./compact-ops.js";
import { withDoc } from "./doc.js";
import { componentOf, facetsOf, identifierOf, itemsOf, propertiesOf, regionName, regionsOf } from "./flexipage-ops.js";
import { childText, childrenNamed, parseXml, type XmlNode } from "./xml.js";

const soqlString = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export async function isProductionOrg(org: string): Promise<boolean> {
  try {
    const [rec] = await query("SELECT IsSandbox FROM Organization LIMIT 1", org);
    return rec?.IsSandbox === false;
  } catch {
    return false;
  }
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

/** Child objects that are never a layout's related list. */
const NOT_RELATED_LIST = /(Share|Feed|History|ChangeEvent|__hd|__e)$/;

/**
 * The object's child relationships not already on the layout, by the name the
 * layout XML uses: custom children and custom lookups are Child.Field, the rest
 * their relationship name. Custom objects first, then by object.
 */
export function relatedListOptions(described: SObjectDescribeResult, onLayout: string[]): (RelatedListOption & { relationshipName: string })[] {
  const placed = new Set(onLayout);
  const seen = new Set<string>();
  return (described.childRelationships ?? [])
    .flatMap((c) => {
      if (!c.relationshipName || c.deprecatedAndHidden || NOT_RELATED_LIST.test(c.childSObject)) return [];
      const dotted = `${c.childSObject}.${c.field}`;
      const relatedList = c.childSObject.endsWith("__c") || c.field.endsWith("__c") ? dotted : c.relationshipName;
      if (placed.has(relatedList) || placed.has(dotted) || placed.has(c.relationshipName) || seen.has(relatedList)) return [];
      seen.add(relatedList);
      return [{ relatedList, object: c.childSObject, relationshipName: c.relationshipName }];
    })
    .sort((a, b) => Number(b.object.endsWith("__c")) - Number(a.object.endsWith("__c")) || a.object.localeCompare(b.object) || a.relatedList.localeCompare(b.relatedList));
}

export async function readLiveLayout(fullName: string, org: string): Promise<LiveLayout> {
  const [structure, profiles, production, described] = await Promise.all([
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
    availableRelated: desc ? relatedListOptions(desc, structure.relatedLists).map(({ relatedList, object }) => ({ relatedList, object })) : null,
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
const profileName = (metadataName: string) => STANDARD_PROFILES[metadataName] ?? decodeURIComponent(metadataName);

interface PageAssignments {
  /** Page name → profiles it's assigned to in some app. */
  profiles: Map<string, Set<string>>;
  /** Page name → apps whose default page it is. */
  appDefaults: Map<string, Set<string>>;
}

const ASSIGNMENTS_TTL_MS = 5 * 60_000;
const assignmentsCache = new Map<string, { at: number; value: Promise<PageAssignments | null> }>();

/** Every app's Lightning page assignments (profile overrides and app defaults) on large form factors. */
async function pageAssignments(org: string): Promise<PageAssignments | null> {
  const hit = assignmentsCache.get(org);
  if (hit && Date.now() - hit.at < ASSIGNMENTS_TTL_MS) return hit.value;
  const value = (async (): Promise<PageAssignments | null> => {
    const result = await retrieveMetadata("", "CustomApplication", org);
    if (!result.success || !result.data) return null;
    const { outputDir } = result.data;
    try {
      const out: PageAssignments = { profiles: new Map(), appDefaults: new Map() };
      const add = (m: Map<string, Set<string>>, page: string, v: string) => m.set(page, (m.get(page) ?? new Set()).add(v));
      const large = (n: XmlNode) => (childText(n, "formFactor") ?? "Large") === "Large";
      for (const file of appFiles(outputDir)) {
        const root = parseXml(fs.readFileSync(file, "utf-8"));
        const app = childText(root, "label") || path.basename(file).replace(/\.app-meta\.xml$/, "");
        for (const o of childrenNamed(root, "profileActionOverrides")) {
          const page = childText(o, "content");
          const profile = childText(o, "profile");
          if (page && profile && large(o)) add(out.profiles, page, profileName(profile));
        }
        for (const o of childrenNamed(root, "actionOverrides")) {
          const page = childText(o, "content");
          if (page && large(o)) add(out.appDefaults, page, app);
        }
      }
      return out;
    } catch {
      return null;
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  })();
  assignmentsCache.set(org, { at: Date.now(), value });
  return value;
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

export async function readLiveFlexiPage(fullName: string, org: string): Promise<LiveFlexiPage> {
  const [structure, reach, managed, production] = await Promise.all([
    withDoc("FlexiPage", fullName, org, async ({ root }) => liveFlexiPageOf(fullName, root)),
    flexiPageReach(fullName, org),
    isManagedFlexiPage(fullName, org),
    isProductionOrg(org),
  ]);
  return { ...structure, profiles: reach?.profiles ?? null, appDefaults: reach?.appDefaults ?? null, managed, production };
}
