/**
 * Actions & Home Page — what each profile sees on the LSC Mobile home page,
 * record pages, and navigation, plus the web Lightning home pages.
 */

import type { ConfigRecord } from "../../config/types.js";
import type { CustomCollector } from "../collect.js";
import type { StudioFinding, StudioFix, StudioItem } from "../types.js";
import {
  buildSurface,
  configItem,
  item,
  plural,
  profileAudience,
  query,
  scalar,
  settle,
  splitList,
  unwrap,
  type SurfaceMeta,
} from "../helpers.js";
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

export const ORG_URL = /[\w-]+\.(?:lightning\.force\.com|my\.salesforce\.com|my\.site\.com)/i;

/** Quick action Locations grouped onto record surfaces; HomePage gets its own. */
const RECORD_LOCATIONS: { location: string; id: string; title: string }[] = [
  { location: "Visit", id: "visitActions", title: "Visit Actions" },
  { location: "Search", id: "searchActions", title: "Search Actions" },
  { location: "IntelligentContent", id: "contentActions", title: "Intelligent Content Actions" },
  { location: "NextBestCustomer", id: "nbcActions", title: "Next Best Customer Actions" },
];
const OPTIONAL_SURFACES = new Set([
  ...RECORD_LOCATIONS.map((l) => l.id),
  "otherQuickActions",
  "stagePathActions",
]);

/** A record type as an action names it: its object and whether it's active. */
export interface KnownRecordType {
  name: string;
  sobject: string;
  active: boolean;
}

/** Names an org knows about (lower-cased → as written), for checking the Profiles / PermissionSets / RecordTypes an action targets. */
export interface Known {
  profiles: Map<string, string>;
  permissionSets: Map<string, string>;
  /** Record types by lower-cased developer name — one entry per object that has a record type of that name. */
  recordTypes: Map<string, KnownRecordType[]>;
}

export async function fetchKnown(org: string): Promise<Known> {
  const [profiles, permissionSets, recordTypes] = await Promise.all([
    query(`SELECT Name FROM Profile`, org),
    query(`SELECT Name, NamespacePrefix FROM PermissionSet WHERE IsOwnedByProfile = false`, org),
    query(`SELECT DeveloperName, SobjectType, IsActive FROM RecordType`, org),
  ]);
  const index = (names: unknown[]) =>
    new Map(
      names.filter(Boolean).map((n) => [String(n).toLowerCase(), String(n)] as [string, string])
    );
  const types = new Map<string, KnownRecordType[]>();
  for (const r of recordTypes.filter((r) => r.DeveloperName)) {
    const key = String(r.DeveloperName).toLowerCase();
    types.set(key, [
      ...(types.get(key) ?? []),
      {
        name: String(r.DeveloperName),
        sobject: String(r.SobjectType ?? ""),
        active: r.IsActive !== false,
      },
    ]);
  }
  return {
    profiles: index(profiles.map((r) => r.Name)),
    permissionSets: index(
      permissionSets.flatMap((r) => [
        r.Name,
        r.NamespacePrefix ? `${r.NamespacePrefix}__${r.Name}` : null,
      ])
    ),
    recordTypes: types,
  };
}

