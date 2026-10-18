/**
 * Collectors shared by more than one org-wide Studio feature.
 */

import { collectCategoryRecords } from "../../config/collect.js";
import type { ConfigRecord } from "../../config/types.js";
import type { Audience, CreateConfigFix, StudioFinding, StudioFix, StudioSurface } from "../types.js";
import {
  audienceOf,
  buildSurface,
  configEdit,
  configItem,
  inList,
  splitList,
  unwrap,
  type Settled,
  type SurfaceMeta,
} from "../helpers.js";

/** All Admin Console records in the given categories. */
/** `strict` throws when a query fails rather than returning what could be read (see `CollectOptions`). */
export function fetchCategories(org: string, categories: string[], strict = false): Promise<ConfigRecord[]> {
  return collectCategoryRecords(
    org,
    `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category IN (${inList(categories)}) ORDER BY Category`,
    { strict }
  );
}

export function byCategory(records: ConfigRecord[], category: string): ConfigRecord[] {
  return records.filter((r) => r.category === category);
}

export function isNavTab(r: ConfigRecord): boolean {
  return r.category === "UISchema" && r.fields.Type === "TAB";
}

/** Profile names a record is assigned to (Admin Console profile assignments). */
export function profilesOf(r: ConfigRecord): string[] {
  return r.assignments.filter((a) => a.level === "Profile").map((a) => a.name);
}

/** Profiles a quick action targets — its Profiles field, or its Admin Console assignments. */
export function actionProfiles(r: ConfigRecord): string[] {
  const listed = splitList(r.fields.Profiles);
  return listed.length ? listed : profilesOf(r);
}

/** Who sees an action. With no profiles or permission sets listed, it shows to everyone. */
export function actionAudience(r: ConfigRecord): Audience | undefined {
  const profiles = actionProfiles(r);
  const permissionSets = [...new Set([...splitList(r.fields.PermissionSets), ...(audienceOf(r)?.permissionSets ?? [])])];
  return profiles.length || permissionSets.length ? { profiles, permissionSets } : undefined;
}

/** The first position after `tab`'s that no active tab sharing one of its profiles uses. */
function nextFreeOrder(tab: ConfigRecord, tabs: ConfigRecord[]): number {
  const mine = new Set(profilesOf(tab));
  const used = new Set(
    tabs
      .filter((t) => t !== tab && t.isActive && profilesOf(t).some((p) => mine.has(p)))
      .map((t) => Number(t.fields.TabOrder))
  );
  let n = Number(tab.fields.TabOrder) + 1;
  while (used.has(n)) n++;
  return n;
}

/** LSC Mobile navigation tabs (UISchema TAB records), with tab-order collision checks per profile. */
export function navTabsSurface(meta: SurfaceMeta, uiSchema: Settled<ConfigRecord[]>): Promise<StudioSurface> {
  return buildSurface(meta, async () => {
    const tabs = (await unwrap(uiSchema))
      .filter(isNavTab)
      .sort((a, b) => Number(a.fields.TabOrder ?? 0) - Number(b.fields.TabOrder ?? 0));

    // Two active tabs with the same order on one profile render in an arbitrary order.
    const seen = new Map<string, string>();
    const collisions = new Map<string, StudioFinding[]>();
    for (const t of tabs.filter((t) => t.isActive)) {
      for (const profile of profilesOf(t)) {
        const key = `${profile}|${t.fields.TabOrder}`;
        const other = seen.get(key);
        if (other) {
          const list = collisions.get(t.developerName) ?? [];
          const to = nextFreeOrder(t, tabs);
          list.push({
            severity: "warning",
            title: `Same tab order as "${other}"`,
            detail: `Both are position ${t.fields.TabOrder} for ${profile}, so their order on the iPad is unpredictable.`,
            fixes: [
              {
                kind: "setConfigField",
                label: `Move to position ${to}`,
                category: t.category,
                developerName: t.developerName,
                recordLabel: t.label ?? t.developerName,
                field: "TabOrder",
                from: Number(t.fields.TabOrder),
                to,
              },
            ],
          });
          collisions.set(t.developerName, list);
        } else {
          seen.set(key, t.label ?? t.developerName);
        }
      }
    }

    return {
      creates: [newNavTab(await unwrap(uiSchema))],
      items: tabs.map((t) => {
        const it = configItem(t, t.label, `#${t.fields.TabOrder ?? "?"} · ${t.fields.TabName ?? ""}`);
        it.audience = audienceOf(t);
        it.findings.push(...(collisions.get(t.developerName) ?? []));
        if (t.isActive && t.assignments.length === 0 && !t.isOrgLevel) {
          it.findings.push({
            severity: "warning",
            title: "Not assigned to any profile",
            detail: "The tab is active but no profile will see it.",
          });
        }
        return it;
      }),
    };
  });
}

// --- Adding records ------------------------------------------------------------

