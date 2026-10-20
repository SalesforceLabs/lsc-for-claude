/** Activity Plan readiness: its validation rules plus Studio's own checks. */

import { activeTerritories } from "../../collectors/territory-users.js";
import { countGroupedBy, plural, query, queryByIds, type Row } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import {
  countOf,
  dbSchemaCheck,
  failedJobs,
  fieldProfilesUsing,
  handlersCheck,
  labels,
  lazy,
  loadDbSchema,
  loadHandlers,
} from "./_activity-plan-shared.js";

const CURRENT = `TimePeriod.StartDate <= TODAY AND TimePeriod.EndDate >= TODAY`;

/*
 * Goals and measures are big tables (one goal per account per plan), so the goal checks never ask
 * "is any goal in the org missing X?" — with no match that scans every goal and times out in large
 * orgs. Instead each active plan's first few goals are read by plan id (an index), and their
 * measures are looked up by goal id. Plans and plan territories are small and read whole.
 */
/** Goals read in all, spread over the active plans. */
const SAMPLE_GOALS = 500;
/** Goals read per plan, at least. */
const MIN_GOALS_PER_PLAN = 5;
/** Active plans whose goals are read, one query each. */
const MAX_PLANS = 200;

/** "1 goal" / "3 goals", spelled out for nouns that don't just take an "s". */
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
const hasHave = (n: number) => (n === 1 ? "has" : "have");

interface GoalSample {
  /** Active plans, by name (at most MAX_PLANS were read for goals). */
  plans: Row[];
  /** Active plans in the org. */
  totalPlans: number;
  /** Goals read per plan id. */
  goals: Map<string, Row[]>;
  /** Goals read per plan. */
  perPlan: number;
  /** Every goal of every active plan was read. */
  complete: boolean;
}

