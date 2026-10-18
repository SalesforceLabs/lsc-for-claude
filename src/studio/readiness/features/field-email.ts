/** Field Email readiness: its validation rules plus Studio's own checks. */

import { count, plural, query } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { handlersResult, loadDbSchema, nameList, syncResult } from "./_consent-sync.js";

/** Handlers that queue, address, send, share and track emails. */
const HANDLERS = [
  "EmailQueueImmediateHandler",
  "EmailQueueRecipientHandler",
  "EmailQueueSenderHandler",
  "EmailAttachmentHandler",
  "EmailTemplateTerritorySharingHandler",
  "SyncEmailResponseStatusToObjectHandler",
  "ContactPointEmailPopulateHandler",
];

/** What reps compose from, and what consent they are checked against. */
const COMPOSE_OBJECTS = [
  "LifeSciEmailTemplate",
  "LifeSciEmailTmplFragment",
  "LifeSciEmailTmplRelaFrgmt",
  "CommSubscription",
  "CommSubscriptionConsent",
  "ContactPointEmail",
  "DataUsePurpose",
];
/** The send queue the iPad writes to and reads statuses from. */
const QUEUE_OBJECTS = ["LifeScienceEmail", "LifeScienceEmailFragment"];

const ACTIVE_JOB_STATES = "'WAITING', 'ACQUIRED', 'EXECUTING'";

