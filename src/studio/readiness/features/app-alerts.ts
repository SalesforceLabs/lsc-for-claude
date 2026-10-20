/** App Alerts readiness: its validation rules plus Studio's own checks. */

import { fieldProfiles } from "../../collectors/territory-users.js";
import { count, countGroupedBy, plural, query, queryByIds } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { handlersResult, loadDbSchema, nameList, syncResult } from "./_consent-sync.js";

/** The handler that shares each alert with the territories it's targeted at. */
const HANDLERS = ["NotificationTerritorySharingHandler"];

/**
 * What the iPad reads to show alerts, and writes when a rep reads or dismisses
 * one. AppAlertTerritory isn't here: the app never reads it — the alert's
 * sharing decides who gets it.
 */
const ALERT_OBJECTS = ["AppAlert", "AppAlertUserResponse"];

/*
 * Personal notifications make AppAlert grow with the number of reps, so the checks below read a
 * fixed number of alerts and look up their territories and sharing by alert id, instead of asking
 * the whole table with an anti-join (which reads every alert and share row when the answer is
 * "none"). When the org has fewer alerts than the sample size, the sample is all of them.
 */
const SAMPLE_ROWS = 500;

/** "1 alert" / "the only alert" / "all 7 alerts". */
const allOf = (n: number, one: string, more: string) => (n === 1 ? `the only ${one}` : `all ${n} ${more}`);

/** The sentence saying what was looked at, so a pass is never read as "the whole org is clean". */
function checkedNote(rows: Record<string, unknown>[], one: string, more: string): string {
  return rows.length < SAMPLE_ROWS ? `Checked ${allOf(rows.length, one, more)}.` : `Checked a sample of ${SAMPLE_ROWS} ${more}, not every one in the org.`;
}

/** Alerts whose dates say they are showing today. */
const LIVE = `FROM AppAlert WHERE EffectiveDate <= TODAY AND (ValidUntilDate = null OR ValidUntilDate >= TODAY)`;

