/** Visit Management readiness: its validation rules plus Studio's own checks. */

import { scriptCodeFindings } from "../../collect.js";
import { count, plural, query, queryByIds } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { handlersResult, loadDbSchema, loadHandlers, once, syncResult } from "./_visit-shared.js";

/** Synced for visits to work offline: the visit, its provider-visit, and what's recorded on it. */
const SYNCED_OBJECTS = ["ProviderVisit", "ProviderVisitProdDetailing", "ProviderVisitProdDiscussion", "ProviderVisitRqstSample", "ProviderVisitMarketingItem"];

/** Validation, locking and conflict handlers — optional ones (holiday, best-time, lock-on-submit variants) are left out. */
const GUARDRAIL_HANDLERS = [
  "VisitConflictValidationHandler",
  "FutureVisitLimitValidationHandler",
  "VisitTimeOffValidationHandler",
  "VisitChangePrimaryAccountHandler",
  "VisitDelayReasonHandler",
  "VisitorLockHandler",
  "ProviderVisitProdDtlNameHandler",
  "ProviderVisitProdDtlLockHandler",
  "ProviderVisitProdDiscussionLockHandler",
  "ProviderVisitRqstSampleLockHandler",
];

/*
 * Visit and ProviderAcctTerritoryInfo hold millions of rows in a large org, and Status, the visit
 * end time and the last visit date aren't indexed. Every visit query is limited to a window on
 * CreatedDate or LastModifiedDate, which are, so its cost follows recent activity rather than the
 * size of the table.
 */
/** Only visits created this recently are looked at for being stuck In Progress. */
const STUCK_WINDOW_DAYS = 90;
/** Completed visits whose accounts the rollup check looks up. */
const SAMPLE_ROWS = 500;

/** "1 account" / "3 accounts". */
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