const readiness: ReadinessModule = {
  ruleFiles: ["field-email-config.yaml"],
  checks: async (org) => {
    const schema = loadDbSchema(org);
    const activeTemplates = `FROM LifeSciEmailTemplate WHERE IsActive = true`;

    /** Whether a scheduled-Apex job of `apexClass` is waiting to run. */
    const scheduled = async (apexClass: string) =>
      count(
        `SELECT COUNT() FROM AsyncApexJob WHERE JobType = 'ScheduledApex' AND ApexClass.Name = '${apexClass}' AND CronTriggerId IN (SELECT Id FROM CronTrigger WHERE State IN (${ACTIVE_JOB_STATES}))`,
        org
      );

    return Promise.all([
      runCheck(
        {
          id: "field-email.enabled.handlers",
          stage: "enabled",
          title: "Field Email trigger handlers are switched on",
          severity: "error",
          why: "These handlers address each queued email, send the immediate ones, share templates with territories, attach files and write delivery statuses back. With one off, emails sit in the queue or never reach the right reps.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on each handler listed below"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        () => handlersResult(org, HANDLERS)
      ),

      runCheck(
        {
          id: "field-email.enabled.status-job",
          stage: "enabled",
          title: "The Fetch Status job is scheduled",
          severity: "warning",
          why: "This job reads delivery, open and bounce statuses back from the email provider. Without it every sent email stays at its first status and bounces are never recorded against the HCP.",
          steps: ["Open Admin Console > Email > Jobs", "Schedule the Fetch Status job, at the same frequency as the Send Email job"],
          uiPath: "Admin Console > Email > Jobs",
          surface: "adminSettings",
        },
        async () => {
          const n = await scheduled("EmailAttemptStatusSchedulable");
          return n ? { pass: true, detail: "Scheduled." } : { pass: false, detail: "No Fetch Status job is scheduled." };
        }
      ),

      runCheck(
        {
          id: "field-email.access.template-sharing",
          stage: "access",
          title: "Active email templates are shared with territories",
          severity: "error",
          why: "Reps only see templates that are shared with their territory. A template with only its owner on the sharing list is invisible to every rep, however well it's configured.",
          steps: ["Open the template in Admin Console > Email", "Assign it to the territories whose reps should use it", "Check the Email Template Territory Sharing handler is on"],
          uiPath: "Admin Console > Email > Template > Territories",
          surface: "objects",
        },
        async () => {
          const total = await count(`SELECT COUNT() ${activeTemplates}`, org);
          if (!total) return { pass: true, skip: true, detail: "No active email templates." };
          const rows = await query(
            `SELECT Id, Name ${activeTemplates} AND Id NOT IN (SELECT ParentId FROM LifeSciEmailTemplateShare WHERE RowCause != 'Owner') LIMIT 20`,
            org
          );
          return rows.length
            ? { pass: false, detail: `${rows.length} of ${plural(total, "active template")} aren't shared with anyone.`, examples: nameList(rows) }
            : { pass: true, detail: `All ${plural(total, "active template")} are shared.` };
        }
      ),

      runCheck(
        {
          id: "field-email.config.template-consent",
          stage: "config",
          title: "Active templates are tied to a communication subscription",
          severity: "warning",
          why: "The subscription is what the consent check is run against. A template with none (and not set to ignore consent) can't be checked, so the app can't tell whether the HCP agreed to receive it.",
          steps: ["Open the template in Admin Console > Email", "Pick its Communication Subscription, or tick Ignore consent if no consent applies", "Save"],
          uiPath: "Admin Console > Email > Template",
          surface: "objects",
        },
        async () => {
          const total = await count(`SELECT COUNT() ${activeTemplates}`, org);
          if (!total) return { pass: true, skip: true, detail: "No active email templates." };
          const rows = await query(`SELECT Id, Name ${activeTemplates} AND CommunicationSubscriptionId = null AND ShouldIgnoreEmailConsent = false LIMIT 20`, org);
          return rows.length
            ? { pass: false, detail: `${rows.length} of ${plural(total, "active template")} have no subscription and still require consent.`, examples: nameList(rows) }
            : { pass: true, detail: `All ${plural(total, "active template")} have a subscription or ignore consent.` };
        }
      ),

      runCheck(
        {
          id: "field-email.config.template-expired",
          stage: "config",
          title: "No active template is past its end date",
          severity: "warning",
          why: "A template is only offered between its start and end dates. One that's still marked active but has ended has quietly disappeared from the rep's list.",
          steps: ["Open the template in Admin Console > Email", "Extend the end date, or deactivate the template"],
          uiPath: "Admin Console > Email > Template",
          surface: "objects",
        },
        async () => {
          const rows = await query(`SELECT Id, Name, EffectiveEndDate ${activeTemplates} AND EffectiveEndDate < TODAY LIMIT 20`, org);
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "active template")} past the end date.`, examples: rows.map((r) => `${r.Name} (ended ${r.EffectiveEndDate})`) }
            : { pass: true, detail: "None have ended." };
        }
      ),

      runCheck(
        {
          id: "field-email.config.template-product",
          stage: "config",
          title: "Active templates are linked to a product",
          severity: "info",
          why: "The product link ties a sent email to what was promoted, so it shows up in product reporting and can be filtered by the rep's products. Without it the template still sends.",
          steps: ["Open the template in Admin Console > Email", "Pick the marketable product", "Save"],
          uiPath: "Admin Console > Email > Template",
          surface: "objects",
        },
        async () => {
          const total = await count(`SELECT COUNT() ${activeTemplates}`, org);
          if (!total) return { pass: true, skip: true, detail: "No active email templates." };
          const rows = await query(`SELECT Id, Name ${activeTemplates} AND ProductId = null LIMIT 20`, org);
          return rows.length
            ? { pass: false, detail: `${rows.length} of ${plural(total, "active template")} have no product.`, examples: nameList(rows) }
            : { pass: true, detail: `All ${plural(total, "active template")} have a product.` };
        }
      ),

      runCheck(
        {
          id: "field-email.data.queue-stuck",
          stage: "data",
          title: "No email has been waiting in the queue for over a day",
          severity: "error",
          why: "Emails in New or Retry should leave the queue within one run of the Send Email job. Ones that don't mean the job isn't running, the sending limit was hit, or the same error keeps repeating.",
          steps: ["Check the Send Email job is scheduled", "Open Admin Console > Email > Queue and read the error on the Retry emails", "Raise the sending limit or fix the cause, then resend"],
          uiPath: "Admin Console > Email > Queue",
          surface: "objects",
        },
        async () => {
          const [stuck, jobOn] = await Promise.all([
            count(`SELECT COUNT() FROM LifeScienceEmail WHERE Status IN ('New', 'Retry') AND CreatedDate < LAST_N_DAYS:1`, org),
            scheduled("EmailQueueSendSchedulable"),
          ]);
          if (!stuck) return { pass: true, detail: "Nothing is stuck." };
          return {
            pass: false,
            detail: `${plural(stuck, "email")} waiting more than a day${jobOn ? "" : "; the Send Email job isn't scheduled"}.`,
          };
        }
      ),

      runCheck(
        {
          id: "field-email.data.bounced",
          stage: "data",
          title: "Few sent emails have bounced",
          severity: "info",
          why: "Bounces point at wrong or retired addresses. Each one is an HCP who thinks they've been contacted and wasn't, so clean up the contact point.",
          steps: ["Report on Emails with Bounced checked", "Correct or remove the address on the HCP's Contact Point Email"],
          uiPath: "App Launcher > Emails",
          surface: "objects",
        },
        async () => {
          const [bounced, sent] = await Promise.all([
            count(`SELECT COUNT() FROM LifeScienceEmail WHERE IsBounced = true`, org),
            count(`SELECT COUNT() FROM LifeScienceEmail WHERE Status = 'Success'`, org),
          ]);
          if (!sent && !bounced) return { pass: true, skip: true, detail: "No emails have been sent yet." };
          return bounced ? { pass: false, detail: `${bounced} bounced of ${plural(sent, "sent email")}.` } : { pass: true, detail: `None of ${plural(sent, "sent email")} bounced.` };
        }
      ),

      runCheck(
        {
          id: "field-email.mobile.compose-objects",
          stage: "mobile",
          title: "Templates, fragments, subscriptions, consent and email addresses sync to the iPad",
          severity: "error",
          why: "Reps compose offline, so the templates, fragments, consent and contact points have to be on the device. A missing one means no template list or a consent check that can't be done.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on each object listed below for every profile that sends email", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => syncResult(org, await schema, COMPOSE_OBJECTS)
      ),

      runCheck(
        {
          id: "field-email.mobile.queue-objects",
          stage: "mobile",
          title: "The email queue syncs to and from the iPad",
          severity: "error",
          why: "A composed email is a LifeScienceEmail record created on the device and uploaded at sync. If it isn't in the DB Schema the email never reaches the org's send queue.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on each object listed below for every profile that sends email", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => syncResult(org, await schema, QUEUE_OBJECTS)
      ),
    ]);
  },
};

export default readiness;
