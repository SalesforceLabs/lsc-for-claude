/**
 * The library "Insert component…" picks from: Lightning page components the
 * iPad renders, by full `namespace:name`, with where they may go and the
 * properties a new one gets. Phase 3 only inserts what Studio can fill in
 * completely — Recent items, the org's inline LWCs (`lscMobileInline_*`,
 * prefilled `mobileHeight` 400) and related lists of synced child objects.
 * Components that need a report, dashboard, list view or other content are
 * listed but greyed out, to be added in Lightning App Builder. Components
 * removed this session are offered by the renderer, which holds their XML.
 */

import { cachedDescribeSObject } from "../salesforce/cli.js";
import { parseJsMeta } from "./component-props.js";
import { query, type Row } from "./helpers.js";
import { separatedWithSpaces } from "./published.js";

export type CatalogPageType = "HomePage" | "RecordPage";

export interface CatalogEntry {
  /** Unique in the catalog: the component, or `component:relatedListApiName` for a related list. */
  key: string;
  /** componentName as App Builder writes it. */
  component: string;
  label: string;
  group: "Standard" | "Inline LWC" | "Related list";
  pages: CatalogPageType[];
  /** The properties a new one gets. */
  properties: { name: string; value: string }[];
  /** False when Studio can't fill in what it needs; `needs` says what. */
  insertable: boolean;
  needs?: string;
  /** A related list's child object. */
  object?: string;
}

export interface ComponentCatalog {
  entries: CatalogEntry[];
  /** Setup page for the greyed-out entries. */
  setupPath: string;
}

/** Inline LWCs open as tall as this unless the page says otherwise (as the iPad does). */
export const DEFAULT_MOBILE_HEIGHT = "400";
const SETUP_PATH = "/lightning/setup/FlexiPageList/home";

/**
 * Fixed entries Studio can't insert yet, with why. Recent items is here because the org rejects it
 * without its list of objects (`entityNames`), which a name/value property can't carry.
 */
const STANDARD: CatalogEntry[] = [
  ...(
    [
      ["flexipage:recentItems", "Recent items", "the objects it lists", ["HomePage", "RecordPage"]],
      ["desktopDashboards:embeddedDashboard", "Dashboard", "a dashboard", ["HomePage", "RecordPage"]],
      ["flexipage:filterListCard", "List view", "a list view", ["HomePage", "RecordPage"]],
      ["flexipage:reportChart", "Report chart", "a report", ["HomePage", "RecordPage"]],
      ["flexipage:richText", "Rich text", "its text", ["HomePage", "RecordPage"]],
      ["tableau:tableauViz", "Tableau", "a Tableau view", ["HomePage", "RecordPage"]],
      ["analytics_embedding:dashboard", "CRM Analytics dashboard", "a CRM Analytics dashboard", ["HomePage", "RecordPage"]],
      ["analytics_embedding:metric", "CRM Analytics metric", "a CRM Analytics metric", ["HomePage", "RecordPage"]],
      ["flowruntime:interview", "Flow", "a flow", ["HomePage", "RecordPage"]],
      ["flexipage:tabset", "Tabs", "its tabs and what's in them", ["RecordPage"]],
    ] as [string, string, string, CatalogPageType[]][]
  ).map(([component, label, needs, pages]): CatalogEntry => ({
    key: component,
    component,
    label,
    group: "Standard",
    pages,
    properties: [],
    insertable: false,
    needs: `Needs ${needs} — add it in Lightning App Builder`,
  })),
];

export interface CatalogInput {
  pageType: CatalogPageType;
  /** The record page's object. */
  sobject: string | null;
  /** The org's inline LWC bundles, as `componentName`s (`lscMobileInline_X`, or `ns:lscMobileInline_X`). */
  lwcs: { component: string; label: string; /** False when the bundle's js-meta.xml has no mobileHeight, which the org then rejects. */ height?: boolean }[];
  /** The object's child relationships. */
  children: { relationshipName: string; childSObject: string }[];
  /** Objects with an active DB Schema record. */
  synced: Set<string>;
}

