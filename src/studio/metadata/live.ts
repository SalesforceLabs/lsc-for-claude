/**
 * The live page layout behind a block in the iPad preview: its sections, fields
 * and related lists as they are in the org now (the preview shows the last
 * publish), which profiles use it, and whether the org is production. The
 * renderer lines the published layout up against it before offering edits.
 * Compact layouts (the record header) likewise: their fields, the fields that
 * could be added, and the record types assigned them.
 */

import { apiRequest, describeSObject } from "../../salesforce/cli.js";
import { assertId } from "../change-helpers.js";
import { query, type Row } from "../helpers.js";
import type { LiveCompactLayout, LiveLayout } from "../types.js";
import { compactFields } from "./compact-ops.js";
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

export async function readLiveLayout(fullName: string, org: string): Promise<LiveLayout> {
  const [structure, profiles, production] = await Promise.all([
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
  ]);
  return { type: "Layout", fullName, ...structure, profiles, production } as LiveLayout;
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
    describeSObject(object, org).then(
      (r) => (r.success && r.data ? r.data.fields.filter((f) => !NOT_COMPACT.has(f.type)).map((f) => ({ name: f.name, label: f.label, type: f.type })) : []),
      () => []
    ),
    compactLayoutRecordTypes(fullName, org),
    isProductionOrg(org),
  ]);
  return { type: "CompactLayout", fullName, ...doc, available, recordTypes, production };
}
