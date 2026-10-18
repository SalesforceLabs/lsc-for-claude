/**
 * The live page layout behind a block in the iPad preview: its sections, fields
 * and related lists as they are in the org now (the preview shows the last
 * publish), which profiles use it, whether the org is production, and the
 * fields and related lists that could be added. The renderer lines the
 * published layout up against it before offering edits.
 */

import { cachedDescribeSObject, type SObjectDescribeResult } from "../../salesforce/cli.js";
import { assertId } from "../change-helpers.js";
import { query, type Row } from "../helpers.js";
import type { LayoutFieldOption, LiveLayout, RelatedListOption } from "../types.js";
import { withDoc } from "./doc.js";
import { childText, childrenNamed } from "./xml.js";

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
