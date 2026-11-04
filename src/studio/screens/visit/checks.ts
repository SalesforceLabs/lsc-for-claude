/**
 * Visit Engagement: what the Save / Sign / Submit checks need from the org (owned by the checks stream; see ./index.ts).
 * Mirrors module/Visit of lifesciences-ios: the plugins behind VisitEngine's validation read ProviderVisitSettings,
 * PlannerAdministration (work week), Holiday, the visit trigger handlers, the compliance statements, the rep's other visits
 * and the running Visit Action Validation script. All reads are bounded and read-only; one that fails leaves its check out.
 * `src-renderer/components/studio/visit/checks/types.ts` is the structural copy of this type — keep them equal by hand.
 */

import { apiRequest, dataPath } from "../../../salesforce/cli.js";
import { collectCategoryRecords } from "../../../config/collect.js";
import { query, type Row } from "../../helpers.js";
import { softFail, type ScreenContext } from "../context.js";

export interface VisitChecks {
  /** ProviderVisitSettings.FutureVisitLimit (days; 0 = no limit). iOS defaults to 365 when the setting is missing. */
  futureVisitLimitDays: number;
  /** SubmissionDelayReasonFields: what the delay reason sheet asks for. */
  delayReasonType: "None" | "Text" | "Picklist";
  /** SubmissionDelayReasonThreshold, in days. */
  delayReasonThresholdDays: number;
  /** Values of ProviderVisit.SubmitDelayReasonType, value → label (only for the Picklist type). */
  delayReasonOptions: { value: string; label: string }[];
  /** VisitConflictValidationPeriod (days) and VisitConflictValidationMode ("error" | "warning"; anything else = off). */
  conflictPeriodDays: number;
  conflictMode: "error" | "warning" | "off";
  /** VisitHolidayValidationHandler is active: working weekday and holiday rules apply. */
  holidayRuleOn: boolean;
  /** PlannerAdministration.FirstDayOfTheWeek ("Monday"…); the work week is five days from it. */
  firstDayOfWeek?: string;
  /** Holiday dates (yyyy-MM-dd, the user's calendar) around today; `holidaysFrom`/`holidaysTo` is the window read. */
  holidays: string[];
  holidaysFrom?: string;
  holidaysTo?: string;
  /** Compliance agreements the Visit module requires (statement type ComplianceAgreement, requirement level Required). */
  requiredStatements: { id: string; text: string }[];
  /** The rep's synced visits around today, for the conflict check (a visit the device holds). */
  visits: {
    id: string;
    accountId: string;
    accountName: string;
    ownerName: string;
    start: string;
    end: string;
  }[];
  /** The window `visits` covers (ISO dates). */
  visitsFrom?: string;
  visitsTo?: string;
  /** The Visit Action Validation script the app runs on Save / Sign / Submit; the preview does not run it. */
  script?: { id: string; name: string };
  /** Sample inventory and limits; absent when none of it could be read. */
  sample?: SampleChecks;
  /** Time off territory; absent when it couldn't be read. */
  tot?: TotChecks;
  /** The viewer's time zone, for "same day" decisions. */
  timeZone: string;
}

/** One rule of a ProviderSampleLimit (OCEDBSampleLimit.Rule), trimmed to what the check reads. */
export interface SampleLimitRule {
  strategy: "SKU" | "SHARED";
  starts?: string;
  ends?: string;
  /** What the rule has left, as the server computed it when it wrote the limit. */
  remaining: number;
  quota: number;
  calculation: "SamplesPerVisit" | "SamplesInPeriod" | "SamplesPerYear";
  /** SampleLimitFirstDropPeriod and friends. */
  periodType?: string;
  /** Period offset is set and not 0 (isRuleHasOffsetForPeriod). */
  hasOffset?: boolean;
}

/** One ProviderSampleLimit row for an account and product, its Rule JSON trimmed. */
export interface SampleLimitRow {
  accountId: string;
  /** The row's ProductId. */
  productId: string;
  template: string;
  /** Template blockType: "Warning" lets the rep continue, anything else blocks. */
  blockType: "Error" | "Warning";
  /** Postfix operations over the rule names (RULE / AND / OR). */
  operations: { op: "RULE" | "AND" | "OR"; rule?: string }[];
  /** The Rule JSON's `products`, by product id. */
  products: Record<
    string,
    {
      rules: Record<string, SampleLimitRule>;
      firstDropDate?: string;
      annualAllocations?: Record<string, number>;
      excludedChildProducts?: string[];
    }
  >;
}