/** Text → a Salesforce API name fragment ("LS MT Field Sales" → "LS_MT_Field_Sales"). */
export function apiName(text: string): string {
  const name = text
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "X$1");
  return name || "New";
}

/** `base` if no record uses it, else base_2, base_3, … (kept within the 80-character limit). */
export function uniqueName(base: string, records: ConfigRecord[]): string {
  const taken = new Set(records.map((r) => r.developerName.toLowerCase()));
  const trimmed = base.slice(0, 76);
  if (!taken.has(trimmed.toLowerCase())) return trimmed;
  let n = 2;
  while (taken.has(`${trimmed}_${n}`.toLowerCase())) n++;
  return `${trimmed}_${n}`;
}

const nextNumber = (values: unknown[]) => Math.max(0, ...values.map(Number).filter((n) => Number.isFinite(n))) + 1;

/** "+ New quick action" at a location, sorted after the existing ones. */
export function newQuickAction(location: string, quickActions: ConfigRecord[]): CreateConfigFix {
  const here = quickActions.filter((r) => r.fields.Location === location);
  const developerName = uniqueName(`QuickAction_${location}`, quickActions);
  return {
    kind: "createConfigRecord",
    label: `New ${location} quick action`,
    category: "QuickAction",
    developerName,
    // Left for the admin: the form derives the API name from the label they type.
    recordLabel: "",
    fields: [
      { name: "Location", value: location },
      { name: "ActionName", value: "" },
      { name: "SortOrder", value: Math.min(100, nextNumber(here.map((r) => r.fields.SortOrder))) },
      { name: "Profiles", value: "" },
    ],
    profiles: [],
    active: true,
  };
}

/** "+ New custom action" for an entity type (HomePage, SObject, StagePath, Visit). */
export function newCustomAction(entityType: string, customActions: ConfigRecord[]): CreateConfigFix {
  const developerName = uniqueName(`CustomAction_${entityType}`, customActions);
  return {
    kind: "createConfigRecord",
    label: `New ${entityType} custom action`,
    category: "CustomAction",
    developerName,
    // Left for the admin: the form derives the API name from the label they type.
    recordLabel: "",
    fields: [
      { name: "EntityType", value: entityType },
      { name: "ActionType", value: "URL" },
      { name: "ActionTarget", value: "" },
      { name: "Profiles", value: "" },
    ],
    profiles: [],
    active: true,
  };
}

/** "+ New navigation tab" in the first position after every existing tab. */
export function newNavTab(uiSchema: ConfigRecord[]): CreateConfigFix {
  const tabs = uiSchema.filter(isNavTab);
  return {
    kind: "createConfigRecord",
    label: "New navigation tab",
    category: "UISchema",
    developerName: uniqueName("NavTab_New", uiSchema),
    recordLabel: "",
    fields: [
      { name: "Type", value: "TAB" },
      { name: "TabName", value: "" },
      { name: "TabOrder", value: nextNumber(tabs.map((t) => t.fields.TabOrder)) },
    ],
    profiles: [],
    active: true,
  };
}

/** A DB Schema record syncing `object` — the defaults create_db_schema uses, with no filter. */
export function newDbSchema(object: string, dbSchema: ConfigRecord[], profiles: string[]): CreateConfigFix {
  return {
    kind: "createConfigRecord",
    label: object ? `Add ${object} to iPad sync` : "New DB Schema record",
    category: "DbSchema",
    developerName: uniqueName(`DbSchema_${apiName(object || "New")}`, dbSchema),
    recordLabel: `DbSchema ${object}`.trim(),
    fields: [
      { name: "SObject", value: object },
      { name: "Type", value: "DATA" },
      { name: "WhereSoql", value: "" },
      { name: "OneWaySync", value: false },
    ],
    profiles,
    active: true,
  };
}

/** A change adding `profile` to whoever sees `rec`, in whichever place the record keeps its profiles. */
export function addProfileFix(rec: ConfigRecord, profile: string, label: string): StudioFix | null {
  const profiles = configEdit(rec)?.profiles;
  if (!profiles) return null;
  const recordLabel = rec.label || rec.developerName;
  if (profiles.source === "assignments") {
    return {
      kind: "setProfileAssignments",
      label,
      category: rec.category,
      developerName: rec.developerName,
      recordLabel,
      from: profiles.names,
      to: [...profiles.names, profile],
    };
  }
  const raw = profiles.raw;
  // An empty Profiles field means everyone already sees it.
  if (!raw.trim()) return null;
  const sep = raw.includes(",") && !raw.includes(";") ? "," : ";";
  return { kind: "setConfigField", label, category: rec.category, developerName: rec.developerName, recordLabel, field: "Profiles", from: raw, to: `${raw}${sep}${profile}` };
}

/** The profile with the most of `records` assigned — the reference to copy from. */
export function busiestProfile(records: ConfigRecord[], profilesFor: (r: ConfigRecord) => string[], exclude: string): string | null {
  const counts = new Map<string, number>();
  for (const r of records) for (const p of profilesFor(r)) if (p !== exclude) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}
