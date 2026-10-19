/**
 * Briefings (Daily Podcasts) — the toggle and licenses, the content pipeline
 * (account summarization and the scheduled flows), who is assigned to receive
 * briefings, the permissions they need, and what syncs to the iPad.
 *
 * Mirrors the checks in `check_briefings_config` (src/tools/briefings.ts) and
 * knowledge/validation-rules/briefings-config.yaml.
 */

import type { ConfigRecord } from "../../config/types.js";
import type { CustomCollector } from "../collect.js";
import type { StudioFinding, StudioFix, StudioItem } from "../types.js";
import {
  audienceOf,
  buildSurface,
  configItem,
  count,
  inList,
  item,
  plural,
  profileAudience,
  query,
  scalar,
  settle,
  unwrap,
  type Row,
} from "../helpers.js";
import { fetchCache, isLiveCache, type CacheRecord } from "./mobile-sync.js";
import { fetchCategories, newDbSchema, profilesOf } from "./shared.js";

/** Licenses Briefings depends on (Field Insights text generation runs on Einstein / Agentforce). */
export const REQUIRED_PSLS = ["Life Science Commercial", "Health Cloud Starter", "Agentforce for LSC Feature Access", "Einstein Prompt Templates"];

/** Standard permission sets that must be assigned to someone. */
export const STANDARD_PERMISSION_SETS = [
  { name: "HealthCloudStarter", label: "Health Cloud Starter" },
  { name: "EinsteinGPTPromptTemplateManager", label: "Prompt Template Manager" },
  { name: "EinsteinGPTPromptTemplateUser", label: "Prompt Template User" },
  { name: "AccsAgtfrceForLifeSciCustEngmt", label: "Access LSC CE Agentforce" },
];

/** The objects that must be in DB Schema for briefings to reach the iPad. */
export const REQUIRED_SYNC_OBJECTS = ["PresentationContent", "PrstCntntUsageSummary", "PrstCntntDefAssignment", "PrstContentDefinition"];

/** Managed flow API names (with and without the `stories__` namespace prefix). */
export const TEXT_GEN_FLOW = /^(stories__)?GenDailyBriefingsText$/;
export const SCHEDULE_FLOW = /^(stories__)?SchdDlyBriefingsOfPrvdAcct$/;
export const SUMMARY_FLOW_LABEL = "Generate Provider Account Territory Summary";

/**
 * The Briefings flow searches, in the order they were asked: ApiName contains "Briefing", Label contains
 * "Briefing", then (optionally) the summary flow by label. FlowDefinitionView is slow on the server (12-24 s
 * per distinct query), so the collector and readiness ask for the same columns, and inside a Studio read scope (withSharedReads) each is read once.
 */
export function briefingFlowGroups(org: string, withSummary = true): Promise<Row[][]> {
  const select = "SELECT Label, ApiName, ActiveVersionId, ProcessType FROM FlowDefinitionView WHERE";
  const asks = [`${select} ApiName LIKE '%Briefing%'`, `${select} Label LIKE '%Briefing%'`];
  if (withSummary) asks.push(`${select} Label = '${SUMMARY_FLOW_LABEL}'`);
  return Promise.all(asks.map((soql) => query(soql, org)));
}

/** Briefings content older than this many days means the scheduled flow has stopped producing it. */
export const STALE_DAYS = 3;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const isMissingObject = (err: unknown) => /is not supported|INVALID_TYPE|does not exist/i.test(String(err instanceof Error ? err.message : err));

/** Briefings objects only exist once the toggle is on; a missing object resolves to null. */
export async function optionalQuery(soql: string, org: string): Promise<Row[] | null> {
  try {
    return await query(soql, org);
  } catch (err) {
    if (isMissingObject(err)) return null;
    throw err;
  }
}

export function rel(r: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v as Row | undefined)?.[k], r);
}

const NOT_ENABLED: StudioFinding = {
  severity: "info",
  title: "Briefings is turned off",
  detail: "The Briefings objects don't exist until the toggle is on (Setup > Life Sciences for Customer Engagement Setup > Configure Briefings).",
};

