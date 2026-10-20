/** Consent Management readiness: its validation rules plus Studio's own checks. */

import { fetchCategories } from "../../collectors/shared.js";
import { count, plural, query } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { handlersResult, loadDbSchema, nameList, syncResult } from "./_consent-sync.js";

/** Handlers that name, share, snapshot and de-duplicate consent records and their signature files. */
const HANDLERS = [
  "ConsentNameCommSubHandler",
  "ConsentGiverConsentHandler",
  "ConsentGiverSnapshotHandler",
  "ConsentSharingHandler",
  "ConsentSnapshotSharingHandler",
  "ConsentUniqueRecordHandler",
  "ConsentContentDocumentHandler",
  "ConsentContentDocumentLinkHandler",
];

/** What reps pick from when capturing consent. */
const REFERENCE_OBJECTS = ["CommSubscription", "CommSubscriptionChannelType", "EngagementChannelType", "DataUsePurpose", "ComplianceStatementDef"];
/** What capturing consent writes and reads on the iPad. */
const CAPTURE_OBJECTS = ["CommSubscriptionConsent", "CommSubConsentCmplSnpsht", "ContactPointEmail", "ContactPointPhone", "DigitalSignature"];

/*
 * CommSubscriptionConsent holds a row per HCP, subscription and channel, so in a large org it has
 * millions. Its status and end date fields have no index: a count filtered on them alone reads every
 * row, and is slowest when nothing matches. The data checks either count inside a CreatedDate window
 * (indexed) or read a fixed number of Opt In consents and look at their end dates here.
 */
const SAMPLE_ROWS = 500;
/** A pending consent older than this hasn't been confirmed. */
const PENDING_DAYS = 30;
/** Only consents created this recently are counted, so the count uses the CreatedDate index. */
const PENDING_WINDOW_DAYS = 365;

