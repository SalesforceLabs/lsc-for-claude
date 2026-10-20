/** Account Management readiness: its validation rules plus Studio's own checks. */

import { collectCategoryRecords } from "../../../config/collect.js";
import { activeTerritories } from "../../collectors/territory-users.js";
import { count, countGroupedBy, inList, plural, query, queryByIds, type Row } from "../../helpers.js";
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
/** Only requests created this recently are counted, so the count uses the CreatedDate index. */
const DCR_WINDOW_DAYS = 90;

/*
 * The data checks look at a fixed number of records the reps work with: active territory info rows
 * and their accounts, plus the addresses, provider records, licenses and affiliations of those
 * accounts, looked up by id. Asking "is any account in the org missing X?" means scanning every
 * account when the answer is no, which times out in large orgs; a sample costs the same everywhere.
 * When the org has fewer rows than the sample size, the sample is all of them.
 */
const SAMPLE_ROWS = 500;
/** Territories whose alignments the coverage check samples (an IN list has to fit in the URL). */
const SAMPLE_TERRITORIES = 200;

interface SampledAccount {
  name: string;
  person: boolean;
}
interface Sample {
  /** Active territory info rows read. */
  rows: Row[];
  accounts: Map<string, SampledAccount>;
  /** Every active territory info row was read. */
  complete: boolean;
}

async function loadSample(org: string): Promise<Sample> {
  const rows = await query(
    `SELECT AccountId, Account.Name, Account.IsPersonAccount, Territory2Id, PreferredAddressId FROM ProviderAcctTerritoryInfo WHERE IsActive = true AND AccountId != null LIMIT ${SAMPLE_ROWS}`,
    org
  );
  const accounts = new Map<string, SampledAccount>();
  for (const r of rows) {
    const a = (r.Account ?? {}) as Row;
    accounts.set(String(r.AccountId), { name: String(a.Name ?? r.AccountId), person: a.IsPersonAccount === true });
  }
  return { rows, accounts, complete: rows.length < SAMPLE_ROWS };
}

/** "1 HCP" / "3 HCPs" for nouns `plural` can't spell. */
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/**
 * The sentence saying what was looked at, so a pass is never read as "the whole org is clean".
 * `what` names the accounts drawn from the sample ("310 HCPs"); omit it for the rows themselves.
 */
function checkedNote(s: Sample, what?: string): string {
  if (s.complete) return what ? `Checked all ${what} in territories.` : `Checked all ${s.rows.length}.`;
  return what
    ? `Checked the ${what} among a sample of ${SAMPLE_ROWS} territory info records, not every one in the org.`
    : `Checked a sample of ${SAMPLE_ROWS}, not every one in the org.`;
}

const isAre = (n: number) => (n === 1 ? "is" : "are");
const hasHave = (n: number) => (n === 1 ? "has" : "have");

/** Whether any row exists — one row read instead of a count over the whole table. */
async function exists(object: string, org: string): Promise<boolean> {
  return (await query(`SELECT Id FROM ${object} LIMIT 1`, org)).length > 0;
}

