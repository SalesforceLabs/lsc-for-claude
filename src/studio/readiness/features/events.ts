/** Events Management readiness: its validation rules plus Studio's own checks. */

import { isMissingObject } from "../../collectors/briefings.js";
import { fieldUsersReadResult } from "./_field-access.js";
import { fetchCache } from "../../collectors/mobile-sync.js";
import { count, plural, query } from "../../helpers.js";
import { runCheck, type ReadinessModule, type StudioCheckResult } from "../index.js";
import { cacheFreshResult } from "./_mobile-sync-shared.js";
import { duplicateSyncResult, handlersResult, loadDbSchema, loadHandlers, once, syncResult } from "./_visit-shared.js";

/** Handlers that enforce the event rules (duplicates, dates, quotas, inviter). */
const CORE_HANDLERS = [
  "CreateMngEventPtcpHandler",
  "MngEventParticipantDuplicateHandler",
  "MngEventPartTOTValidationHandler",
  "MngEventDateTimeValidationHandler",
  "WriteInToAttendeeHandler",
  "MngEventPtcpSetAttendeeQuotaHandler",
  "AttendeeQuotaCountOfAttendeesHandler",
  "MngEventParticipantInvitedByHandler",
];
const SYNC_OBJECTS = [
  "MngEvent",
  "MngEventType",
  "MngEventParticipant",
  "MngEventResource",
  "MngEventProduct",
  "MngEventTerritory",
  "MngEventBudget",
  "EstimatedExpense",
  "EventMgmtParticipantType",
  "EventMgmtParticipantRole",
  "EventMgmtPtcpTypeRoleMap",
];
/** Objects that must not sync: they are server-side only and break the first sync. */
const NEVER_SYNC = ["BudgetMngEventType", "EstimatedExpensePtcpAlloc"];

const OFF: StudioCheckResult = { pass: true, skip: true, detail: "Events Management isn't available in this org." };

/*
 * The checks on events read a fixed number of them with a plain filter and no ORDER BY, so the query
 * stops early whatever the size of the table; the rest is worked out here. SOQL can't compare two
 * fields, and ComplianceStatements is a long text field it can't filter on, so both checks read rows
 * anyway. When the org has fewer events than the sample size, the sample is all of them.
 */
const SAMPLE_ROWS = 500;

/** "1 event" / "3 events", spelled out for nouns `plural` can't handle. */
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/** The sentence saying what was looked at, so a pass is never read as "every event in the org". */
function checkedNote(n: number, one: string, more: string): string {
  return n < SAMPLE_ROWS ? `Checked all ${many(n, one, more)}.` : `Checked a sample of ${SAMPLE_ROWS} ${more}, not every one in the org.`;
}

/** ComplianceStatements holds a JSON list; an event with none has "[]" (or nothing). */
function hasStatements(value: unknown): boolean {
  const text = String(value ?? "").trim();
  if (!text) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (parsed && typeof parsed === "object") return Object.keys(parsed).length > 0;
    return Boolean(parsed);
  } catch {
    return true;
  }
}

