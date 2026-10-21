/** Key Account Management readiness: its validation rules plus Studio's own checks. */

import { countGroupedBy, plural, query, type Row } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import {
  countOf,
  dbSchemaCheck,
  fieldProfilesUsing,
  handlersCheck,
  lazy,
  loadDbSchema,
  loadHandlers,
} from "./_activity-plan-shared.js";

/*
 * The "has children" checks read a fixed number of plans or objectives and look their children up by
 * id. An anti-join (`Id NOT IN (SELECT ...)`) has to read every child row when nothing is missing,
 * and ActionPlan is shared with other features, so it can be large even when KAM is small. Orgs with
 * fewer plans than the sample size get every one checked.
 */
const SAMPLE_ROWS = 500;

/** "1 plan" / "3 plans" with the plural spelled out. */
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
const hasHave = (n: number) => (n === 1 ? "has" : "have");

/** The sentence saying what was looked at, so a pass is never read as "the whole org is clean". */
function checkedNote(n: number, one: string, more: string): string {
  return n < SAMPLE_ROWS
    ? `Checked all ${many(n, one, more)}.`
    : `Checked a sample of ${SAMPLE_ROWS} ${more}, not every one in the org.`;
}

/** Rows of the sample with no children in `children`, as "N of M have no X. Checked ..." */
function missingResult(
  rows: Row[],
  children: Map<string, number>,
  one: string,
  more: string,
  what: string
) {
  const bare = rows.filter((r) => !children.has(String(r.Id)));
  const scope = checkedNote(rows.length, one, more);
  return bare.length
    ? {
        pass: false,
        detail: `${bare.length} of ${many(rows.length, one, more)} ${hasHave(bare.length)} no ${what}. ${scope}`,
        examples: bare.slice(0, 5).map((r) => String(r.Name ?? r.Id)),
      }
    : {
        pass: true,
        detail: `Every one has ${what === "action plan" ? "an action plan" : what}. ${scope}`,
      };
}

