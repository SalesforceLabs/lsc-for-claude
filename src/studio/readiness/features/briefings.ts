/** Briefings (Daily Podcasts) readiness: its validation rules plus a check per step of the content pipeline. */

import {
  REQUIRED_PSLS,
  REQUIRED_SYNC_OBJECTS,
  SCHEDULE_FLOW,
  STALE_DAYS,
  STANDARD_PERMISSION_SETS,
  SUMMARY_FLOW_LABEL,
  TEXT_GEN_FLOW,
  countBy,
  isMissingObject,
  optionalQuery,
  rel,
} from "../../collectors/briefings.js";
import { fetchCache, isLiveCache } from "../../collectors/mobile-sync.js";
import { fetchCategories } from "../../collectors/shared.js";
import { count, inList, plural, query, type Row } from "../../helpers.js";
import { runCheck, type ReadinessModule, type StudioCheckResult } from "../index.js";
import { cacheFreshResult, daysSince, profileSyncResult } from "./_mobile-sync-shared.js";
import { once } from "./_visit-shared.js";

const OFF: StudioCheckResult = { pass: true, skip: true, detail: "Briefings is not turned on in this org." };

const readiness: ReadinessModule = {
  ruleFiles: ["briefings-config.yaml"],
  checks: async (org) => {
    // false = the Briefings objects don't exist, i.e. the toggle is off.
    const enabled = once(() =>
      count(`SELECT COUNT() FROM PresentationContent`, org).then(
        () => true,
        (err) => {
          if (isMissingObject(err)) return false;
          throw err;
        }
      )
    );
    const assignments = once(async () =>
      ((await optionalQuery(`SELECT IsActive, AssignedTo.Name FROM PrstCntntDefAssignment`, org)) ?? []).filter((a) => a.IsActive)
    );
    /** Profiles that receive briefings, from the active content definition assignments. */
    const profiles = async () => [...new Set((await assignments()).map((a) => String(rel(a, "AssignedTo.Name"))))].sort();
    const flows = once(async () => {
      const groups = await Promise.all([
        query(`SELECT Label, ApiName, ActiveVersionId FROM FlowDefinitionView WHERE ApiName LIKE '%Briefing%'`, org),
        query(`SELECT Label, ApiName, ActiveVersionId FROM FlowDefinitionView WHERE Label LIKE '%Briefing%'`, org),
      ]);
      return [...new Map(groups.flat().map((r) => [String(r.ApiName), r] as [string, Row])).values()];
    });
    const dbSchema = once(() => fetchCategories(org, ["DbSchema"]));
    const caches = once(() => fetchCache(org));
    const gate = (fn: () => Promise<StudioCheckResult>) => async () => ((await enabled()) ? fn() : OFF);

    return Promise.all([
      runCheck(
        {
          id: "briefings.access.licenses",
          stage: "access",
          title: "The licenses Briefings runs on are provisioned",
          severity: "error",
          why: "Briefing text is written by Einstein prompt templates, which need the Life Science Commercial, Health Cloud Starter, Agentforce for LSC and Prompt Template licenses. Without them the text flow fails and no briefing is produced.",
          steps: ["Open Setup > Company Information > Permission Set License Assignments", "Ask your Salesforce account team to provision any license listed as missing"],
          uiPath: "Setup > Company Information",
          surface: "licenses",
        },
        gate(async () => {
          const rows = await query(`SELECT MasterLabel, TotalLicenses, UsedLicenses FROM PermissionSetLicense WHERE MasterLabel IN (${inList(REQUIRED_PSLS)})`, org);
          const found = new Map(rows.map((r) => [String(r.MasterLabel), r]));
          const problems = REQUIRED_PSLS.flatMap((label) => {
            const r = found.get(label);
            if (!r) return [`${label}: not in this org`];
            const total = Number(r.TotalLicenses ?? 0);
            if (total === 0) return [`${label}: none provisioned`];
            return Number(r.UsedLicenses ?? 0) >= total ? [`${label}: all ${total} in use`] : [];
          });
          return problems.length
            ? { pass: false, detail: `${plural(problems.length, "license")} missing or exhausted.`, examples: problems }
            : { pass: true, detail: `All ${REQUIRED_PSLS.length} licenses provisioned with seats free.` };
        })
      ),
      runCheck(
        {
          id: "briefings.access.use-briefings-assigned",
          stage: "access",
          title: "Someone has a permission set with Use Briefings",
          severity: "error",
          why: "The Briefings icon only shows for users whose permission set grants Use Briefings (PermissionsStoriesUser). No assignee means no rep can open a briefing, whatever else is configured.",
          steps: ["Open Setup > Permission Sets and find or create a set with Use Briefings", "Assign it to the reps who should get briefings"],
          uiPath: "Setup > Permission Sets",
          surface: "permissionSets",
        },
        gate(async () => {
          const sets = await query(`SELECT Id, Label FROM PermissionSet WHERE PermissionsStoriesUser = true`, org);
          if (!sets.length) return { pass: false, detail: "No permission set grants Use Briefings." };
          const n = await count(`SELECT COUNT() FROM PermissionSetAssignment WHERE PermissionSet.PermissionsStoriesUser = true AND Assignee.IsActive = true`, org);
          return { pass: n > 0, detail: n ? `${plural(n, "active assignment")} of Use Briefings.` : `${plural(sets.length, "permission set")} grant Use Briefings but none is assigned to an active user.` };
        })
      ),
      runCheck(
        {
          id: "briefings.access.profile-users",
          stage: "access",
          title: "Each profile that receives briefings has users with Use Briefings",
          severity: "warning",
          why: "A profile can be assigned content yet have no user with Use Briefings, so briefings are generated for people who can't see the icon.",
          steps: ["Open Setup > Permission Sets", "Assign a set with Use Briefings to the users of each profile listed"],
          uiPath: "Setup > Permission Sets",
          surface: "assignments",
        },
        gate(async () => {
          const assigned = await profiles();
          if (!assigned.length) return { pass: true, skip: true, detail: "No profile is assigned a content definition yet." };
          const users = await countBy(
            `SELECT Assignee.Profile.Name pn, COUNT(Id) cnt FROM PermissionSetAssignment WHERE PermissionSet.PermissionsStoriesUser = true AND Assignee.IsActive = true GROUP BY Assignee.Profile.Name`,
            "pn",
            org
          );
          const none = assigned.filter((p) => !users.get(p));
          return none.length
            ? { pass: false, detail: `${plural(none.length, "profile")} receiving briefings with no Use Briefings user: ${none.join(", ")}.`, examples: none }
            : { pass: true, detail: `All ${plural(assigned.length, "profile")} receiving briefings have Use Briefings users.` };
        })
      ),
      runCheck(
        {
          id: "briefings.access.standard-permission-sets",
          stage: "access",
          title: "The Einstein and Health Cloud permission sets are assigned",
          severity: "warning",
          why: "Generating text needs the prompt template, Health Cloud and Agentforce permission sets assigned to the user the flows run as. Missing assignments show up as flow errors, not as a clear message.",
          steps: ["Open Setup > Permission Sets", "Assign each set listed to the integration or admin user the Briefings flows run as"],
          uiPath: "Setup > Permission Sets",
          surface: "permissionSets",
        },
        gate(async () => {
          const rows = await countBy(
            `SELECT PermissionSet.Name nm, COUNT(Id) cnt FROM PermissionSetAssignment WHERE PermissionSet.Name IN (${inList(STANDARD_PERMISSION_SETS.map((p) => p.name))}) GROUP BY PermissionSet.Name`,
            "nm",
            org
          );
          const missing = STANDARD_PERMISSION_SETS.filter((p) => !rows.get(p.name)).map((p) => p.label);
          return missing.length
            ? { pass: false, detail: `${plural(missing.length, "permission set")} not assigned to anyone: ${missing.join(", ")}.`, examples: missing }
            : { pass: true, detail: "All four standard permission sets are assigned." };
        })
      ),
      runCheck(
        {
          id: "briefings.data.summaries-current",
          stage: "data",
          title: `Account summaries were refreshed in the last ${STALE_DAYS} days`,
          severity: "warning",
          why: "Briefing text is written from the account summaries. If summarization stopped, new briefings repeat old facts or stop appearing.",
          steps: [
            "Open Setup > Flows and check the Account Summarization flow is active and its schedule is running",
            "Open Setup > Paused and Failed Flow Interviews for errors",
          ],
          uiPath: "Setup > Life Sciences for Customer Engagement Setup > Configure Account Summarization",
          surface: "accountSummarization",
        },
        gate(async () => {
          const rows = await optionalQuery(`SELECT MAX(LastModifiedDate) latest, COUNT(Id) cnt FROM PrvdAccountTerritorySummary`, org);
          if (rows === null) return { pass: true, skip: true, detail: "Account Summarization isn't set up in this org." };
          const n = Number(rows[0]?.cnt ?? 0);
          if (!n) return { pass: false, detail: "No account summaries exist, so Account Summarization has never run." };
          const age = daysSince(rows[0].latest) ?? 0;
          return { pass: age <= STALE_DAYS, detail: `${n.toLocaleString("en-US")} summary records; the newest was updated ${plural(age, "day")} ago.` };
        })
      ),
      runCheck(
        {
          id: "briefings.data.briefings-current",
          stage: "data",
          title: `New briefings were generated in the last ${STALE_DAYS} days`,
          severity: "warning",
          why: "Daily briefings only help if they are daily. Content older than a few days means the scheduled flow stopped, and reps hear last week's account news.",
          steps: [
            "Open Setup > Flows and confirm a clone of the schedule flow is active with a Daily frequency",
            "Check Setup > Paused and Failed Flow Interviews for the text generation flow",
          ],
          uiPath: "Setup > Flows",
          surface: "generated",
        },
        gate(async () => {
          const rows = await optionalQuery(`SELECT MAX(CreatedDate) latest, COUNT(Id) cnt FROM PresentationContent`, org);
          if (rows === null) return OFF;
          const n = Number(rows[0]?.cnt ?? 0);
          if (!n) return { pass: false, detail: "No briefings have been generated." };
          const age = daysSince(rows[0].latest) ?? 0;
          return { pass: age <= STALE_DAYS, detail: `${plural(n, "briefing")} exist; the newest was created ${plural(age, "day")} ago.` };
        })
      ),
      runCheck(
        {
          id: "briefings.data.profiles-have-content",
          stage: "data",
          title: "Each profile that receives briefings has content",
          severity: "info",
          why: "A profile can be assigned and licensed yet receive nothing, for example when its users have no territory accounts to summarize.",
          steps: ["Check the profile's users are in territories with aligned accounts", "Run the scheduled flow once and re-check"],
          uiPath: "Setup > Flows",
          surface: "assignments",
        },
        gate(async () => {
          const assigned = await profiles();
          if (!assigned.length) return { pass: true, skip: true, detail: "No profile is assigned a content definition yet." };
          const rows = await countBy(`SELECT TargetUser.Profile.Name pn, COUNT(Id) cnt FROM PresentationContent GROUP BY TargetUser.Profile.Name`, "pn", org);
          const none = assigned.filter((p) => !rows.get(p));
          return none.length
            ? { pass: false, detail: `${plural(none.length, "profile")} with no briefings yet: ${none.join(", ")}.`, examples: none }
            : { pass: true, detail: `All ${plural(assigned.length, "profile")} have briefings.` };
        })
      ),
      runCheck(
        {
          id: "briefings.config.scheduled-flow",
          stage: "config",
          title: "A daily schedule flow is active",
          severity: "warning",
          why: "Briefings are only generated when a scheduled flow runs. The packaged schedule is a template: clone it, set a Daily frequency, and activate the clone. Without that, nothing runs.",
          steps: [
            "Open Setup > Flows and the 'Briefings: Schedule Daily Briefings of Provider Accounts' flow",
            "Set the start time and frequency to Daily, then Save As New Flow",
            "Activate the new flow",
          ],
          uiPath: "Setup > Flows",
          surface: "flows",
        },
        gate(async () => {
          const rows = (await flows()).filter((f) => f.Label !== SUMMARY_FLOW_LABEL && !TEXT_GEN_FLOW.test(String(f.ApiName)));
          const active = rows.filter((f) => f.ActiveVersionId);
          if (!active.length) return { pass: false, detail: rows.length ? `${plural(rows.length, "schedule flow")} found, none active.` : "No schedule flow found." };
          const template = active.some((f) => SCHEDULE_FLOW.test(String(f.ApiName)));
          return {
            pass: true,
            detail: template
              ? `The template itself is active (${active.map((f) => f.ApiName).join(", ")}); a clone with a Daily frequency is the recommended setup.`
              : `Active: ${active.map((f) => f.ApiName).join(", ")}.`,
          };
        })
      ),
      runCheck(
        {
          id: "briefings.mobile.db-schema-profiles",
          stage: "mobile",
          title: "Briefings objects sync to every profile that receives briefings",
          severity: "error",
          why: "The four Briefings objects must be in DB Schema for each receiving profile. If one is missing for a profile, its reps get no briefing or no definitions, and the Briefings icon stays empty.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on a record for each object listed, assigned to the receiving profiles", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "syncSchema",
        },
        gate(async () => profileSyncResult(await dbSchema(), REQUIRED_SYNC_OBJECTS, await profiles()))
      ),
      runCheck(
        {
          id: "briefings.mobile.cache-published",
          stage: "mobile",
          title: "Receiving profiles have a published metadata cache",
          severity: "warning",
          why: "The iPad only learns about the Briefings objects from the published metadata cache. A profile with none never downloads them.",
          steps: ["Open Admin Console > Mobile > Object Metadata Cache Configuration", "Generate the cache for the profiles listed (or /lsc:generate-metadata-cache)"],
          uiPath: "Admin Console > Mobile > Object Metadata Cache Configuration",
          surface: "metadataCache",
        },
        gate(async () => {
          const assigned = await profiles();
          if (!assigned.length) return { pass: true, skip: true, detail: "No profile is assigned a content definition yet." };
          const live = (await caches()).filter(isLiveCache);
          const none = assigned.filter((p) => !live.some((c) => c.profile === p));
          return none.length
            ? { pass: false, detail: `${plural(none.length, "profile")} without a published cache: ${none.join(", ")}.`, examples: none }
            : { pass: true, detail: `All ${plural(assigned.length, "profile")} have a published cache.` };
        })
      ),
      runCheck(
        {
          id: "briefings.mobile.cache-fresh",
          stage: "mobile",
          title: "The published cache includes the latest DB Schema changes",
          severity: "warning",
          why: "If the Briefings DB Schema records were added or edited after the last publish, the iPad still runs the old schema and the changes don't take effect.",
          steps: ["Regenerate the cache for the profiles listed (Publish to iPad in Studio, or /lsc:generate-metadata-cache)"],
          uiPath: "Admin Console > Mobile > Object Metadata Cache Configuration",
          surface: "metadataCache",
        },
        gate(async () => {
          const schema = await dbSchema();
          const mine = schema.filter((r) => REQUIRED_SYNC_OBJECTS.some((o) => String(r.fields.SObject ?? "").toLowerCase() === o.toLowerCase()));
          return cacheFreshResult(org, await caches(), ["DbSchema"], mine, await profiles(), true);
        })
      ),
    ]);
  },
};

export default readiness;
