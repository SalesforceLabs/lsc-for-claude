/** Intelligent Content readiness: its validation rules plus Studio's own checks. */

import { count, plural, query } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { handlersResult, loadDbSchema, nameList, syncResult } from "./_consent-sync.js";

/** Handlers that share presentations and their pages with territories and keep topics valid. */
const HANDLERS = ["PresentationSharingHandler", "PresentationLinkedPageSharingHandler", "PresentationForumLockHandler", "TopicValidationHandler"];

/** What the iPad needs to list, open and organize presentations. */
const CONTENT_OBJECTS = ["Presentation", "PresentationPage", "PresentationLinkedPage", "PresentationPageProduct", "Topic", "TopicAssignment"];
/** What the iPad writes while a rep presents. */
const TRACKING_OBJECTS = ["PresentationClickStrmEntry"];

const ACTIVE = `FROM Presentation WHERE Status = 'Active'`;

const readiness: ReadinessModule = {
  ruleFiles: ["intelligent-content-config.yaml"],
  checks: async (org) => {
    const schema = loadDbSchema(org);
    return Promise.all([
      runCheck(
        {
          id: "intelligent-content.enabled.handlers",
          stage: "enabled",
          title: "Presentation trigger handlers are switched on",
          severity: "error",
          why: "These handlers share each presentation and its pages with the territories it's distributed to, and keep topics valid. With one off, content uploads fine but reps never see it.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on each handler listed below"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        () => handlersResult(org, HANDLERS)
      ),

      runCheck(
        {
          id: "intelligent-content.access.shared",
          stage: "access",
          title: "Every active presentation is distributed to a territory",
          severity: "error",
          why: "A presentation reaches reps only through a share. One with just its owner on the sharing list is invisible on every iPad.",
          steps: ["Open Admin Console > Content Management", "Select the presentation and use Distribute to pick its territories"],
          uiPath: "Admin Console > Content Management > Distribute",
          surface: "objects",
        },
        async () => {
          const total = await count(`SELECT COUNT() ${ACTIVE}`, org);
          if (!total) return { pass: true, skip: true, detail: "No active presentations." };
          const rows = await query(
            `SELECT Id, Name ${ACTIVE} AND Id NOT IN (SELECT ParentId FROM PresentationShare WHERE RowCause != 'Owner') LIMIT 20`,
            org
          );
          return rows.length
            ? { pass: false, detail: `${rows.length} of ${plural(total, "active presentation")} aren't distributed.`, examples: nameList(rows) }
            : { pass: true, detail: `All ${plural(total, "active presentation")} are distributed.` };
        }
      ),

      runCheck(
        {
          id: "intelligent-content.data.empty",
          stage: "data",
          title: "Every active presentation has at least one page",
          severity: "error",
          why: "A presentation with no pages opens as an empty viewer. It usually means the upload or conversion didn't finish.",
          steps: ["Open Admin Console > Content Management", "Re-upload the presentation, or deactivate it"],
          uiPath: "Admin Console > Content Management",
          surface: "objects",
        },
        async () => {
          const total = await count(`SELECT COUNT() ${ACTIVE}`, org);
          if (!total) return { pass: true, skip: true, detail: "No active presentations." };
          const rows = await query(`SELECT Id, Name ${ACTIVE} AND Id NOT IN (SELECT PresentationId FROM PresentationLinkedPage) LIMIT 20`, org);
          return rows.length
            ? { pass: false, detail: `${rows.length} of ${plural(total, "active presentation")} have no pages.`, examples: nameList(rows) }
            : { pass: true, detail: `All ${plural(total, "active presentation")} have pages.` };
        }
      ),

      runCheck(
        {
          id: "intelligent-content.data.inactive-pages",
          stage: "data",
          title: "Active presentations don't include inactive pages",
          severity: "warning",
          why: "An inactive page inside an active presentation is skipped, leaving a gap in the story the rep tells, or a missing mandatory slide.",
          steps: ["Open the presentation in Admin Console > Content Management", "Reactivate the page or remove it from the presentation"],
          uiPath: "Admin Console > Content Management",
          surface: "objects",
        },
        async () => {
          const rows = await query(
            `SELECT Presentation.Name, PresentationPage.Name FROM PresentationLinkedPage WHERE Presentation.Status = 'Active' AND PresentationPage.Status != 'Active' LIMIT 20`,
            org
          );
          const label = (r: Record<string, unknown>) =>
            `${(r.Presentation as { Name?: string } | null)?.Name ?? "?"} → ${(r.PresentationPage as { Name?: string } | null)?.Name ?? "?"}`;
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "inactive page")} in active presentations.`, examples: rows.map(label) }
            : { pass: true, detail: "None." };
        }
      ),

      runCheck(
        {
          id: "intelligent-content.config.dates",
          stage: "config",
          title: "No active presentation is outside its activation dates",
          severity: "warning",
          why: "The iPad only offers a presentation between its activation and deactivation dates. One marked Active but past its end, or not yet started, is hidden from reps.",
          steps: ["Open the presentation in Admin Console > Content Management", "Adjust the dates, or set the status to match"],
          uiPath: "Admin Console > Content Management",
          surface: "objects",
        },
        async () => {
          const rows = await query(`SELECT Id, Name, ActivationDate, DeactivationDate ${ACTIVE} AND (DeactivationDate < TODAY OR ActivationDate > TODAY) LIMIT 20`, org);
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "active presentation")} outside the dates.`, examples: nameList(rows) }
            : { pass: true, detail: "All within their dates." };
        }
      ),

      runCheck(
        {
          id: "intelligent-content.config.page-dates",
          stage: "config",
          title: "No active page is past its deactivation date",
          severity: "info",
          why: "A page past its end date is dropped from the presentation on the iPad even though its status still says Active.",
          steps: ["Open the page in Admin Console > Content Management", "Extend its deactivation date, or set it Inactive"],
          uiPath: "Admin Console > Content Management",
          surface: "objects",
        },
        async () => {
          const n = await count(`SELECT COUNT() FROM PresentationPage WHERE Status = 'Active' AND DeactivationDate < TODAY`, org);
          return n ? { pass: false, detail: `${plural(n, "active page")} past the deactivation date.` } : { pass: true, detail: "None." };
        }
      ),

      runCheck(
        {
          id: "intelligent-content.mobile.content-objects",
          stage: "mobile",
          title: "Presentations, pages, products and topics sync to the iPad",
          severity: "error",
          why: "The iPad lists presentations from its offline copy. If one of these objects isn't synced, content is missing, unfiltered by product or topic, or empty.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on each object listed below for every profile that uses content", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => syncResult(org, await schema, CONTENT_OBJECTS, "Presentation")
      ),

      runCheck(
        {
          id: "intelligent-content.mobile.tracking-objects",
          stage: "mobile",
          title: "Presentation click-stream tracking syncs from the iPad",
          severity: "warning",
          why: "Which pages a rep showed, and for how long, is recorded on the device and uploaded at sync. Without it in the DB Schema you get no usage reporting.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on each object listed below for every profile that presents", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => syncResult(org, await schema, TRACKING_OBJECTS, "Presentation")
      ),
    ]);
  },
};

export default readiness;
