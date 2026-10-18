/**
 * The live page layout or Lightning page behind a block in the iPad preview:
 * its sections, fields and related lists (or regions and components) as they
 * are in the org now (the preview shows the last publish), which profiles use
 * it, and whether the org is production. The renderer lines the published
 * version up against it before offering edits.
 */

import * as fs from "fs";
import * as path from "path";
import { retrieveMetadata } from "../../salesforce/cli.js";
import { assertId } from "../change-helpers.js";
import { query, type Row } from "../helpers.js";
import type { LiveFlexiPage, LiveLayout } from "../types.js";
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
