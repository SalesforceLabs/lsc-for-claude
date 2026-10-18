/** Territory & Users readiness: the territory model, alignment, field users and their licenses. */

import { fieldProfiles, LSC_PSL } from "../../collectors/territory-users.js";
import { inList, plural, query } from "../../helpers.js";
import type { StudioFix } from "../../types.js";
import { runCheck, type ReadinessModule } from "../index.js";
import {
  countOf,
  dbSchemaCheck,
  failedJobs,
  handlersCheck,
  labels,
  lazy,
  loadDbSchema,
  loadHandlers,
} from "./_activity-plan-shared.js";

/** One-click license fixes are capped; the rest are listed in the detail. */
const MAX_FIXES = 10;

const readiness: ReadinessModule = {
  ruleFiles: ["territory-alignment-config.yaml"],
  checks: async (org) => {
    const handlers = loadHandlers(org);
    const schema = loadDbSchema(org);
    const profiles = lazy(() => fieldProfiles(org));
    const lscPsl = lazy(async () => {
      const rows = await query(
        `SELECT Id, DeveloperName, MasterLabel, TotalLicenses, UsedLicenses, Status FROM PermissionSetLicense WHERE DeveloperName LIKE '%LSC4CE%' OR DeveloperName LIKE '%LifeScienceCommercial%'`,
        org
      );
      return rows.find((r) => LSC_PSL.test(String(r.DeveloperName)));
    });
    /** Active field users, optionally limited by extra SOQL conditions. */
    const fieldUsers = async (extra: string) => {
      const names = await profiles();
      if (names.length === 0) return null;
      return query(
        `SELECT Id, Name FROM User WHERE IsActive = true AND Profile.Name IN (${inList(names)}) ${extra} ORDER BY Name LIMIT 200`,
        org
      );
    };

    return Promise.all([
      handlersCheck(
        {
          id: "territory-users.enabled.trigger-handlers",
          stage: "enabled",
          title: "The territory alignment trigger handlers are switched on",
          severity: "error",
          why: "These handlers copy territory data onto accounts and keep Provider Account Territory Info in step with alignment changes. With them off, accounts drift out of the territories reps see.",
          steps: ["Open Admin Console > Trigger Handlers.", "Switch on each handler listed."],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "territorySettings",
        },
        handlers,
        ["Territory2Handler", "AccountTerritoryFieldsHandler", "PVChangedEventUpdateAccountTerrInfo", "PATIRejectionHandler"]
      ),

      runCheck(
        {
          id: "territory-users.access.field-user-license",
          stage: "access",
          title: "Every field user has the Life Science Commercial license",
          severity: "error",
          why: "Without the Life Science Commercial permission set license, a rep can't be given the LSC permission sets and the iPad app refuses to sync for them.",
          steps: ["Setup > Users: open the user and assign the Life Science Commercial permission set license.", "Then assign the LSC permission sets."],
          uiPath: "Setup > Users > Permission Set License Assignments",
          surface: "fieldUsers",
        },
        async () => {
          const psl = await lscPsl();
          if (!psl) return { pass: true, skip: true, detail: "No Life Science Commercial license in this org." };
          const rows = await fieldUsers(
            `AND Id NOT IN (SELECT AssigneeId FROM PermissionSetLicenseAssign WHERE PermissionSetLicenseId = '${psl.Id}')`
          );
          if (!rows) return { pass: true, skip: true, detail: "No field profiles found (no profile has LSC Mobile app settings)." };
          if (rows.length === 0) return { pass: true, detail: "Every field user is licensed." };
          const fixes: StudioFix[] = rows.slice(0, MAX_FIXES).map((u) => ({
            kind: "assignPsl",
            label: `Assign ${psl.MasterLabel} to ${u.Name}`,
            userId: String(u.Id),
            userName: String(u.Name),
            pslId: String(psl.Id),
            pslLabel: String(psl.MasterLabel),
          }));
          return { pass: false, detail: `${plural(rows.length, "field user")} without it.`, examples: labels(rows), fixes };
        }
      ),

      runCheck(
        {
          id: "territory-users.access.license-capacity",
          stage: "access",
          title: "The Life Science Commercial license has room to spare",
          severity: "warning",
          why: "Once every license is used, new reps can't be provisioned. Running at 90% or more is when onboarding starts to stall.",
          steps: ["Free licenses from deactivated users (remove their assignment), or ask Salesforce for more."],
          uiPath: "Setup > Company Information > Permission Set Licenses",
          surface: "psls",
        },
        async () => {
          const psl = await lscPsl();
          if (!psl) return { pass: true, skip: true, detail: "No Life Science Commercial license in this org." };
          const used = Number(psl.UsedLicenses);
          const total = Number(psl.TotalLicenses);
          if (!total) return { pass: false, detail: `${psl.MasterLabel}: no licenses (${psl.Status}).` };
          const pct = Math.round((used / total) * 100);
          return { pass: pct < 90, detail: `${used} of ${total} used (${pct}%).` };
        }
      ),

      runCheck(
        {
          id: "territory-users.data.field-user-territory",
          stage: "data",
          title: "Every field user sits in a territory of the active model",
          severity: "warning",
          why: "Reps see accounts, plans and samples through their territories. A user in none — or only in a retired model — opens the app to an empty account list.",
          steps: ["Open the territory the user covers and add them under Assigned Users."],
          uiPath: "Setup > Territories > Assigned Users",
          surface: "fieldUsers",
        },
        async () => {
          const rows = await fieldUsers(
            `AND Id NOT IN (SELECT UserId FROM UserTerritory2Association WHERE Territory2.Territory2Model.State = 'Active')`
          );
          if (!rows) return { pass: true, skip: true, detail: "No field profiles found." };
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "field user")} in no active-model territory.`, examples: labels(rows) }
            : { pass: true, detail: "Every field user has a territory." };
        }
      ),

      runCheck(
        {
          id: "territory-users.data.territory-staffed",
          stage: "data",
          title: "Territories with aligned accounts have a user",
          severity: "warning",
          why: "Accounts aligned to a territory nobody is assigned to are visible to no rep — usually a vacancy or a user removed during a reorganisation.",
          steps: ["Assign a user to each territory listed, or realign its accounts."],
          uiPath: "Setup > Territories > Assigned Users",
          surface: "territories",
        },
        async () => {
          const [withAccounts, withUsers] = await Promise.all([
            query(
              `SELECT Territory2Id, Territory2.Name tname, COUNT(Id) cnt FROM ObjectTerritory2Association WHERE SobjectType = 'Account' AND Territory2.Territory2Model.State = 'Active' GROUP BY Territory2Id, Territory2.Name`,
              org
            ),
            query(
              `SELECT Territory2Id FROM UserTerritory2Association WHERE Territory2.Territory2Model.State = 'Active'`,
              org
            ),
          ]);
          const staffed = new Set(withUsers.map((r) => String(r.Territory2Id)));
          const bare = withAccounts.filter((r) => !staffed.has(String(r.Territory2Id)));
          return bare.length
            ? {
                pass: false,
                detail: `${bare.length} of ${withAccounts.length} territories with accounts have no user.`,
                examples: bare.map((r) => `${r.tname} (${plural(Number(r.cnt), "account")})`),
              }
            : { pass: true, detail: `All ${withAccounts.length} territories with accounts have users.` };
        }
      ),

      runCheck(
        {
          id: "territory-users.data.pati-matches-alignment",
          stage: "data",
          title: "Provider territory info matches the account alignment",
          severity: "warning",
          why: "Provider Account Territory Info is what the iPad lists as a rep's accounts. Rows for accounts that are no longer aligned keep showing up; aligned accounts without a row never appear.",
          steps: ["Run the territory alignment jobs (Admin Console > Territory Management Jobs).", "Delete leftover info rows for accounts no longer in the territory."],
          uiPath: "Admin Console > Territory Management Jobs",
          surface: "providerTerritoryInfo",
        },
        async () => {
          const [orphans, missing, aligned] = await Promise.all([
            countOf(
              `SELECT COUNT() FROM ProviderAcctTerritoryInfo WHERE AccountId NOT IN (SELECT ObjectId FROM ObjectTerritory2Association WHERE SobjectType = 'Account')`,
              org
            ),
            countOf(
              `SELECT COUNT() FROM ObjectTerritory2Association WHERE SobjectType = 'Account' AND Territory2.Territory2Model.State = 'Active' AND ObjectId NOT IN (SELECT AccountId FROM ProviderAcctTerritoryInfo)`,
              org
            ),
            countOf(`SELECT COUNT() FROM ObjectTerritory2Association WHERE SobjectType = 'Account'`, org),
          ]);
          if (aligned === 0 && orphans === 0) return { pass: true, skip: true, detail: "No account alignment yet." };
          const parts = [
            orphans ? `${plural(orphans, "account")} with territory info but no alignment` : "",
            missing ? `${plural(missing, "aligned account")} with no territory info` : "",
          ].filter(Boolean);
          return parts.length ? { pass: false, detail: `${parts.join("; ")}.` } : { pass: true, detail: "In step." };
        }
      ),

      runCheck(
        {
          id: "territory-users.config.alignment-jobs",
          stage: "config",
          title: "The territory alignment jobs haven't failed recently",
          severity: "warning",
          why: "The alignment batches (accounts, zip, brick, affiliation) turn rules into assignments. A failed run leaves new accounts and moved rules unaligned.",
          steps: ["Open Admin Console > Territory Management Jobs, re-run the failed job, and check Apex Jobs for the error."],
          uiPath: "Admin Console > Territory Management Jobs",
        },
        async () => {
          const rows = await failedJobs(org, ["%Territor%Align%", "%Align%Territor%", "%ZipToTerritory%", "%BrickToTerritory%", "%Affiliation%Align%"]);
          const label = (r: Record<string, unknown>) =>
            `${(r.ApexClass as { Name?: string } | undefined)?.Name}: ${String(r.ExtendedStatus ?? r.Status).slice(0, 80)}`;
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "failed run")} in the last 14 days.`, examples: rows.map(label) }
            : { pass: true, detail: "No failed runs in the last 14 days." };
        }
      ),

      dbSchemaCheck(
        {
          id: "territory-users.mobile.db-schema",
          stage: "mobile",
          title: "Territory objects sync to the iPad",
          severity: "error",
          why: "The iPad filters accounts by the rep's territories. Without these objects offline, the account list and territory picker are empty.",
          steps: ["Admin Console > Mobile > DB Schema: add or switch on a record for each object listed, for the field profiles.", "Publish to iPad."],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "territorySettings",
        },
        schema,
        ["Territory2", "UserTerritory2Association", "ObjectTerritory2Association", "ProviderAcctTerritoryInfo"]
      ),
    ]);
  },
};

export default readiness;