/** The Briefings DB Schema record syncing `object`, if any. */
export const syncs = (r: ConfigRecord, object: string) =>
  String(r.fields.SObject ?? "").toLowerCase() === object.toLowerCase() ||
  r.developerName.toLowerCase() === `dbschema_${object}`.toLowerCase();

export { fetchCache, isLiveCache, type CacheRecord };

/** Profile → number, from an aggregate query with a text column `key`. */
export async function countBy(soql: string, key: string, org: string): Promise<Map<string, number>> {
  const rows = await query(soql, org);
  return new Map(rows.filter((r) => r[key]).map((r) => [String(r[key]), Number(r.cnt ?? r.expr0 ?? 0)]));
}

export const collectBriefings: CustomCollector = async (org) => {
  // false = the toggle is off; a thrown error means we couldn't tell.
  const enabled = settle(
    count(`SELECT COUNT() FROM PresentationContent`, org).then(
      () => true,
      (err) => {
        if (isMissingObject(err)) return false;
        throw err;
      }
    )
  );
  const psls = settle(
    query(`SELECT Id, DeveloperName, MasterLabel, TotalLicenses, UsedLicenses FROM PermissionSetLicense WHERE MasterLabel IN (${inList(REQUIRED_PSLS)})`, org)
  );
  const definitions = settle(optionalQuery(`SELECT Id, DeveloperName, MasterLabel, IsActive, ContentType FROM PrstContentDefinition ORDER BY MasterLabel`, org));
  const assignments = settle(
    optionalQuery(`SELECT Id, IsActive, AssignedToId, AssignedTo.Name, PrstContentDefinition.MasterLabel FROM PrstCntntDefAssignment ORDER BY AssignedTo.Name`, org)
  );
  const content = settle(
    optionalQuery(`SELECT TargetUser.Profile.Name pn, COUNT(Id) cnt, MAX(CreatedDate) latest FROM PresentationContent GROUP BY TargetUser.Profile.Name`, org)
  );
  // Flows: the managed ones plus anything else with "Briefing" in its name (clones of the schedule).
  const flows = settle(
    briefingFlowGroups(org).then((groups) => {
      const seen = new Map<string, Row>();
      for (const r of groups.flat()) seen.set(String(r.ApiName), r);
      return [...seen.values()];
    })
  );
  const summaries = settle(
    count(`SELECT COUNT() FROM PrvdAccountTerritorySummary`, org).catch((err): number | null => {
      if (isMissingObject(err)) return null;
      throw err;
    })
  );
  const briefingPermSets = settle(
    query(
      `SELECT Id, Label, Name, PermissionsStoriesAdmin, PermissionsStoriesUser FROM PermissionSet WHERE (PermissionsStoriesAdmin = true OR PermissionsStoriesUser = true) AND IsCustom = true ORDER BY Label`,
      org
    )
  );
  const permSetAssignments = settle(
    countBy(
      `SELECT PermissionSet.Label lbl, COUNT(Id) cnt FROM PermissionSetAssignment WHERE PermissionSet.PermissionsStoriesAdmin = true OR PermissionSet.PermissionsStoriesUser = true GROUP BY PermissionSet.Label`,
      "lbl",
      org
    )
  );
  const standardAssignments = settle(
    countBy(
      `SELECT PermissionSet.Name nm, COUNT(Id) cnt FROM PermissionSetAssignment WHERE PermissionSet.Name IN (${inList(STANDARD_PERMISSION_SETS.map((p) => p.name))}) GROUP BY PermissionSet.Name`,
      "nm",
      org
    )
  );
  const readAccess = settle(optionalQuery(`SELECT ParentId FROM ObjectPermissions WHERE SobjectType = 'PresentationContent' AND PermissionsRead = true`, org));
  // Active users per profile holding "Use Briefings" through any permission set.
  const briefingUsers = settle(
    countBy(
      `SELECT Assignee.Profile.Name pn, COUNT(Id) cnt FROM PermissionSetAssignment WHERE PermissionSet.PermissionsStoriesUser = true AND Assignee.IsActive = true GROUP BY Assignee.Profile.Name`,
      "pn",
      org
    )
  );
  const dbSchema = settle(fetchCategories(org, ["DbSchema"]));
  const cache = settle(fetchCache(org));

  /** Profiles that receive briefings, from the active content definition assignments. */
  const assignedProfiles = async () =>
    [...new Set(((await unwrap(assignments)) ?? []).filter((a) => a.IsActive).map((a) => String(rel(a, "AssignedTo.Name"))))].sort();

  const surfaces = await Promise.all([
    buildSurface(
      { id: "toggle", title: "Briefings Toggle", lane: "setup", description: "Configure Briefings must be switched on for the Briefings objects and flows to exist." },
      async () => {
        const on = await unwrap(enabled);
        return {
          items: [
            item("toggle", "Briefings", {
              sublabel: on ? "On" : "Off",
              active: on,
              properties: { Enabled: on, "Checked via": "PresentationContent object" },
              findings: on ? [] : [{ severity: "error", title: "Briefings toggle is off", detail: NOT_ENABLED.detail }],
            }),
          ],
        };
      }
    ),
    buildSurface(
      { id: "licenses", title: "Licenses", lane: "setup", description: "Permission set licenses Briefings and its text generation depend on." },
      async () => {
        const rows = await unwrap(psls);
        const found = new Set(rows.map((r) => String(r.MasterLabel)));
        const items = rows.map((r) => {
          const total = Number(r.TotalLicenses ?? 0);
          const used = Number(r.UsedLicenses ?? 0);
          const findings: StudioFinding[] = [];
          if (total === 0) findings.push({ severity: "error", title: "No licenses provisioned", detail: "Contact your Salesforce account team." });
          else if (used >= total) findings.push({ severity: "warning", title: "No licenses left", detail: `${used} of ${total} in use.` });
          return item(String(r.Id), String(r.MasterLabel), {
            sublabel: `${used} of ${total} used`,
            active: total > 0,
            properties: { "Developer name": scalar(r.DeveloperName), Total: total, Used: used, Available: total - used },
            findings,
          });
        });
        const missing = REQUIRED_PSLS.filter((l) => !found.has(l));
        return {
          items,
          findings: missing.length
            ? [{ severity: "error", title: `${plural(missing.length, "license")} not found`, detail: `Missing: ${missing.join(", ")}. Contact your Salesforce account team.` }]
            : [],
        };
      }
    ),
    buildSurface(
      { id: "accountSummarization", title: "Account Summarization", lane: "pipeline", description: "Summaries of each provider account in each territory — the source Briefings text is generated from." },
      async () => {
        const [flowRows, total, on] = await Promise.all([unwrap(flows), unwrap(summaries), unwrap(enabled)]);
        const flow = flowRows.find((f) => f.Label === SUMMARY_FLOW_LABEL);
        const findings: StudioFinding[] = [];
        const items: StudioItem[] = [];
        if (flow) {
          const active = !!flow.ActiveVersionId;
          items.push(
            item(String(flow.ApiName), String(flow.Label), {
              sublabel: active ? "Active" : "Inactive",
              active,
              properties: { "API name": scalar(flow.ApiName), "Process type": scalar(flow.ProcessType) },
              findings: active ? [] : [{ severity: "error", title: "Flow isn't active", detail: `Activate the '${SUMMARY_FLOW_LABEL}' flow.` }],
            })
          );
        } else if (on) {
          findings.push({
            severity: total ? "info" : "error",
            title: "Account Summarization flow not found",
            detail: `The '${SUMMARY_FLOW_LABEL}' flow wasn't found. Setup > Life Sciences for Customer Engagement Setup > Configure Account Summarization.`,
          });
        }
        if (total !== null) {
          items.push(
            item("summaryRecords", `${total} summary records`, {
              sublabel: "PrvdAccountTerritorySummary",
              properties: { "PrvdAccountTerritorySummary records": total },
              findings:
                total === 0
                  ? [{ severity: "error", title: "No summary records", detail: "Account Summarization hasn't run — no podcast text can be generated. Verify it is configured and the flow has run." }]
                  : [],
            })
          );
        }
        if (items.length === 0 && !on) findings.push(NOT_ENABLED);
        return { items, findings };
      }
    ),
    buildSurface(
      { id: "flows", title: "Briefings Flows", lane: "pipeline", description: "Flows that generate the briefing text and schedule it daily. Clone the schedule template rather than activating it." },
      async () => {
        const [rows, on, generated] = await Promise.all([unwrap(flows), unwrap(enabled), unwrap(content)]);
        const briefingFlows = rows.filter((f) => f.Label !== SUMMARY_FLOW_LABEL);
        const template = briefingFlows.find((f) => SCHEDULE_FLOW.test(String(f.ApiName)));
        const textGen = briefingFlows.find((f) => TEXT_GEN_FLOW.test(String(f.ApiName)));
        const clones = briefingFlows.filter((f) => f !== template && f !== textGen && f.ActiveVersionId);
        const findings: StudioFinding[] = [];
        const flowItem = (f: Row, role: string, extra: StudioFinding[] = []) =>
          item(String(f.ApiName), String(f.Label), {
            sublabel: `${role} · ${f.ActiveVersionId ? "Active" : "Inactive"}`,
            active: !!f.ActiveVersionId,
            properties: { "API name": scalar(f.ApiName), Role: role, "Process type": scalar(f.ProcessType) },
            findings: extra,
          });

        const items: StudioItem[] = [];
        if (textGen) {
          items.push(
            flowItem(
              textGen,
              "Text generation",
              textGen.ActiveVersionId ? [] : [{ severity: "error", title: "Generate Daily Briefings Text flow isn't active", detail: "Activate GenDailyBriefingsText." }]
            )
          );
        } else if (on) {
          findings.push({ severity: "error", title: "Generate Daily Briefings Text flow not found", detail: "Verify the Briefings managed package is installed." });
        }
        if (template) {
          items.push(
            flowItem(
              template,
              "Schedule template",
              template.ActiveVersionId
                ? [{ severity: "warning", title: "Template flow is active", detail: "Best practice is to clone the template, set a Daily frequency, and activate the clone instead." }]
                : []
            )
          );
        } else if (on) {
          findings.push({ severity: "error", title: "Scheduling flow template not found", detail: "SchdDlyBriefingsOfPrvdAcct is missing — verify the managed package installation." });
        }
        for (const f of clones) items.push(flowItem(f, "Active clone"));

        const scheduled = clones.length > 0 || !!template?.ActiveVersionId;
        if (on && !scheduled) {
          const hasContent = (generated ?? []).length > 0;
          findings.push({
            severity: hasContent ? "info" : "warning",
            title: "No active scheduled flow",
            detail: "Clone 'Briefings: Schedule Daily Briefings of Provider Accounts', set a Daily frequency, and activate the clone so briefings are generated.",
          });
        }
        if (items.length === 0 && !on) findings.push(NOT_ENABLED);
        return { items, findings };
      }
    ),
    buildSurface(
      { id: "definitions", title: "Content Definitions", lane: "content", description: "PrstContentDefinition — what a briefing is and the content type it produces." },
      async () => {
        const rows = await unwrap(definitions);
        if (rows === null) return { items: [], findings: [NOT_ENABLED] };
        const findings: StudioFinding[] = [];
        if (!rows.some((r) => r.IsActive)) {
          findings.push({
            severity: "error",
            title: "No active content definition",
            detail: "Create one via Configure Briefings > Manage Assignments — without it no briefings are produced.",
          });
        }
        return {
          items: rows.map((r) =>
            item(String(r.Id), String(r.MasterLabel), {
              sublabel: `${r.ContentType} · ${r.IsActive ? "Active" : "Inactive"}`,
              active: r.IsActive as boolean,
              properties: { "Developer name": scalar(r.DeveloperName), "Content type": scalar(r.ContentType) },
            })
          ),
          findings,
        };
      }
    ),
    buildSurface(
      { id: "assignments", title: "Profile Assignments", lane: "content", description: "PrstCntntDefAssignment — the profiles that receive daily briefings, with their readiness." },
      async () => {
        const [rows, userCounts, generated, caches, schema] = await Promise.all([
          unwrap(assignments),
          unwrap(briefingUsers),
          unwrap(content),
          unwrap(cache),
          unwrap(dbSchema),
        ]);
        if (rows === null) return { items: [], findings: [NOT_ENABLED] };

        const withContent = new Set<string>();
        for (const r of generated ?? []) if (r.pn) withContent.add(String(r.pn));
        const syncing = (profile: string) => REQUIRED_SYNC_OBJECTS.some((o) => schema.some((r) => r.isActive && syncs(r, o) && profilesOf(r).includes(profile)));
        const liveCache = (profile: string) => caches.some((c) => c.profile === profile && isLiveCache(c));
        const orgCache = caches.some((c) => c.profile === null && isLiveCache(c));

        const items = rows.map((a) => {
          const profile = String(rel(a, "AssignedTo.Name"));
          const findings: StudioFinding[] = [];
          if (a.IsActive) {
            if ((userCounts.get(profile) ?? 0) === 0) {
              findings.push({
                severity: "warning",
                title: "No users have Use Briefings",
                detail: `No active ${profile} user has a permission set with 'Use Briefings' — the Briefings icon won't show. Assign one from Territory & Users.`,
              });
            }
            if (!withContent.has(profile)) {
              findings.push({ severity: "info", title: "No briefing content yet", detail: "No PresentationContent has been generated for this profile's users." });
            }
            if (!syncing(profile)) {
              findings.push({ severity: "warning", title: "Briefings objects don't sync to this profile", detail: "None of the Briefings DB Schema records are assigned to this profile." });
            } else if (!liveCache(profile) && !orgCache) {
              findings.push({ severity: "warning", title: "No active metadata cache", detail: "Generate the mobile metadata cache for this profile so the iPad downloads the Briefings schema." });
            }
          }
          return item(String(a.Id), profile, {
            sublabel: `${rel(a, "PrstContentDefinition.MasterLabel") ?? "Content definition"} · ${a.IsActive ? "Active" : "Inactive"}`,
            active: a.IsActive as boolean,
            properties: {
              Profile: profile,
              "Content definition": scalar(rel(a, "PrstContentDefinition.MasterLabel")),
              "Users with Use Briefings": userCounts.get(profile) ?? 0,
            },
            audience: profileAudience(profile),
            checkProfile: profile,
            findings,
          });
        });

        const findings: StudioFinding[] = [];
        if (!rows.some((a) => a.IsActive)) {
          findings.push({
            severity: "error",
            title: "No active content definition assignments",
            detail: "Add the user profiles that should receive briefings in Configure Briefings > Manage Assignments.",
          });
        }
        const assigned = new Set(await assignedProfiles());
        const unassigned = [...userCounts.keys()].filter((p) => !assigned.has(p) && p !== "System Administrator");
        if (unassigned.length && assigned.size) {
          findings.push({
            severity: "info",
            title: `${plural(unassigned.length, "profile")} have Use Briefings but aren't assigned`,
            detail: `${unassigned.join(", ")} — add them in Manage Assignments if they should receive briefings.`,
          });
        }
        return { items, findings };
      }
    ),
    buildSurface(
      { id: "generated", title: "Generated Briefings", lane: "content", description: "PresentationContent — the briefings produced so far, by profile." },
      async () => {
        const [rows, on] = await Promise.all([unwrap(content), unwrap(enabled)]);
        if (rows === null) return { items: [], findings: [NOT_ENABLED] };
        const byProfile = new Map<string, { total: number; latest: string }>();
        let newest = "";
        for (const r of rows) {
          const profile = r.pn ? String(r.pn) : "Unknown profile";
          const latest = String(r.latest ?? "");
          const cur = byProfile.get(profile) ?? { total: 0, latest: "" };
          cur.total += Number(r.cnt ?? 0);
          if (latest > cur.latest) cur.latest = latest;
          byProfile.set(profile, cur);
          if (latest > newest) newest = latest;
        }
        const items = [...byProfile.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([profile, s]) =>
            item(`content:${profile}`, profile, {
              sublabel: plural(s.total, "briefing"),
              properties: { Briefings: s.total, "Latest generated": s.latest },
              audience: profileAudience(profile),
            })
          );
        const findings: StudioFinding[] = [];
        if (rows.length === 0 && on) {
          findings.push({
            severity: "warning",
            title: "No briefings generated yet",
            detail: "Verify an admin has cloned the scheduling flow, set a Daily frequency, and activated it. If just set up, check after the next scheduled run.",
          });
        } else if (newest && Date.now() - Date.parse(newest) > STALE_DAYS * DAY_MS) {
          findings.push({
            severity: "warning",
            title: `No new briefings in ${STALE_DAYS}+ days`,
            detail: `The latest briefing was generated ${newest.slice(0, 10)}. Check the scheduled flow is still active and not failing.`,
          });
        }
        return { items, findings };
      }
    ),
    buildSurface(
      { id: "permissionSets", title: "Permission Sets", lane: "access", description: "Custom permission sets with Manage / Use Briefings, and the standard sets the feature relies on." },
      async () => {
        const [sets, assigned, standardCounts, read] = await Promise.all([
          unwrap(briefingPermSets),
          unwrap(permSetAssignments),
          unwrap(standardAssignments),
          unwrap(readAccess),
        ]);
        const items: StudioItem[] = sets.map((p) => {
          const n = assigned.get(String(p.Label)) ?? 0;
          const grants = [p.PermissionsStoriesAdmin && "Manage Briefings", p.PermissionsStoriesUser && "Use Briefings"].filter(Boolean).join(" + ");
          return item(String(p.Id), String(p.Label), {
            sublabel: `${grants} · ${plural(n, "assignment")}`,
            properties: {
              "API name": scalar(p.Name),
              "Manage Briefings": !!p.PermissionsStoriesAdmin,
              "Use Briefings": !!p.PermissionsStoriesUser,
              Assignments: n,
            },
            findings: n === 0 ? [{ severity: "warning", title: "Not assigned to any user", detail: "Assign this permission set from Territory & Users." }] : [],
          });
        });
        for (const p of STANDARD_PERMISSION_SETS) {
          const n = standardCounts.get(p.name) ?? 0;
          items.push(
            item(`standard:${p.name}`, p.label, {
              sublabel: `Standard · ${plural(n, "assignment")}`,
              properties: { "API name": p.name, Assignments: n },
              findings:
                n === 0
                  ? [{ severity: "warning", title: "No direct assignments", detail: `${p.label} (${p.name}) isn't assigned to anyone directly — fine if a permission set group grants it.` }]
                  : [],
            })
          );
        }
        const findings: StudioFinding[] = [];
        if (!sets.some((p) => p.PermissionsStoriesUser)) {
          findings.push({
            severity: "error",
            title: "No permission set grants Use Briefings",
            detail: "The #1 reason Briefings doesn't show up. Clone 'Life Sciences Field Sales Representative', enable 'Use Briefings', and assign it to end users.",
          });
        }
        if (!sets.some((p) => p.PermissionsStoriesAdmin)) {
          findings.push({
            severity: "warning",
            title: "No permission set grants Manage Briefings",
            detail: "Clone 'Life Sciences Commercial Admin', enable 'Manage Briefings', and assign it to admins.",
          });
        }
        if (read !== null && read.length === 0) {
          findings.push({ severity: "warning", title: "No permission set can read PresentationContent", detail: "The Briefings icon won't appear without read access to the object." });
        }
        return { items, findings };
      }
    ),
    buildSurface(
      { id: "syncSchema", title: "Briefings DB Schema", lane: "mobile", description: "DB Schema records that sync the Briefings objects to the iPad." },
      async () => {
        const records = await unwrap(dbSchema);
        const profiles = await assignedProfiles().catch(() => [] as string[]);
        const items: StudioItem[] = [];
        const missing: string[] = [];
        const creates = [];
        for (const object of REQUIRED_SYNC_OBJECTS) {
          const matches = records.filter((r) => syncs(r, object));
          if (matches.length === 0) {
            missing.push(object);
            continue;
          }
          for (const r of matches) {
            const it = configItem(r, object, [r.fields.Type, r.isActive ? "Active" : "Inactive"].filter(Boolean).join(" · "));
            it.audience = audienceOf(r);
            if (!r.isActive) {
              const fix: StudioFix = {
                kind: "setActive",
                label: `Enable ${r.developerName}`,
                record: { type: "config", category: r.category, developerName: r.developerName, label: r.label || r.developerName },
                from: false,
                to: true,
              };
              it.findings.push({ severity: "warning", title: "Sync is disabled", detail: `${object} doesn't sync to the iPad while this record is inactive.`, fixes: [fix] });
            } else if (r.assignments.length === 0 && !r.isOrgLevel) {
              it.findings.push({ severity: "warning", title: "Not assigned to any profile", detail: "The record is active but nothing syncs from it." });
            }
            items.push(it);
          }
        }
        // Offer to add each missing object, to the profiles that receive briefings.
        const findings: StudioFinding[] = [];
        for (const object of missing) {
          const create = newDbSchema(object, records, profiles);
          creates.push(create);
          findings.push({
            severity: "error",
            title: `${object} isn't in DB Schema`,
            detail: `Briefings can't reach the iPad without it. Admin Console > Mobile > Object Metadata Cache Configuration.`,
            fixes: [create],
          });
        }
        return { items, findings, creates };
      }
    ),
    buildSurface(
      { id: "metadataCache", title: "Metadata Cache", lane: "mobile", description: "The generated schema package the iPad downloads. Regenerate it after any Briefings change, then sync the iPad." },
      async () => {
        const [caches, profiles] = await Promise.all([unwrap(cache), assignedProfiles().catch(() => [] as string[])]);
        // A cache is generated in parts; show the newest live one per profile (rows are newest first).
        const latest = new Map<string, CacheRecord & { parts: number }>();
        for (const c of caches.filter((c) => (c.profile === null || profiles.includes(c.profile)) && isLiveCache(c))) {
          const key = c.profile ?? "";
          const cur = latest.get(key);
          latest.set(key, cur ? { ...cur, parts: cur.parts + 1 } : { ...c, parts: 1 });
        }
        return {
          items: [...latest.values()].map(({ row, profile, parts }) => {
            const message = row.IntegrationErrorMessage || (/error|fail/i.test(String(row.IntegrationStatus ?? "")) ? `Integration status: ${row.IntegrationStatus}` : "");
            return item(String(row.Id), profile ?? "Org level", {
              sublabel: `${row.Status} · ${scalar(row.LastModifiedDate)}`,
              active: true,
              properties: { Status: scalar(row.Status), "Integration status": scalar(row.IntegrationStatus), "Last generated": scalar(row.LastModifiedDate), "Active records": parts, Profile: profile ?? "Org level" },
              audience: profile ? profileAudience(profile) : undefined,
              findings: message ? [{ severity: "error", title: "Cache generation failed", detail: String(message) }] : [],
            });
          }),
        };
      }
    ),
  ]);

  const on = await unwrap(enabled).catch(() => false);
  const assignmentsSurface = surfaces.find((s) => s.id === "assignments")!;
  const active = assignmentsSurface.items.filter((i) => i.active).length;
  return {
    summary: `${on ? "On" : "Off"} · ${plural(active, "assigned profile")}`,
    lanes: [
      { id: "setup", title: "Setup" },
      { id: "pipeline", title: "Content pipeline" },
      { id: "content", title: "Content & assignments" },
      { id: "access", title: "Access" },
      { id: "mobile", title: "iPad sync" },
    ],
    surfaces,
    // What one profile needs to receive briefings on the iPad, in the order an admin would fix it.
    checkTitle: "Briefings readiness",
    checklist: [
      { surface: "assignments", label: "Assigned to receive briefings", missing: "Not one of the {total} assigned profiles" },
      { surface: "generated", label: "Briefings generated", missing: "No briefings generated for this profile yet" },
      { surface: "syncSchema", label: "Briefings DB Schema", missing: "None of the {total} records are assigned to this profile" },
      { surface: "metadataCache", label: "Metadata cache", missing: "No active cache for this profile", publish: true },
      { surface: "permissionSets", label: "Permission sets" },
      { surface: "flows", label: "Content pipeline" },
    ],
  };
};
