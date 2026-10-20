/** Medical Inquiries readiness: its validation rules plus Studio's own checks. */

import { isMissingObject } from "../../collectors/briefings.js";
import { fieldUsersReadResult } from "./_field-access.js";
import { fetchCache } from "../../collectors/mobile-sync.js";
import { count, inList, plural, query } from "../../helpers.js";
import { runCheck, type ReadinessModule, type StudioCheckResult } from "../index.js";
import { cacheFreshResult } from "./_mobile-sync-shared.js";
import { handlersResult, loadDbSchema, loadHandlers, once, syncResult } from "./_visit-shared.js";

/** Handlers that route a new inquiry's Case to the right queue and owner. */
const CASE_HANDLERS = ["CaseMSLQueueHandler", "CaseChangeOwnershipHandler", "CaseShareToCreatorHandler"];
const SYNC_OBJECTS = ["Inquiry", "InquiryQuestion", "InquiryQuestionAnswer", "Case"];
/** Queues the packaged routing sends inquiries to. */
const QUEUES = ["Medical_Affairs", "Pharmacovigilance"];
/** Drafts older than this were started and never submitted. */
const DRAFT_DAYS = 30;

/*
 * Inquiry grows with every question a rep raises, and its Status has no index, so a count filtered on
 * it reads the whole table. The drafts check counts inside a CreatedDate window, which uses the index.
 */
/** Only drafts created this recently are counted, so the count uses the CreatedDate index. */
const DRAFT_WINDOW_DAYS = 365;

/** "1 inquiry" / "3 inquiries". */
const inquiries = (n: number, adjective = "") => `${n} ${adjective}${n === 1 ? "inquiry" : "inquiries"}`;

const OFF: StudioCheckResult = { pass: true, skip: true, detail: "Medical Inquiries isn't available in this org." };