const readiness: ReadinessModule = {
  ruleFiles: ["kam-config.yaml"],
  checks: async (org) => {
    const handlers = loadHandlers(org);
    const schema = loadDbSchema(org);
    // A plain LIMIT with no ORDER BY stops after the sample is read.
    const plans = lazy(() => query(`SELECT Id, Name FROM AccountPlan LIMIT ${SAMPLE_ROWS}`, org));
    const objectives = lazy(() =>
      query(`SELECT Id, Name FROM AccountPlanObjective LIMIT ${SAMPLE_ROWS}`, org)
    );
    const planIds = async () => (await plans()).map((r) => String(r.Id));
    // Field profiles of the people who own or take part in account plans — they need plans offline.
    const planUsers = lazy(() =>
      fieldProfilesUsing(org, [
        `SELECT Profile.Name pn, COUNT(Id) cnt FROM User WHERE IsActive = true AND Id IN (SELECT OwnerId FROM AccountPlan) GROUP BY Profile.Name`,
        `SELECT Profile.Name pn, COUNT(Id) cnt FROM User WHERE IsActive = true AND Id IN (SELECT ParticipantId FROM AccountPlanParticipant) GROUP BY Profile.Name`,
      ])
    );

    return Promise.all([
      handlersCheck(
        {
          id: "kam.enabled.sharing-handlers",
          stage: "enabled",
          title: "Account plan sharing handlers are switched on",
          severity: "error",
          why: "These handlers give plan participants access to the plan and to its tasks. With them off, a participant who isn't the owner can't see the plan, and tasks assigned to them are invisible.",
          steps: ["Open Admin Console > Trigger Handlers.", "Switch on each handler listed."],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        handlers,
        ["AccountPlanToParticipantSharingHandler", "AssessmentTaskSharingHandler"]
      ),

      handlersCheck(
        {
          id: "kam.enabled.rollup-handlers",
          stage: "enabled",
          title: "Percent-complete and clean-up handlers are switched on",
          severity: "warning",
          why: "They roll task completion up to action plans, objectives and the plan, and delete child records with their parent. With them off, progress bars stay at zero and deleted plans leave orphans behind.",
          steps: ["Open Admin Console > Trigger Handlers.", "Switch on each handler listed."],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        handlers,
        [
          "AccountPlanChangeStatusHandler",
          "AccountPlanDeleteChildrenHandler",
          "AcctPlanObjDeleteChildrenHandler",
          "ActionPlanDeleteChildrenHandler",
          "AssessmentTaskDeleteAPItemHandler",
          "SetAccObjectPercentCompleteHandler",
          "SetAccPlanPercentCompleteHandler",
          "SetActionPlanPercentCompleteHandler",
        ]
      ),

      runCheck(
        {
          id: "kam.config.published-templates",
          stage: "config",
          title: "Published action plan templates exist for objectives",
          severity: "warning",
          why: "Only templates with status Final can be imported into an objective. Drafts are invisible to key account managers, so they build every tactic by hand.",
          steps: [
            "Open App Launcher > Action Plan Templates.",
            "Publish the draft template (Status = Final), or create one with Action Plan Type KAM and Target Entity Type Account Plan Objective.",
          ],
          uiPath: "App Launcher > Action Plan Templates",
          surface: "objects",
        },
        async () => {
          const final = await countOf(
            `SELECT COUNT() FROM ActionPlanTemplate WHERE ActionPlanType = 'KAM' AND TargetEntityType = 'AccountPlanObjective' AND Status = 'Final'`,
            org
          );
          if (final) return { pass: true, detail: `${plural(final, "published template")}.` };
          const drafts = await countOf(
            `SELECT COUNT() FROM ActionPlanTemplate WHERE ActionPlanType = 'KAM'`,
            org
          );
          return {
            pass: false,
            detail: drafts
              ? `${plural(drafts, "KAM template")}, none published.`
              : "No KAM action plan templates.",
          };
        }
      ),

      runCheck(
        {
          id: "kam.config.template-links",
          stage: "config",
          title: "Goal definitions are linked to action plan templates",
          severity: "info",
          why: "Linking a template to a goal definition (an assignment) is what suggests the right tactics when a manager imports that goal. Without links, imports bring in the goal alone.",
          steps: [
            "Open the Action Plan Template.",
            "Add the goal definitions it belongs to under Template Assignments.",
          ],
          uiPath: "App Launcher > Action Plan Templates",
          surface: "objects",
        },
        async () => {
          const templates = await countOf(
            `SELECT COUNT() FROM ActionPlanTemplate WHERE ActionPlanType = 'KAM'`,
            org
          );
          if (!templates) return { pass: true, skip: true, detail: "No KAM templates yet." };
          const links = await countOf(`SELECT COUNT() FROM ActionPlanTemplateAssignment`, org);
          return links
            ? { pass: true, detail: `${plural(links, "template assignment")}.` }
            : { pass: false, detail: "No template is linked to a goal definition." };
        }
      ),

      runCheck(
        {
          id: "kam.data.plans-have-objectives",
          stage: "data",
          title: "Account plans have objectives",
          severity: "warning",
          why: "A plan with no objectives has nothing to track, and its progress never moves. It usually means the template import was skipped or failed.",
          steps: ["Open the plan, then Account Plan Objectives > Import Template or New."],
          uiPath: "Account Plan > Account Plan Objectives",
          surface: "objects",
        },
        async () => {
          const rows = await plans();
          if (!rows.length) return { pass: true, skip: true, detail: "No account plans yet." };
          const children = await countGroupedBy(
            "AccountPlanObjective",
            "AccountPlanId",
            await planIds(),
            org
          );
          return missingResult(rows, children, "account plan", "account plans", "objectives");
        }
      ),

      runCheck(
        {
          id: "kam.data.plans-have-participants",
          stage: "data",
          title: "Account plans have participants",
          severity: "warning",
          why: "Participants are the people who get access to a plan. A plan with none is visible only to its owner, so the team working the account can't see or update it.",
          steps: ["Open the plan, then Account Plan Participants > New, and add the team."],
          uiPath: "Account Plan > Account Plan Participants",
          surface: "objects",
        },
        async () => {
          const rows = await plans();
          if (!rows.length) return { pass: true, skip: true, detail: "No account plans yet." };
          const children = await countGroupedBy(
            "AccountPlanParticipant",
            "AccountPlanId",
            await planIds(),
            org
          );
          return missingResult(rows, children, "account plan", "account plans", "participants");
        }
      ),

      runCheck(
        {
          id: "kam.data.objectives-have-action-plans",
          stage: "data",
          title: "Objectives have an action plan",
          severity: "info",
          why: "Action plans hold the tactics and tasks that move an objective forward. An objective without one can't show progress.",
          steps: ["Open the objective, then Action Plans > Import Template or New."],
          uiPath: "Account Plan Objective > Action Plans",
          surface: "objects",
        },
        async () => {
          const rows = await objectives();
          if (!rows.length) return { pass: true, skip: true, detail: "No objectives yet." };
          const ids = rows.map((r) => String(r.Id));
          const children = await countGroupedBy(
            "ActionPlan",
            "TargetId",
            ids,
            org,
            "ActionPlanType = 'KAM'"
          );
          return missingResult(rows, children, "objective", "objectives", "action plan");
        }
      ),

      runCheck(
        {
          id: "kam.data.overdue-plans",
          stage: "data",
          title: "No account plan is still open past its end date",
          severity: "info",
          why: "Plans left Active or Not Started after their end date clutter the lists reps work from and keep counting in reports.",
          steps: ["Open each plan and set its status to match reality, or extend the end date."],
          uiPath: "App Launcher > Account Plans",
          surface: "objects",
        },
        async () => {
          const n = await countOf(
            `SELECT COUNT() FROM AccountPlan WHERE EndDate < TODAY AND Status IN ('Active', 'Not Started')`,
            org
          );
          return n
            ? { pass: false, detail: `${plural(n, "plan")} past the end date but still open.` }
            : { pass: true, detail: "No plan is open past its end date." };
        }
      ),

      runCheck(
        {
          id: "kam.data.objectives-have-goals",
          stage: "data",
          title: "Objectives are tied to a goal definition",
          severity: "info",
          why: "Objectives imported from a goal definition keep the link, so reports can roll results up by goal. Hand-made objectives have none.",
          steps: [
            "Import objectives from a goal definition (Import Template) instead of creating them by hand.",
          ],
          uiPath: "Account Plan > Account Plan Objectives > Import Template",
          surface: "objects",
        },
        async () => {
          const total = await countOf(`SELECT COUNT() FROM AccountPlanObjective`, org);
          if (!total) return { pass: true, skip: true, detail: "No objectives yet." };
          const bare = await countOf(
            `SELECT COUNT() FROM AccountPlanObjective WHERE GoalDefinitionId = null`,
            org
          );
          return bare
            ? { pass: false, detail: `${bare} of ${total} objectives have no goal definition.` }
            : { pass: true, detail: `All ${total} objectives are tied to a goal.` };
        }
      ),

      dbSchemaCheck(
        {
          id: "kam.mobile.db-schema",
          stage: "mobile",
          title: "Account plan objects sync to the iPad",
          severity: "error",
          why: "Account plans, objectives, participants, stakeholders, action plans, tasks and templates are read offline on the iPad. A missing object leaves a hole in the plan or an empty import dialog. Studio checks them against the field profiles of users who own or take part in an account plan.",
          steps: [
            "Admin Console > Mobile > DB Schema: add or switch on a record for each object listed, and give it to each profile named.",
            "Publish to iPad.",
          ],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        schema,
        [
          "AccountPlan",
          "AccountPlanObjective",
          "AccountPlanParticipant",
          "AccountPlanStakeholder",
          "ActionPlan",
          "ActionPlanItem",
          "ActionPlanTemplate",
          "ActionPlanTemplateAssignment",
          "GoalDefinition",
          "AssessmentTask",
        ],
        planUsers
      ),
    ]);
  },
};

export default readiness;
