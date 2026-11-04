import type { PublishedIpad, PublishedLayout } from "../../published-types";
import { visitFields } from "../../ipad-visit-form";
import type { VisitDraft } from "../draft";
import type { VisitChecks } from "./types";

/**
 * The Save / Sign / Submit checks of the Visit Engagement editor, as lifesciences-ios runs them
 * (module/Visit/Visit: VisitEngine validation plugins, VisitEditorBloc.validateAndSave). Pure: the shell passes the
 * draft and the snapshot, and CheckFeedback shows what comes back. Nothing here writes to the org.
 */

/** The device's validation modes (lifesciences-ios VisitValidation). "new" is the page-load check. */
export type CheckMode = "save" | "sign" | "submit" | "new";

export interface CheckInput {
  mode: CheckMode;
  draft: VisitDraft;
  snapshot: PublishedIpad;
  layouts: PublishedLayout[];
  editId?: string;
  now: Date;
  /** The rep already tapped Continue on this conflict warning (VisitConflictValidationPlugin.didValidate). */
  confirmedConflict?: boolean;
}

/** A message the editor draws, as VisitEngine.ValidationMessage: where it goes and how it looks. */
export interface CheckMessage {
  text: string;
  severity: "error" | "warning";
  /** "global" = banner at the top of the form; "compliance" = above the compliance statements section. */
  where: "global" | "compliance";
}

export interface CheckOutcome {
  /** Nothing blocks: the action goes ahead (after `warnings` are confirmed, and a delay reason if asked). */
  ok: boolean;
  fieldErrors: Record<string, string>;
  /** Messages shown at the top of the form (global validation messages). */
  errors: string[];
  /** "Continue with warnings?" messages. */
  warnings: string[];
  needsDelayReason?: boolean;
  /** What the delay reason sheet asks for, and its picklist values (type Picklist). */
  delayReasonType?: "Text" | "Picklist";
  delayReasonOptions?: { value: string; label: string }[];
  /** VisitConflictValidationMode = Warning: the "Just a heads-up..." confirm's message. */
  conflictWarning?: string;
  /** Every message with its place, for the form to draw. */
  messages: CheckMessage[];
  /** Checks the preview can't run, each with why (shown as a note, never a pass). */
  skipped: { check: string; reason: string }[];
}

// ── Strings (iOS defaults) ──────────────────────────────────────────────────

export const TEXT = {
  required: (label: string) => `${label} is required`, // VisitHeader required validation
  compliance: "To submit this visit, first complete the required compliance checks.", // ComplianceStatementsPlugin.swift
  delayMissing: "Please provide a reason for submitting with delay.", // DelayReasonPlugin.swift
  endBeforeStart: "Visit end time cannot be before start time.", // VisitBusinessHoursValidationPlugin.swift
  futureLimit: (days: number) => `Schedule the visit within the next ${days} days.`, // FutureVisitLimitValidationPlugin.swift
  futureSubmit: "The visit date can't be in the future when you submit a visit.", // FutureVisitSubmitValidationPlugin.swift
  sameDaySignature: "The visit date must be the same day as the signature date", // SameDaySignatureValidationPlugin.swift
  workingDay: "Schedule the visit on a working weekday", // HolidayWeekendValidationPlugin.swift
  conflictTitle: "Just a heads-up...", // VisitConflictValidationPlugin.swift
  warningsTitle: "Continue with warnings?", // VisitEditorBloc.validateState
  fieldErrors:
    "We couldn't perform the action because some fields contain errors. Please correct the highlighted fields", // VisitEditorBloc.validateState (FailedFormValidation)
  conflictError: (owner: string, account: string, days: number, date: string) =>
    days === 1
      ? `${owner} has a visit with ${account} within ${days} day on ${date}. Choose a different date.`
      : `${owner} has a visit with ${account} within ${days} days on ${date}. Choose a different date.`,
  conflictWarning: (owner: string, account: string, days: number, date: string) =>
    days === 1
      ? `${owner} has a visit with ${account} within ${days} day on ${date}. Do you want to continue?`
      : `${owner} has a visit with ${account} within ${days} days on ${date}. Do you want to continue?`,
  inventoryExceeds: (name: string, remaining: number) =>
    `${name}: Quantity exceeds the remaining sample inventory of ${remaining}`, // LACSampleLimitErrorBuilder InventoryValidationQuantityFieldError
  limitRemaining: (name: string, remaining: number) =>
    `${name} quantity exceeds the remaining sample limit of ${remaining < 0 ? 0 : remaining}.`, // XQtyExceedsRemSampleLimit
  limitPerVisit: (name: string, limit: number) =>
    `${name} quantity exceeds the limit of ${limit} per visit.`, // XQtyExceedsLimitPerVisit
  backdatedInventory:
    "The sample date is before the last inventory reconciliation. If you continue, make sure that you adjust the sample count in your next reconciliation.", // SampleInventoryValidationPlugin BackdatedInventoryWarning
  timeOff: "You can't schedule a visit during a territory time off", // TimeOffTerritoryValidationPlugin TimeOffTerritoryValidationMessage
  saved: "Visit was saved.",
  signed: "Signature Captured",
  signedPhysical: "Document ID was saved",
  submitted: "The Visit record has been submitted successfully",
};