const readiness: ReadinessModule = {
  ruleFiles: ["consent-management-config.yaml"],
  checks: async (org) => {
    const schema = loadDbSchema(org);
    return Promise.all([
      runCheck(
        {
          id: "consent.enabled.handlers",
          stage: "enabled",
          title: "Consent trigger handlers are switched on",
          severity: "error",
          why: "These handlers name each consent record, share it with the right territories, snapshot the disclaimer text, and block duplicates. With one off, consent saves but isn't visible, auditable or unique.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on each handler listed below"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        () => handlersResult(org, HANDLERS)
      ),

      runCheck(
        {
          id: "consent.config.opt-administration",
          stage: "config",
          title: "Consent Management general settings are saved and active",
          severity: "warning",
          why: "Signature requirement, attachment requirement, the Not Asked option and multiple channel values all come from this one Admin Console record. Without an active one the iPad falls back to defaults you didn't choose.",
          steps: ["Open Admin Console > Consent Management > General Settings", "Set the signature and attachment requirements, then save"],
          uiPath: "Admin Console > Consent Management > General Settings",
          surface: "adminSettings",
        },
        async () => {
          const records = await fetchCategories(org, ["OptAdministration"], true);
          const active = records.filter((r) => r.isActive);
          if (active.length) {
            const orgLevel = active.find((r) => r.isOrgLevel) ?? active[0];
            const sig = orgLevel.fields.SignatureRequirements;
            return { pass: true, detail: `${plural(active.length, "active record")}${sig ? `; signature ${String(sig).toLowerCase()}` : ""}.` };
          }
          const off = records.find((r) => r.isOrgLevel) ?? records[0];
          return {
            pass: false,
            detail: records.length ? "The settings record exists but is switched off." : "No consent settings have been saved.",
            fixes: off
              ? [
                  {
                    kind: "setActive",
                    label: `Switch on ${off.label || off.developerName}`,
                    record: { type: "config", category: "OptAdministration", developerName: off.developerName, label: off.label || off.developerName },
                    from: false,
                    to: true,
                  },
                ]
              : undefined,
          };
        }
      ),

      runCheck(
        {
          id: "consent.config.subscription-channels",
          stage: "config",
          title: "Every communication subscription has at least one channel",
          severity: "warning",
          why: "A subscription with no channel mapping shows up on the consent screen with nothing to opt in to, so reps can't record a choice for it.",
          steps: ["Open Communication Subscription Channel Types", "Add a record linking each subscription below to its channels (Email, Phone, …)"],
          uiPath: "App Launcher > Communication Subscription Channel Types",
          surface: "objects",
        },
        async () => {
          const total = await count(`SELECT COUNT() FROM CommSubscription`, org);
          if (!total) return { pass: true, skip: true, detail: "No communication subscriptions yet." };
          const rows = await query(
            `SELECT Id, Name FROM CommSubscription WHERE Id NOT IN (SELECT CommunicationSubscriptionId FROM CommSubscriptionChannelType) LIMIT 20`,
            org
          );
          return rows.length
            ? { pass: false, detail: `${rows.length} of ${plural(total, "subscription")} have no channel.`, examples: nameList(rows) }
            : { pass: true, detail: `All ${plural(total, "subscription")} have a channel.` };
        }
      ),

      runCheck(
        {
          id: "consent.config.channel-active",
          stage: "config",
          title: "Subscriptions aren't mapped to inactive channel types",
          severity: "warning",
          why: "A mapping to an inactive engagement channel type still exists but the channel is hidden, so the subscription loses an option reps expect.",
          steps: ["Open Engagement Channel Types", "Reactivate the channel type, or remove its channel mappings"],
          uiPath: "App Launcher > Engagement Channel Types",
          surface: "objects",
        },
        async () => {
          const rows = await query(
            `SELECT Id, CommunicationSubscription.Name, EngagementChannelType.Name FROM CommSubscriptionChannelType WHERE EngagementChannelTypeId IN (SELECT Id FROM EngagementChannelType WHERE IsActive = false) LIMIT 20`,
            org
          );
          const label = (r: Record<string, unknown>) =>
            `${(r.CommunicationSubscription as { Name?: string } | null)?.Name ?? "?"} → ${(r.EngagementChannelType as { Name?: string } | null)?.Name ?? "?"}`;
          return rows.length
            ? { pass: false, detail: `${plural(rows.length, "mapping")} point at an inactive channel type.`, examples: rows.map(label) }
            : { pass: true, detail: "Every mapping points at an active channel type." };
        }
      ),

      runCheck(
        {
          id: "consent.config.subscription-purpose",
          stage: "config",
          title: "Every communication subscription has a data use purpose",
          severity: "warning",
          why: "The data use purpose is the reason a subscription exists, and usually points at the marketable product it is about. A subscription without one, and the consents captured for it, aren't tied to a product or purpose.",
          steps: ["Open each subscription listed below", "Set Data Use Purpose, then save"],
          uiPath: "App Launcher > Communication Subscriptions",
          surface: "objects",
        },
        async () => {
          const total = await count(`SELECT COUNT() FROM CommSubscription`, org);
          if (!total) return { pass: true, skip: true, detail: "No communication subscriptions yet." };
          const rows = await query(`SELECT Id, Name FROM CommSubscription WHERE DataUsePurposeId = null LIMIT 20`, org);
          return rows.length
            ? { pass: false, detail: `${rows.length} of ${plural(total, "subscription")} have no data use purpose.`, examples: nameList(rows) }
            : { pass: true, detail: `All ${plural(total, "subscription")} have one.` };
        }
      ),

      runCheck(
        {
          id: "consent.config.compliance-text",
          stage: "config",
          title: "Consent compliance statements have text",
          severity: "warning",
          why: "The disclaimer and terms shown on the consent screen come from these statements. One with no text displays an empty panel and the snapshot saved with the consent has nothing to prove what the HCP agreed to.",
          steps: ["Open Compliance Statement Definitions", "Fill in the statement text for each one listed below"],
          uiPath: "Admin Console > Compliance Statements",
          surface: "compliance",
        },
        async () => {
          // StatementText is a long text field, so it can't be filtered on; read it back instead.
          const rows = await query(`SELECT Id, Name, StatementText FROM ComplianceStatementDef WHERE ModuleType = 'Consent' LIMIT 200`, org);
          if (!rows.length) return { pass: true, skip: true, detail: "No consent compliance statements." };
          const blank = rows.filter((r) => !String(r.StatementText ?? "").trim());
          return blank.length
            ? { pass: false, detail: `${blank.length} of ${plural(rows.length, "statement")} have no text.`, examples: nameList(blank) }
            : { pass: true, detail: `${plural(rows.length, "statement")}, all with text.` };
        }
      ),

      runCheck(
        {
          id: "consent.data.pending-stale",
          stage: "data",
          title: "No consent has been pending confirmation for over 30 days",
          severity: "warning",
          why: "Opt In Pending and Opt Out Pending are the two halves of a double opt-in. A record stuck there means the HCP never confirmed, so it counts as neither consent nor refusal and can block sends.",
          steps: ["Report on Communication Subscription Consents with status Opt In Pending or Opt Out Pending", "Follow up with the HCP or reset the status"],
          uiPath: "App Launcher > Communication Subscription Consents",
          surface: "objects",
        },
        async () => {
          const n = await count(
            `SELECT COUNT() FROM CommSubscriptionConsent WHERE PrivacyConsentStatus IN ('OptInPending','OptOutPending') AND CreatedDate = LAST_N_DAYS:${PENDING_WINDOW_DAYS} AND CreatedDate < LAST_N_DAYS:${PENDING_DAYS}`,
            org
          );
          return n
            ? { pass: false, detail: `${plural(n, "consent")} created ${PENDING_DAYS} to ${PENDING_WINDOW_DAYS} days ago ${n === 1 ? "is" : "are"} still pending. Consents created earlier weren't counted.` }
            : { pass: true, detail: `No consent created ${PENDING_DAYS} to ${PENDING_WINDOW_DAYS} days ago is still pending. Consents created earlier weren't counted.` };
        }
      ),

      runCheck(
        {
          id: "consent.data.opt-in-expired",
          stage: "data",
          title: "No Opt In consent is past its end date",
          severity: "info",
          why: "A consent whose end date has passed is still marked Opt In. Depending on how consent is checked, reps may keep emailing an HCP whose consent has lapsed.",
          steps: ["Report on Communication Subscription Consents with status Opt In and an Effective To date in the past", "Re-capture consent or update the status"],
          uiPath: "App Launcher > Communication Subscription Consents",
          surface: "objects",
        },
        async () => {
          // Opt In is most consents, so this filter fills the sample quickly; the end date is checked here.
          const rows = await query(`SELECT Name, EffectiveToDate FROM CommSubscriptionConsent WHERE PrivacyConsentStatus = 'OptIn' LIMIT ${SAMPLE_ROWS}`, org);
          if (!rows.length) return { pass: true, skip: true, detail: "No Opt In consents." };
          const today = new Date().toLocaleDateString("en-CA");
          const expired = rows.filter((r) => r.EffectiveToDate && String(r.EffectiveToDate).slice(0, 10) < today);
          const scope =
            rows.length < SAMPLE_ROWS
              ? `Checked all ${plural(rows.length, "Opt In consent")}.`
              : `Checked a sample of ${SAMPLE_ROWS} Opt In consents, not every one in the org.`;
          return expired.length
            ? {
                pass: false,
                detail: `${expired.length} of ${rows.length} ${expired.length === 1 ? "is" : "are"} past the end date. ${scope}`,
                examples: expired.slice(0, 5).map((r) => `${r.Name} (ended ${String(r.EffectiveToDate).slice(0, 10)})`),
              }
            : { pass: true, detail: `None is past its end date. ${scope}` };
        }
      ),

      runCheck(
        {
          id: "consent.data.snapshots",
          stage: "data",
          title: "Recent consents were saved with a compliance snapshot",
          severity: "warning",
          why: "The snapshot freezes the disclaimer and terms the HCP saw. Consents captured without one can't prove what was agreed to, which is the point of having compliance statements.",
          steps: ["Check the Consent Management trigger handlers are on", "Check the consent compliance statements have text", "Re-capture consent for the HCPs affected"],
          uiPath: "Admin Console > Compliance Statements",
          surface: "compliance",
        },
        async () => {
          const statements = await count(`SELECT COUNT() FROM ComplianceStatementDef WHERE ModuleType = 'Consent'`, org);
          if (!statements) return { pass: true, skip: true, detail: "No consent compliance statements, so no snapshots are expected." };
          const recent = await count(`SELECT COUNT() FROM CommSubscriptionConsent WHERE CreatedDate = LAST_N_DAYS:90`, org);
          if (!recent) return { pass: true, skip: true, detail: "No consents captured in the last 90 days." };
          const bare = await count(`SELECT COUNT() FROM CommSubscriptionConsent WHERE CreatedDate = LAST_N_DAYS:90 AND CommSubConsentCmplSnpshtId = null`, org);
          return bare
            ? { pass: false, detail: `${bare} of ${plural(recent, "consent")} from the last 90 days have no snapshot.` }
            : { pass: true, detail: `All ${plural(recent, "recent consent")} have a snapshot.` };
        }
      ),

      runCheck(
        {
          id: "consent.mobile.reference-objects",
          stage: "mobile",
          title: "Subscriptions, channels and purposes sync to the iPad",
          severity: "error",
          why: "Without these objects offline, the consent screen has no subscriptions or channels to show, so reps can't capture consent in the field.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on each object listed below for every profile that captures consent", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => syncResult(org, await schema, REFERENCE_OBJECTS, "CommSubscriptionConsent")
      ),

      runCheck(
        {
          id: "consent.mobile.capture-objects",
          stage: "mobile",
          title: "Consent records, snapshots, contact points and signatures sync to the iPad",
          severity: "error",
          why: "Captured consent is written to these objects on the device and uploaded at the next sync. If one isn't synced, a consent or its signature is lost or never reaches the org.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on each object listed below for every profile that captures consent", "Publish to iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => syncResult(org, await schema, CAPTURE_OBJECTS)
      ),
    ]);
  },
};

export default readiness;