/** Sample inventory and limit settings and data (SampleLimitValidationPlugin, SampleInventoryValidationPlugin). */
export interface SampleChecks {
  /** ProviderVisitSettings.ValidateSampleInventory: a sample row's lot must cover its quantity. */
  inventoryOn: boolean;
  /** SampleInventoryValidationMode: Warning lets the rep continue; anything else blocks. */
  inventoryMode: "error" | "warning";
  /** ProviderVisitSettings.ValidateSampleLimits. */
  limitsOn: boolean;
  /** ProviderVisitSettings.ValidateTerritoryQtyAllocation (not modelled; named in the skipped list). */
  territoryAllocationOn: boolean;
  /** ProviderSampleLimit rows the device holds (at most 500, newest first); the draft's account picks its own. */
  limits: SampleLimitRow[];
  /** More rows matched than were read. */
  limitsTruncated: boolean;
  /** ProviderSampleLimit isn't synced or couldn't be read. */
  limitsUnavailable?: string;
  /** ActualStartDateTime of the rep's latest completed InventoryCountAssessment (backdated visit check). */
  lastInventoryAt?: string;
  /** The backdated check could read InventoryCountAssessment. */
  inventoryCountRead: boolean;
}

/** Time off territory (TimeOffTerritoryValidationPlugin). */
export interface TotChecks {
  /** VisitTimeOffValidationHandler is active. */
  on: boolean;
  /** TimeOffTerritorySettings.RulesValidationEnabled. */
  rulesEnabled: boolean;
  /** TimeOffTerritorySettings.SetName ("Default" when missing). */
  setName: string;
  /** TimeOffTerritoryRule rows (static rule types). */
  rules: { ruleSet: string; type: string; visit: string; isParent: boolean }[];
  /** The rep's TerritoryUserDowntime rows within the window (at most 500). */
  events: { start: string; end: string; type: string }[];
  eventsFrom?: string;
  eventsTo?: string;
  /** The org has dynamic TOT rule rows, which the preview doesn't evaluate. */
  dynamicRules: boolean;
  /** TerritoryUserDowntime isn't synced or couldn't be read. */
  unavailable?: string;
}

const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const key = (row: Row | undefined, k: string): unknown =>
  row?.[Object.keys(row).find((x) => x.toLowerCase() === k.toLowerCase()) ?? k];
const int = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const ID = /^[a-zA-Z0-9]{15,18}$/;
/** Most ProviderSampleLimit rows read. */
const LIMIT_ROWS = 500;

/** The Rule JSON of a ProviderSampleLimit (OCEDBSampleLimit.SampleLimit), cut to what the check reads. */
function trimSampleLimit(r: Row): SampleLimitRow | undefined {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text(r.Rule));
  } catch {
    return undefined;
  }
  const template = (json.template ?? {}) as Record<string, unknown>;
  const ops = Array.isArray(template.operations)
    ? (template.operations as Record<string, unknown>[])
    : [];
  const products: SampleLimitRow["products"] = {};
  for (const [pid, raw] of Object.entries(
    (json.products ?? {}) as Record<string, Record<string, unknown>>
  )) {
    const rules: Record<string, SampleLimitRule> = {};
    for (const [name, rr] of Object.entries(
      (raw?.rules ?? {}) as Record<string, Record<string, unknown>>
    )) {
      const period = (rr.period ?? {}) as Record<string, unknown>;
      const params = (period.params ?? {}) as Record<string, unknown>;
      const calc = text(rr.calculation);
      if (calc !== "SamplesPerVisit" && calc !== "SamplesInPeriod" && calc !== "SamplesPerYear")
        continue;
      rules[name] = {
        strategy: text(rr.strategy) === "SHARED" ? "SHARED" : "SKU",
        starts: text(rr.starts) || undefined,
        ends: text(rr.ends) || undefined,
        remaining: int(rr.remaining, 0),
        quota: int(rr.quota, 0),
        calculation: calc,
        periodType: text(period.type) || undefined,
        hasOffset: int(params.offset, 0) !== 0,
      };
    }
    const info = (raw?.info ?? {}) as Record<string, unknown>;
    products[pid] = {
      rules,
      firstDropDate: text(info.firstDropDate) || undefined,
      annualAllocations:
        (info.annualAllocations as Record<string, number> | undefined) ?? undefined,
      excludedChildProducts: Array.isArray(info.excludedChildProducts)
        ? (info.excludedChildProducts as unknown[]).map(text)
        : undefined,
    };
  }
  return {
    accountId: text(r.AccountId),
    productId: text(r.ProductId),
    template: text(r.PrvdSampleLmtTemplateName) || text(template.name),
    blockType: text(template.blockType) === "Warning" ? "Warning" : "Error",
    operations: ops.map((o) => ({
      op: text(o.operation) === "AND" ? "AND" : text(o.operation) === "OR" ? "OR" : "RULE",
      rule: text(o.rule) || undefined,
    })),
    products,
  };
}

