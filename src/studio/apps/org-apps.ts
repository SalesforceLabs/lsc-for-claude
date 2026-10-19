/** The org's LSC apps (`lscMobileInline_*` bundles) and their source. */

import { checkInlineLwc, type LwcFile } from "../screens/inline-lwc.js";
import { loadBundles } from "../lwc/compile.js";
import { query, type Row } from "../helpers.js";
import { parseMeta } from "./lint.js";
import { APP_PREFIX, QUICK_ACTION_PREFIX, type AppFile, type AppInput, type AppTarget, type OrgApp } from "./types.js";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Which kind of app a bundle is, from its meta targets (a prefixed RecordAction-only bundle is a record tab; an unprefixed one is a quick action). */
export function targetOf(targets: string[], name = APP_PREFIX): AppTarget | null {
  const prefixed = name.startsWith(APP_PREFIX);
  if (targets.includes("lightning__HomePage")) return "home";
  if (targets.includes("lightning__AppPage")) return "tab";
  if (targets.includes("lightning__RecordPage")) return "record";
  if (targets.includes("lightning__RecordAction")) return prefixed ? "record" : "action";
  return null;
}

const NAME_RE = new RegExp(`^(${APP_PREFIX}|${QUICK_ACTION_PREFIX})\\w+$`);

/** Objects each app has an LWC quick action on, by bundle name. */
async function quickActionObjects(org: string): Promise<Map<string, string[]>> {
  const rows = await query(
    "SELECT DeveloperName, EntityDefinition.QualifiedApiName FROM QuickActionDefinition WHERE Type = 'LightningWebComponent' AND DeveloperName LIKE 'lscMobile%'",
    org,
    true
  ).catch(() => [] as Row[]);
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const object = str((r.EntityDefinition as Row | undefined)?.QualifiedApiName);
    const action = str(r.DeveloperName);
    if (object && action) out.set(action, [...(out.get(action) ?? []), object]);
  }
  return out;
}

/** The unmanaged `lscMobileInline_*` bundles of the org, newest change first. */
export async function listOrgApps(org: string): Promise<OrgApp[]> {
  const [bundles, metas, actions] = await Promise.all([
    query(
      "SELECT DeveloperName, NamespacePrefix, MasterLabel, Description, LastModifiedDate, LastModifiedBy.Name FROM LightningComponentBundle WHERE DeveloperName LIKE 'lscMobile%'",
      org,
      true
    ),
    query("SELECT LightningComponentBundle.DeveloperName, Source FROM LightningComponentResource WHERE FilePath LIKE '%.js-meta.xml' AND LightningComponentBundle.DeveloperName LIKE 'lscMobile%'", org, true).catch(() => [] as Row[]),
    quickActionObjects(org),
  ]);
  const targets = new Map<string, string[]>();
  for (const m of metas) {
    const name = str((m.LightningComponentBundle as Row | undefined)?.DeveloperName);
    const meta = parseMeta(str(m.Source));
    if (name && meta.ok) targets.set(name, meta.targets);
  }
  return bundles
    .filter((b) => !str(b.NamespacePrefix) && NAME_RE.test(str(b.DeveloperName)))
    .map((b): OrgApp => {
      const name = str(b.DeveloperName);
      const target = targetOf(targets.get(name) ?? [], name);
      const objects = actions.get(name);
      const modifiedBy = str((b.LastModifiedBy as Row | undefined)?.Name);
      return {
        name,
        label: str(b.MasterLabel) || name.replace(/^lscMobile[A-Za-z]+_/, ""),
        target,
        ...(objects?.length ? { objectApiNames: objects } : {}),
        ...(str(b.LastModifiedDate) ? { lastModifiedDate: str(b.LastModifiedDate) } : {}),
        ...(modifiedBy ? { lastModifiedBy: modifiedBy } : {}),
        ...(str(b.Description) ? { description: str(b.Description) } : {}),
      };
    })
    .sort((a, b) => (b.lastModifiedDate ?? "").localeCompare(a.lastModifiedDate ?? ""));
}

/** One app's files: the parent bundle and the `c/` bundles it uses. */
export async function appSource(name: string, org: string): Promise<AppInput> {
  if (!NAME_RE.test(name)) throw new Error(`Not an LSC app name: ${name}`);
  const read: LwcFile[] = [];
  const load = async (bundles: string[]) => {
    const files = await loadBundles(org, bundles);
    read.push(...files);
    return files;
  };
  const check = await checkInlineLwc(name, load);
  if (!check.bundles.includes(name)) throw new Error(`The org has no LSC app named ${name}.`);
  const files: AppFile[] = [...new Map(read.filter((f) => f.path).map((f) => [f.path, { bundle: f.bundle, path: f.path, source: f.source }] as const)).values()];
  const parentMeta = files.find((f) => f.path === `lwc/${name}/${name}.js-meta.xml`);
  const target = targetOf(parentMeta ? parseMeta(parentMeta.source).targets : [], name) ?? "home";
  const objects = (await quickActionObjects(org)).get(name);
  return { name, target, ...((target === "record" || target === "action") && objects?.[0] ? { objectApiName: objects[0] } : {}), files };
}
