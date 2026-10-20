/** Calendar & Time Off Territory readiness: its validation rules plus Studio's own checks. */

import { cachedDescribeSObject } from "../../../salesforce/cli.js";
import { fetchCategories } from "../../collectors/shared.js";
import { inList, plural, query } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { countOf, dbSchemaCheck, handlersCheck, lazy, loadDbSchema, loadHandlers } from "./_activity-plan-shared.js";

const ID_PATTERN = /^[a-zA-Z0-9]{15,18}$/;
/**
 * Events and visits run to millions of rows and their start time isn't a field a count can use
 * cheaply, so the calendar check reads at most this many ids of each and stops there.
 */
const SAMPLE_ROWS = 500;

const readiness: ReadinessModule = {
  ruleFiles: ["calendar-tot-routine-config.yaml"],
  checks: async (org) => {
    const handlers = loadHandlers(org);
    const schema = loadDbSchema(org);
    const settings = lazy(() =>
      fetchCategories(org, ["PlannerAdministration", "TimeOffTerritoryRule", "TimeOffTerritorySettings", "WorkingDaysConfig"], true)
    );

    return Promise.all([
      handlersCheck(
        {
          id: "calendar-tot.enabled.trigger-handlers",
          stage: "enabled",
          title: "The Time Off Territory trigger handlers are switched on",
          severity: "warning",
          why: "These handlers share a time-off block with the team, block overlapping entries, and stop visits and events landing inside time off. With them off, reps can double-book over their own time off.",
          steps: ["Open Admin Console > Trigger Handlers.", "Switch on each handler listed."],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        handlers,
        [
          "TUDSharingHandler",
          "TUDUpdateHandler",
          "TUDOverlapHandler",
          "TUDEventValidationHandler",
          "TUDVisitValidationHandler",
          "TUDBHValidationHandler",
          "TUDHolidayValidationHandler",
          "VisitTimeOffValidationHandler",
        ]
      ),

      runCheck(
        {
          id: "calendar-tot.config.planner-business-hours",
          stage: "config",
          title: "Planner Administration points at active business hours",
          severity: "warning",
          why: "The planner shades working hours from the business hours chosen here, and Time Off Territory validation uses them to refuse off-hours entries. A missing or deleted business hours record turns both off silently.",
          steps: ["Open Admin Console > Planner Administration.", "Pick an active Business Hours record for calls and the calendar."],
          uiPath: "Admin Console > Planner Administration",
          surface: "adminSettings",
        },
        async () => {
          const planner = (await settings()).filter((r) => r.category === "PlannerAdministration" && r.isActive);
          if (planner.length === 0) return { pass: false, detail: "No active Planner Administration setting." };
          const ids = [
            ...new Set(planner.flatMap((r) => [r.fields.BusinessHours, r.fields.CallBusinessHours]).filter((v): v is string => typeof v === "string" && ID_PATTERN.test(v))),
          ];
          if (ids.length === 0) return { pass: false, detail: "Planner Administration has no business hours chosen." };
          const live = await query(`SELECT Id FROM BusinessHours WHERE IsActive = true AND Id IN (${inList(ids)})`, org);
          const missing = ids.length - live.length;
          return missing
            ? { pass: false, detail: `${plural(missing, "chosen business hours record")} deleted or inactive.` }
            : { pass: true, detail: `${plural(ids.length, "business hours record")} in use, all active.` };
        }
      ),

      runCheck(
        {
          id: "calendar-tot.config.tot-rules",
          stage: "config",
          title: "Time Off Territory rules are set up",
          severity: "warning",
          why: "The rule set says what a time-off block may overlap (visits, meetings, holidays, off-hours). Without an active rule set the platform can't tell a legal TOT from an illegal one.",
          steps: ["Open Admin Console > Time Off Territory.", "Create the rule set and slot definitions for the TOT types in use."],
          uiPath: "Admin Console > Time Off Territory",
          surface: "adminSettings",
        },
        async () => {
          const rules = (await settings()).filter((r) => r.category === "TimeOffTerritoryRule" && r.isActive);
          return rules.length
            ? { pass: true, detail: `${plural(rules.length, "active rule")}.` }
            : { pass: false, detail: "No active Time Off Territory rule." };
        }
      ),

      runCheck(
        {
          id: "calendar-tot.config.working-days",
          stage: "config",
          title: "Working-day sources point at fields that exist",
          severity: "warning",
          why: "Working-day calculations (activity plan prorating, goal pacing) read business hours, holidays and time off from the objects and fields named here. A field that doesn't exist, often left over from a copied or test setting, makes the calculation fail or skip that source.",
          steps: ["Open Admin Console and find the WorkingDaysConfig category (its own category, not part of Planner Administration).", "Correct or delete the setting listed."],
          uiPath: "Admin Console > WorkingDaysConfig",
          surface: "adminSettings",
        },
        async () => {
          const recs = (await settings()).filter((r) => r.category === "WorkingDaysConfig" && r.isActive);
          if (recs.length === 0) return { pass: true, skip: true, detail: "No working-day settings." };
          const objects = [...new Set(recs.map((r) => String(r.fields.Object || "")).filter(Boolean))];
          const described = new Map<string, Set<string>>();
          await Promise.all(
            objects.map(async (o) => {
              const d = await cachedDescribeSObject(o, org);
              if (d.success && d.data) described.set(o, new Set(d.data.fields.map((f) => f.name.toLowerCase())));
            })
          );
          const bad: string[] = [];
          for (const r of recs) {
            const fields = described.get(String(r.fields.Object || ""));
            if (!fields) continue; // object couldn't be described — say nothing
            const missing = ["Start", "End", "StartTime"]
              .map((k) => r.fields[k])
              .filter((v): v is string => typeof v === "string" && v !== "" && !fields.has(v.toLowerCase()));
            if (missing.length) bad.push(`${r.label || r.developerName}: ${missing.join(", ")}`);
          }
          return bad.length
            ? { pass: false, detail: `${plural(bad.length, "setting")} name a field the object doesn't have.`, examples: bad }
            : { pass: true, detail: `${plural(recs.length, "setting")} checked.` };
        }
      ),

      runCheck(
        {
          id: "calendar-tot.data.holidays-ahead",
          stage: "data",
          title: "Holidays are defined for the coming months",
          severity: "warning",
          why: "Holidays feed working-day calculations and the calendar's day-off shading. Once the last dated holiday has passed (or a one-off list was loaded for a past year), plans prorate wrongly and visits can be booked on public holidays.",
          steps: ["Open Setup > Holidays.", "Add the holidays for this and next year, or make them recurring."],
          uiPath: "Setup > Holidays",
          surface: "objects",
        },
        async () => {
          const n = await countOf(
            `SELECT COUNT() FROM Holiday WHERE ActivityDate >= TODAY OR (IsRecurrence = true AND (RecurrenceEndDateOnly = null OR RecurrenceEndDateOnly >= TODAY))`,
            org
          );
          if (n) return { pass: true, detail: `${plural(n, "holiday")} from today on (dated or recurring).` };
          const total = await countOf(`SELECT COUNT() FROM Holiday`, org);
          return { pass: false, detail: total ? `${plural(total, "holiday")}, all in the past.` : "No holidays." };
        }
      ),

      runCheck(
        {
          id: "calendar-tot.data.recent-events",
          stage: "data",
          title: "The calendar has events or visits from the last 30 days or ahead",
          severity: "info",
          why: "Reps' calendars are built from Events and Visits. None in the sync window usually means a data load was never refreshed, or event ownership no longer matches the field users.",
          steps: ["Check that field users own current events and visits, and that data loads set the right owner."],
          uiPath: "App Launcher > Events",
          surface: "objects",
        },
        async () => {
          // Up to SAMPLE_ROWS ids each: enough to tell a live calendar from an empty one without counting it.
          const read = async (soql: string) => (await query(`${soql} LIMIT ${SAMPLE_ROWS}`, org)).length;
          const [events, visits] = await Promise.all([
            read(`SELECT Id FROM Event WHERE StartDateTime >= LAST_N_DAYS:30`),
            read(`SELECT Id FROM Visit WHERE PlannedVisitStartTime >= LAST_N_DAYS:30`).catch(() => 0),
          ]);
          if (!events && !visits) return { pass: false, detail: "No events or visits in the last 30 days or ahead." };
          const counted = (n: number, noun: string) => (n >= SAMPLE_ROWS ? `${SAMPLE_ROWS} or more ${noun}s` : plural(n, noun));
          const parts = [events ? counted(events, "event") : "", visits ? counted(visits, "visit") : ""].filter(Boolean);
          const stopped = events >= SAMPLE_ROWS || visits >= SAMPLE_ROWS ? ` Stopped counting at ${SAMPLE_ROWS} of each.` : "";
          return { pass: true, detail: `${parts.join(" and ")} in the window.${stopped}` };
        }
      ),

      dbSchemaCheck(
        {
          id: "calendar-tot.mobile.db-schema",
          stage: "mobile",
          title: "Calendar objects sync to the iPad",
          severity: "error",
          why: "The iPad calendar reads events, event invitees, holidays and time off offline. Missing any of them leaves gaps in the planner or lets reps book over holidays and time off.",
          steps: ["Admin Console > Mobile > DB Schema: add or switch on a record for each object listed, for the field profiles.", "Publish to iPad."],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        schema,
        ["Event", "EventRelation", "Holiday", "TerritoryUserDowntime"]
      ),
    ]);
  },
};

export default readiness;
