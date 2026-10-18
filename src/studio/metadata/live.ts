/**
 * The live page layout behind a block in the iPad preview: its sections, fields
 * and related lists as they are in the org now (the preview shows the last
 * publish), which profiles use it, and whether the org is production. The
 * renderer lines the published layout up against it before offering edits.
 */

import { assertId } from "../change-helpers.js";
import { query, type Row } from "../helpers.js";
import type { LiveLayout } from "../types.js";
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
