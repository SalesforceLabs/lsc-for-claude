/** Account Management readiness: its validation rules plus Studio's own checks. */

import { collectCategoryRecords } from "../../../config/collect.js";
import { count, inList, plural, query } from "../../helpers.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { duplicateSyncResult, handlersResult, loadDbSchema, loadHandlers, once, syncResult } from "./_visit-shared.js";

const ADDRESS_HANDLERS = [
  "AccountAddressPrimaryHandler",
  "ATFPreferredAddressHandler",
  "AccountTerritoryFieldsHandler",
  "RelatedContactPointAddressHandler",
  "ContactPointEmailPopulateHandler",
  "ContactPointPhoneHandler",
  "ContactPointSocialPopulateHandler",
];
const AFFILIATION_HANDLERS = [
  "HardAffiliationHandler",
  "AffiliationReciprocalHandler",
  "AffiliationPrimaryChangeHandler",
  "AffiliationUniquenessHandler",
  "AffiliationUniquenessGenericHandler",
  "AffiliationAccountUpdateHandler",
  "HealthcareProviderAffiliationHandler",
];
const PROVIDER_HANDLERS = ["HealthcareProviderHandler", "HealthcareProviderNpiHandler", "HealthcareProviderSpecialityHandler"];

/** What the Provider Card needs offline. */
const SYNCED_OBJECTS = ["Account", "HealthcareProvider", "ContactPointAddress", "ProviderAffiliation", "ProviderAcctTerritoryInfo"];

/** DCR requests that never reached a final state after this many days are stuck. */
const DCR_STALE_DAYS = 7;

