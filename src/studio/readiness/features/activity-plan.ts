/** Activity Plan readiness: its validation rules plus Studio's own checks. */

import { plural, query } from "../../helpers.js";
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

const CURRENT = `TimePeriod.StartDate <= TODAY AND TimePeriod.EndDate >= TODAY`;

const readiness: ReadinessModule = {
  ruleFiles: ["activity-plan-config.yaml"],
  checks: async (org) => {
    const handlers = loadHandlers(org);
    const schema = loadDbSchema(org);
    // Active-model territories with a field user — the ones that need a plan.
    const staffed = lazy(() =>
      query(
        `SELECT Territory2Id, Territory2.Name tname, COUNT(Id) cnt FROM UserTerritory2Association WHERE Territory2.Territory2Model.State = 'Active' AND IsActive = true GROUP BY Territory2Id, Territory2.Name`,
        org
      )
    );

    return Promise.all([
      handlersCheck(
        {
          id: "activity-plan.enabled.trigger-handlers",
          stage: "enabled",
          title: "The Activity Plan trigger handlers are switched on",
          severity: "error",
          why: "These handlers validate plans, keep goals consistent and share a plan with the users of its territories. With them off, reps don't see their plans and bad data gets saved.",
          steps: ["Open Admin Console > Trigger Handlers.", "Switch on each handler listed."],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        handlers,
        [
          "ActivityPlanValidationHandler",
          "ActivityPlanTerritoryValidationHandler",
          "ActivityPlanTerritoryModHandler",
          "ActivityPlanTerritorySharingHandler",
          "ProviderActivityGoalHandler",
        ]
      ),

      runCheck(
        {
          id: "activity-plan.data.time-period-current",
          stage: "data",
          title: "A time period covers today",
          severity: "error",
          why: "Plans run for the length of their time period. When every period has ended, new plans can't be created for the current cycle and the app shows no current goals.",
          steps: ["Open Time Periods.", "Create a TimePeriod whose start date is on or before today and whose end date is after today."],
          uiPath: "App Launcher > Time Periods",
          surface: "objects",
        },
        async () => {
          const rows = await query(
            `SELECT Name, EndDate FROM TimePeriod WHERE StartDate <= TODAY AND EndDate >= TODAY ORDER BY EndDate`,
            org
          );
          if (rows.length) return { pass: true, detail: `${plural(rows.length, "time period")} cover today.`, examples: labels(rows) };
          const total = await countOf(`SELECT COUNT() FROM TimePeriod`, org);
          return { pass: false, detail: total ? `${plural(total, "time period")}, none covering today.` : "No time periods." };
        }
      ),

      runCheck(
        {
          id: "activity-plan.data.active-plan-current",
          stage: "data",
          title: "At least one active plan runs in the current time period",
          severity: "error",
          why: "Reps only see plans that are active and whose time period includes today. Without one, the Activity Plan widgets on Home and Accounts are empty.",
          steps: ["Open Activity Plans.", "Open the plan for the current period and select Active (or create one and link it to a territory)."],
          uiPath: "App Launcher > Activity Plans",
          surface: "objects",
        },
        async () => {
          const n = await countOf(`SELECT COUNT() FROM ActivityPlan WHERE IsActive = true AND ${CURRENT}`, org);
          if (n) return { pass: true, detail: `${plural(n, "active plan")} in the current period.` };
          const total = await countOf(`SELECT COUNT() FROM ActivityPlan`, org);
          return { pass: false, detail: total ? `${plural(total, "plan")}, none active in the current period.` : "No activity plans." };
        }
      ),

      runCheck(
        {
          id: "activity-plan.data.stale-active-plans",
          stage: "data",
          title: "No active plan is past its time period",
          severity: "warning",
          why: "A plan left active after its period ended keeps syncing to iPads and shows old goals next to the current ones.",
          steps: ["Open the plans listed.", "Clear Active, or move them to a time period that is still running."],
          uiPath: "App Launcher > Activity Plans",
          surface: "objects",
        },
        async () => {
          const rows = await query(
            `SELECT Name, TimePeriod.EndDate FROM ActivityPlan WHERE IsActive = true AND TimePeriod.EndDate < TODAY ORDER BY TimePeriod.EndDate DESC LIMIT 50`,
            org
          );
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "active plan")} past their time period.`, examples: labels(rows) }
            : { pass: true, detail: "None." };
        }
      ),

      runCheck(
        {
          id: "activity-plan.data.plan-territory",
          stage: "data",
          title: "Every active plan is linked to a territory",
          severity: "error",
          why: "A plan reaches reps through its territories (ActivityPlanTerritory). An active plan with none is visible to no one.",
          steps: ["Open the plan and add an Activity Plan Territory for each territory it covers."],
          uiPath: "App Launcher > Activity Plan Territories",
          surface: "objects",
        },
        async () => {
          const rows = await query(
            `SELECT Name FROM ActivityPlan WHERE IsActive = true AND Id NOT IN (SELECT ActivityPlanId FROM ActivityPlanTerritory) LIMIT 50`,
            org
          );
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "active plan")} with no territory.`, examples: labels(rows) }
            : { pass: true, detail: "All linked." };
        }
      ),

      runCheck(
        {
          id: "activity-plan.data.plan-territory-model",
          stage: "data",
          title: "Plan territories belong to the active territory model",
          severity: "warning",
          why: "Plans linked to territories of an archived or planning model reach no one once the model changes — a common leftover after a territory realignment.",
          steps: ["Re-create the Activity Plan Territory records against the matching territories of the active model."],
          uiPath: "App Launcher > Activity Plan Territories",
          surface: "objects",
        },
        async () => {
          const rows = await query(
            `SELECT ActivityPlan.Name, Territory.Name FROM ActivityPlanTerritory WHERE Territory.Territory2Model.State != 'Active' LIMIT 50`,
            org
          );
          const label = (r: Record<string, unknown>) =>
            `${(r.ActivityPlan as { Name?: string } | undefined)?.Name} → ${(r.Territory as { Name?: string } | undefined)?.Name}`;
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "link")} point outside the active model.`, examples: rows.map(label) }
            : { pass: true, detail: "All in the active model." };
        }
      ),

      runCheck(
        {
          id: "activity-plan.data.territory-coverage",
          stage: "data",
          title: "Every staffed territory has an active plan",
          severity: "warning",
          why: "Reps in a territory with no active plan open the app to empty goals. New territories and reorganisations are where this usually slips.",
          steps: ["Create (or extend) a plan for the current period and add the listed territories to it."],
          uiPath: "App Launcher > Activity Plan Territories",
          surface: "objects",
        },
        async () => {
          const [people, covered] = await Promise.all([
            staffed(),
            query(`SELECT TerritoryId FROM ActivityPlanTerritory WHERE ActivityPlan.IsActive = true`, org),
          ]);
          if (people.length === 0) return { pass: true, skip: true, detail: "No users are assigned to the active model's territories." };
          const have = new Set(covered.map((r) => String(r.TerritoryId)));
          const bare = people.filter((r) => !have.has(String(r.Territory2Id)));
          return bare.length
            ? {
                pass: false,
                detail: `${bare.length} of ${people.length} staffed territories have no active plan.`,
                examples: bare.map((r) => String(r.tname)),
              }
            : { pass: true, detail: `All ${people.length} staffed territories are covered.` };
        }
      ),

      runCheck(
        {
          id: "activity-plan.data.plan-goals",
          stage: "data",
          title: "Every active plan has account goals",
          severity: "warning",
          why: "A plan without ProviderActivityGoal records gives reps nothing to work toward. Goals are normally loaded or generated after the plan is created.",
          steps: ["Load goals for the plan (data load, or the plan's goal creation job), then check again."],
          uiPath: "App Launcher > Provider Activity Goals",
          surface: "objects",
        },
        async () => {
          const rows = await query(
            `SELECT Name FROM ActivityPlan WHERE IsActive = true AND Id NOT IN (SELECT ActivityPlanId FROM ProviderActivityGoal) LIMIT 50`,
            org
          );
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "active plan")} with no goals.`, examples: labels(rows) }
            : { pass: true, detail: "All have goals." };
        }
      ),

      runCheck(
        {
          id: "activity-plan.data.goal-measures",
          stage: "data",
          title: "Every goal on an active plan has measures",
          severity: "warning",
          why: "Measures carry the actual targets (e.g. 7 face-to-face visits). A goal with none shows 0 of 0 and can't attain.",
          steps: ["Add Provider Activity Goal Measure records for the goals, one per activity type."],
          uiPath: "App Launcher > Provider Activity Goal Measures",
          surface: "objects",
        },
        async () => {
          const n = await countOf(
            `SELECT COUNT() FROM ProviderActivityGoal WHERE ActivityPlan.IsActive = true AND Id NOT IN (SELECT ProviderActivityGoalId FROM ProviderActivityGoalMeasure)`,
            org
          );
          return n ? { pass: false, detail: `${plural(n, "goal")} on active plans with no measures.` } : { pass: true, detail: "All goals have measures." };
        }
      ),

      runCheck(
        {
          id: "activity-plan.config.measure-types",
          stage: "config",
          title: "Provider Activity Measure Types are defined",
          severity: "error",
          why: "Measure types say which visits and calls count toward a goal and how. Without them no activity can be attributed to goals.",
          steps: ["Open Admin Console > Activity Plans and define the measure types, then regenerate the iPad metadata."],
          uiPath: "Admin Console > Activity Plans > Activity Types",
          surface: "adminSettings",
        },
        async () => {
          const n = await countOf(`SELECT COUNT() FROM ProviderActivityMeasureType`, org);
          return { pass: n > 0, detail: n ? `${plural(n, "measure type")}.` : "None defined." };
        }
      ),

      runCheck(
        {
          id: "activity-plan.config.calculation-enabled",
          stage: "config",
          title: "Active plans have calculation enabled",
          severity: "warning",
          why: "The attainment jobs only recalculate plans marked Calculation Enabled. Without it, actual and scheduled counts stay at zero however many calls reps make.",
          steps: ["Open each plan listed.", "Select Calculation Enabled and save."],
          uiPath: "App Launcher > Activity Plans",
          surface: "objects",
        },
        async () => {
          const rows = await query(
            `SELECT Name FROM ActivityPlan WHERE IsActive = true AND IsCalculationEnabled = false LIMIT 50`,
            org
          );
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "active plan")} with calculation off.`, examples: labels(rows) }
            : { pass: true, detail: "All active plans calculate." };
        }
      ),

      runCheck(
        {
          id: "activity-plan.config.weighted-weights",
          stage: "config",
          title: "Weighted goal measures have an activity weight",
          severity: "warning",
          why: "Weighted plans score each activity by its weight (0.01–9.99). A weighted measure without one contributes nothing to attainment.",
          steps: ["Set Activity Weight Value on the measures listed."],
          uiPath: "App Launcher > Provider Activity Goal Measures",
          surface: "objects",
        },
        async () => {
          const n = await countOf(
            `SELECT COUNT() FROM ProviderActivityGoalMeasure WHERE Type LIKE '%Weighted%' AND ActivityWeightValue = null`,
            org
          );
          const weighted = await countOf(`SELECT COUNT() FROM ProviderActivityGoalMeasure WHERE Type LIKE '%Weighted%'`, org);
          if (weighted === 0) return { pass: true, skip: true, detail: "No weighted measures." };
          return n ? { pass: false, detail: `${n} of ${weighted} weighted measures have no weight.` } : { pass: true, detail: `${weighted} weighted measures all weighted.` };
        }
      ),

      runCheck(
        {
          id: "activity-plan.config.calculation-jobs",
          stage: "config",
          title: "The goal calculation jobs haven't failed recently",
          severity: "warning",
          why: "The calculation batches refresh actual and scheduled counts on every goal. When one fails, attainment on the iPad stops moving.",
          steps: ["Open Admin Console > Activity Plans > Jobs and re-run the failed job; check Apex Jobs for the error."],
          uiPath: "Admin Console > Activity Plans > Jobs",
        },
        async () => {
          const rows = await failedJobs(org, ["%ActivityPlan%", "%AccountGoals%", "%ProviderActivity%"]);
          const label = (r: Record<string, unknown>) =>
            `${(r.ApexClass as { Name?: string } | undefined)?.Name}: ${String(r.ExtendedStatus ?? r.Status).slice(0, 80)}`;
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "failed run")} in the last 14 days.`, examples: rows.map(label) }
            : { pass: true, detail: "No failed runs in the last 14 days." };
        }
      ),

      dbSchemaCheck(
        {
          id: "activity-plan.mobile.db-schema",
          stage: "mobile",
          title: "Activity Plan objects sync to the iPad",
          severity: "error",
          why: "Plans, territories, goals and measures are read offline. An object missing from DB Schema leaves the plan widgets blank on the iPad.",
          steps: ["Admin Console > Mobile > DB Schema: add or switch on a record for each object listed, for the field profiles.", "Publish to iPad."],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        schema,
        ["ActivityPlan", "ActivityPlanTerritory", "TimePeriod", "ProviderActivityGoal", "ProviderActivityGoalMeasure"]
      ),
    ]);
  },
};

export default readiness;
