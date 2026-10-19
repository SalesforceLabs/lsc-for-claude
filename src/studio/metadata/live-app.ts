/**
 * The Lightning app behind the iPad's tab bar: which app a profile's bar comes from, the tabs it has
 * (in order) and the ones it could take, who sees it, and whether the org is production.
 *
 * The published cache doesn't say which app a profile's bar came from, so it is found by its tabs:
 * the apps the profile can open are read, and the one whose tabs are the bar's is the app. When
 * two fit equally well nothing is guessed and the bar stays explain-only.
 */

import * as fs from "fs";
import * as path from "path";
import { apiRequest, dataPath, retrieveMetadata } from "../../salesforce/cli.js";
import { assertId } from "../change-helpers.js";
import { query } from "../helpers.js";
import type { AppTabOption, LiveApp } from "../types.js";
import { appFixedTabs, appTabs, isInstalledApp } from "./app-ops.js";
import { withDoc } from "./doc.js";
import { isProductionOrg, profileName } from "./live.js";
import { childText, parseXml, type XmlNode } from "./xml.js";

const soqlString = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

interface AppEntry {
  id: string;
  fullName: string;
  label: string;
}

const TTL_MS = 60_000;
const appListCache = new Map<string, { at: number; value: Promise<AppEntry[]> }>();
const tabListCache = new Map<string, { at: number; value: Promise<AppTabOption[]> }>();
const matchCache = new Map<string, { at: number; value: Promise<AppMatch> }>();

export function forgetLiveApps(org?: string): void {
  if (!org) {
    appListCache.clear();
    tabListCache.clear();
    matchCache.clear();
    return;
  }
  appListCache.delete(org);
  tabListCache.delete(org);
  for (const k of [...matchCache.keys()]) if (k.startsWith(`${org}\u0000`)) matchCache.delete(k);
}

function cached<T>(map: Map<string, { at: number; value: Promise<T> }>, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = load();
  map.set(key, { at: Date.now(), value });
  value.catch(() => map.delete(key));
  return value;
}

/** Every Lightning app (AppMenuItem of type TabSet) with the Id access is granted by. */
function allApps(org: string): Promise<AppEntry[]> {
  return cached(appListCache, org, TTL_MS, async () => {
    const rows = await query("SELECT ApplicationId, Name, NamespacePrefix, Label FROM AppMenuItem WHERE Type = 'TabSet'", org);
    return rows.map((r) => {
      const ns = String(r.NamespacePrefix ?? "");
      const name = String(r.Name ?? "");
      return { id: String(r.ApplicationId ?? ""), fullName: ns ? `${ns}__${name}` : name, label: String(r.Label ?? name) };
    });
  });
}

/** The apps a profile can open. */
async function profileApps(profile: string, org: string): Promise<AppEntry[]> {
  const [access, apps] = await Promise.all([
    query(
      `SELECT SetupEntityId FROM SetupEntityAccess WHERE SetupEntityType = 'TabSet' AND ParentId IN (SELECT Id FROM PermissionSet WHERE Profile.Name = ${soqlString(profile)})`,
      org
    ),
    allApps(org),
  ]);
  const ids = new Set(access.map((r) => String(r.SetupEntityId ?? "").slice(0, 15)));
  return apps.filter((a) => ids.has(a.id.slice(0, 15)));
}

function appFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? appFiles(full) : e.name.endsWith(".app-meta.xml") ? [full] : [];
  });
}

