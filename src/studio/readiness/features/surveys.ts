/** Surveys readiness: its validation rules plus Studio's own checks. */

import { count, plural, query } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { handlersResult, loadDbSchema, nameList, syncResult } from "./_consent-sync.js";

/** Handlers every surveys setup needs: sharing invitations with reps, and cleaning up with the visit. */
const HANDLERS = ["SurveyInvitationSharingHandler", "VisitSurveyInviteCascadeDeleteHandler"];

/** What the iPad needs to show a survey. */
const DEFINITION_OBJECTS = ["Survey", "SurveyVersion", "SurveyPage", "SurveyQuestion", "SurveyQuestionChoice", "SurveyInvitation"];
/** What the iPad writes when a rep fills one in. */
const RESPONSE_OBJECTS = ["SurveyResponseOffline", "SurveyQstnResponseOffline"];

/** Surveys built for the iPad are the OfflineMobile type. */
const MOBILE = `FROM Survey WHERE SurveyType = 'OfflineMobile'`;

const readiness: ReadinessModule = {
  ruleFiles: ["surveys-config.yaml"],
  checks: async (org) => {
    const schema = loadDbSchema(org);
    return Promise.all([
      runCheck(
        {
          id: "surveys.enabled.handlers",
          stage: "enabled",
          title: "Survey trigger handlers are switched on",
          severity: "error",
          why: "The invitation handler shares each invitation with the rep it was issued to, and the cascade handler removes a visit's invitations with it. With one off, reps can't see their surveys, or orphaned invitations pile up.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on each handler listed below"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        () => handlersResult(org, HANDLERS)
      ),

      runCheck(
        {
          id: "surveys.enabled.colleague-sharing",
          stage: "enabled",
          title: "The colleague survey sharing handler is switched on",
          severity: "info",
          why: "This handler shares survey invitations with colleagues on a managed event. It's needed only if you run surveys on managed events; otherwise it can stay off.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on ColleagueSurveySharingHandler if you use surveys on managed events"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        async () => {
          // Only orgs with both managed events and survey invitations can need it.
          const [events, invitations] = await Promise.all([
            count(`SELECT COUNT() FROM MngEvent`, org).catch(() => 0),
            count(`SELECT COUNT() FROM SurveyInvitation`, org).catch(() => 0),
          ]);
          if (!events || !invitations) return { pass: true, skip: true, detail: "No survey invitations on managed events to share." };
          return handlersResult(org, ["ColleagueSurveySharingHandler"]);
        }
      ),

      runCheck(
        {
          id: "surveys.access.shared",
          stage: "access",
          title: "Mobile surveys are shared beyond their owner",
          severity: "error",
          why: "Reps see only surveys they can read. When the org-wide default for surveys is Private, a survey with only its owner on the sharing list doesn't appear on the iPad.",
          steps: ["Open the survey and use Sharing", "Share it with the groups or territories whose reps should fill it in", "Or set the org-wide default for Survey to Public Read Only in Setup > Sharing Settings"],
          uiPath: "App Launcher > Surveys > Sharing",
          surface: "objects",
        },
        async () => {
          const total = await count(`SELECT COUNT() ${MOBILE}`, org);
          if (!total) return { pass: true, skip: true, detail: "No mobile surveys." };
          const owd = await query(`SELECT InternalSharingModel FROM EntityDefinition WHERE QualifiedApiName = 'Survey'`, org)
            .then((r) => r[0]?.InternalSharingModel as string | undefined)
            .catch(() => undefined);
          if (owd && owd !== "Private") return { pass: true, detail: `Survey's org-wide default is ${owd}, so reps can read all ${plural(total, "mobile survey")}.` };
          const rows = await query(`SELECT Id, Name ${MOBILE} AND Id NOT IN (SELECT ParentId FROM SurveyShare WHERE RowCause != 'Owner') LIMIT 20`, org);
          return rows.length
            ? {
                pass: false,
                detail: `${owd ? "Survey's org-wide default is Private and " : ""}${rows.length} of ${plural(total, "mobile survey")} aren't shared with anyone but the owner.`,
                examples: nameList(rows),
              }
            : { pass: true, detail: `All ${plural(total, "mobile survey")} are shared.` };
        }
      ),

      runCheck(
        {
          id: "surveys.config.mobile-type",
          stage: "config",
          title: "At least one survey is built for the iPad",
          severity: "warning",
          why: "Only surveys of type Offline Mobile can be filled in on the iPad. If every survey is another type, reps have nothing to launch.",
          steps: ["Create a survey with type Offline Mobile in App Launcher > Surveys", "Add its questions and activate a version"],
          uiPath: "App Launcher > Surveys",
          surface: "objects",
        },
        async () => {
          const [mobile, total] = await Promise.all([count(`SELECT COUNT() ${MOBILE}`, org), count(`SELECT COUNT() FROM Survey`, org)]);
          if (!total) return { pass: true, skip: true, detail: "No surveys yet." };
          return mobile
            ? { pass: true, detail: `${plural(mobile, "mobile survey")} of ${total}.` }
            : { pass: false, detail: `None of the ${plural(total, "survey")} is an Offline Mobile survey.` };
        }
      ),

      runCheck(
        {
          id: "surveys.config.active-version",
          stage: "config",
          title: "Every mobile survey has an active version",
          severity: "error",
          why: "The iPad launches a survey's active version. A survey with only drafts or an obsolete version can't be started.",
          steps: ["Open the survey in App Launcher > Surveys", "Activate a version"],
          uiPath: "App Launcher > Surveys",
          surface: "objects",
        },
        async () => {
          const total = await count(`SELECT COUNT() ${MOBILE}`, org);
          if (!total) return { pass: true, skip: true, detail: "No mobile surveys." };
          const rows = await query(`SELECT Id, Name ${MOBILE} AND ActiveVersionId = null LIMIT 20`, org);
          return rows.length
            ? { pass: false, detail: `${rows.length} of ${plural(total, "mobile survey")} have no active version.`, examples: nameList(rows) }
            : { pass: true, detail: `All ${plural(total, "mobile survey")} have one.` };
        }
      ),

      runCheck(
        {
          id: "surveys.config.questions",
          stage: "config",
          title: "Active survey versions have questions",
          severity: "warning",
          why: "An active version with no questions opens as a blank form that can still be submitted.",
          steps: ["Open the survey in App Launcher > Surveys", "Add questions to the active version, or activate one that has them"],
          uiPath: "App Launcher > Surveys",
          surface: "objects",
        },
        async () => {
          const total = await count(`SELECT COUNT() FROM SurveyVersion WHERE SurveyStatus = 'Active'`, org);
          if (!total) return { pass: true, skip: true, detail: "No active survey versions." };
          const rows = await query(
            `SELECT Id, Name, Survey.Name FROM SurveyVersion WHERE SurveyStatus = 'Active' AND Id NOT IN (SELECT SurveyVersionId FROM SurveyQuestion) LIMIT 20`,
            org
          );
          return rows.length
            ? {
                pass: false,
                detail: `${rows.length} of ${plural(total, "active version")} have no questions.`,
                examples: rows.map((r) => String((r.Survey as { Name?: string } | null)?.Name ?? r.Name)),
              }
            : { pass: true, detail: `All ${plural(total, "active version")} have questions.` };
        }
      ),

      runCheck(
        {
          id: "surveys.data.unmigrated",
          stage: "data",
          title: "Completed offline responses are being processed",
          severity: "warning",
          why: "A response uploaded from the iPad stays Completed until it's turned into survey responses (then it's marked Completed and Migrated). Ones left over for days mean reports and analytics miss them.",
          steps: ["Check the survey response migration job is scheduled", "Check the Survey trigger handlers are on", "Open the oldest Completed response for an error"],
          uiPath: "App Launcher > Survey Response Offline",
          surface: "objects",
        },
        async () => {
          const [stale, total] = await Promise.all([
            count(`SELECT COUNT() FROM SurveyResponseOffline WHERE Status IN ('Completed', 'PartiallyCompleted') AND CreatedDate < LAST_N_DAYS:2`, org),
            count(`SELECT COUNT() FROM SurveyResponseOffline`, org),
          ]);
          if (!total) return { pass: true, skip: true, detail: "No offline responses yet." };
          return stale
            ? { pass: false, detail: `${stale} of ${plural(total, "offline response")} have waited over 2 days.` }
            : { pass: true, detail: `${plural(total, "offline response")}; none waiting.` };
        }
      ),

      runCheck(
        {
          id: "surveys.mobile.definition-objects",
          stage: "mobile",
          title: "Surveys, versions, questions and invitations sync to the iPad",
          severity: "error",
          why: "The iPad draws a survey from its offline copy of these objects. A missing one means the survey doesn't appear, or has no questions or choices.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on each object listed below for every profile that fills in surveys", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => syncResult(org, await schema, DEFINITION_OBJECTS, "Survey")
      ),

      runCheck(
        {
          id: "surveys.mobile.response-objects",
          stage: "mobile",
          title: "Survey responses sync from the iPad",
          severity: "error",
          why: "Answers are saved to these objects on the device and uploaded at the next sync. If they aren't in the DB Schema, a completed survey never reaches the org.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on each object listed below for every profile that fills in surveys", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => syncResult(org, await schema, RESPONSE_OBJECTS, "Survey")
      ),
    ]);
  },
};

export default readiness;