/** The catalog for one page, pure: standard entries, inline LWCs, then synced related lists (record pages only). */
export function buildCatalog(input: CatalogInput): CatalogEntry[] {
  const { pageType, sobject } = input;
  const standard = STANDARD.filter((e) => e.pages.includes(pageType));
  const lwcs = [...input.lwcs]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(
      (l): CatalogEntry => ({
        key: l.component,
        component: l.component,
        label: l.label,
        group: "Inline LWC",
        pages: ["HomePage", "RecordPage"],
        properties: l.height === false ? [] : [{ name: "mobileHeight", value: DEFAULT_MOBILE_HEIGHT }],
        insertable: true,
      })
    );
  if (pageType !== "RecordPage" || !sobject) return [...standard, ...lwcs];
  const seen = new Set<string>();
  const lists = input.children
    .filter((c) => c.relationshipName && !seen.has(c.relationshipName) && seen.add(c.relationshipName))
    .sort((a, b) => a.relationshipName.localeCompare(b.relationshipName))
    .map((c): CatalogEntry => {
      const activity = ACTIVITY_CHILDREN.has(c.childSObject);
      const synced = !activity && input.synced.has(c.childSObject);
      return {
        key: `force:relatedListSingleContainer:${c.relationshipName}`,
        component: "force:relatedListSingleContainer",
        label: separatedWithSpaces(c.relationshipName.replace(/__r$/, "")),
        group: "Related list",
        pages: ["RecordPage"],
        properties: [
          { name: "parentFieldApiName", value: `${sobject}.Id` },
          { name: "relatedListApiName", value: c.relationshipName },
          { name: "relatedListComponentOverride", value: "NONE" },
          { name: "rowsToDisplay", value: "10" },
          { name: "showActionBar", value: "true" },
        ],
        insertable: synced,
        object: c.childSObject,
        ...(synced ? {} : { needs: activity ? `${c.childSObject} is an activity — the org only takes Open Activities and Activity History as related lists` : `${c.childSObject} doesn't sync to the iPad — add it to iPad sync first` }),
      };
    });
  // Synced lists first: they're the ones that can go in.
  return [...standard, ...lwcs, ...lists.filter((l) => l.insertable), ...lists.filter((l) => !l.insertable)];
}

/** Activity children the org refuses as related lists (it offers OpenActivities / ActivityHistories instead). */
const ACTIVITY_CHILDREN = new Set(["Event", "EventRelation", "Task", "TaskRelation"]);

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Inline LWC bundles in the org, as page `componentName`s. */
async function inlineLwcs(org: string, pageType: CatalogPageType): Promise<CatalogInput["lwcs"]> {
  const rows = await query(
    "SELECT DeveloperName, NamespacePrefix, MasterLabel FROM LightningComponentBundle WHERE DeveloperName LIKE 'lscMobileInline%'",
    org,
    true
  );
  // Which bundles declare mobileHeight for this page; a bundle we can't read (managed) is assumed to.
  const declares = new Map<string, boolean>();
  const metas = await query(
    "SELECT LightningComponentBundle.DeveloperName, LightningComponentBundle.NamespacePrefix, Source FROM LightningComponentResource WHERE FilePath LIKE '%.js-meta.xml' AND LightningComponentBundle.DeveloperName LIKE 'lscMobileInline%'",
    org,
    true
  ).catch(() => [] as Row[]);
  for (const m of metas) {
    const b = (m.LightningComponentBundle ?? {}) as Row;
    const source = str(m.Source);
    if (!source.trim()) continue;
    const ns = str(b.NamespacePrefix);
    declares.set(`${ns}:${str(b.DeveloperName)}`, parseJsMeta(source, pageType === "HomePage" ? "HomePage" : "RecordPage").some((d) => d.name === "mobileHeight"));
  }
  return rows
    .filter((r: Row) => /^lscMobileInline_\w+$/i.test(str(r.DeveloperName)))
    .map((r: Row) => {
      const name = str(r.DeveloperName);
      const ns = str(r.NamespacePrefix);
      const height = declares.get(`${ns}:${name}`);
      return { component: ns ? `${ns}:${name}` : name, label: str(r.MasterLabel) || `LWC · ${name.slice(16)}`, ...(height === false ? { height } : {}) };
    });
}

async function syncedObjects(org: string): Promise<Set<string>> {
  const rows = await query(
    `SELECT ObjectValue, TextValue FROM LifeSciConfigFieldValue
     WHERE FieldName = 'SObject' AND LifeSciConfigRecord.IsActive = true AND LifeSciConfigRecord.LifeSciConfigCategory.Category = 'DbSchema'`,
    org,
    true
  );
  return new Set(rows.map((r) => str(r.ObjectValue) || str(r.TextValue)).filter(Boolean));
}

export async function collectCatalog(pageType: CatalogPageType, sobject: string | null, org: string): Promise<ComponentCatalog> {
  if (sobject !== null && !/^\w+$/.test(sobject)) throw new Error(`Invalid object name: ${sobject}`);
  const record = pageType === "RecordPage" && sobject;
  const [lwcs, synced, described] = await Promise.all([
    inlineLwcs(org, pageType).catch(() => []),
    record ? syncedObjects(org).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    record ? cachedDescribeSObject(sobject, org) : Promise.resolve(null),
  ]);
  const children = (described?.data?.childRelationships ?? []).flatMap((c) =>
    c.relationshipName ? [{ relationshipName: c.relationshipName, childSObject: c.childSObject }] : []
  );
  return { entries: buildCatalog({ pageType, sobject, lwcs, children, synced }), setupPath: SETUP_PATH };
}