const readiness: ReadinessModule = {
  ruleFiles: ["account-management-config.yaml"],
  checks: async (org) => {
    const handlers = once(() => loadHandlers(org));
    const schema = once(() => loadDbSchema(org));
    const licenses = once(() => exists("BusinessLicense", org));
    const sample = once(() => loadSample(org));
    const ids = async () => [...(await sample()).accounts.keys()];
    const addresses = once(async () => countGroupedBy("ContactPointAddress", "ParentId", await ids(), org));
    const primaries = once(async () => countGroupedBy("ContactPointAddress", "ParentId", await ids(), org, "IsPrimary = true"));
    const persons = async () => [...(await sample()).accounts].filter(([, a]) => a.person).map(([id]) => id);
    const providers = once(async () => countGroupedBy("HealthcareProvider", "AccountId", await persons(), org));
    const NO_SAMPLE = { pass: true, skip: true, detail: "No active territory info records, so there are no accounts reps work with to check." };

    return Promise.all([
      runCheck(
        {
          id: "accounts.data.territory-info-coverage",
          stage: "data",
          title: "Accounts aligned in the active territory model have territory info",
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
          const { rows: territories, model } = await activeTerritories(org);
          if (!model) return { pass: true, skip: true, detail: "No active territory model." };
          // Spread the IN list over the model's territories rather than taking the first ones.
          const step = Math.max(1, Math.ceil(territories.length / SAMPLE_TERRITORIES));
          const picked = territories.filter((_, i) => i % step === 0).map((t) => String(t.Id));
          if (!picked.length) return { pass: true, skip: true, detail: "The active territory model has no territories." };
          const alignments = await query(
            `SELECT ObjectId, Territory2Id FROM ObjectTerritory2Association WHERE SobjectType = 'Account' AND Territory2Id IN (${inList(picked)}) LIMIT ${SAMPLE_ROWS}`,
            org
          );
          if (!alignments.length) return { pass: true, skip: true, detail: "No accounts are aligned in the active territory model." };
          const accountIds = [...new Set(alignments.map((r) => String(r.ObjectId)))];
          const info = await queryByIds("AccountId, Territory2Id, IsActive", "ProviderAcctTerritoryInfo", "AccountId", accountIds, org);
          const key = (account: unknown, territory: unknown) => `${account}:${territory}`;
          const active = new Set(info.filter((r) => r.IsActive).map((r) => key(r.AccountId, r.Territory2Id)));
          const inactive = new Set(info.filter((r) => !r.IsActive).map((r) => key(r.AccountId, r.Territory2Id)));
          const missing = alignments.filter((r) => !active.has(key(r.ObjectId, r.Territory2Id)));
          const deactivated = missing.filter((r) => inactive.has(key(r.ObjectId, r.Territory2Id))).length;
          const why = deactivated
            ? `: ${deactivated} ${hasHave(deactivated)} only inactive territory info, ${missing.length - deactivated} ${hasHave(missing.length - deactivated)} none`
            : "";
          const complete = alignments.length < SAMPLE_ROWS && picked.length === territories.length;
          const scope = complete ? `Checked all ${many(alignments.length, "account alignment", "account alignments")}.` : `Checked ${many(alignments.length, "account alignment", "account alignments")} in ${many(picked.length, "territory", "territories")}, not every alignment in the org.`;
          // Territory info can lag by a batch run; flag only a gap larger than 5%.
          return {
            pass: missing.length <= alignments.length * 0.05,
            detail: missing.length ? `${missing.length} of ${alignments.length} alignments have no active territory info${why}. ${scope}` : `Every alignment checked has territory info. ${scope}`,
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
          steps: [
            "For an account with no address, add a Contact Point Address first",
            "For an account with addresses, mark one as primary",
            "Make sure ATFPreferredAddressHandler is active, then re-save or re-run the territory field job",
          ],
          uiPath: "Admin Console > Account Management > Address Administration & Setup",
        },
        async () => {
          const s = await sample();
          if (!s.rows.length) return NO_SAMPLE;
          const scope = checkedNote(s);
          const missing = s.rows.filter((r) => !r.PreferredAddressId);
          if (!missing.length) return { pass: true, detail: `Every one has a preferred address. ${scope}` };
          // Marking a primary address only helps where the account has one; the rest need an address first.
          const withAddresses = await addresses();
          const withAddress = missing.filter((r) => withAddresses.has(String(r.AccountId))).length;
          const noAddress = missing.length - withAddress;
          const parts = [
            withAddress ? `${withAddress} ${isAre(withAddress)} for accounts with addresses but none preferred` : "",
            noAddress ? `${noAddress} ${isAre(noAddress)} for accounts with no address at all` : "",
          ].filter(Boolean);
          return {
            pass: false,
            detail: `${missing.length} of ${s.rows.length} territory info records have no preferred address: ${parts.join(", ")}. ${scope}`,
            examples: [...new Set(missing.map((r) => s.accounts.get(String(r.AccountId))?.name ?? String(r.AccountId)))].slice(0, 5),
          };
        }
      ),
      runCheck(
        {
          id: "accounts.data.hcps-have-address",
          stage: "data",
          title: "HCPs in territories have at least one address",
          severity: "warning",
          why: "Addresses drive visit planning, maps, territory geo-alignment and license checks. An HCP with none can't be routed or aligned by geography.",
          steps: ["Load or create a Contact Point Address for each HCP listed", "Check the data load set ParentId to the person account"],
          uiPath: "Account > Addresses",
        },
        async () => {
          const s = await sample();
          if (!s.rows.length) return NO_SAMPLE;
          const withProvider = await providers();
          const hcps = (await persons()).filter((id) => withProvider.has(id));
          if (!hcps.length) return { pass: true, skip: true, detail: "No person account with territory info has a Healthcare Provider record." };
          const withAddresses = await addresses();
          const none = hcps.filter((id) => !withAddresses.has(id));
          const scope = checkedNote(s, many(hcps.length, "HCP", "HCPs"));
          return {
            pass: !none.length,
            detail: none.length ? `${none.length} of ${hcps.length} ${hasHave(none.length)} no address. ${scope}` : `Every HCP checked has an address. ${scope}`,
            examples: none.slice(0, 5).map((id) => s.accounts.get(id)!.name),
          };
        }
      ),
      runCheck(
        {
          id: "accounts.data.primary-address",
          stage: "data",
          title: "Accounts with addresses have a primary one",
          severity: "warning",
          why: "The primary address is what the account list, map and visit defaults use. With several addresses and none primary, the app picks arbitrarily.",
          steps: ["Open each account listed and mark one address Primary", "Keep AccountAddressPrimaryHandler active so only one stays primary"],
          uiPath: "Account > Addresses",
        },
        async () => {
          const s = await sample();
          if (!s.rows.length) return NO_SAMPLE;
          const [withAddresses, withPrimary] = await Promise.all([addresses(), primaries()]);
          const addressed = [...withAddresses.keys()];
          if (!addressed.length) return { pass: true, skip: true, detail: "None of the accounts checked has an address." };
          const none = addressed.filter((id) => !withPrimary.has(id));
          const scope = checkedNote(s, many(addressed.length, "account with addresses", "accounts with addresses"));
          return {
            pass: !none.length,
            detail: none.length ? `${none.length} of ${addressed.length} ${hasHave(none.length)} no primary address. ${scope}` : `Every one has a primary address. ${scope}`,
            examples: none.slice(0, 5).map((id) => s.accounts.get(id)?.name ?? id),
          };
        }
      ),
      runCheck(
        {
          id: "accounts.data.hcps-have-provider-record",
          stage: "data",
          title: "Person accounts in territories have a Healthcare Provider record",
          severity: "warning",
          why: "Specialty, NPI, title and status live on HealthcareProvider. A person account without one has no professional details on the Provider Card and can't be found by specialty.",
          steps: ["Create a Healthcare Provider record linked to the account", "Load HealthcareProvider alongside person accounts in the migration"],
          uiPath: "Healthcare Providers tab",
        },
        async () => {
          const s = await sample();
          if (!s.rows.length) return NO_SAMPLE;
          const people = await persons();
          if (!people.length) return { pass: true, skip: true, detail: "None of the accounts with territory info checked is a person account." };
          const withProvider = await providers();
          const none = people.filter((id) => !withProvider.has(id));
          const scope = checkedNote(s, many(people.length, "person account", "person accounts"));
          return {
            pass: !none.length,
            detail: none.length ? `${none.length} of ${people.length} ${hasHave(none.length)} no Healthcare Provider record. ${scope}` : `Every one has a Healthcare Provider record. ${scope}`,
            examples: none.slice(0, 5).map((id) => s.accounts.get(id)!.name),
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
          const s = await sample();
          if (!s.rows.length) return NO_SAMPLE;
          const expired = await queryByIds("Name, LicenseNumber, PeriodEnd, AccountId", "BusinessLicense", "AccountId", await ids(), org, "IsActive = true AND PeriodEnd < TODAY");
          const scope = checkedNote(s, many(s.accounts.size, "account", "accounts"));
          return {
            pass: !expired.length,
            detail: expired.length ? `${plural(expired.length, "active license")} past the period end date. ${scope}` : `No active license is past its end date. ${scope}`,
            examples: expired.slice(0, 5).map((r) => `${r.Name} ${r.LicenseNumber ?? ""} (ended ${String(r.PeriodEnd).slice(0, 10)})`.replace("  ", " ")),
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
          if (!(await exists("ProviderAffiliation", org))) return { pass: true, skip: true, detail: "No affiliations." };
          const s = await sample();
          if (!s.rows.length) return NO_SAMPLE;
          const ended = await countGroupedBy("ProviderAffiliation", "AccountId", await ids(), org, "IsActive = true AND EffectiveEndDate < TODAY");
          const n = [...ended.values()].reduce((a, b) => a + b, 0);
          const scope = checkedNote(s, many(s.accounts.size, "account", "accounts"));
          return {
            pass: n === 0,
            detail: n ? `${plural(n, "affiliation")} active past their end date. ${scope}` : `No active affiliation is past its end date. ${scope}`,
            examples: [...ended.keys()].slice(0, 5).map((id) => s.accounts.get(id)?.name ?? id),
          };
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
          if (!(await exists("LifeSciDataChgDefMngFld", org)) && !(await exists("LifeSciDataChangeRequest", org)))
            return { pass: true, skip: true, detail: "Data change requests aren't set up — optional." };
          const where = `Status IN ('NotProcessed', 'Failed', 'Retry') AND CreatedDate = LAST_N_DAYS:${DCR_WINDOW_DAYS} AND CreatedDate < LAST_N_DAYS:${DCR_STALE_DAYS}`;
          const n = await count(`SELECT COUNT() FROM LifeSciDataChangeRequest WHERE ${where}`, org);
          const rows = n ? await query(`SELECT Name, Status, FailureReason FROM LifeSciDataChangeRequest WHERE ${where} LIMIT 5`, org) : [];
          return {
            pass: n === 0,
            detail: n
              ? `${plural(n, "request")} from the last ${DCR_WINDOW_DAYS} days unprocessed for more than ${DCR_STALE_DAYS} days.`
              : `No request from the last ${DCR_WINDOW_DAYS} days is stuck.`,
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
          const records = await collectCategoryRecords(org, `SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category = 'AddressSettings'`, { strict: true, cache: true });
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
