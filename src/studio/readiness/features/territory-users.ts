/** Territory & Users readiness: the territory model, alignment, field users and their licenses. */

import { activeTerritories, fieldProfiles, LSC_PSL } from "../../collectors/territory-users.js";
import { focusTerritoryIds } from "../../profile-focus.js";
import {
  count,
  countGroupedBy,
  inList,
  plural,
  query,
  queryByIds,
  type Row,
} from "../../helpers.js";
import { chunkIds } from "../../../tools/helpers.js";
import type { StudioFix } from "../../types.js";
import { runCheck, type ReadinessModule } from "../index.js";
import {
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
/** Example rows listed in a check's detail. */
const MAX_EXAMPLES = 25;
/*
 * Alignments (ObjectTerritory2Association) and territory info (ProviderAcctTerritoryInfo) run to
 * millions of rows in large orgs, so the data checks never count or anti-join them whole: that scans
 * every row when the org is healthy and times out. They read a fixed number of rows by territory id
 * across the active model and look the other side up by account id, both of which use indexes, and
 * say when what they read is a sample.
 */
const SAMPLE_ROWS = 500;
/** Territories with no user of their own whose alignments are counted (the ones with no user above first). */
const MAX_OWNLESS = 2000;

/** "1 territory" / "3 territories" for nouns `plural` can't spell. */
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/** At most `max` items, taken evenly across the list rather than from its start. */
function spread<T>(items: T[], max: number): T[] {
  if (max <= 0) return [];
  const step = Math.max(1, Math.ceil(items.length / max));
  return items.filter((_, i) => i % step === 0).slice(0, max);
}

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
      return rows.filter((r) => LSC_PSL.test(String(r.DeveloperName)));
    });
    const free = (p: Row) =>
      p.Status === "Active" && Number(p.TotalLicenses) > Number(p.UsedLicenses);
    /** Active field users, optionally limited by extra SOQL conditions: the true total plus a sample. */
    const fieldUsers = async (extra: string) => {
      const names = await profiles();
      if (names.length === 0) return null;
      const where = `IsActive = true AND Profile.Name IN (${inList(names)}) ${extra}`;
      const [total, rows] = await Promise.all([
        count(`SELECT COUNT() FROM User WHERE ${where}`, org),
        query(`SELECT Id, Name FROM User WHERE ${where} ORDER BY Name LIMIT 200`, org),
      ]);
      return { total, rows };
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
        [
          "Territory2Handler",
          "AccountTerritoryFieldsHandler",
          "PVChangedEventUpdateAccountTerrInfo",
          "PATIRejectionHandler",
        ]
      ),

      runCheck(
        {
          id: "territory-users.access.field-user-license",
          stage: "access",
          title: "Every field user has the Life Science Commercial license",
          severity: "error",
          why: "Without the Life Science Commercial permission set license, a rep can't be given the LSC permission sets and the iPad app refuses to sync for them.",
          steps: [
            "Setup > Users: open the user and assign the Life Science Commercial permission set license.",
            "Then assign the LSC permission sets.",
          ],
          uiPath: "Setup > Users > Permission Set License Assignments",
          surface: "fieldUsers",
        },
        async () => {
          const psls = await lscPsl();
          if (!psls.length)
            return {
              pass: true,
              skip: true,
              detail: "No Life Science Commercial license in this org.",
            };
          // Licensed means holding any of the org's LSC licenses.
          const found = await fieldUsers(
            `AND Id NOT IN (SELECT AssigneeId FROM PermissionSetLicenseAssign WHERE PermissionSetLicenseId IN (${inList(psls.map((p) => String(p.Id)))}))`
          );
          if (!found) return { pass: true, skip: true, detail: "No iPad profiles found." };
          const { total, rows } = found;
          if (total === 0) return { pass: true, detail: "Every field user is licensed." };
          // Only one license with seats is an unambiguous fix; with several, which one is the admin's call.
          const open = psls.filter(free);
          const psl = open.length === 1 ? open[0] : undefined;
          if (!psl)
            return {
              pass: false,
              detail: `${plural(total, "field user")} without it.`,
              examples: labels(rows),
            };
          const fixes: StudioFix[] = rows.slice(0, MAX_FIXES).map((u) => ({
            kind: "assignPsl",
            label: `Assign ${psl.MasterLabel} to ${u.Name}`,
            userId: String(u.Id),
            userName: String(u.Name),
            pslId: String(psl.Id),
            pslLabel: String(psl.MasterLabel),
          }));
          return {
            pass: false,
            detail: `${plural(total, "field user")} without it.`,
            examples: labels(rows),
            fixes,
          };
        }
      ),

      runCheck(
        {
          id: "territory-users.access.license-capacity",
          stage: "access",
          title: "The Life Science Commercial license has room to spare",
          severity: "warning",
          why: "Once every license is used, new reps can't be provisioned. Running at 90% or more is when onboarding starts to stall.",
          steps: [
            "Free licenses from deactivated users (remove their assignment), or ask Salesforce for more.",
          ],
          uiPath: "Setup > Company Information > Permission Set Licenses",
          surface: "psls",
        },
        async () => {
          const psls = await lscPsl();
          if (!psls.length)
            return {
              pass: true,
              skip: true,
              detail: "No Life Science Commercial license in this org.",
            };
          const parts = psls.map((psl) => {
            const used = Number(psl.UsedLicenses);
            const total = Number(psl.TotalLicenses);
            const pct = total ? Math.round((used / total) * 100) : 100;
            return {
              ok: total > 0 && pct < 90,
              text: total
                ? `${psl.MasterLabel}: ${used} of ${total} used (${pct}%)`
                : `${psl.MasterLabel}: no licenses (${psl.Status})`,
            };
          });
          // Room on any one LSC license is room to provision.
          return {
            pass: parts.some((p) => p.ok),
            detail: `${parts.map((p) => p.text).join("; ")}.`,
          };
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
          const found = await fieldUsers(
            `AND Id NOT IN (SELECT UserId FROM UserTerritory2Association WHERE Territory2.Territory2Model.State = 'Active')`
          );
          if (!found) return { pass: true, skip: true, detail: "No iPad profiles found." };
          return found.total
            ? {
                pass: false,
                detail: `${plural(found.total, "field user")} in no active-model territory.`,
                examples: labels(found.rows),
              }
            : { pass: true, detail: "Every field user has a territory." };
        }
      ),

      runCheck(
        {
          id: "territory-users.data.territory-staffed",
          stage: "data",
          title: "Territories with aligned accounts have a user",
          severity: "warning",
          why: "Users of a territory, and of the territories above it, can see the accounts aligned to it. Accounts in a territory with no user on it or above it are visible to no one through territories — usually a vacancy or a user removed during a reorganisation.",
          steps: ["Assign a user to each territory listed, or realign its accounts."],
          uiPath: "Setup > Territories > Assigned Users",
          surface: "territories",
        },
        async () => {
          // Users are counted per territory (a few per territory); alignments only for the territories
          // with no user of their own, since a staffed territory passes whatever it holds.
          const { rows: territories } = await activeTerritories(org);
          const ids = territories.map((t) => String(t.Id));
          const users = await countGroupedBy("UserTerritory2Association", "Territory2Id", ids, org);
          const byId = new Map(territories.map((t) => [String(t.Id), t]));
          const nameOf = (id: string) => String(byId.get(id)?.Name ?? id);
          /** The nearest territory above `id` that has a user, if any. */
          const coveredBy = (id: string): string | undefined => {
            const seen = new Set<string>();
            for (
              let up = byId.get(id)?.ParentTerritory2Id;
              up && !seen.has(String(up));
              up = byId.get(String(up))?.ParentTerritory2Id
            ) {
              seen.add(String(up));
              if (users.get(String(up))) return String(up);
            }
            return undefined;
          };
          const ownless = ids.filter((id) => !users.get(id));
          if (!ownless.length)
            return {
              pass: true,
              detail: `Every one of the ${many(ids.length, "territory", "territories")} in the active model has a user of its own.`,
            };
          // The ones with no user above them either are what fails, so they're read first.
          const bareIds = spread(
            ownless.filter((id) => !coveredBy(id)),
            MAX_OWNLESS
          );
          const coveredIds = spread(
            ownless.filter((id) => coveredBy(id)),
            MAX_OWNLESS - bareIds.length
          );
          const checked = bareIds.length + coveredIds.length;
          const accounts = await countGroupedBy(
            "ObjectTerritory2Association",
            "Territory2Id",
            [...bareIds, ...coveredIds],
            org,
            "SobjectType = 'Account'"
          );
          const withAccounts = (list: string[]) =>
            list
              .filter((id) => accounts.get(id))
              .map((id): [string, number] => [id, accounts.get(id)!])
              .sort((a, b) => b[1] - a[1]);
          const bare = withAccounts(bareIds);
          const covered = withAccounts(coveredIds);
          const coveredNote = covered.length
            ? ` ${many(covered.length, "territory", "territories")} with accounts ${covered.length === 1 ? "has" : "have"} no user of ${covered.length === 1 ? "its" : "their"} own but ${covered.length === 1 ? "is" : "are"} covered by a territory above (${covered
                .slice(0, 3)
                .map(([id]) => `${nameOf(id)} by ${nameOf(coveredBy(id)!)}`)
                .join("; ")}${covered.length > 3 ? "…" : ""}).`
            : "";
          const scope =
            checked === ownless.length
              ? `Checked the accounts of all ${many(checked, "territory", "territories")} with no user of their own.`
              : `Checked the accounts of ${checked} of the ${ownless.length} territories with no user of their own, not every one in the model.`;
          return bare.length
            ? {
                pass: false,
                detail: `${many(bare.length, "territory", "territories")} with accounts ${bare.length === 1 ? "has" : "have"} no user on ${bare.length === 1 ? "it" : "them"} or above ${bare.length === 1 ? "it" : "them"}.${coveredNote}${bare.length > MAX_EXAMPLES ? ` Showing the ${MAX_EXAMPLES} with the most accounts.` : ""} ${scope}`,
                examples: bare
                  .slice(0, MAX_EXAMPLES)
                  .map(([id, n]) => `${nameOf(id)} (${plural(n, "account")})`),
              }
            : {
                pass: true,
                detail: `Every territory with accounts has a user on it or above it.${coveredNote} ${scope}`,
              };
        }
      ),

      runCheck(
        {
          id: "territory-users.data.pati-matches-alignment",
          stage: "data",
          title: "Provider territory info matches the account alignment",
          severity: "warning",
          why: "Provider Account Territory Info holds an account's details for one territory (visit counts, last visit), which Activity Plans, Next Best Customer and territory reports read. A row for an account no longer aligned to that territory is stale; an aligned account without one has no territory details there.",
          steps: [
            "Run the territory alignment jobs (Admin Console > Territory Management Jobs).",
            "Delete leftover info rows for accounts no longer in the territory.",
          ],
          uiPath: "Admin Console > Territory Management Jobs",
          surface: "providerTerritoryInfo",
        },
        async () => {
          // Active model only: planning or archived models keep their own info rows.
          const [{ rows: modelTerritories, model }, focus] = await Promise.all([
            activeTerritories(org),
            focusTerritoryIds(org),
          ]);
          const mine = focus && new Set(focus);
          const territories = mine
            ? modelTerritories.filter((t) => mine.has(String(t.Id)))
            : modelTerritories;
          if (mine && model && !territories.length)
            return {
              pass: true,
              skip: true,
              detail: "This profile's users have no territory in the active model.",
            };
          if (!model || !territories.length)
            return { pass: true, skip: true, detail: "No account alignment yet." };
          // One query per IN-list chunk of the model's territories, each reading its share of the sample,
          // so the rows come from across the model rather than from its first territories.
          const chunks = chunkIds(territories.map((t) => String(t.Id)));
          const share = Math.ceil(SAMPLE_ROWS / chunks.length);
          let complete = true;
          const sample = async (soql: (ids: string) => string) =>
            (
              await Promise.all(
                chunks.map(async (ids) => {
                  const rows = await query(`${soql(inList(ids))} LIMIT ${share}`, org);
                  if (rows.length >= share) complete = false;
                  return rows;
                })
              )
            ).flat();
          const [info, alignments] = await Promise.all([
            sample(
              (ids) =>
                `SELECT AccountId, Account.Name, Territory2Id, Territory2.Name FROM ProviderAcctTerritoryInfo WHERE Territory2Id IN (${ids})`
            ),
            sample(
              (ids) =>
                `SELECT ObjectId, Object.Name, Territory2Id, Territory2.Name FROM ObjectTerritory2Association WHERE SobjectType = 'Account' AND Territory2Id IN (${ids})`
            ),
          ]);
          if (!info.length && !alignments.length)
            return { pass: true, skip: true, detail: "No account alignment yet." };
          // The other side of each sampled row, looked up by account id.
          const [infoOfAligned, alignmentsOfInfo] = await Promise.all([
            queryByIds(
              "AccountId, Territory2Id",
              "ProviderAcctTerritoryInfo",
              "AccountId",
              [...new Set(alignments.map((r) => String(r.ObjectId)))],
              org
            ),
            queryByIds(
              "ObjectId, Territory2Id",
              "ObjectTerritory2Association",
              "ObjectId",
              [...new Set(info.map((r) => String(r.AccountId)))],
              org,
              "SobjectType = 'Account'"
            ),
          ]);
          // Each info row belongs to one account in one territory, so the pair is what has to match.
          const key = (account: unknown, territory: unknown) =>
            `${String(account).slice(0, 15)}|${String(territory).slice(0, 15)}`;
          const name = (r: Row, rel: string) =>
            String((r[rel] as { Name?: string } | null)?.Name ?? "");
          const infoKeys = new Set(infoOfAligned.map((r) => key(r.AccountId, r.Territory2Id)));
          const alignedKeys = new Set(alignmentsOfInfo.map((r) => key(r.ObjectId, r.Territory2Id)));
          const orphans = info.filter((r) => !alignedKeys.has(key(r.AccountId, r.Territory2Id)));
          const missing = alignments.filter((r) => !infoKeys.has(key(r.ObjectId, r.Territory2Id)));
          const read = `${many(alignments.length, "alignment", "alignments")} and ${many(info.length, "territory info row", "territory info rows")}`;
          const scope = mine
            ? complete
              ? `Checked all ${read} in this profile's territories.`
              : `Checked a sample of ${read} from this profile's territories, not every one.`
            : complete
              ? `Checked all ${read} in the active model.`
              : `Checked a sample of ${read} from across the active model, not every one in it.`;
          const parts = [
            orphans.length
              ? `${plural(orphans.length, "territory info row")} for an account no longer aligned to that territory`
              : "",
            missing.length
              ? `${plural(missing.length, "aligned account")} with no territory info for that territory`
              : "",
          ].filter(Boolean);
          if (!parts.length) return { pass: true, detail: `In step. ${scope}` };
          const examples = [
            ...orphans.map(
              (r) =>
                `${name(r, "Account") || r.AccountId} in ${name(r, "Territory2") || r.Territory2Id}: info row, not aligned`
            ),
            ...missing.map(
              (r) =>
                `${name(r, "Object") || r.ObjectId} in ${name(r, "Territory2") || r.Territory2Id}: aligned, no info row`
            ),
          ];
          return {
            pass: false,
            detail: `${parts.join("; ")}. ${scope}`,
            examples: examples.slice(0, MAX_EXAMPLES),
          };
        }
      ),

      runCheck(
        {
          id: "territory-users.config.alignment-jobs",
          stage: "config",
          title: "The territory alignment jobs haven't failed recently",
          severity: "warning",
          why: "The alignment batches (accounts, zip, brick, affiliation) turn rules into assignments. A failed run leaves new accounts and moved rules unaligned.",
          steps: [
            "Open Admin Console > Territory Management Jobs, re-run the failed job, and check Apex Jobs for the error.",
          ],
          uiPath: "Admin Console > Territory Management Jobs",
        },
        async () => {
          const rows = await failedJobs(org, [
            "%Territor%Align%",
            "%Align%Territor%",
            "%ZipToTerritory%",
            "%BrickToTerritory%",
            "%Affiliation%Align%",
          ]);
          const label = (r: Record<string, unknown>) =>
            `${(r.ApexClass as { Name?: string } | undefined)?.Name}: ${String(r.ExtendedStatus ?? r.Status).slice(0, 80)}`;
          return rows.length
            ? {
                pass: false,
                detail: `${plural(rows.length, "failed run")} in the last 14 days.`,
                examples: rows.map(label),
              }
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
          steps: [
            "Admin Console > Mobile > DB Schema: add or switch on a record for each object listed, for the field profiles.",
            "Publish to iPad.",
          ],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "territorySettings",
        },
        schema,
        [
          "Territory2",
          "UserTerritory2Association",
          "ObjectTerritory2Association",
          "ProviderAcctTerritoryInfo",
        ]
      ),
    ]);
  },
};

export default readiness;