const readiness: ReadinessModule = {
  ruleFiles: ["medical-inquiries-config.yaml"],
  checks: async (org) => {
    const available = once(async () => {
      try {
        // One row read tells whether the object exists; a count would scan every inquiry.
        await query(`SELECT Id FROM Inquiry LIMIT 1`, org);
        return true;
      } catch (err) {
        if (isMissingObject(err)) return false;
        throw err;
      }
    });
    const handlers = once(() => loadHandlers(org));
    const dbSchema = once(() => loadDbSchema(org));
    const caches = once(() => fetchCache(org));
    const gate = (fn: () => Promise<StudioCheckResult>) => async () => ((await available()) ? fn() : OFF);

    return Promise.all([
      runCheck(
        {
          id: "medical-inquiries.enabled.case-handlers",
          stage: "enabled",
          title: "The Case routing trigger handlers are switched on",
          severity: "warning",
          why: "Each inquiry creates a Case. These handlers put it in the medical affairs queue and give the submitting rep access. Switched off, cases land with the integration user and reps lose sight of their own inquiries.",
          steps: ["Open Admin Console > Trigger Handlers (or use the fix)", "Switch on each handler listed"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        gate(async () => handlersResult(await handlers(), CASE_HANDLERS))
      ),
      runCheck(
        {
          id: "medical-inquiries.access.inquiry-read",
          stage: "access",
          title: "Field users can read Inquiries",
          severity: "error",
          why: "Without Read on Inquiry through their profile or a permission set, reps can't see the inquiries they raised, or the answers medical sends back.",
          steps: [
            "Open Setup > Permission Sets and pick a set the field users on the profiles listed hold, or create one",
            "Grant Read and Create on Inquiry, Inquiry Question and Inquiry Question Answer",
            "Assign the set to any of those users who don't hold it",
          ],
          uiPath: "Setup > Permission Sets > Object Settings",
          surface: "objects",
        },
        gate(() => fieldUsersReadResult(org, "Inquiry", "Inquiry"))
      ),
      runCheck(
        {
          id: "medical-inquiries.data.record-types-match",
          stage: "data",
          title: "Every Inquiry record type has a Case record type of the same name",
          severity: "error",
          why: "Creating an inquiry creates a Case with the matching record type, found by name. If no Case record type has the same name, creating the inquiry can fail without an error or leave orphaned records.",
          steps: ["Open Setup > Object Manager > Case > Record Types", "Create a record type with the exact name of each one listed, and make it available to the same profiles"],
          uiPath: "Setup > Object Manager > Case > Record Types",
          surface: "recordTypes",
        },
        gate(async () => {
          const rows = await query(`SELECT SobjectType, Name FROM RecordType WHERE SobjectType IN ('Inquiry', 'Case') AND IsActive = true`, org);
          const cases = new Set(rows.filter((r) => r.SobjectType === "Case").map((r) => String(r.Name)));
          const inquiries = rows.filter((r) => r.SobjectType === "Inquiry").map((r) => String(r.Name));
          if (!inquiries.length) return { pass: true, skip: true, detail: "Inquiry has no active record types." };
          const bare = inquiries.filter((n) => !cases.has(n));
          return bare.length
            ? { pass: false, detail: `${bare.length} of ${inquiries.length} Inquiry record types have no Case record type with the same name.`, examples: bare }
            : { pass: true, detail: `${plural(inquiries.length, "Inquiry record type")}; each has a matching Case record type.` };
        })
      ),
      runCheck(
        {
          id: "medical-inquiries.data.stale-drafts",
          stage: "data",
          title: `No drafts are older than ${DRAFT_DAYS} days`,
          severity: "info",
          why: "A draft is an inquiry the rep started and never submitted, so medical affairs never saw it. Old drafts are usually abandoned and clutter the rep's inquiry list; check none of them was meant to be sent.",
          steps: ["Ask reps to submit or delete the drafts", "Review the Draft list view on Inquiries"],
          uiPath: "App Launcher > Inquiries",
          surface: "objects",
        },
        gate(async () => {
          const n = await count(
            `SELECT COUNT() FROM Inquiry WHERE Status = 'Draft' AND CreatedDate = LAST_N_DAYS:${DRAFT_WINDOW_DAYS} AND CreatedDate < LAST_N_DAYS:${DRAFT_DAYS}`,
            org
          );
          return n
            ? { pass: false, detail: `${inquiries(n, "draft ")} created ${DRAFT_DAYS} to ${DRAFT_WINDOW_DAYS} days ago ${n === 1 ? "is" : "are"} still unsubmitted. Drafts created earlier weren't counted.` }
            : { pass: true, detail: `No draft created ${DRAFT_DAYS} to ${DRAFT_WINDOW_DAYS} days ago is still unsubmitted. Drafts created earlier weren't counted.` };
        })
      ),
      runCheck(
        {
          id: "medical-inquiries.config.stage-path",
          stage: "config",
          title: "Inquiry has an active stage path",
          severity: "warning",
          why: "The stage path drives the status chevrons (Draft, Submitted, Responded). Without an active path on Inquiry, status changes aren't guided and reps can't tell what comes next.",
          steps: ["Open Admin Console > Stage Paths", "Activate the path for Inquiry, or create one on Status"],
          uiPath: "Admin Console > Stage Paths",
          surface: "adminSettings",
        },
        gate(async () => {
          const paths = await query(`SELECT Name, Status FROM LifeSciStagePath WHERE LifeSciStageObject.ObjectName = 'Inquiry'`, org).catch((err) =>
            isMissingObject(err) ? null : Promise.reject(err)
          );
          if (paths === null) return { pass: true, skip: true, detail: "Stage paths aren't available in this org." };
          const active = paths.filter((p) => p.Status === "Active");
          return active.length
            ? { pass: true, detail: `${plural(active.length, "active stage path")} for Inquiry (${active.map((p) => String(p.Name)).join(", ")}).` }
            : { pass: false, detail: paths.length ? `${plural(paths.length, "stage path")} for Inquiry, none active.` : "No stage path is registered for Inquiry." };
        })
      ),
      runCheck(
        {
          id: "medical-inquiries.config.queues",
          stage: "config",
          title: "The inquiry queues exist",
          severity: "warning",
          why: "Cases are routed to the Medical Affairs and Pharmacovigilance queues. If one doesn't exist, an adverse event may sit with no owner.",
          steps: ["Open Setup > Queues", "Create a queue for each one listed, with Case as a supported object"],
          uiPath: "Setup > Queues",
          surface: "triggerHandlers",
        },
        gate(async () => {
          const rows = await query(`SELECT DeveloperName FROM Group WHERE Type = 'Queue' AND DeveloperName IN (${inList(QUEUES)})`, org);
          const have = new Set(rows.map((r) => String(r.DeveloperName)));
          const missing = QUEUES.filter((q) => !have.has(q));
          return missing.length ? { pass: false, detail: `Missing queue: ${missing.join(", ")}.`, examples: missing } : { pass: true, detail: "Both queues exist." };
        })
      ),
      runCheck(
        {
          id: "medical-inquiries.mobile.db-schema",
          stage: "mobile",
          title: "Inquiry objects sync to the iPad",
          severity: "error",
          why: "Inquiry, its questions and answers, and Case must be in DB Schema for reps to raise an inquiry or read the answer on the iPad.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on a record for each object listed", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        gate(async () => syncResult(org, await dbSchema(), SYNC_OBJECTS))
      ),
      runCheck(
        {
          id: "medical-inquiries.mobile.cache-fresh",
          stage: "mobile",
          title: "The published cache includes your latest inquiry DB Schema changes",
          severity: "warning",
          why: "If the inquiry DB Schema records changed after the last publish, the iPad still runs the old schema.",
          steps: ["Regenerate the cache for the profiles listed (Publish to iPad in Studio, or /lsc:generate-metadata-cache)"],
          uiPath: "Admin Console > Mobile > Object Metadata Cache Configuration",
          surface: "metadataCache",
        },
        gate(async () => {
          const mine = (await dbSchema()).filter((r) => SYNC_OBJECTS.some((o) => o.toLowerCase() === String(r.fields.SObject ?? "").toLowerCase()));
          return cacheFreshResult(org, await caches(), ["DbSchema"], mine, [], true);
        })
      ),
    ]);
  },
};

export default readiness;