const readiness: ReadinessModule = {
  ruleFiles: ["activity-plan-config.yaml"],
  checks: async (org) => {
    const handlers = loadHandlers(org);
    const schema = loadDbSchema(org);
    // Active-model territories with a field user — the ones that need a plan.
    // Counted per chunk of territory ids: one grouped query stops at 2,000 groups.
    const staffed = lazy(async () => {
      const { rows } = await activeTerritories(org);
      const users = await countGroupedBy("UserTerritory2Association", "Territory2Id", rows.map((t) => String(t.Id)), org, "IsActive = true");
      return rows.filter((t) => users.get(String(t.Id))).map((t) => ({ Territory2Id: String(t.Id), tname: String(t.Name), cnt: users.get(String(t.Id)) }));
    });

    const activePlans = lazy(() => query(`SELECT Id, Name FROM ActivityPlan WHERE IsActive = true ORDER BY Name`, org));
    const goalSample = lazy(async (): Promise<GoalSample> => {
      const all = await activePlans();
      const plans = all.slice(0, MAX_PLANS);
      const perPlan = Math.max(MIN_GOALS_PER_PLAN, Math.ceil(SAMPLE_GOALS / Math.max(1, plans.length)));
      const goals = new Map<string, Row[]>();
      await Promise.all(
        plans.map(async (p) => {
          const rows = await query(`SELECT Id, Name FROM ProviderActivityGoal WHERE ActivityPlanId = '${p.Id}' LIMIT ${perPlan}`, org);
          goals.set(String(p.Id), rows);
        })
      );
      const complete = plans.length === all.length && [...goals.values()].every((g) => g.length < perPlan);
      return { plans, totalPlans: all.length, goals, perPlan, complete };
    });
    // Measures of the sampled goals, looked up by goal id.
    const measures = lazy(async () => {
      const ids = [...(await goalSample()).goals.values()].flat().map((g) => String(g.Id));
      return queryByIds("ProviderActivityGoalId, Type, ActivityWeightValue", "ProviderActivityGoalMeasure", "ProviderActivityGoalId", ids, org);
    });
    /** What the goal checks looked at, so a pass is never read as "every goal in the org". */
    const goalScope = (s: GoalSample, goals: number) =>
      s.complete
        ? `Checked all ${many(goals, "goal", "goals")} on active plans.`
        : `Checked ${many(goals, "goal", "goals")} across ${many(s.plans.length, "active plan", "active plans")} (up to ${s.perPlan} per plan), not every goal in the org.`;

    // Field profiles of users in a territory that has a plan — they need plans offline.
    const planUsers = lazy(() =>
      fieldProfilesUsing(org, [
        `SELECT User.Profile.Name pn, COUNT(Id) cnt FROM UserTerritory2Association WHERE IsActive = true AND User.IsActive = true AND Territory2Id IN (SELECT TerritoryId FROM ActivityPlanTerritory) GROUP BY User.Profile.Name`,
      ])
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
          const plans = await activePlans();
          if (!plans.length) return { pass: true, detail: "No active plans." };
          const linked = await countGroupedBy("ActivityPlanTerritory", "ActivityPlanId", plans.map((p) => String(p.Id)), org);
          const rows = plans.filter((p) => !linked.has(String(p.Id)));
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "active plan")} with no territory.`, examples: labels(rows.slice(0, 50)) }
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
          const people = await staffed();
          if (people.length === 0) return { pass: true, skip: true, detail: "No users are assigned to the active model's territories." };
          // Looked up by territory id, so the cost follows the staffed territories, not every plan link.
          const have = await countGroupedBy("ActivityPlanTerritory", "TerritoryId", people.map((r) => r.Territory2Id), org, "ActivityPlan.IsActive = true");
          const bare = people.filter((r) => !have.has(String(r.Territory2Id)));
          return bare.length
            ? {
                pass: false,
                detail: `${bare.length} of ${people.length} staffed territories have no active plan.${bare.length > 25 ? " Showing the first 25." : ""}`,
                examples: bare.slice(0, 25).map((r) => String(r.tname)),
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
          const s = await goalSample();
          if (!s.plans.length) return { pass: true, detail: "No active plans." };
          const rows = s.plans.filter((p) => !s.goals.get(String(p.Id))?.length);
          const scope =
            s.plans.length === s.totalPlans
              ? `Checked all ${many(s.totalPlans, "active plan", "active plans")}.`
              : `Checked ${s.plans.length} of ${s.totalPlans} active plans, not every one in the org.`;
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "active plan")} with no goals. ${scope}`, examples: labels(rows.slice(0, 50)) }
            : { pass: true, detail: `All have goals. ${scope}` };
        }
      ),

      runCheck(
        {
          id: "activity-plan.data.goal-measures",
          stage: "data",
          title: "Goals on active plans have measures",
          severity: "warning",
          why: "Measures carry the actual targets (e.g. 7 face-to-face visits). A goal with none shows 0 of 0 and can't attain.",
          steps: ["Add Provider Activity Goal Measure records for the goals, one per activity type."],
          uiPath: "App Launcher > Provider Activity Goal Measures",
          surface: "objects",
        },
        async () => {
          const s = await goalSample();
          const names = new Map([...s.plans].map((p) => [String(p.Id), String(p.Name ?? p.Id)]));
          const goals = [...s.goals].flatMap(([plan, rows]) => rows.map((g) => ({ id: String(g.Id), label: `${g.Name ?? g.Id} (${names.get(plan)})` })));
          if (!goals.length) return { pass: true, skip: true, detail: "No goals on active plans." };
          const measured = new Set((await measures()).map((m) => String(m.ProviderActivityGoalId)));
          const none = goals.filter((g) => !measured.has(g.id));
          const scope = goalScope(s, goals.length);
          return none.length
            ? { pass: false, detail: `${none.length} of ${goals.length} ${hasHave(none.length)} no measures. ${scope}`, examples: none.slice(0, 5).map((g) => g.label) }
            : { pass: true, detail: `Every goal checked has measures. ${scope}` };
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
          // Measures of the sampled goals on active plans: Type and the weight aren't indexed, so asking
          // the whole measure table would scan it.
          const s = await goalSample();
          const goals = [...s.goals.values()].reduce((a, g) => a + g.length, 0);
          const weighted = (await measures()).filter((m) => /weighted/i.test(String(m.Type ?? "")));
          if (weighted.length === 0)
            return { pass: true, skip: true, detail: s.complete ? "No weighted measures." : `No weighted measures on the ${many(goals, "goal", "goals")} checked.` };
          const n = weighted.filter((m) => m.ActivityWeightValue === null || m.ActivityWeightValue === undefined).length;
          const scope = goalScope(s, goals);
          return n
            ? { pass: false, detail: `${n} of ${weighted.length} weighted measures ${hasHave(n)} no weight. ${scope}` }
            : { pass: true, detail: `${many(weighted.length, "weighted measure", "weighted measures")}, all weighted. ${scope}` };
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
          steps: ["Admin Console > Mobile > DB Schema: add or switch on a record for each object listed, and give it to each profile named.", "Publish to iPad."],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        schema,
        ["ActivityPlan", "ActivityPlanTerritory", "TimePeriod", "ProviderActivityGoal", "ProviderActivityGoalMeasure"],
        planUsers
      ),
    ]);
  },
};

export default readiness;