const readiness: ReadinessModule = {
  ruleFiles: ["events-management-config.yaml"],
  checks: async (org) => {
    const available = once(async () => {
      try {
        // One row read tells whether the object exists; a count would scan every event.
        await query(`SELECT Id FROM MngEvent LIMIT 1`, org);
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
          id: "events.enabled.core-handlers",
          stage: "enabled",
          title: "The Events Management trigger handlers are switched on",
          severity: "error",
          why: "Duplicate-participant, date, quota and inviter rules are enforced by trigger handlers. Switched off, reps can double-book participants, save an event that ends before it starts, and invitation quotas aren't counted.",
          steps: ["Open Admin Console > Trigger Handlers (or use the fix)", "Switch on each handler listed"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        gate(async () => handlersResult(await handlers(), CORE_HANDLERS))
      ),
      runCheck(
        {
          id: "events.access.event-read",
          stage: "access",
          title: "Field users can read Managed Events",
          severity: "error",
          why: "Without Read on Managed Event through their profile or a permission set, the Events tab and the event cards on the iPad stay empty for the users who should run events.",
          steps: [
            "Open Setup > Permission Sets and pick a set the field users on the profiles listed hold, or create one",
            "Grant Read (and Create, Edit for organisers) on Managed Event and its child objects",
            "Assign the set to any of those users who don't hold it",
          ],
          uiPath: "Setup > Permission Sets > Object Settings",
          surface: "objects",
        },
        gate(() => fieldUsersReadResult(org, "MngEvent", "Managed Event"))
      ),
      runCheck(
        {
          id: "events.data.event-template",
          stage: "data",
          title: "Every event type has a template",
          severity: "warning",
          why: "The type's Target Template decides which screens an event shows (speaker meeting, presentation, exhibit). A type with none opens a generic event with missing sections.",
          steps: ["Open each event type listed", "Choose a Target Template"],
          uiPath: "App Launcher > Event Types",
          surface: "objects",
        },
        gate(async () => {
          const types = await query(`SELECT Name, TargetTemplate FROM MngEventType`, org);
          if (!types.length) return { pass: true, skip: true, detail: "No event types exist yet." };
          const bare = types.filter((t) => !t.TargetTemplate);
          return bare.length
            ? { pass: false, detail: `${bare.length} of ${types.length} event types have no template.`, examples: bare.map((t) => String(t.Name)) }
            : { pass: true, detail: `${plural(types.length, "event type")}; all have a template.` };
        })
      ),
      runCheck(
        {
          id: "events.data.type-role-map",
          stage: "data",
          title: "Every event type has active participant type and role combinations",
          severity: "warning",
          why: "The type-role map says which kinds of participant (HCP, employee) can hold which roles (attendee, speaker) at an event type. With no active map the Add Participant dialog offers nothing.",
          steps: ["Open App Launcher > Event Participant Type Role Maps", "Create an active map for each event type listed"],
          uiPath: "App Launcher > Event Participant Type Role Maps",
          surface: "objects",
        },
        gate(async () => {
          const [types, ptcpTypes, roles] = await Promise.all([
            query(`SELECT Id, Name FROM MngEventType`, org),
            count(`SELECT COUNT() FROM EventMgmtParticipantType`, org),
            count(`SELECT COUNT() FROM EventMgmtParticipantRole`, org),
          ]);
          if (!types.length) return { pass: true, skip: true, detail: "No event types exist yet." };
          // Nothing to map until both exist; the participant type and role checks already say so.
          const none = [!ptcpTypes && "participant types", !roles && "participant roles"].filter(Boolean);
          if (none.length) return { pass: true, skip: true, detail: `No ${none.join(" or ")} exist yet, so there is nothing to map.` };
          const maps = await query(`SELECT MngEventTypeId FROM EventMgmtPtcpTypeRoleMap WHERE IsActive = true`, org);
          const mapped = new Set(maps.map((m) => String(m.MngEventTypeId)));
          const bare = types.filter((t) => !mapped.has(String(t.Id)));
          return bare.length
            ? { pass: false, detail: `${bare.length} of ${types.length} event types have no active participant type and role map.`, examples: bare.map((t) => String(t.Name)) }
            : { pass: true, detail: `${plural(types.length, "event type")}; each has an active map.` };
        })
      ),
      runCheck(
        {
          id: "events.data.event-dates",
          stage: "data",
          title: "No event ends before it starts",
          severity: "warning",
          why: "Events with an end before the start break the calendar and business-hours validation, and can't be submitted for approval.",
          steps: ["Open the events listed", "Correct the start or end date and time"],
          uiPath: "App Launcher > Managed Events",
          surface: "objects",
        },
        gate(async () => {
          const rows = await query(`SELECT Name, StartDateTime, EndDateTime FROM MngEvent WHERE EndDateTime != null LIMIT ${SAMPLE_ROWS}`, org);
          if (!rows.length) return { pass: true, skip: true, detail: "No event has an end date yet." };
          const bad = rows.filter((r) => Date.parse(String(r.EndDateTime)) < Date.parse(String(r.StartDateTime)));
          const scope = checkedNote(rows.length, "event with an end date", "events with an end date");
          return bad.length
            ? { pass: false, detail: `${bad.length} of ${rows.length} ${bad.length === 1 ? "ends" : "end"} before ${bad.length === 1 ? "it starts" : "they start"}. ${scope}`, examples: bad.slice(0, 5).map((r) => String(r.Name)) }
            : { pass: true, detail: `Every one ends after it starts. ${scope}` };
        })
      ),
      runCheck(
        {
          id: "events.config.stage-path",
          stage: "config",
          title: "Managed Event has an active stage path",
          severity: "warning",
          why: "The stage path drives the status chevrons (Planned, Approved, Completed) on the event. Without an active one, status is a plain picklist and approvals can't be tied to a stage.",
          steps: ["Open Admin Console > Stage Paths", "Register Managed Event, then create an active path on Status with at least two stages"],
          uiPath: "Admin Console > Stage Paths",
          surface: "adminSettings",
        },
        gate(async () => {
          const paths = await query(
            `SELECT Name, Status, FieldApiName FROM LifeSciStagePath WHERE LifeSciStageObject.ObjectName = 'MngEvent'`,
            org
          ).catch((err) => (isMissingObject(err) ? null : Promise.reject(err)));
          if (paths === null) return { pass: true, skip: true, detail: "Stage paths aren't available in this org." };
          const active = paths.filter((p) => p.Status === "Active");
          return active.length
            ? { pass: true, detail: `${plural(active.length, "active stage path")} for Managed Event (${active.map((p) => String(p.Name)).join(", ")}).` }
            : { pass: false, detail: paths.length ? `${plural(paths.length, "stage path")} for Managed Event, none active.` : "No stage path is registered for Managed Event." };
        })
      ),
      runCheck(
        {
          id: "events.config.compliance",
          stage: "config",
          title: "Compliance statements for events are defined, if used",
          severity: "info",
          why: "Managed events can show compliance statements the organiser must accept. Events that have statements recorded but no definition behind them can't be completed.",
          steps: ["Open App Launcher > Compliance Statement Definitions", "Create a definition with Module Type Managed Event"],
          uiPath: "App Launcher > Compliance Statement Definitions",
          surface: "compliance",
        },
        gate(async () => {
          const defs = await count(`SELECT COUNT() FROM ComplianceStatementDef WHERE ModuleType = 'ManagedEvent'`, org);
          if (defs) return { pass: true, detail: `${plural(defs, "event compliance statement")} defined.` };
          // ComplianceStatements is a long text field, so SOQL can't filter on it; read a sample and look.
          const rows = await query(`SELECT Name, ComplianceStatements FROM MngEvent LIMIT ${SAMPLE_ROWS}`, org);
          const withStatements = rows.filter((r) => hasStatements(r.ComplianceStatements));
          const scope = checkedNote(rows.length, "event", "events");
          if (!withStatements.length)
            return { pass: true, skip: true, detail: rows.length ? `No event carries compliance statements, and none are defined. ${scope}` : "No events, and no compliance statements defined for them." };
          return {
            pass: false,
            detail: `${withStatements.length} of ${rows.length} events ${withStatements.length === 1 ? "carries" : "carry"} compliance statements but no definition exists. ${scope}`,
            examples: withStatements.slice(0, 5).map((r) => String(r.Name)),
          };
        })
      ),
      runCheck(
        {
          id: "events.mobile.db-schema",
          stage: "mobile",
          title: "Event objects sync to the iPad",
          severity: "error",
          why: "Events, participants, resources and the participant type and role setup must be in DB Schema for the iPad to open an event or add attendees offline.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on a record for each object listed", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        gate(async () => syncResult(org, await dbSchema(), SYNC_OBJECTS))
      ),
      runCheck(
        {
          id: "events.mobile.business-hours",
          stage: "mobile",
          title: "Business hours sync when events are checked against them",
          severity: "error",
          why: "With MngEventBusinessHoursHandler on, the iPad checks each event against the org's business hours. If BusinessHours doesn't sync, there are no hours to check against and saving the event fails with \"Unable to validate mngevent\".",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add an active BusinessHours record assigned to the rep profiles, or switch the handler off", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        gate(async () => {
          const on = (await handlers()).some((h) => h.active && h.developerName.toLowerCase() === "mngeventbusinesshourshandler");
          if (!on) return { pass: true, skip: true, detail: "MngEventBusinessHoursHandler is off, so business hours aren't checked." };
          return syncResult(org, await dbSchema(), ["BusinessHours"]);
        })
      ),
      runCheck(
        {
          id: "events.mobile.no-server-only-objects",
          stage: "mobile",
          title: "Server-only budget objects are not synced",
          severity: "error",
          why: "Budget Event Type and Estimated Expense Participant Allocation are maintained on the server. Syncing them to the iPad makes the sync fail or write rows the server then rejects.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Switch off or delete the records listed"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        gate(async () => {
          const bad = (await dbSchema()).filter((r) => r.isActive && NEVER_SYNC.some((o) => o.toLowerCase() === String(r.fields.SObject ?? "").toLowerCase()));
          return bad.length
            ? { pass: false, detail: `${plural(bad.length, "active record")} sync a server-only object.`, examples: bad.map((r) => String(r.fields.SObject)) }
            : { pass: true, detail: "Neither server-only object syncs." };
        })
      ),
      runCheck(
        {
          id: "events.mobile.duplicate-sync",
          stage: "mobile",
          title: "No event object has two active DB Schema records for one profile",
          severity: "warning",
          why: "Two records for the same object and profile compete, so which filter reaches the device depends on order.",
          steps: ["Keep one record per object and profile in Admin Console > Mobile > DB Schema"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        gate(async () => duplicateSyncResult(await dbSchema(), SYNC_OBJECTS))
      ),
      runCheck(
        {
          id: "events.mobile.cache-fresh",
          stage: "mobile",
          title: "The published cache includes your latest event DB Schema changes",
          severity: "warning",
          why: "If the event DB Schema records changed after the last publish, the iPad still runs the old schema.",
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