const readiness: ReadinessModule = {
  ruleFiles: ["account-management-config.yaml"],
  checks: async (org) => {
    const handlers = once(() => loadHandlers(org));
    const schema = once(() => loadDbSchema(org));
    const licenses = once(() => count(`SELECT COUNT() FROM BusinessLicense`, org));
    const managedFields = once(() => count(`SELECT COUNT() FROM LifeSciDataChgDefMngFld`, org));

    return Promise.all([
      runCheck(
        {
          id: "accounts.data.territory-info-coverage",
          stage: "data",
          title: "Every account in the active territory model has territory info",
          severity: "warning",
          why: "ProviderAcctTerritoryInfo holds the preferred address, last visit and call counts reps see per account and territory. Accounts aligned to a territory without it show blanks on the Provider Card and drop out of call planning.",
          steps: [
            "Run the territory alignment batch jobs to create territory info for new alignments",
            "Check the AccountTerritoryFieldsHandler trigger handler is active",
            "Confirm the active territory model is the one the rules were run against",
          ],
          uiPath: "Admin Console > Territory Alignment",
        },
        async () => {
          const aligned = await count(
            `SELECT COUNT() FROM ObjectTerritory2Association WHERE SobjectType = 'Account' AND Territory2.Territory2Model.State = 'Active'`,
            org
          );
          if (!aligned) return { pass: true, skip: true, detail: "No accounts are aligned in the active territory model." };
          const info = await count(`SELECT COUNT() FROM ProviderAcctTerritoryInfo WHERE IsActive = true`, org);
          const missing = Math.max(0, aligned - info);
          // Territory info can lag by a batch run; flag only a gap larger than 5%.
          return {
            pass: missing <= aligned * 0.05,
            detail: `${aligned} account alignments, ${info} active territory info records${missing ? ` (about ${missing} short)` : ""}.`,
          };
        }
      ),
      runCheck(
        {
          id: "accounts.data.preferred-address",
          stage: "data",
          title: "Territory info records point at a preferred address",
          severity: "info",
          why: "The preferred address is the one shown on the account card and used for route planning in that territory. Without it reps see the account with no location.",
          steps: ["Mark a primary address on the account", "Make sure ATFPreferredAddressHandler is active, then re-save or re-run the territory field job"],
          uiPath: "Admin Console > Account Management > Address Administration & Setup",
        },
        async () => {
          const total = await count(`SELECT COUNT() FROM ProviderAcctTerritoryInfo WHERE IsActive = true`, org);
          if (!total) return { pass: true, skip: true, detail: "No active territory info records." };
          const n = await count(`SELECT COUNT() FROM ProviderAcctTerritoryInfo WHERE IsActive = true AND PreferredAddressId = null`, org);
          return { pass: n === 0, detail: n ? `${n} of ${total} have no preferred address.` : `All ${total} have a preferred address.` };
        }
      ),
      runCheck(
        {
          id: "accounts.data.hcps-have-address",
          stage: "data",
          title: "Every HCP has at least one address",
          severity: "warning",
          why: "Addresses drive visit planning, maps, territory geo-alignment and license checks. An HCP with none can't be routed or aligned by geography.",
          steps: ["Load or create a Contact Point Address for each HCP listed", "Check the data load set ParentId to the person account"],
          uiPath: "Account > Addresses",
        },
        async () => {
          const total = await count(`SELECT COUNT() FROM Account WHERE IsPersonAccount = true`, org);
          if (!total) return { pass: true, skip: true, detail: "No person accounts." };
          const where = `IsPersonAccount = true AND Id NOT IN (SELECT ParentId FROM ContactPointAddress)`;
          const n = await count(`SELECT COUNT() FROM Account WHERE ${where}`, org);
          const rows = n ? await query(`SELECT Name FROM Account WHERE ${where} LIMIT 5`, org) : [];
          return {
            pass: n === 0,
            detail: n ? `${n} of ${total} person accounts have no address.` : `All ${total} person accounts have an address.`,
            examples: rows.map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "accounts.data.primary-address",
          stage: "data",
          title: "Every account with addresses has a primary one",
          severity: "warning",
          why: "The primary address is what the account list, map and visit defaults use. With several addresses and none primary, the app picks arbitrarily.",
          steps: ["Open each account listed and mark one address Primary", "Keep AccountAddressPrimaryHandler active so only one stays primary"],
          uiPath: "Account > Addresses",
        },
        async () => {
          const where = `Id IN (SELECT ParentId FROM ContactPointAddress) AND Id NOT IN (SELECT ParentId FROM ContactPointAddress WHERE IsPrimary = true)`;
          const n = await count(`SELECT COUNT() FROM Account WHERE ${where}`, org);
          const rows = n ? await query(`SELECT Name FROM Account WHERE ${where} LIMIT 5`, org) : [];
          return {
            pass: n === 0,
            detail: n ? `${plural(n, "account")} have addresses but none marked primary.` : "Every account with addresses has a primary one.",
            examples: rows.map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "accounts.data.hcps-have-provider-record",
          stage: "data",
          title: "Every person account has a Healthcare Provider record",
          severity: "warning",
          why: "Specialty, NPI, title and status live on HealthcareProvider. A person account without one has no professional details on the Provider Card and can't be found by specialty.",
          steps: ["Create a Healthcare Provider record linked to the account", "Load HealthcareProvider alongside person accounts in the migration"],
          uiPath: "Healthcare Providers tab",
        },
        async () => {
          const where = `IsPersonAccount = true AND Id NOT IN (SELECT AccountId FROM HealthcareProvider)`;
          const n = await count(`SELECT COUNT() FROM Account WHERE ${where}`, org);
          const rows = n ? await query(`SELECT Name FROM Account WHERE ${where} LIMIT 5`, org) : [];
          return {
            pass: n === 0,
            detail: n ? `${plural(n, "person account")} without a Healthcare Provider record.` : "Every person account has a Healthcare Provider record.",
            examples: rows.map((r) => String(r.Name)),
          };
        }
      ),
      runCheck(
        {
          id: "accounts.data.licenses-current",
          stage: "data",
          title: "Active business licenses haven't expired",
          severity: "warning",
          why: "License validation blocks sample drops and orders for an HCP whose license has lapsed. An expired license still marked active hides that until a rep is stopped at the visit.",
          steps: ["Collect the renewed license and update its period end, or mark the license inactive"],
          uiPath: "Account > Business Licenses",
        },
        async () => {
          if (!(await licenses())) return { pass: true, skip: true, detail: "No business licenses — optional." };
          const where = `IsActive = true AND PeriodEnd < TODAY`;
          const n = await count(`SELECT COUNT() FROM BusinessLicense WHERE ${where}`, org);
          const rows = n ? await query(`SELECT Name, LicenseNumber, PeriodEnd FROM BusinessLicense WHERE ${where} ORDER BY PeriodEnd DESC LIMIT 5`, org) : [];
          return {
            pass: n === 0,
            detail: n ? `${plural(n, "active license")} past the period end date.` : "No active license is past its end date.",
            examples: rows.map((r) => `${r.Name} ${r.LicenseNumber ?? ""} (ended ${String(r.PeriodEnd).slice(0, 10)})`.replace("  ", " ")),
          };
        }
      ),
      runCheck(
        {
          id: "accounts.data.affiliations-current",
          stage: "data",
          title: "Active affiliations haven't ended",
          severity: "info",
          why: "An affiliation past its end date but still active keeps showing in the network view and affiliation-based territory rules.",
          steps: ["Mark the affiliation inactive, or extend its end date"],
          uiPath: "Account > Affiliations",
        },
        async () => {
          if (!(await count(`SELECT COUNT() FROM ProviderAffiliation`, org))) return { pass: true, skip: true, detail: "No affiliations." };
          const n = await count(`SELECT COUNT() FROM ProviderAffiliation WHERE IsActive = true AND EffectiveEndDate < TODAY`, org);
          return { pass: n === 0, detail: n ? `${plural(n, "affiliation")} active past their end date.` : "No active affiliation is past its end date." };
        }
      ),
      runCheck(
        {
          id: "accounts.data.dcr-not-stuck",
          stage: "data",
          title: "Data change requests aren't stuck",
          severity: "warning",
          why: "A request that stays Not Processed, Failed or Retry means the change a rep or MDM submitted never reaches the account.",
          steps: ["Open the request and read its Failure Reason", "Fix the cause (validation rule, field access, missing target) and set Status to Retry"],
          uiPath: "Data Change Requests tab",
        },
        async () => {
          if (!(await managedFields()) && !(await count(`SELECT COUNT() FROM LifeSciDataChangeRequest`, org)))
            return { pass: true, skip: true, detail: "Data change requests aren't set up — optional." };
          const where = `Status IN ('NotProcessed', 'Failed', 'Retry') AND CreatedDate < LAST_N_DAYS:${DCR_STALE_DAYS}`;
          const n = await count(`SELECT COUNT() FROM LifeSciDataChangeRequest WHERE ${where}`, org);
          const rows = n ? await query(`SELECT Name, Status, FailureReason FROM LifeSciDataChangeRequest WHERE ${where} LIMIT 5`, org) : [];
          return {
            pass: n === 0,
            detail: n ? `${plural(n, "request")} unprocessed for more than ${DCR_STALE_DAYS} days.` : "No request is stuck.",
            examples: rows.map((r) => `${r.Name} (${r.Status})`),
          };
        }
      ),
      runCheck(
        {
          id: "accounts.config.address-handlers",
          stage: "config",
          title: "Address and contact point handlers are switched on",
          severity: "warning",
          why: "They keep one primary address per account, set the preferred address on territory info, and copy email, phone and social handles onto the account.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on each handler listed"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        async () => handlersResult(await handlers(), ADDRESS_HANDLERS)
      ),
      runCheck(
        {
          id: "accounts.config.affiliation-handlers",
          stage: "config",
          title: "Affiliation handlers are switched on",
          severity: "warning",
          why: "They create the reverse affiliation, keep one primary per account, and block duplicates. With them off the network view fills with one-way and duplicate links.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on each handler listed"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        async () => handlersResult(await handlers(), AFFILIATION_HANDLERS)
      ),
      runCheck(
        {
          id: "accounts.config.provider-handlers",
          stage: "config",
          title: "Healthcare provider handlers are switched on",
          severity: "warning",
          why: "They populate provider name fields, validate the NPI and maintain specialties. Off, provider search and the Provider Card show incomplete details.",
          steps: ["Open Admin Console > Trigger Handlers", "Switch on each handler listed"],
          uiPath: "Admin Console > Trigger Handlers",
          surface: "triggerHandlers",
        },
        async () => handlersResult(await handlers(), PROVIDER_HANDLERS)
      ),
      runCheck(
        {
          id: "accounts.config.address-formula-field",
          stage: "config",
          title: "The address display formula field exists",
          severity: "warning",
          why: "Admin Console > Address Administration names a formula field on Contact Point Address that the iPad shows as the address line. If it is blank or the field was deleted, addresses show empty.",
          steps: ["Open Admin Console > Account Management > Address Administration & Setup", "Pick a formula field that exists on Contact Point Address"],
          uiPath: "Admin Console > Account Management > Address Administration & Setup",
          surface: "adminSettings",
        },
        async () => {
          const records = await collectCategoryRecords(org, `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category = 'AddressSettings'`, { strict: true });
          const active = records.find((r) => r.isActive);
          if (!active) return { pass: true, skip: true, detail: "Address settings aren't configured in this org." };
          const field = String(active.fields.ContactPointAddressFormulaField ?? "").trim();
          if (!field) return { pass: false, detail: "No address formula field is set in Address settings." };
          const found = await query(
            `SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = 'ContactPointAddress' AND QualifiedApiName IN (${inList([field])})`,
            org
          );
          return found.length ? { pass: true, detail: `Using ${field}.` } : { pass: false, detail: `Address settings name ${field}, which isn't a field on Contact Point Address.` };
        }
      ),
      runCheck(
        {
          id: "accounts.mobile.db-schema",
          stage: "mobile",
          title: "Accounts, providers, addresses and affiliations sync to the iPad",
          severity: "error",
          why: "The Provider Card is built from the device's offline copy. An object with no active DB Schema record is empty on the iPad.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Add or switch on a record for each object listed, assigned to the reps' profiles", "Publish to the iPad"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => {
          const objects = (await licenses()) ? [...SYNCED_OBJECTS, "BusinessLicense"] : SYNCED_OBJECTS;
          return syncResult(org, await schema(), objects);
        }
      ),
      runCheck(
        {
          id: "accounts.mobile.one-sync-per-object",
          stage: "mobile",
          title: "No object syncs through two active DB Schema records",
          severity: "warning",
          why: "When two active records cover the same object for a profile, the app uses one filter and ignores the other, so a WHERE clause you edited may not be the one in effect.",
          steps: ["Open Admin Console > Mobile > DB Schema", "Keep one record per object and profile, merging the filters, and deactivate the other"],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => duplicateSyncResult(await schema(), SYNCED_OBJECTS)
      ),
    ]);
  },
};

export default readiness;
