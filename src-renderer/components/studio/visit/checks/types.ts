/** Structural copy of the types in src/studio/screens/visit/checks.ts — keep equal (test/unit/studio/visit/checks-collector.test.ts). */
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