const readiness: ReadinessModule = {
  ruleFiles: ["app-alerts-config.yaml"],
  checks: async (org) => {
    const schema = loadDbSchema(org);
    return Promise.all([
      runCheck(
        {
          id: "app-alerts.enabled.handlers",
          stage: "enabled",
          title: "The alert territory sharing handler is switched on",
          severity: "error",
          why: "This handler shares each alert with the reps in the territories it targets. With it off, alerts save but no rep is given access to them.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on the handler listed below"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        () => handlersResult(org, HANDLERS)
      ),

      runCheck(
        {
          id: "app-alerts.access.targeted",
          stage: "access",
          title: "Alerts in effect are targeted to a territory",
          severity: "warning",
          why: "Alerts reach reps through their territories. One with no territory, owned by someone who isn't a rep and shared with nobody else, never appears in anyone's notification pane or Home Office Announcements widget. Alerts owned by a rep (personal notifications) reach their owner, so they aren't counted.",
          steps: ["Open the alert in App Launcher > App Alerts", "Add an App Alert Territory for each territory that should see it"],
          uiPath: "App Launcher > App Alerts > Territories",
          surface: "objects",
        },
        async () => {
          const live = await query(`SELECT Id, Subject, Owner.Profile.Name ${LIVE} LIMIT ${SAMPLE_ROWS}`, org);
          if (!live.length) return { pass: true, skip: true, detail: "No alerts are in effect." };
          const ids = live.map((r) => String(r.Id));
          const [territories, shares, field] = await Promise.all([
            countGroupedBy("AppAlertTerritory", "AlertReferenceRecordId", ids, org),
            countGroupedBy("AppAlertShare", "ParentId", ids, org, "RowCause != 'Owner'"),
            fieldProfiles(org).catch(() => [] as string[]),
          ]);
          // An alert owned by a rep is a personal notification: it reaches its owner.
          const reps = new Set(field.map((p) => p.toLowerCase()));
          const ownerProfile = (r: Record<string, unknown>) => String((r.Owner as { Profile?: { Name?: string } } | null)?.Profile?.Name ?? "").toLowerCase();
          const rows = live.filter((r) => !territories.has(String(r.Id)) && !shares.has(String(r.Id)) && !reps.has(ownerProfile(r)));
          const scope = checkedNote(live, "alert in effect", "alerts in effect");
          return rows.length
            ? {
                pass: false,
                detail: `${rows.length} of ${live.length} have no territory and reach nobody but their owner. ${scope}`,
                examples: nameList(rows.slice(0, 20), "Subject"),
              }
            : { pass: true, detail: `Every one is targeted. ${scope}` };
        }
      ),

      runCheck(
        {
          id: "app-alerts.access.active-model",
          stage: "access",
          title: "Alert territories belong to the active territory model",
          severity: "warning",
          why: "Reps are placed in territories of the active model. An alert aimed at a territory in a planning or archived model reaches nobody.",
          steps: ["Open the alert in App Launcher > App Alerts", "Replace its territories with ones from the active model"],
          uiPath: "App Launcher > App Alerts > Territories",
          surface: "objects",
        },
        async () => {
          const n = await count(`SELECT COUNT() FROM AppAlertTerritory WHERE Territory.Territory2Model.State != 'Active'`, org);
          return n ? { pass: false, detail: `${n} alert ${n === 1 ? "territory sits" : "territories sit"} in a model that isn't active.` } : { pass: true, detail: "All in the active model." };
        }
      ),

      runCheck(
        {
          id: "app-alerts.config.dates",
          stage: "config",
          title: "No alert ends before it starts",
          severity: "warning",
          why: "An alert whose end date is before its start date is never in effect, however it's otherwise set up.",
          steps: ["Open the alert in App Launcher > App Alerts", "Correct the Effective and Valid Until dates"],
          uiPath: "App Launcher > App Alerts",
          surface: "objects",
        },
        async () => {
          // SOQL can't compare two fields, so read the dated alerts back.
          const rows = await query(`SELECT Id, Subject, EffectiveDate, ValidUntilDate FROM AppAlert WHERE ValidUntilDate != null LIMIT 2000`, org);
          const bad = rows.filter((r) => String(r.ValidUntilDate) < String(r.EffectiveDate));
          return bad.length
            ? { pass: false, detail: `${plural(bad.length, "alert")} end before they start.`, examples: nameList(bad.slice(0, 20), "Subject") }
            : { pass: true, detail: "All date ranges are valid." };
        }
      ),

      runCheck(
        {
          id: "app-alerts.config.context",
          stage: "config",
          title: "Tab and object alerts name where they show",
          severity: "error",
          why: "A Tab or Object alert appears on one screen only. With no context name the app doesn't know which one, so it never shows.",
          steps: ["Open the alert in App Launcher > App Alerts", "Fill in Display Context Name with the tab or object API name, or set the context to Global"],
          uiPath: "App Launcher > App Alerts",
          surface: "objects",
        },
        async () => {
          const rows = await query(`SELECT Id, Subject FROM AppAlert WHERE DisplayContextType IN ('Tab', 'Object') AND DisplayContextName = null LIMIT 20`, org);
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "alert")} with a Tab or Object context and no name.`, examples: nameList(rows, "Subject") }
            : { pass: true, detail: "None." };
        }
      ),

      runCheck(
        {
          id: "app-alerts.config.announcement-images",
          stage: "config",
          title: "Announcements in effect have an image",
          severity: "info",
          why: "The Home Office Announcements widget is a banner. An announcement with no image URL shows as plain text and is easy to miss.",
          steps: ["Open the announcement in App Launcher > App Alerts", "Set Image URL"],
          uiPath: "App Launcher > App Alerts",
          surface: "objects",
        },
        async () => {
          const total = await count(`SELECT COUNT() ${LIVE} AND Type = 'Announcement'`, org);
          if (!total) return { pass: true, skip: true, detail: "No announcements are in effect." };
          const rows = await query(`SELECT Id, Subject ${LIVE} AND Type = 'Announcement' AND ImageUrl = null LIMIT 20`, org);
          return rows.length
            ? { pass: false, detail: `${rows.length} of ${plural(total, "announcement")} have no image.`, examples: nameList(rows, "Subject") }
            : { pass: true, detail: `All ${plural(total, "announcement")} have an image.` };
        }
      ),

      runCheck(
        {
          id: "app-alerts.data.expired",
          stage: "data",
          title: "Fewer than half of the alerts have expired",
          severity: "info",
          why: "Expired alerts are hidden but still counted and synced to some devices. A large pile of them slows lists and hides what's current.",
          steps: ["Report on App Alerts with Valid Until in the past", "Delete the ones you no longer need"],
          uiPath: "App Launcher > App Alerts",
          surface: "objects",
        },
        async () => {
          // A share, so a sample answers it; counting every alert doesn't scale with personal notifications.
          const rows = await query(`SELECT Id FROM AppAlert LIMIT ${SAMPLE_ROWS}`, org);
          if (!rows.length) return { pass: true, skip: true, detail: "No alerts yet." };
          // TODAY in SOQL is the org's day, not this machine's.
          const expired = (await queryByIds("Id", "AppAlert", "Id", rows.map((r) => String(r.Id)), org, "ValidUntilDate < TODAY")).length;
          const detail = `${expired} of ${rows.length} have expired. ${checkedNote(rows, "alert", "alerts")}`;
          return { pass: expired * 2 <= rows.length, detail };
        }
      ),

      runCheck(
        {
          id: "app-alerts.mobile.alert-objects",
          stage: "mobile",
          title: "Alerts and their user responses sync to the iPad",
          severity: "error",
          why: "The bell and the Home Office Announcements widget read from the device's copy. A missing object means no alerts, or reads and dismissals that never come back to the org.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on each object listed below for every profile that gets alerts", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => syncResult(org, await schema, ALERT_OBJECTS, "AppAlert")
      ),
    ]);
  },
};

export default readiness;
