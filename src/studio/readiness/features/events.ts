/** Events Management readiness: its validation rules plus Studio's own checks. */

import { isMissingObject } from "../../collectors/briefings.js";
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

const readiness: ReadinessModule = {
  ruleFiles: ["events-management-config.yaml"],
  checks: async (org) => {
    const available = once(async () => {
      try {
        await count(`SELECT COUNT() FROM MngEvent`, org);
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
          title: "Reps' permission sets can read Managed Events",
          severity: "error",
          why: "Without Read on Managed Event, the Events tab and the event cards on the iPad stay empty for the users who should run events.",
          steps: ["Open Setup > Permission Sets for the field rep sets", "Grant Read (and Create, Edit for organisers) on Managed Event and its child objects"],
          uiPath: "Setup > Permission Sets > Object Settings",
          surface: "objects",
        },
        gate(async () => {
          const n = await count(`SELECT COUNT() FROM ObjectPermissions WHERE SobjectType = 'MngEvent' AND PermissionsRead = true`, org);
          return { pass: n > 0, detail: n ? `${plural(n, "permission set")} grant Read on Managed Event.` : "No permission set grants Read on Managed Event." };
        })
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
          const types = await query(`SELECT Id, Name FROM MngEventType`, org);
          if (!types.length) return { pass: true, skip: true, detail: "No event types exist yet." };
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
          const rows = await query(`SELECT Name, StartDateTime, EndDateTime FROM MngEvent WHERE EndDateTime != null LIMIT 200`, org);
          const bad = rows.filter((r) => Date.parse(String(r.EndDateTime)) < Date.parse(String(r.StartDateTime)));
          return bad.length
            ? { pass: false, detail: `${plural(bad.length, "event")} end before they start.`, examples: bad.map((r) => String(r.Name)) }
            : { pass: true, detail: `${plural(rows.length, "event")} with an end date checked; all end after they start.` };
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
          const withStatements = await count(`SELECT COUNT() FROM MngEvent WHERE ComplianceStatements != null`, org).catch(() => 0);
          const defs = await count(`SELECT COUNT() FROM ComplianceStatementDef WHERE ModuleType = 'ManagedEvent'`, org);
          if (!withStatements && !defs) return { pass: true, skip: true, detail: "No compliance statements for events, and none defined." };
          return defs
            ? { pass: true, detail: `${plural(defs, "event compliance statement")} defined.` }
            : { pass: false, detail: `${plural(withStatements, "event")} carry compliance statements but no definition exists.` };
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
