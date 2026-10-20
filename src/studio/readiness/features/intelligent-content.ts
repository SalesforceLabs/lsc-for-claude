/** Intelligent Content readiness: its validation rules plus Studio's own checks. */

import { count, countGroupedBy, plural, query, queryByIds, type Row } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { handlersResult, loadDbSchema, nameList, syncResult } from "./_consent-sync.js";
import { once } from "./_visit-shared.js";

/** Handlers that share presentations and their pages with territories and keep topics valid. */
const HANDLERS = ["PresentationSharingHandler", "PresentationLinkedPageSharingHandler", "PresentationForumLockHandler", "TopicValidationHandler"];

/** What the iPad needs to list, open and organize presentations. */
const CONTENT_OBJECTS = ["Presentation", "PresentationPage", "PresentationLinkedPage", "PresentationPageProduct", "Topic", "TopicAssignment"];
/** What the iPad writes while a rep presents. */
const TRACKING_OBJECTS = ["PresentationClickStrmEntry"];

const ACTIVE = `FROM Presentation WHERE Status = 'Active'`;

/*
 * The checks on active presentations read a fixed number of them, then look up their shares and
 * pages by presentation id. An anti-join ("Id NOT IN (SELECT ... FROM PresentationShare)") has to read
 * the whole share table when every presentation is distributed, which is the healthy case; a lookup
 * by id costs the same whatever the size of the org. When the org has fewer active presentations than
 * the sample size, the sample is all of them.
 */
const SAMPLE_ROWS = 500;

interface Sample {
  rows: Row[];
  ids: string[];
  /** Every active presentation was read. */
  complete: boolean;
}

async function loadActive(org: string): Promise<Sample> {
  const rows = await query(`SELECT Id, Name ${ACTIVE} LIMIT ${SAMPLE_ROWS}`, org);
  return { rows, ids: rows.map((r) => String(r.Id)), complete: rows.length < SAMPLE_ROWS };
}

/** The sentence saying what was looked at, so a pass is never read as "every presentation in the org". */
function checkedNote(s: Sample): string {
  return s.complete ? `Checked all ${plural(s.rows.length, "active presentation")}.` : `Checked a sample of ${SAMPLE_ROWS} active presentations, not every one in the org.`;
}

const NO_ACTIVE = { pass: true, skip: true, detail: "No active presentations." };

const readiness: ReadinessModule = {
  ruleFiles: ["intelligent-content-config.yaml"],
  checks: async (org) => {
    const schema = loadDbSchema(org);
    const active = once(() => loadActive(org));
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
          title: "Active presentations are distributed to a territory",
          severity: "error",
          why: "A presentation reaches reps only through a share. One with just its owner on the sharing list is invisible on every iPad.",
          steps: ["Open Admin Console > Content Management", "Select the presentation and use Distribute to pick its territories"],
          uiPath: "Admin Console > Content Management > Distribute",
          surface: "objects",
        },
        async () => {
          const s = await active();
          if (!s.rows.length) return NO_ACTIVE;
          const shared = await countGroupedBy("PresentationShare", "ParentId", s.ids, org, "RowCause != 'Owner'");
          const rows = s.rows.filter((r) => !shared.has(String(r.Id)));
          const scope = checkedNote(s);
          return rows.length
            ? { pass: false, detail: `${rows.length} of ${s.rows.length} ${rows.length === 1 ? "isn't" : "aren't"} distributed. ${scope}`, examples: nameList(rows.slice(0, 20)) }
            : { pass: true, detail: `Every one is distributed. ${scope}` };
        }
      ),

      runCheck(
        {
          id: "intelligent-content.data.empty",
          stage: "data",
          title: "Active presentations have at least one page",
          severity: "error",
          why: "A presentation with no pages opens as an empty viewer. It usually means the upload or conversion didn't finish.",
          steps: ["Open Admin Console > Content Management", "Re-upload the presentation, or deactivate it"],
          uiPath: "Admin Console > Content Management",
          surface: "objects",
        },
        async () => {
          const s = await active();
          if (!s.rows.length) return NO_ACTIVE;
          const paged = await countGroupedBy("PresentationLinkedPage", "PresentationId", s.ids, org);
          const rows = s.rows.filter((r) => !paged.has(String(r.Id)));
          const scope = checkedNote(s);
          return rows.length
            ? { pass: false, detail: `${rows.length} of ${s.rows.length} ${rows.length === 1 ? "has" : "have"} no pages. ${scope}`, examples: nameList(rows.slice(0, 20)) }
            : { pass: true, detail: `Every one has pages. ${scope}` };
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
          const s = await active();
          if (!s.rows.length) return NO_ACTIVE;
          const rows = await queryByIds("Presentation.Name, PresentationPage.Name", "PresentationLinkedPage", "PresentationId", s.ids, org, "PresentationPage.Status != 'Active'");
          const label = (r: Record<string, unknown>) =>
            `${(r.Presentation as { Name?: string } | null)?.Name ?? "?"} → ${(r.PresentationPage as { Name?: string } | null)?.Name ?? "?"}`;
          const scope = checkedNote(s);
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "inactive page")} in active presentations. ${scope}`, examples: rows.slice(0, 20).map(label) }
            : { pass: true, detail: `No active presentation includes an inactive page. ${scope}` };
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
            ? { pass: false, detail: `${plural(rows.length, "active presentation")} outside the dates.`, examples: nameList(rows.slice(0, 20)) }
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
