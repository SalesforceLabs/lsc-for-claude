/**
 * Actions & Home Page — what each profile sees on the LSC Mobile home page,
 * record pages, and navigation, plus the web Lightning home pages.
 */

import type { ConfigRecord } from "../../config/types.js";
import type { CustomCollector } from "../collect.js";
import type { StudioFinding, StudioFix, StudioItem } from "../types.js";
import { buildSurface, configItem, item, plural, profileAudience, query, scalar, settle, splitList, unwrap, type SurfaceMeta } from "../helpers.js";
import {
  actionAudience,
  actionProfiles,
  addProfileFix,
  busiestProfile,
  byCategory,
  fetchCategories,
  isNavTab,
  navTabsSurface,
  newCustomAction,
  newQuickAction,
  profilesOf,
} from "./shared.js";

const ORG_URL = /[\w-]+\.(?:lightning\.force\.com|my\.salesforce\.com|my\.site\.com)/i;

/** Quick action Locations grouped onto record surfaces; HomePage gets its own. */
const RECORD_LOCATIONS: { location: string; id: string; title: string }[] = [
  { location: "Visit", id: "visitActions", title: "Visit Actions" },
  { location: "Search", id: "searchActions", title: "Search Actions" },
  { location: "IntelligentContent", id: "contentActions", title: "Intelligent Content Actions" },
  { location: "NextBestCustomer", id: "nbcActions", title: "Next Best Customer Actions" },
];
const OPTIONAL_SURFACES = new Set([...RECORD_LOCATIONS.map((l) => l.id), "otherQuickActions", "stagePathActions"]);

/** Names an org knows about (lower-cased → as written), for checking the Profiles / PermissionSets / RecordTypes an action targets. */
interface Known {
  profiles: Map<string, string>;
  permissionSets: Map<string, string>;
  recordTypes: Map<string, string>;
}