const readiness: ReadinessModule = {
  ruleFiles: ["visit-management-config.yaml"],
  checks: async (org) => {
    const handlers = once(() => loadHandlers(org));
    const schema = once(() => loadDbSchema(org));
    const completed90 = once(() => count(`SELECT COUNT() FROM Visit WHERE Status = 'Completed' AND CreatedDate = LAST_N_DAYS:90`, org));

    return Promise.all([
      runCheck(
        {
          id: "visit.data.recent-visits",
          stage: "data",
          title: "Reps have created visits in the last 30 days",
          severity: "info",
          why: "A feature nobody has used lately is the first thing to look at: either reps aren't on it yet or something blocks them.",
          steps: ["Ask a pilot rep to create and complete a visit on the iPad", "Check the rep's profile has the Visit permission sets"],
          uiPath: "Visits tab",
        },
        async () => {
          const n = await count(`SELECT COUNT() FROM Visit WHERE CreatedDate = LAST_N_DAYS:30`, org);
          return { pass: n > 0, detail: n ? `${plural(n, "visit")} created in the last 30 days.` : "No visits created in the last 30 days." };
        }
      ),
      runCheck(
        {
          id: "visit.data.stuck-in-progress",
          stage: "data",
          title: "No visits are stuck In Progress",
          severity: "warning",
          why: "A visit left In Progress for weeks was started on a device and never submitted — it keeps counting toward conflicts and blocks the rep's calendar.",
          steps: ["Open each visit and have the rep submit or abandon it", "If the rep's device is gone, set the status to Abandoned from an admin account"],
          uiPath: "Visits tab > list view filtered on Status = In Progress",
        },
        async () => {
          const where = `Status = 'InProgress' AND CreatedDate = LAST_N_DAYS:${STUCK_WINDOW_DAYS} AND CreatedDate < LAST_N_DAYS:14`;
          const rows = await query(`SELECT Id, Name, Account.Name, CreatedDate FROM Visit WHERE ${where} ORDER BY CreatedDate LIMIT 6`, org);
          const n = rows.length === 6 ? await count(`SELECT COUNT() FROM Visit WHERE ${where}`, org) : rows.length;
          return {
            pass: n === 0,
            detail: n
              ? `${plural(n, "visit")} from the last ${STUCK_WINDOW_DAYS} days In Progress for more than 14 days.`
              : `No visit from the last ${STUCK_WINDOW_DAYS} days has been In Progress for more than 14 days.`,
            examples: rows.map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "visit.data.rollup-fresh",
          stage: "data",
          title: "Completed visits update the territory info's last visit date",
          severity: "warning",
          why: "Last visit date and year-to-date count on ProviderAcctTerritoryInfo drive call frequency, Activity Plan attainment and Next Best Customer. They only move when the rollup handler and job run.",
          steps: [
            "Confirm the PVChangedEventUpdateAccountTerrInfo trigger handler is active",
            "Check the Visit rollup job is scheduled in Admin Console",
            "Confirm the visited account is aligned to the visit's territory",
          ],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        async () => {
          // Completing a visit modifies it, so the LastModifiedDate window loses none of them and
          // lets the query use an index; the end time alone would mean reading every visit.
          const visits = await query(
            `SELECT AccountId FROM Visit WHERE LastModifiedDate = LAST_N_DAYS:30 AND Status = 'Completed' AND ActualVisitEndTime = LAST_N_DAYS:30 AND AccountId != null LIMIT ${SAMPLE_ROWS}`,
            org
          );
          if (!visits.length) return { pass: true, skip: true, detail: "No visits were completed in the last 30 days." };
          const accounts = [...new Set(visits.map((v) => String(v.AccountId)))];
          const info = await queryByIds("AccountId", "ProviderAcctTerritoryInfo", "AccountId", accounts, org, "LastProviderVisitDate = LAST_N_DAYS:30");
          const updated = new Set(info.map((r) => String(r.AccountId))).size;
          const scope =
            visits.length < SAMPLE_ROWS
              ? `Checked the accounts of all ${many(visits.length, "visit", "visits")} completed in the last 30 days.`
              : `Checked the accounts of a sample of ${SAMPLE_ROWS} visits completed in the last 30 days, not every one in the org.`;
          return {
            pass: updated > 0,
            detail: `${updated} of ${many(accounts.length, "visited account", "visited accounts")} ${updated === 1 ? "has" : "have"} territory info showing a last visit date in the last 30 days. ${scope}`,
          };
        }
      ),
      runCheck(
        {
          id: "visit.data.territory-on-visits",
          stage: "data",
          title: "Completed visits carry the territory they were made in",
          severity: "warning",
          why: "Territory-level reporting, sharing and the last-visit rollup key off the visit's territory. Visits without one disappear from territory dashboards.",
          steps: ["Check the visit page layout and mobile defaults populate Territory", "Fix existing visits with a data load"],
          uiPath: "Setup > Object Manager > Visit",
        },
        async () => {
          const total = await completed90();
          if (!total) return { pass: true, skip: true, detail: "No visits were completed in the last 90 days." };
          const missing = await count(`SELECT COUNT() FROM Visit WHERE Status = 'Completed' AND TerritoryId = null AND CreatedDate = LAST_N_DAYS:90`, org);
          return {
            pass: missing === 0,
            detail: missing ? `${missing} of ${total} recently completed visits have no territory.` : `All ${total} recently completed visits have a territory.`,
          };
        }
      ),
      runCheck(
        {
          id: "visit.config.guardrail-handlers",
          stage: "config",
          title: "Visit validation and locking handlers are switched on",
          severity: "warning",
          why: "These handlers stop double-booked and far-future visits, lock submitted visits and their detailing, and number product details. With them off, reps can save data the rules are meant to reject.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on each handler listed"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        async () => handlersResult(await handlers(), GUARDRAIL_HANDLERS)
      ),
      runCheck(
        {
          id: "visit.config.action-validation-script",
          stage: "config",
          title: "The Visit Action Validation script will run",
          severity: "error",
          why: "Only the earliest-created Visit Action Validation script runs, and only if it targets ProviderVisit on update. Any other script, or one with the wrong target, is silently ignored.",
          steps: [
            "Keep one Visit Action Validation script and merge the others' checks into it",
            "Set Object Name to ProviderVisit and Operation Event Type to OnUpdate",
            "Click Refresh in Workflow Configuration > Custom Scripts after deploying the LWC",
          ],
          uiPath: "Admin Console > Workflow Configuration > Custom Scripts",
          surface: "customScripts",
        },
        async () => {
          const rows = await query(
            `SELECT Id, Name, ObjectName, OperationEventType, CodeText FROM LifeScienceCustomScript WHERE Type = 'VisitActionValidation' ORDER BY CreatedDate, Id`,
            org
          );
          if (!rows.length) return { pass: true, skip: true, detail: "No Visit Action Validation scripts — optional." };
          const problems: string[] = [];
          const [running, ...ignored] = rows;
          if (ignored.length) problems.push(`${ignored.map((r) => r.Name).join(", ")} will not run — only "${running.Name}" does`);
          if (running.ObjectName !== "ProviderVisit") problems.push(`"${running.Name}" has Object Name ${running.ObjectName ?? "blank"}, not ProviderVisit`);
          if (running.OperationEventType !== "OnUpdate") problems.push(`"${running.Name}" has Operation Event Type ${running.OperationEventType ?? "blank"}, not OnUpdate`);
          for (const f of scriptCodeFindings(String(running.CodeText ?? "")).filter((f) => f.severity === "warning")) problems.push(`"${running.Name}": ${f.title}`);
          return problems.length
            ? { pass: false, detail: problems.join("; ") + ".", examples: problems }
            : { pass: true, detail: `"${running.Name}" is the running script and is set up correctly.` };
        }
      ),
      runCheck(
        {
          id: "visit.mobile.db-schema",
          stage: "mobile",
          title: "Visits and what's recorded on them sync to the iPad",
          severity: "error",
          why: "Without DB Schema records for ProviderVisit and its child objects, reps can't see, create or submit visits offline.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on a record for each object listed, assigned to the reps' profiles"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => syncResult(org, await schema(), SYNCED_OBJECTS)
      ),
    ]);
  },
};

export default readiness;