/** Every tab (editable and the package's) of each app, by retrieving them together. */
async function tabsOfApps(apps: AppEntry[], org: string): Promise<Map<string, { tabs: string[]; root: XmlNode }>> {
  const out = new Map<string, { tabs: string[]; root: XmlNode }>();
  if (!apps.length) return out;
  const result = await retrieveMetadata("", apps.map((a) => `CustomApplication:${a.fullName}`), org);
  if (!result.success || !result.data) throw new Error(result.error ?? "Couldn't read the apps.");
  const { outputDir } = result.data;
  try {
    for (const file of appFiles(outputDir)) {
      const fullName = path.basename(file).replace(/\.app-meta\.xml$/, "");
      const root = parseXml(fs.readFileSync(file, "utf-8"));
      out.set(fullName, { tabs: [...appFixedTabs(root, fullName), ...appTabs(root, fullName)], root });
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  return out;
}

export type AppMatch = { app: { fullName: string; label: string; installed: boolean } } | { app: null; reason: string };

/**
 * The app a profile's published tab bar comes from. `names` are every tab the publish knew of for the
 * profile — the bar's and the hidden ones — except the UI Settings tabs, which aren't the app's.
 */
export function matchApp(apps: { fullName: string; label: string; tabs: string[] }[], names: string[]): AppMatch {
  const known = new Set(names);
  const scored = apps
    .map((a) => {
      const covered = a.tabs.filter((t) => known.has(t)).length;
      return { a, covered, extra: a.tabs.length - covered };
    })
    .filter((s) => s.covered > 0)
    .sort((x, y) => y.covered - x.covered || x.extra - y.extra);
  if (!scored.length) return { app: null, reason: "None of the apps this profile can open has the tabs the iPad shows, so which app the tab bar comes from isn't known." };
  const [best, next] = scored;
  if (next && next.covered === best.covered && next.extra === best.extra) {
    return { app: null, reason: `${best.a.label} and ${next.a.label} both fit this profile's tabs equally, so which one the tab bar comes from isn't known. Change it in App Manager.` };
  }
  return { app: { fullName: best.a.fullName, label: best.a.label, installed: isInstalledApp(best.a.fullName) } };
}

/** The app a profile's tab bar comes from; null app with the reason when it can't be told. */
export function findProfileApp(profile: string, names: string[], org: string): Promise<AppMatch> {
  const key = `${org}\u0000${profile}\u0000${[...names].sort().join("|")}`;
  return cached(matchCache, key, TTL_MS, async () => {
    const apps = await profileApps(profile, org);
    if (!apps.length) return { app: null, reason: `${profile} can't open any Lightning app.` } satisfies AppMatch;
    const tabs = await tabsOfApps(apps, org);
    return matchApp(
      apps.flatMap((a) => (tabs.has(a.fullName) ? [{ ...a, tabs: tabs.get(a.fullName)!.tabs }] : [])),
      names
    );
  });
}

/** Every tab the org has, from the tab describe: names as apps list them. */
function allTabs(org: string): Promise<AppTabOption[]> {
  return cached(tabListCache, org, 5 * TTL_MS, async () => {
    const r = await apiRequest<{ name: string; label: string; custom?: boolean; sobjectName?: string | null }[]>(await dataPath(org, "/tabs"), "GET", undefined, org);
    if (!r.success || !Array.isArray(r.data)) return [];
    return r.data
      .filter((t) => t.name && t.label)
      .map((t) => ({ name: t.name, label: t.label, kind: t.sobjectName ? ("object" as const) : ("page" as const) }));
  });
}

/** The profiles that can open an app (those with a profile-owned permission set granting it), sorted; null when that couldn't be read. */
export async function appProfiles(fullName: string, org: string): Promise<string[] | null> {
  try {
    const app = (await allApps(org)).find((a) => a.fullName === fullName);
    if (!app) return null;
    assertId(app.id);
    const rows = await query(
      `SELECT Parent.Profile.Name FROM SetupEntityAccess WHERE SetupEntityType = 'TabSet' AND SetupEntityId = '${app.id}' AND Parent.IsOwnedByProfile = true`,
      org
    );
    const names = rows.flatMap((r) => {
      const p = (r.Parent as { Profile?: { Name?: string } } | undefined)?.Profile?.Name;
      return p ? [profileName(p)] : [];
    });
    return [...new Set(names)].sort();
  } catch {
    return null;
  }
}

/** The app's tab bar as it is in the org now (see `LiveApp`); `available` leaves out what the app already has. */
export function liveAppOf(fullName: string, root: XmlNode): Omit<LiveApp, "available" | "production" | "profiles"> {
  return {
    type: "CustomApplication",
    fullName,
    label: childText(root, "label") ?? fullName,
    installed: isInstalledApp(fullName),
    tabs: appTabs(root, fullName),
    fixedTabs: appFixedTabs(root, fullName),
  };
}

export async function readLiveApp(fullName: string, org: string): Promise<LiveApp> {
  const [doc, tabs, profiles, production] = await Promise.all([
    withDoc("CustomApplication", fullName, org, async ({ root }) => liveAppOf(fullName, root)),
    allTabs(org).catch(() => [] as AppTabOption[]),
    appProfiles(fullName, org),
    isProductionOrg(org),
  ]);
  const has = new Set([...doc.tabs, ...doc.fixedTabs]);
  return { ...doc, available: tabs.filter((t) => !has.has(t.name)), profiles, production };
}