export async function collectVisitChecks(ctx: ScreenContext): Promise<VisitChecks | undefined> {
  const { org, adminOrg } = ctx;
  const cfg = await ctx
    .config(["ProviderVisitSettings", "PlannerAdministration", "TimeOffTerritorySettings"])
    .catch(() => ({}) as Record<string, Row>);
  const s = cfg.ProviderVisitSettings;
  const typeRaw = text(key(s, "SubmissionDelayReasonFields"));
  const delayReasonType: VisitChecks["delayReasonType"] =
    typeRaw === "Text" || typeRaw === "Picklist" ? typeRaw : "None";
  const modeRaw = text(key(s, "VisitConflictValidationMode")).toLowerCase();
  const conflictPeriodDays = Math.max(0, int(key(s, "VisitConflictValidationPeriod"), 0));
  const result: VisitChecks = {
    futureVisitLimitDays: int(key(s, "FutureVisitLimit"), 365),
    delayReasonType,
    delayReasonThresholdDays: Math.max(0, int(key(s, "SubmissionDelayReasonThreshold"), 0)),
    delayReasonOptions: [],
    conflictPeriodDays,
    conflictMode:
      modeRaw === "warning" ? "warning" : modeRaw === "error" || !modeRaw ? "error" : "off",
    holidayRuleOn: false,
    firstDayOfWeek: text(key(cfg.PlannerAdministration, "FirstDayOfTheWeek")) || undefined,
    holidays: [],
    requiredStatements: [],
    visits: [],
    timeZone: ctx.format.timeZone,
  };

  const flag = (k: string) => key(s, k) === true || text(key(s, k)).toLowerCase() === "true";
  const sample: SampleChecks = {
    inventoryOn: flag("ValidateSampleInventory"),
    inventoryMode:
      text(key(s, "SampleInventoryValidationMode")).toLowerCase() === "warning"
        ? "warning"
        : "error",
    limitsOn: flag("ValidateSampleLimits"),
    territoryAllocationOn: flag("ValidateTerritoryQtyAllocation"),
    limits: [],
    limitsTruncated: false,
    inventoryCountRead: false,
  };
  const tot: TotChecks = {
    on: false,
    rulesEnabled: key(cfg.TimeOffTerritorySettings, "RulesValidationEnabled") === true,
    setName: text(key(cfg.TimeOffTerritorySettings, "SetName")) || "Default",
    rules: [],
    events: [],
    dynamicRules: false,
  };
  result.sample = sample;
  result.tot = tot;

  const now = Date.now();
  const scoped = (table: string): string | null => {
    const sc = ctx.scope(table);
    return sc === undefined || sc === null ? null : sc ? ` AND (${sc})` : "";
  };

  await Promise.all([
    // isTriggerEnabled("VisitHolidayValidationHandler"): the managed trigger handler's active switch.
    query(
      "SELECT IsActive FROM LifeScienceTriggerHandler WHERE DeveloperName = 'VisitHolidayValidationHandler' LIMIT 1",
      adminOrg,
      true
    )
      .then((rows) => {
        result.holidayRuleOn = rows[0]?.IsActive === true;
      })
      .catch(softFail(ctx, "Visit checks", undefined)),

    // HolidayWeekendValidationPlugin: holidays the device holds (it syncs the Holiday object when DB Schema says so).
    (async () => {
      const w = scoped("Holiday");
      if (w === null) return;
      const from = day(now - 400 * 86_400_000);
      const to = day(now + 400 * 86_400_000);
      const rows = await query(
        `SELECT ActivityDate FROM Holiday WHERE ActivityDate >= ${from} AND ActivityDate <= ${to}${w} LIMIT 500`,
        org
      ).catch(softFail(ctx, "Visit checks", [] as Row[]));
      result.holidays = rows.map((r) => text(r.ActivityDate).slice(0, 10)).filter(Boolean);
      result.holidaysFrom = from;
      result.holidaysTo = to;
    })(),

    // ComplianceStatementsPlugin: required agreements of the Visit module.
    (async () => {
      const w = scoped("ComplianceStatementDef");
      if (w === null) return;
      const rows = await query(
        `SELECT Id, StatementText, StatementRequirementLevel FROM ComplianceStatementDef
         WHERE StatementType = 'ComplianceAgreement' AND ModuleType = 'Visit'${w} ORDER BY DisplayOrder LIMIT 200`,
        org
      ).catch(softFail(ctx, "Visit checks", [] as Row[]));
      result.requiredStatements = rows
        .filter((r) => text(r.StatementRequirementLevel) === "Required")
        .map((r) => ({ id: text(r.Id), text: text(r.StatementText) }));
    })(),

    // DelayReasonPlugin: the picklist the sheet offers (valuesForPicklistField of ProviderVisit.SubmitDelayReasonType).
    (async () => {
      if (delayReasonType !== "Picklist") return;
      const r = await apiRequest<Row>(
        await dataPath(org, "/sobjects/ProviderVisit/describe"),
        "GET",
        undefined,
        org
      ).catch(() => null);
      const fields = Array.isArray(r?.data?.fields) ? (r?.data?.fields as Row[]) : [];
      const f = fields.find((x) => text(x.name) === "SubmitDelayReasonType");
      const values = Array.isArray(f?.picklistValues) ? (f?.picklistValues as Row[]) : [];
      result.delayReasonOptions = values
        .filter((p) => p.active !== false)
        .map((p) => ({ value: text(p.value), label: text(p.label) || text(p.value) }));
    })(),

    // VisitConflictValidationPlugin.findConflictingVisit: the device's own Visit table, here the rep's synced visits
    // within 120 days of today (a draft dated outside that window is not checked).
    (async () => {
      if (conflictPeriodDays <= 0 || result.conflictMode === "off") return;
      const w = scoped("Visit");
      if (w === null) return;
      const from = day(now - 120 * 86_400_000);
      const to = day(now + 120 * 86_400_000);
      const rows = await query(
        `SELECT Id, AccountId, Account.Name, Owner.Name, PlannedVisitStartTime, PlannedVisitEndTime FROM Visit
         WHERE AccountId != null AND PlannedVisitStartTime >= ${from}T00:00:00Z AND PlannedVisitStartTime <= ${to}T00:00:00Z${w}
         ORDER BY PlannedVisitStartTime LIMIT 2000`,
        org
      ).catch(softFail(ctx, "Visit checks", [] as Row[]));
      result.visits = rows.map((r) => ({
        id: text(r.Id),
        accountId: text(r.AccountId),
        accountName: text((r.Account as Row | null)?.Name),
        ownerName: text((r.Owner as Row | null)?.Name),
        start: text(r.PlannedVisitStartTime),
        end: text(r.PlannedVisitEndTime) || text(r.PlannedVisitStartTime),
      }));
      result.visitsFrom = from;
      result.visitsTo = to;
    })(),

    // RealSampleLimitProvider: the ProviderSampleLimit rows the device holds. The visit's account isn't known here,
    // so the newest 500 are read and the editor picks the draft account's; LIMIT 501 tells a cut-short read.
    (async () => {
      if (!sample.limitsOn) return;
      const w = scoped("ProviderSampleLimit");
      if (w === null) {
        sample.limitsUnavailable =
          ctx.scope("ProviderSampleLimit") === undefined
            ? "The device doesn't sync Sample Limits."
            : "The Sample Limit sync filter can't be reproduced here.";
        return;
      }
      const rows = await query(
        `SELECT AccountId, ProductId, PrvdSampleLmtTemplateName, Rule FROM ProviderSampleLimit
         WHERE AccountId != null${w} ORDER BY LastModifiedDate DESC LIMIT ${LIMIT_ROWS + 1}`,
        org
      ).catch((err) => {
        sample.limitsUnavailable = "Sample limits couldn't be read.";
        return softFail(ctx, "Visit checks", [] as Row[])(err);
      });
      sample.limitsTruncated = rows.length > LIMIT_ROWS;
      sample.limits = rows
        .slice(0, LIMIT_ROWS)
        .map(trimSampleLimit)
        .filter((r): r is SampleLimitRow => !!r);
    })(),

    // SampleInventoryValidationPlugin.fetchLatestSampleInventory: the rep's latest completed count.
    (async () => {
      if (!ID.test(ctx.userId)) return;
      const w = scoped("InventoryCountAssessment");
      if (w === null) return;
      const rows = await query(
        `SELECT ActualStartDateTime FROM InventoryCountAssessment
         WHERE LocationPrimaryUserId = '${ctx.userId}' AND Status = 'Complete'${w} ORDER BY LastModifiedDate DESC LIMIT 1`,
        org
      ).catch(softFail(ctx, "Visit checks", undefined));
      if (!rows) return;
      sample.inventoryCountRead = true;
      sample.lastInventoryAt = text(rows[0]?.ActualStartDateTime) || undefined;
    })(),

    // TimeOffTerritoryValidationPlugin: the trigger handler, the rep's downtime events and the rule set.
    query(
      "SELECT IsActive FROM LifeScienceTriggerHandler WHERE DeveloperName = 'VisitTimeOffValidationHandler' LIMIT 1",
      adminOrg,
      true
    )
      .then((rows) => {
        tot.on = rows[0]?.IsActive === true;
      })
      .catch(softFail(ctx, "Visit checks", undefined)),
    (async () => {
      const w = scoped("TerritoryUserDowntime");
      if (w === null || !ID.test(ctx.userId)) {
        tot.unavailable =
          ctx.scope("TerritoryUserDowntime") === undefined
            ? "The device doesn't sync Time Off Territory."
            : "The Time Off Territory sync filter can't be reproduced here.";
        return;
      }
      const from = day(now - 400 * 86_400_000);
      const to = day(now + 400 * 86_400_000);
      const rows = await query(
        `SELECT StartDate, EndDate, DownTimeType FROM TerritoryUserDowntime
         WHERE UserId = '${ctx.userId}' AND EndDate >= ${from}T00:00:00Z AND StartDate <= ${to}T23:59:59Z${w}
         ORDER BY StartDate LIMIT 500`,
        org
      ).catch((err) => {
        tot.unavailable = "Time Off Territory couldn't be read.";
        return softFail(ctx, "Visit checks", [] as Row[])(err);
      });
      tot.events = rows.map((r) => ({
        start: text(r.StartDate),
        end: text(r.EndDate) || text(r.StartDate),
        type: text(r.DownTimeType),
      }));
      tot.eventsFrom = from;
      tot.eventsTo = to;
    })(),
    (async () => {
      const recs = await collectCategoryRecords(
        adminOrg,
        "SELECT Id, DeveloperName, Category, MasterLabel FROM LifeSciConfigCategory WHERE Category IN ('TimeOffTerritoryRule', 'TimeOffTerritoryDynamicRule')",
        { cache: true }
      ).catch(
        softFail(ctx, "Visit checks", [] as Awaited<ReturnType<typeof collectCategoryRecords>>)
      );
      for (const r of recs) {
        if (r.isActive === false) continue;
        if (r.category === "TimeOffTerritoryDynamicRule") tot.dynamicRules = true;
        else
          tot.rules.push({
            ruleSet: text(r.fields.RuleSet),
            type: text(r.fields.TimeOffTerritoryType),
            visit: text(r.fields.Visit),
            isParent: r.fields.IsParent === true,
          });
      }
    })(),

    // CustomScriptsPlugin: the earliest Visit Action Validation script is the one the app runs.
    query(
      "SELECT Id, Name FROM LifeScienceCustomScript WHERE Type = 'VisitActionValidation' ORDER BY CreatedDate, Id LIMIT 1",
      adminOrg
    )
      .then((rows) => {
        if (rows[0]) result.script = { id: text(rows[0].Id), name: text(rows[0].Name) };
      })
      .catch(softFail(ctx, "Visit checks", undefined)),
  ]);
  return result;
}