async function fetchKnown(org: string): Promise<Known> {
  const [profiles, permissionSets, recordTypes] = await Promise.all([
    query(`SELECT Name FROM Profile`, org),
    query(`SELECT Name, NamespacePrefix FROM PermissionSet WHERE IsOwnedByProfile = false`, org),
    query(`SELECT DeveloperName, Name, SobjectType FROM RecordType`, org),
  ]);
  const index = (names: unknown[]) =>
    new Map(names.filter(Boolean).map((n) => [String(n).toLowerCase(), String(n)] as [string, string]));
  return {
    profiles: index(profiles.map((r) => r.Name)),
    permissionSets: index(
      permissionSets.flatMap((r) => [r.Name, r.NamespacePrefix ? `${r.NamespacePrefix}__${r.Name}` : null])
    ),
    recordTypes: index(recordTypes.map((r) => r.DeveloperName)),
  };
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** The existing name `missing` most likely meant — only when one candidate clearly wins. */
export function closestName(missing: string, candidates: Iterable<string>): string | null {
  const m = missing.toLowerCase();
  const scored = [...candidates]
    .map((c) => ({ c, edits: editDistance(m, c.toLowerCase()), len: Math.max(m.length, c.length) }))
    .sort((a, b) => a.edits - b.edits);
  const [best, second] = scored;
  if (!best || best.edits / best.len > 0.35) return null;
  // A tie (e.g. "LS XX …" vs "LS MT …" and "LS PH …") is a guess, not a suggestion.
  if (second && second.edits === best.edits) return null;
  return best.c;
}

const FIELD_KINDS: { field: string; kind: string; key: keyof Known }[] = [
  { field: "Profiles", kind: "Profile", key: "profiles" },
  { field: "PermissionSets", kind: "Permission set", key: "permissionSets" },
  { field: "RecordTypes", kind: "Record type", key: "recordTypes" },
];

/** Rewrite one entry of a "A;B;C" config list, keeping its separator. */
function rewriteList(raw: string, from: string, to: string | null): string {
  const sep = raw.includes(";") ? ";" : ",";
  return splitList(raw)
    .flatMap((v) => (v === from ? (to ? [to] : []) : [v]))
    .join(sep);
}

function actionFindings(r: ConfigRecord, known: Known | null): StudioFinding[] {
  const findings: StudioFinding[] = [];
  const url = Object.values(r.fields)
    .map((v) => (typeof v === "string" ? ORG_URL.exec(v)?.[0] : undefined))
    .find(Boolean);
  if (url) {
    findings.push({
      severity: "warning",
      title: "Hardcoded org URL",
      detail: `References ${url}. The action breaks when the config is migrated to another org or the sandbox is refreshed — use a relative path.`,
    });
  }
  if (known) {
    for (const { field, kind, key } of FIELD_KINDS) {
      const raw = r.fields[field];
      const values = splitList(raw);
      for (const name of values.filter((v) => !known[key].has(v.toLowerCase()))) {
        const label = r.label || r.developerName;
        const setTo = (to: string, fixLabel: string): StudioFix => ({
          kind: "setConfigField",
          label: fixLabel,
          category: r.category,
          developerName: r.developerName,
          recordLabel: label,
          field,
          from: String(raw),
          to,
        });
        const suggestion = closestName(name, known[key].values());
        const fixes: StudioFix[] = [];
        if (suggestion) fixes.push(setTo(rewriteList(String(raw), name, suggestion), `Replace with "${suggestion}"`));
        // Removing the last entry would empty the list, which can widen who sees the action.
        if (values.length > 1) fixes.push(setTo(rewriteList(String(raw), name, null), `Remove "${name}"`));
        findings.push({
          severity: "warning",
          title: `${kind} "${name}" not found`,
          detail: `No ${kind.toLowerCase()} with this name exists in the org, so the action won't show for it.${
            suggestion ? ` Did you mean "${suggestion}"?` : ""
          }`,
          fixes: fixes.length ? fixes : undefined,
        });
      }
    }
  }
  return findings;
}

function actionItem(r: ConfigRecord, known: Known | null): StudioItem {
  const isQuick = r.category === "QuickAction";
  const target = isQuick
    ? [r.fields.SObject, actionProfiles(r).join(", ") || "All profiles"]
    : [r.fields.ActionType, r.fields.EntityName || r.fields.EntityType];
  const it = configItem(r, r.label || r.developerName, target.filter(Boolean).join(" · "));
  it.properties["Developer name"] = r.developerName;
  it.properties.Kind = isQuick ? "Quick Action" : "Custom Action";
  it.audience = actionAudience(r);
  it.findings.push(...actionFindings(r, known));
  return it;
}

/** Info findings for quick actions sharing a SortOrder on the same location + object. */
function sortCollisions(records: ConfigRecord[]): StudioFinding[] {
  const groups = new Map<string, ConfigRecord[]>();
  for (const r of records.filter((r) => r.isActive && r.fields.SortOrder != null && r.fields.SortOrder !== "")) {
    const key = `${r.fields.Location}|${r.fields.SObject ?? ""}|${r.fields.SortOrder}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      severity: "info" as const,
      title: `Same sort order: ${g.map((r) => r.label ?? r.developerName).join(", ")}`,
      detail: `All are position ${g[0].fields.SortOrder}, so their order is unpredictable.`,
    }));
}

/**
 * "No home page actions", suggesting the home page actions of the profile that
 * has the most — an existing setup to copy rather than a made-up default.
 */
function noHomeActions(profile: string, activeQuick: ConfigRecord[], profileExists: boolean): StudioFinding {
  const finding: StudioFinding = {
    severity: "info",
    title: "No home page actions",
    detail: "The iPad home page shows no quick actions for this profile.",
  };
  if (!profileExists) return finding;
  const home = activeQuick.filter((r) => r.fields.Location === "HomePage");
  const ref = busiestProfile(home, actionProfiles, profile);
  if (!ref) return finding;
  const fixes = home
    .filter((r) => actionProfiles(r).includes(ref))
    .map((r) => addProfileFix(r, profile, `Show ${r.label ?? r.developerName} to ${profile}`))
    .filter((f): f is StudioFix => f !== null);
  if (!fixes.length) return finding;
  return { ...finding, detail: `${finding.detail} ${ref} has ${plural(fixes.length, "home page action")} you can give it too.`, fixes };
}

export const collectActionsHome: CustomCollector = async (org) => {
  const actions = settle(fetchCategories(org, ["QuickAction", "CustomAction"]));
  const uiSchema = settle(fetchCategories(org, ["UISchema"]));
  // Name checks are best-effort — a failure just skips them.
  const known = settle(fetchKnown(org).catch(() => null));

  const quick = async () => byCategory(await unwrap(actions), "QuickAction");
  const custom = async () => byCategory(await unwrap(actions), "CustomAction");

  /** `creates` — what "+ New" offers on the surface, by quick-action location or custom-action entity type. */
  const actionSurface = (
    meta: SurfaceMeta,
    pick: () => Promise<ConfigRecord[]>,
    creates: { quick?: string; custom?: string } = {}
  ) =>
    buildSurface(meta, async () => {
      const [records, k, qa, ca] = await Promise.all([pick(), unwrap(known), quick(), custom()]);
      return {
        items: records.map((r) => actionItem(r, k)),
        findings: sortCollisions(records),
        creates: [
          ...(creates.quick ? [newQuickAction(creates.quick, qa)] : []),
          ...(creates.custom ? [newCustomAction(creates.custom, ca)] : []),
        ],
      };
    });

  const surfaces = await Promise.all([
    actionSurface(
      {
        id: "homeActions",
        title: "Home Page Actions",
        lane: "home",
        description: "Quick actions (Location = HomePage) and custom actions on the LSC Mobile home page.",
      },
      async () => [
        ...(await quick()).filter((r) => r.fields.Location === "HomePage"),
        ...(await custom()).filter((r) => r.fields.EntityType === "HomePage"),
      ],
      { quick: "HomePage", custom: "HomePage" }
    ),
    buildSurface(
      {
        id: "profileCoverage",
        title: "Profile Coverage",
        lane: "home",
        description: "What each profile sees — home page actions, record actions, and navigation tabs.",
      },
      async () => {
        const [qa, ui, k] = await Promise.all([quick(), unwrap(uiSchema), unwrap(known)]);
        const active = qa.filter((r) => r.isActive);
        const tabs = ui.filter((r) => isNavTab(r) && r.isActive);
        const names = new Set([...active.flatMap(actionProfiles), ...tabs.flatMap(profilesOf)]);
        const everyone = active.filter((r) => actionProfiles(r).length === 0);
        return {
          items: [...names].sort().map((profile) => {
            const mine = [...everyone, ...active.filter((r) => actionProfiles(r).includes(profile))];
            const home = mine.filter((r) => r.fields.Location === "HomePage");
            const myTabs = tabs.filter((t) => profilesOf(t).includes(profile));
            const findings: StudioFinding[] = [];
            if (k && !k.profiles.has(profile.toLowerCase())) {
              findings.push({
                severity: "warning",
                title: "Profile doesn't exist",
                detail: "Actions target this profile name, but no profile has it — check for a typo or a profile renamed after the actions were configured.",
              });
            }
            if (home.length === 0) {
              findings.push(noHomeActions(profile, active, !k || k.profiles.has(profile.toLowerCase())));
            }
            return item(`profile:${profile}`, profile, {
              sublabel: `${home.length} home · ${plural(mine.length - home.length, "record action")} · ${plural(myTabs.length, "tab")}`,
              properties: {
                "Home page actions": home.map((r) => r.label ?? r.developerName).join(", ") || null,
                "Record actions": mine.filter((r) => r.fields.Location !== "HomePage").map((r) => `${r.label ?? r.developerName} (${r.fields.Location})`).join(", ") || null,
                "Navigation tabs": myTabs.map((t) => t.label ?? t.developerName).join(", ") || null,
              },
              audience: profileAudience(profile),
              checkProfile: profile,
              findings,
            });
          }),
        };
      }
    ),
    ...RECORD_LOCATIONS.map(({ location, id, title }) =>
      actionSurface(
        { id, title, lane: "record", description: `Quick actions with Location = ${location}.` },
        async () => (await quick()).filter((r) => r.fields.Location === location),
        { quick: location }
      )
    ),
    actionSurface(
      {
        id: "otherQuickActions",
        title: "Other Quick Actions",
        lane: "record",
        description: "Quick actions at other locations.",
      },
      async () =>
        (await quick()).filter(
          (r) => r.fields.Location !== "HomePage" && !RECORD_LOCATIONS.some((l) => l.location === r.fields.Location)
        ),
      { quick: "Account" }
    ),
    actionSurface(
      {
        id: "recordCustomActions",
        title: "Record Custom Actions",
        lane: "record",
        description: "Custom actions (URL, app, utterance) on record pages.",
      },
      async () => (await custom()).filter((r) => r.fields.EntityType !== "HomePage" && r.fields.EntityType !== "StagePath"),
      { custom: "SObject" }
    ),
    actionSurface(
      {
        id: "stagePathActions",
        title: "Stage Path Actions",
        lane: "record",
        description: "Custom actions attached to stage paths.",
      },
      async () => (await custom()).filter((r) => r.fields.EntityType === "StagePath"),
      { custom: "StagePath" }
    ),
    navTabsSurface(
      {
        id: "navigationTabs",
        title: "Navigation Tabs",
        lane: "navigation",
        description: "LSC Mobile navigation tabs (Admin Console > Mobile > UI Settings).",
      },
      uiSchema
    ),
    buildSurface(
      {
        id: "webHomePages",
        title: "Web Home Pages",
        lane: "web",
        description: "Lightning home pages (FlexiPage, Type = HomePage) used by the LSC web app.",
      },
      async () => {
        const rows = await query(
          `SELECT Id, DeveloperName, MasterLabel, NamespacePrefix, Description, LastModifiedDate FROM FlexiPage WHERE Type = 'HomePage' ORDER BY MasterLabel`,
          org,
          true
        );
        return {
          items: rows.map((r) =>
            item(String(r.Id), String(r.MasterLabel), {
              sublabel: r.NamespacePrefix ? `${r.DeveloperName} · ${r.NamespacePrefix}` : String(r.DeveloperName),
              properties: {
                "Developer name": scalar(r.DeveloperName),
                Namespace: scalar(r.NamespacePrefix),
                Description: scalar(r.Description),
                "Last modified": scalar(r.LastModifiedDate),
              },
            })
          ),
        };
      }
    ),
  ]);

  const actionCount = surfaces
    .filter((s) => s.lane === "home" || s.lane === "record")
    .filter((s) => s.id !== "profileCoverage")
    .reduce((n, s) => n + s.items.length, 0);
  const tabCount = surfaces.find((s) => s.id === "navigationTabs")!.items.length;
  return {
    summary: `${actionCount} actions · ${tabCount} tabs`,
    lanes: [
      { id: "home", title: "iPad home page" },
      { id: "record", title: "Record actions" },
      { id: "navigation", title: "Navigation" },
      { id: "web", title: "Web" },
    ],
    // Hide empty per-location surfaces to keep the canvas focused.
    surfaces: surfaces.filter((s) => !OPTIONAL_SURFACES.has(s.id) || s.items.length > 0 || s.error),
  };
};