// ── Dates ───────────────────────────────────────────────────────────────────

/** A draft date value: ISO, "M/D/YY, h:mm AM" (the record view) or "Jan 5, 2026 at 3:00 PM" (the editor's picker). */
export function parseWhen(value: string | undefined): Date | undefined {
  const v = (value ?? "").replace(/ /g, " ").trim();
  if (!v) return undefined;
  const us = /^(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+)\s*([AP]M)/i.exec(v);
  if (us) {
    const y = Number(us[3]);
    const hour = (Number(us[4]) % 12) + (/p/i.test(us[6]) ? 12 : 0);
    return new Date(y < 100 ? 2000 + y : y, Number(us[1]) - 1, Number(us[2]), hour, Number(us[5]));
  }
  const t = Date.parse(v.replace(" at ", " "));
  return Number.isNaN(t) ? undefined : new Date(t);
}

/** yyyy-MM-dd of an instant in the viewer's time zone (Calendar.startOfDay / isDate(inSameDayAs:) on the device). */
export function dayKey(d: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return p;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayOf(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(d);
}

/** PlannerConfigProvider.isDateWeekday: the five days from the first day of the week are working days. */
export function isWorkingDay(firstDay: string, d: Date, timeZone: string): boolean {
  const start = WEEKDAYS.indexOf(firstDay);
  if (start < 0) return false;
  const working = new Set([0, 1, 2, 3, 4].map((i) => WEEKDAYS[(start + i) % 7]));
  return working.has(weekdayOf(d, timeZone));
}

const DAY_MS = 86_400_000;

// ── The checks ──────────────────────────────────────────────────────────────

const empty = (v: string | undefined) => v === undefined || v.trim() === "";
const id15 = (id: string) => id.slice(0, 15);

/** Fields the editor fills itself or never lets the rep touch; "required" on the layout doesn't apply to them. */
const SELF_FILLED = new Set(["Name", "OwnerId", "TerritoryId", "Status"]);

export function runChecks(input: CheckInput): CheckOutcome {
  const { mode, draft, snapshot, layouts, editId, now } = input;
  const data: VisitChecks | undefined = snapshot.screens?.visit?.checks;
  const tz = data?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const out: CheckOutcome = {
    ok: true,
    fieldErrors: {},
    errors: [],
    warnings: [],
    messages: [],
    skipped: [],
  };
  const error = (text: string, where: CheckMessage["where"] = "global") => {
    out.errors.push(text);
    out.messages.push({ text, severity: "error", where });
  };
  const skip = (check: string, reason: string) => out.skipped.push({ check, reason });

  // "new": VisitEngine runs only the custom script gate when the editor opens a new visit (NewVisitValidationGate).
  if (mode === "new") {
    if (data?.script)
      skip(
        `Custom script "${data.script.name}"`,
        "Studio doesn't run Visit Action Validation scripts in the preview."
      );
    return out;
  }

  // ── Required fields (VisitHeaderViewModel.validateHeader: every mode) ──
  const val = (name: string) => draft.values[name];
  for (const spec of visitFields(layouts, { edit: !!editId })) {
    if (
      !spec.name ||
      spec.type === "blank" ||
      spec.type === "calculated" ||
      spec.type === "summary"
    )
      continue;
    if (!spec.required || SELF_FILLED.has(spec.name) || spec.type === "boolean") continue;
    const value =
      spec.name === "RecordTypeId" ? (draft.recordTypeName ?? val("RecordTypeId")) : val(spec.name);
    if (empty(value)) out.fieldErrors[spec.name] = TEXT.required(spec.label || spec.name);
  }

  const start = parseWhen(val("PlannedVisitStartTime"));
  const end = parseWhen(val("PlannedVisitEndTime"));

  if (data) {
    // ── End before start (VisitBusinessHoursValidationPlugin: always, save / sign / submit) ──
    if (start && end && end.getTime() < start.getTime()) error(TEXT.endBeforeStart);

    // ── Future visit limit (FutureVisitLimitValidationPlugin) ──
    if (start && data.futureVisitLimitDays > 0) {
      const limit = dayKey(new Date(now.getTime() + data.futureVisitLimitDays * DAY_MS), tz);
      if (dayKey(start, tz) > limit) error(TEXT.futureLimit(data.futureVisitLimitDays));
    }

    // ── Future date on submit (FutureVisitSubmitValidationPlugin) ──
    if (mode === "submit" && start && dayKey(start, tz) > dayKey(now, tz)) error(TEXT.futureSubmit);

    // ── Same-day signature (SameDaySignatureValidationPlugin) ──
    if (
      mode === "sign" &&
      start &&
      now.getTime() >= start.getTime() &&
      dayKey(now, tz) !== dayKey(start, tz)
    )
      error(TEXT.sameDaySignature);

    // ── Working weekday and holidays (HolidayWeekendValidationPlugin: needs VisitHolidayValidationHandler) ──
    if (data.holidayRuleOn && data.firstDayOfWeek) {
      if (!start) error(TEXT.workingDay);
      else {
        const key = dayKey(start, tz);
        if (!isWorkingDay(data.firstDayOfWeek, start, tz) || data.holidays.includes(key))
          error(TEXT.workingDay);
        else if (
          data.holidaysFrom &&
          data.holidaysTo &&
          (key < data.holidaysFrom || key > data.holidaysTo)
        )
          skip(
            "Holidays",
            "The date is outside the holidays Studio read (400 days either side of today)."
          );
      }
    }

    // ── Visit conflict (VisitConflictValidationPlugin) ──
    if (data.conflictMode !== "off" && data.conflictPeriodDays > 0 && start) {
      const period = data.conflictPeriodDays * DAY_MS;
      const from = start.getTime() - period;
      const to = (end ?? start).getTime() + period;
      const accounts = new Set<string>();
      const account = val("AccountId");
      if (account) accounts.add(id15(account));
      for (const row of draft.rows.Visit ?? [])
        if (row.values.ParentVisitId && row.values.AccountId)
          accounts.add(id15(row.values.AccountId));
      const hit = [...data.visits]
        .sort((a, b) => a.start.localeCompare(b.start))
        .find((v) => {
          const vs = Date.parse(v.start);
          const ve = Date.parse(v.end);
          return (
            accounts.has(id15(v.accountId)) &&
            vs < to &&
            ve > from &&
            (!editId || id15(v.id) !== id15(editId))
          );
        });
      if (hit) {
        const date = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          dateStyle: "medium",
        }).format(new Date(hit.start));
        const args = [
          hit.ownerName || "User",
          hit.accountName || hit.accountId,
          data.conflictPeriodDays,
          date,
        ] as const;
        if (data.conflictMode === "error") error(TEXT.conflictError(...args));
        else if (!input.confirmedConflict) out.conflictWarning = TEXT.conflictWarning(...args);
      }
      if (data.visitsFrom && data.visitsTo && start) {
        const k = dayKey(start, tz);
        if (k < data.visitsFrom || k > data.visitsTo)
          skip(
            "Visit conflict",
            "The date is outside the visits Studio read (120 days either side of today)."
          );
      }
    }

    // ── Required compliance statements (ComplianceStatementsPlugin: submit) ──
    if (mode === "submit" && data.requiredStatements.some((s) => draft.compliance[s.id] !== true))
      error(TEXT.compliance, "compliance");

    if (data.script)
      skip(
        `Custom script "${data.script.name}"`,
        "Studio doesn't run Visit Action Validation scripts in the preview; the device runs it on Save, Sign and Submit."
      );
  } else {
    skip(
      "Org settings",
      "The visit settings couldn't be read, so only required fields were checked."
    );
    if (start && end && end.getTime() < start.getTime()) error(TEXT.endBeforeStart);
  }

  // ── Sample inventory and limits (SampleLimitValidationPlugin.beforeValidation: every mode but save) ──
  const sections = snapshot.screens?.visit?.sections;
  const sample = data?.sample;
  const sampleRows = draft.rows.ProductDisbursement ?? [];
  const nameOf = (productId: string) =>
    sections?.products.find((p) => id15(p.id) === id15(productId))?.name || productId;
  const warn = (text: string) => {
    if (!out.warnings.includes(text)) out.warnings.push(text);
  };
  if (data && sample && sections && mode !== "save") {
    const lines = sampleRows.map((r) => {
      const item = sections.inventory.items.find(
        (i) => id15(i.id) === id15(r.values.ProductItemId ?? "")
      );
      const productId = item?.productId || r.values.ProductId || "";
      const qty = Number(r.values.QuantityDisbursed);
      return { row: r, item, productId, qty: Number.isFinite(qty) ? qty : 0 };
    });

    // SampleLotAllocationValidator.validateBySampleLotAllocation: the lot's remaining must cover the row's quantity.
    if (sample.inventoryOn) {
      for (const l of lines) {
        const lotId = l.row.values.ProductionBatchId ?? "";
        const batch = sections.inventory.batches.find(
          (b) =>
            id15(b.productItemId) === id15(l.row.values.ProductItemId ?? "") &&
            lotId !== "" &&
            (id15(b.batchId ?? "") === id15(lotId) || id15(b.id) === id15(lotId))
        );
        const remaining = batch ? batch.remaining : l.item?.quantity;
        if (remaining === undefined || remaining === null) continue;
        if (remaining > 0 && l.qty <= remaining) continue;
        const text = TEXT.inventoryExceeds(nameOf(l.productId), Math.max(remaining, 0));
        if (sample.inventoryMode === "warning") warn(text);
        else error(text);
      }
    }

    // LACSampleLimitValidation: the account's limit templates, rule by rule, joined by the template's operations.
    if (sample.limitsOn) {
      const account = id15(val("AccountId") ?? "");
      const day = start ? dayKey(start, tz) : dayKey(now, tz);
      const mine = sample.limits.filter((r) => account !== "" && id15(r.accountId) === account);
      for (const limit of mine) {
        for (const [pid, product] of Object.entries(limit.products)) {
          const forProduct = lines.filter((l) => id15(l.productId) === id15(pid));
          if (!forProduct.length) continue;
          const results = new Map<string, { bad: boolean; text: string } | null>();
          for (const [name, rule] of Object.entries(product.rules)) {
            // Rules outside their dates are nil (a dateError); period offsets aren't modelled (named in skipped).
            if (
              (rule.starts && day < rule.starts.slice(0, 10)) ||
              (rule.ends && day > rule.ends.slice(0, 10)) ||
              rule.hasOffset
            ) {
              results.set(name, null);
              continue;
            }
            const qty =
              rule.strategy === "SHARED"
                ? lines
                    .filter((l) =>
                      Object.keys(limit.products).some((k) => id15(k) === id15(l.productId))
                    )
                    .reduce((n, l) => n + l.qty, 0)
                : forProduct.reduce((n, l) => n + l.qty, 0);
            if (rule.calculation === "SamplesPerVisit")
              results.set(name, {
                bad: qty > rule.quota,
                text: TEXT.limitPerVisit(nameOf(pid), rule.quota),
              });
            else
              results.set(name, {
                bad: qty > rule.remaining,
                text: TEXT.limitRemaining(nameOf(pid), rule.remaining),
              });
          }
          // Postfix over the rules: a nil operand (rule not in force) gives way to the other side.
          const stack: ({ bad: boolean; text: string[] } | null)[] = [];
          for (const op of limit.operations.length
            ? limit.operations
            : Object.keys(product.rules).flatMap((n, i) => [
                { op: "RULE" as const, rule: n },
                ...(i ? [{ op: "OR" as const }] : []),
              ])) {
            if (op.op === "RULE") {
              const r = results.get(op.rule ?? "");
              stack.push(r ? { bad: r.bad, text: r.bad ? [r.text] : [] } : null);
              continue;
            }
            const b = stack.pop() ?? null;
            const a = stack.pop() ?? null;
            if (!a || !b) stack.push(a ?? b);
            else if (op.op === "AND")
              stack.push({
                bad: a.bad && b.bad,
                text: a.bad && b.bad ? [...a.text, ...b.text] : [],
              });
            else stack.push({ bad: a.bad || b.bad, text: [...a.text, ...b.text] });
          }
          const verdict = stack.pop();
          if (verdict?.bad)
            for (const t of verdict.text) {
              if (limit.blockType === "Warning") warn(t);
              else error(t);
            }
        }
      }
    }
  }

  // ── Backdated inventory (SampleInventoryValidationPlugin: submit, with unsigned samples) ──
  if (mode === "submit" && sample?.lastInventoryAt && start && sampleRows.length > 0) {
    const last = Date.parse(sample.lastInventoryAt);
    if (!Number.isNaN(last) && start.getTime() < last) warn(TEXT.backdatedInventory);
  }

  // ── Time off territory (TimeOffTerritoryValidationPlugin: every mode with a start and an end) ──
  const tot = data?.tot;
  if (tot?.on && start && end) {
    if (tot.unavailable) skip("Time off territory", tot.unavailable);
    else if (
      tot.eventsFrom &&
      tot.eventsTo &&
      (dayKey(start, tz) < tot.eventsFrom || dayKey(end, tz) > tot.eventsTo)
    )
      skip(
        "Time off territory",
        "The visit is outside the time off Studio read (400 days either side of today)."
      );
    else if (tot.events.length) {
      const overlaps = (e: { start: string; end: string }) => {
        const s = Date.parse(e.start);
        const t = Date.parse(e.end);
        const vs = start.getTime();
        const ve = end.getTime();
        return (vs >= s && vs <= t) || (ve >= s && ve <= t) || (vs <= s && ve >= t);
      };
      let blocked: Set<string> | "all" = "all";
      if (tot.rulesEnabled) {
        // resolveBlockedTypes / buildBlockedTypes: the parent rule sets the default, children flip single types.
        const set = tot.rules.filter((r) => r.ruleSet === tot.setName);
        const parent = set.find((r) => r.isParent);
        const children = set.filter((r) => !r.isParent);
        blocked = new Set<string>();
        if (parent || children.length) {
          if (!parent || parent.visit === "Allowed") {
            for (const c of children) if (c.visit === "Not Allowed") blocked.add(c.type);
          } else {
            for (const e of tot.events) blocked.add(e.type);
            for (const c of children) if (c.visit === "Allowed") blocked.delete(c.type);
          }
        }
        if (tot.dynamicRules)
          skip(
            "Time off territory",
            "The org has dynamic rules; Studio evaluates the static rule set only."
          );
      }
      if (tot.events.some((e) => (blocked === "all" || blocked.has(e.type)) && overlaps(e)))
        error(TEXT.timeOff);
    }
  }

  // What this stream never runs.
  if (data?.sample?.limitsOn) {
    if (data.sample.limitsUnavailable) skip("Sample limits", data.sample.limitsUnavailable);
    else if (data.sample.limitsTruncated)
      skip(
        "Sample limits",
        "Studio read the newest 500 sample limits; the account's may be further back."
      );
    skip(
      "Sample limit details",
      "Rules with a period offset, limits on DTP items and the not-yet-synced quantity aren't evaluated; the device also totals attendee visits on submit."
    );
  }
  if (data?.sample?.territoryAllocationOn)
    skip(
      "Territory product allocation",
      "Territory quantity allocation isn't evaluated in the preview."
    );
  if (data?.sample?.inventoryOn)
    skip(
      "Sample inventory",
      "Quantities already on unsynced visits aren't subtracted from the lot."
    );
  if (!data?.sample) skip("Sample limits and inventory", "Their settings couldn't be read.");
  if (!data?.tot && data) skip("Time off territory", "Its settings couldn't be read.");
  skip(
    "Best times, one HCO, parent organization, account record type, business hours",
    "Their data isn't read."
  );
  skip("Geolocation", "The preview has no device location.");

  // ── Outcome ──
  out.ok = out.errors.length === 0 && Object.keys(out.fieldErrors).length === 0;

  // ── Delay reason (DelayReasonPlugin.beforeSave: submit, after validation passed) ──
  if (
    out.ok &&
    mode === "submit" &&
    data &&
    data.delayReasonType !== "None" &&
    data.delayReasonThresholdDays > 0 &&
    start &&
    empty(draft.delayReason) &&
    empty(val("SubmitDelayReason")) &&
    empty(val("SubmitDelayReasonType")) &&
    Math.floor((now.getTime() - start.getTime()) / DAY_MS) > data.delayReasonThresholdDays
  ) {
    out.needsDelayReason = true;
    out.delayReasonType = data.delayReasonType;
    out.delayReasonOptions = data.delayReasonOptions;
  }
  return out;
}