/** The object an action's record types belong to: a quick action's SObject, or a custom action's EntityName on SObject actions. */
function actionObject(r: ConfigRecord): string {
  if (r.fields.SObject) return String(r.fields.SObject);
  return r.fields.EntityType === "SObject" && r.fields.EntityName
    ? String(r.fields.EntityName)
    : "";
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

/**
 * Why `name` in an action's `key` list matches nothing usable (title and detail), or null when it's fine,
 * plus the names it could have meant. Record types count only on the action's object, and only when active.
 */
function unknownName(
  r: ConfigRecord,
  key: keyof Known,
  kind: string,
  name: string,
  known: Known
): { title: string; detail: string; candidates: string[] } | null {
  const missing = {
    title: `${kind} "${name}" not found`,
    detail: `No ${kind.toLowerCase()} with this name exists in the org, so the action won't show for it.`,
  };
  if (key !== "recordTypes")
    return known[key].has(name.toLowerCase())
      ? null
      : { ...missing, candidates: [...known[key].values()] };
  const object = actionObject(r);
  const onObject = (t: KnownRecordType) =>
    !object || t.sobject.toLowerCase() === object.toLowerCase();
  const all = known.recordTypes.get(name.toLowerCase()) ?? [];
  const mine = all.filter(onObject);
  if (mine.some((t) => t.active)) return null;
  const candidates = [...known.recordTypes.values()]
    .flat()
    .filter((t) => t.active && onObject(t))
    .map((t) => t.name);
  if (!all.length) return { ...missing, candidates };
  if (!mine.length) {
    const objects = [...new Set(all.map((t) => t.sobject))].join(", ");
    return {
      title: `Record type "${name}" isn't on ${object}`,
      detail: `"${name}" is a record type of ${objects}, not of ${object}, so the action won't show for it.`,
      candidates,
    };
  }
  return {
    title: `Record type "${name}" is inactive`,
    detail: `The ${object ? `${object} ` : ""}record type "${name}" is inactive, so the action won't show for it.`,
    candidates,
  };
}

/** Rewrite one entry of a "A;B;C" config list, keeping its separator. */
function rewriteList(raw: string, from: string, to: string | null): string {
  const sep = raw.includes(";") ? ";" : ",";
  return splitList(raw)
    .flatMap((v) => (v === from ? (to ? [to] : []) : [v]))
    .join(sep);
}

export function actionFindings(r: ConfigRecord, known: Known | null): StudioFinding[] {
  const findings: StudioFinding[] = [];
  const url = Object.values(r.fields)
    .map((v) => (typeof v === "string" ? ORG_URL.exec(v)?.[0] : undefined))
    .find(Boolean);
  if (url) {
    findings.push({
      severity: "info",
      title: "Hardcoded org URL",
      detail: `References ${url}. It works in this org, but after a sandbox refresh or a migration to another org it still points here.`,
    });
  }
  if (known) {
    for (const { field, kind, key } of FIELD_KINDS) {
      const raw = r.fields[field];
      const values = splitList(raw);
      for (const name of values) {
        const problem = unknownName(r, key, kind, name, known);
        if (!problem) continue;
        const setTo = (to: string, fixLabel: string): StudioFix => ({
          kind: "setConfigField",
          label: fixLabel,
          category: r.category,
          developerName: r.developerName,
          recordLabel: r.label || r.developerName,
          field,
          from: String(raw),
          to,
        });
        const suggestion = closestName(
          name,
          new Set(problem.candidates.filter((c) => c.toLowerCase() !== name.toLowerCase()))
        );
        const fixes: StudioFix[] = [];
        if (suggestion)
          fixes.push(
            setTo(rewriteList(String(raw), name, suggestion), `Replace with "${suggestion}"`)
          );
        // Removing the last entry would empty the list, which can widen who sees the action.
        if (values.length > 1)
          fixes.push(setTo(rewriteList(String(raw), name, null), `Remove "${name}"`));
        findings.push({
          severity: "warning",
          title: problem.title,
          detail: `${problem.detail}${suggestion ? ` Did you mean "${suggestion}"?` : ""}`,
          fixes: fixes.length ? fixes : undefined,
        });
      }
    }
  }
  return findings;
}

export function actionItem(r: ConfigRecord, known: Known | null): StudioItem {
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

/** Whether two actions can show to the same user: either shows to everyone, or they share a profile or permission set. */
function sameAudience(a: ConfigRecord, b: ConfigRecord): boolean {
  const x = actionAudience(a);
  const y = actionAudience(b);
  if (!x || !y) return true;
  const shares = (p: string[], q: string[]) =>
    p.some((n) => q.some((m) => m.toLowerCase() === n.toLowerCase()));
  return shares(x.profiles, y.profiles) || shares(x.permissionSets, y.permissionSets);
}

/** Whether two record actions can show on the same record: either lists no record types, or they share one. */
function sameRecordTypes(a: ConfigRecord, b: ConfigRecord): boolean {
  const x = splitList(a.fields.RecordTypes).map((n) => n.toLowerCase());
  const y = splitList(b.fields.RecordTypes).map((n) => n.toLowerCase());
  return !x.length || !y.length || x.some((n) => y.includes(n));
}

/**
 * Info findings for quick actions that share a SortOrder where a rep sees them together: the same
 * location and object (the home page button holds every HomePage action, whatever its object), for
 * overlapping profiles or permission sets and — on records — overlapping record types.
 */
export function sortCollisions(records: ConfigRecord[]): StudioFinding[] {
  const groups = new Map<string, ConfigRecord[]>();
  for (const r of records.filter(
    (r) => r.isActive && r.fields.SortOrder != null && r.fields.SortOrder !== ""
  )) {
    const home = r.fields.Location === "HomePage";
    const key = home
      ? `HomePage|${r.fields.SortOrder}`
      : `${r.fields.Location}|${r.fields.SObject ?? ""}|${r.fields.SortOrder}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const clashes: ConfigRecord[][] = [];
  for (const group of groups.values()) {
    // Actions that clash with each other, joined into clusters (A–B and B–C is one cluster).
    const cluster = group.map((_, i) => i);
    const root = (i: number): number => (cluster[i] === i ? i : (cluster[i] = root(cluster[i])));
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]];
        if (sameAudience(a, b) && (a.fields.Location === "HomePage" || sameRecordTypes(a, b)))
          cluster[root(j)] = root(i);
      }
    }
    const byRoot = new Map<number, ConfigRecord[]>();
    group.forEach((r, i) => byRoot.set(root(i), [...(byRoot.get(root(i)) ?? []), r]));
    clashes.push(...[...byRoot.values()].filter((c) => c.length > 1));
  }
  return clashes.map((g) => ({
    severity: "info" as const,
    title: `Same sort order: ${g.map((r) => r.label ?? r.developerName).join(", ")}`,
    detail: `All are position ${g[0].fields.SortOrder} and show to the same reps, so their order is unpredictable.`,
  }));
}

/**
 * "No home page actions", suggesting the home page actions of the profile that
 * has the most — an existing setup to copy rather than a made-up default.
 */
export function noHomeActions(
  profile: string,
  activeQuick: ConfigRecord[],
  profileExists: boolean
): StudioFinding {
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
  return {
    ...finding,
    detail: `${finding.detail} ${ref} has ${plural(fixes.length, "home page action")} you can give it too.`,
    fixes,
  };
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
        description:
          "Quick actions (Location = HomePage) and custom actions on the LSC Mobile home page.",
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
        description:
          "What each profile sees — home page actions, record actions, and navigation tabs.",
      },
      async () => {
        const [qa, ui, k] = await Promise.all([quick(), unwrap(uiSchema), unwrap(known)]);
        const active = qa.filter((r) => r.isActive);
        const tabs = ui.filter((r) => isNavTab(r) && r.isActive);
        const names = new Set([...active.flatMap(actionProfiles), ...tabs.flatMap(profilesOf)]);
        const everyone = active.filter((r) => actionProfiles(r).length === 0);
        return {
          items: [...names].sort().map((profile) => {
            const mine = [
              ...everyone,
              ...active.filter((r) => actionProfiles(r).includes(profile)),
            ];
            const home = mine.filter((r) => r.fields.Location === "HomePage");
            const myTabs = tabs.filter((t) => profilesOf(t).includes(profile));
            const findings: StudioFinding[] = [];
            if (k && !k.profiles.has(profile.toLowerCase())) {
              findings.push({
                severity: "warning",
                title: "Profile doesn't exist",
                detail:
                  "Actions target this profile name, but no profile has it — check for a typo or a profile renamed after the actions were configured.",
              });
            }
            if (home.length === 0) {
              findings.push(
                noHomeActions(profile, active, !k || k.profiles.has(profile.toLowerCase()))
              );
            }
            return item(`profile:${profile}`, profile, {
              sublabel: `${home.length} home · ${plural(mine.length - home.length, "record action")} · ${plural(myTabs.length, "tab")}`,
              properties: {
                "Home page actions": home.map((r) => r.label ?? r.developerName).join(", ") || null,
                "Record actions":
                  mine
                    .filter((r) => r.fields.Location !== "HomePage")
                    .map((r) => `${r.label ?? r.developerName} (${r.fields.Location})`)
                    .join(", ") || null,
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
          (r) =>
            r.fields.Location !== "HomePage" &&
            !RECORD_LOCATIONS.some((l) => l.location === r.fields.Location)
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
      async () =>
        (await custom()).filter(
          (r) => r.fields.EntityType !== "HomePage" && r.fields.EntityType !== "StagePath"
        ),
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
              sublabel: r.NamespacePrefix
                ? `${r.DeveloperName} · ${r.NamespacePrefix}`
                : String(r.DeveloperName),
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
