import { describe, expect, it } from "vitest";
import {
  dayKey,
  isWorkingDay,
  parseWhen,
  runChecks,
  TEXT,
  type CheckInput,
} from "../../../../src-renderer/components/studio/visit/checks/run";
import { bullets } from "../../../../src-renderer/components/studio/visit/checks/CheckFeedback";
import {
  emptyDraft,
  type VisitDraft,
} from "../../../../src-renderer/components/studio/visit/draft";
import type { VisitChecks } from "../../../../src-renderer/components/studio/visit/checks/types";
import type {
  PublishedIpad,
  PublishedLayout,
} from "../../../../src-renderer/components/studio/published-types";

const TZ = "America/New_York";
// Wednesday 2026-11-04, noon in New York.
const NOW = new Date("2026-11-04T17:00:00Z");

const settings = (over: Partial<VisitChecks> = {}): VisitChecks => ({
  futureVisitLimitDays: 365,
  delayReasonType: "None",
  delayReasonThresholdDays: 0,
  delayReasonOptions: [],
  conflictPeriodDays: 0,
  conflictMode: "error",
  holidayRuleOn: false,
  holidays: [],
  requiredStatements: [],
  visits: [],
  timeZone: TZ,
  ...over,
});

const layout: PublishedLayout = {
  name: "Visit-Layout",
  sections: [
    {
      label: null,
      columns: [["AccountId", "PlannedVisitStartTime", "Subject__c"], []],
      fields: [
        [
          { name: "AccountId", label: "Account", type: "lookup" },
          { name: "PlannedVisitStartTime", label: "Planned Start", type: "datetime" },
          { name: "Subject__c", label: "Subject", type: "string", required: true },
        ],
        [{ name: "PlannedVisitEndTime", label: "Planned End", type: "datetime" }],
      ],
    },
  ],
  relatedLists: [],
  actions: [],
};

function snapshot(checks: VisitChecks | undefined): PublishedIpad {
  return { screens: { visit: { checks } } } as unknown as PublishedIpad;
}

function input(
  mode: CheckInput["mode"],
  values: Record<string, string>,
  checks: VisitChecks | undefined = settings(),
  over: Partial<VisitDraft> = {},
  extra: Partial<CheckInput> = {}
): CheckInput {
  return {
    mode,
    draft: { ...emptyDraft(), values, ...over },
    snapshot: snapshot(checks),
    layouts: [layout],
    now: NOW,
    ...extra,
  };
}

const good = {
  PlaceId: "0hy000000000001",
  AccountId: "001000000000001",
  PlannedVisitStartTime: "2026-11-04T15:00:00Z",
  PlannedVisitEndTime: "2026-11-04T15:30:00Z",
  Subject__c: "Intro",
};

describe("dates", () => {
  it("parses ISO, record view and picker formats", () => {
    expect(parseWhen("2026-11-04T15:00:00Z")?.toISOString()).toBe("2026-11-04T15:00:00.000Z");
    expect(parseWhen("11/4/26, 3:05 PM")).toEqual(new Date(2026, 10, 4, 15, 5));
    expect(parseWhen("Nov 4, 2026 at 3:05 PM")).toEqual(new Date(2026, 10, 4, 15, 5));
    expect(parseWhen("")).toBeUndefined();
    expect(parseWhen("nonsense")).toBeUndefined();
  });
  it("keys days in the viewer's time zone", () => {
    expect(dayKey(new Date("2026-11-05T02:00:00Z"), TZ)).toBe("2026-11-04");
    expect(dayKey(new Date("2026-11-05T02:00:00Z"), "Asia/Tokyo")).toBe("2026-11-05");
  });
  it("works out the working week from its first day", () => {
    const sat = new Date("2026-11-07T17:00:00Z");
    const sun = new Date("2026-11-08T17:00:00Z");
    expect(isWorkingDay("Monday", sat, TZ)).toBe(false);
    expect(isWorkingDay("Monday", new Date("2026-11-04T17:00:00Z"), TZ)).toBe(true);
    expect(isWorkingDay("Sunday", sun, TZ)).toBe(true);
    expect(isWorkingDay("Sunday", sat, TZ)).toBe(false);
    expect(isWorkingDay("Nope", sat, TZ)).toBe(false);
  });
});

describe("runChecks: required fields", () => {
  it("passes a complete visit", () => {
    const out = runChecks(input("save", good));
    expect(out.ok).toBe(true);
    expect(out.fieldErrors).toEqual({});
  });
  it("flags an empty required field with the device's text, in every mode", () => {
    for (const mode of ["save", "sign", "submit"] as const) {
      const out = runChecks(input(mode, { ...good, Subject__c: " " }));
      expect(out.ok).toBe(false);
      expect(out.fieldErrors.Subject__c).toBe("Subject is required");
    }
  });
  it("requires account, start and end (forced by the editor)", () => {
    const out = runChecks(input("save", {}));
    expect(Object.keys(out.fieldErrors).sort()).toEqual([
      "AccountId",
      "PlaceId",
      "PlannedVisitEndTime",
      "PlannedVisitStartTime",
      "Subject__c",
    ]);
    expect(out.fieldErrors.AccountId).toBe(TEXT.required("Account"));
  });
  it("does nothing in new mode except note the script", () => {
    const out = runChecks(input("new", {}, settings({ script: { id: "a", name: "Gate" } })));
    expect(out.ok).toBe(true);
    expect(out.fieldErrors).toEqual({});
    expect(out.skipped[0].check).toContain("Gate");
  });
  it("still checks required fields when the settings couldn't be read, and says so", () => {
    const out = runChecks(input("save", { ...good, Subject__c: "" }, null as unknown as undefined));
    expect(out.ok).toBe(false);
    expect(out.skipped.some((s) => s.check === "Org settings")).toBe(true);
  });
});

describe("runChecks: dates", () => {
  it("rejects an end before the start", () => {
    const out = runChecks(input("save", { ...good, PlannedVisitEndTime: "2026-11-04T14:00:00Z" }));
    expect(out.errors).toEqual([TEXT.endBeforeStart]);
    expect(out.ok).toBe(false);
    expect(out.messages[0]).toMatchObject({ severity: "error", where: "global" });
  });
  it("rejects a visit past the future limit by calendar day", () => {
    const c = settings({ futureVisitLimitDays: 7 });
    const edge = runChecks(
      input(
        "save",
        {
          ...good,
          PlannedVisitStartTime: "2026-11-11T20:00:00Z",
          PlannedVisitEndTime: "2026-11-11T21:00:00Z",
        },
        c
      )
    );
    expect(edge.ok).toBe(true);
    const over = runChecks(
      input(
        "save",
        {
          ...good,
          PlannedVisitStartTime: "2026-11-12T20:00:00Z",
          PlannedVisitEndTime: "2026-11-12T21:00:00Z",
        },
        c
      )
    );
    expect(over.errors).toEqual([TEXT.futureLimit(7)]);
  });
  it("ignores the limit when it is 0", () => {
    const out = runChecks(
      input(
        "save",
        {
          ...good,
          PlannedVisitStartTime: "2030-01-01T10:00:00Z",
          PlannedVisitEndTime: "2030-01-01T11:00:00Z",
        },
        settings({ futureVisitLimitDays: 0 })
      )
    );
    expect(out.ok).toBe(true);
  });
  it("blocks a future visit on submit only", () => {
    const future = {
      ...good,
      PlannedVisitStartTime: "2026-11-05T15:00:00Z",
      PlannedVisitEndTime: "2026-11-05T16:00:00Z",
    };
    expect(runChecks(input("submit", future)).errors).toEqual([TEXT.futureSubmit]);
    expect(runChecks(input("save", future)).ok).toBe(true);
    expect(runChecks(input("submit", good)).ok).toBe(true);
  });
  it("requires the signature on the visit's day", () => {
    const yesterday = {
      ...good,
      PlannedVisitStartTime: "2026-11-03T15:00:00Z",
      PlannedVisitEndTime: "2026-11-03T16:00:00Z",
    };
    expect(runChecks(input("sign", yesterday)).errors).toEqual([TEXT.sameDaySignature]);
    expect(runChecks(input("sign", good)).ok).toBe(true);
    expect(runChecks(input("save", yesterday)).ok).toBe(true);
    // A start still ahead of now is not "past".
    const later = {
      ...good,
      PlannedVisitStartTime: "2026-11-05T15:00:00Z",
      PlannedVisitEndTime: "2026-11-05T16:00:00Z",
    };
    expect(runChecks(input("sign", later)).ok).toBe(true);
  });
});

describe("runChecks: working days and holidays", () => {
  const on = settings({
    holidayRuleOn: true,
    firstDayOfWeek: "Monday",
    holidays: ["2026-11-04"],
    holidaysFrom: "2025-01-01",
    holidaysTo: "2027-12-31",
  });
  it("rejects a weekend", () => {
    const sat = {
      ...good,
      PlannedVisitStartTime: "2026-11-07T15:00:00Z",
      PlannedVisitEndTime: "2026-11-07T16:00:00Z",
    };
    expect(runChecks(input("save", sat, on)).errors).toEqual([TEXT.workingDay]);
  });
  it("rejects a holiday", () => {
    expect(runChecks(input("save", good, on)).errors).toEqual([TEXT.workingDay]);
  });
  it("accepts a working day that isn't a holiday", () => {
    const thu = {
      ...good,
      PlannedVisitStartTime: "2026-11-05T15:00:00Z",
      PlannedVisitEndTime: "2026-11-05T16:00:00Z",
    };
    expect(runChecks(input("save", thu, { ...on, holidays: [] })).ok).toBe(true);
  });
  it("is off without the trigger handler", () => {
    expect(runChecks(input("save", good, { ...on, holidayRuleOn: false })).ok).toBe(true);
  });
  it("uses the viewer's time zone for the weekday", () => {
    // Sat 2026-11-07 02:00Z is still Friday evening in New York.
    const fri = {
      ...good,
      PlannedVisitStartTime: "2026-11-07T02:00:00Z",
      PlannedVisitEndTime: "2026-11-07T03:00:00Z",
    };
    expect(runChecks(input("save", fri, { ...on, holidays: [] })).ok).toBe(true);
  });
  it("notes a date outside the holidays it read", () => {
    const far = {
      ...good,
      PlannedVisitStartTime: "2028-03-01T15:00:00Z",
      PlannedVisitEndTime: "2028-03-01T16:00:00Z",
    };
    const out = runChecks(input("save", far, { ...on, futureVisitLimitDays: 0 }));
    expect(out.skipped.some((s) => s.check === "Holidays")).toBe(true);
  });
});

describe("runChecks: visit conflict", () => {
  const visit = {
    id: "a0X000000000009",
    accountId: "001000000000001",
    accountName: "Dr. Rao",
    ownerName: "Sam",
    start: "2026-11-04T16:00:00Z",
    end: "2026-11-04T16:30:00Z",
  };
  it("errors in error mode with the device's wording", () => {
    const out = runChecks(
      input(
        "save",
        good,
        settings({ conflictPeriodDays: 2, conflictMode: "error", visits: [visit] })
      )
    );
    expect(out.errors).toEqual([
      "Sam has a visit with Dr. Rao within 2 days on Nov 4, 2026. Choose a different date.",
    ]);
  });
  it("uses the singular for one day", () => {
    const out = runChecks(
      input("save", good, settings({ conflictPeriodDays: 1, visits: [visit] }))
    );
    expect(out.errors[0]).toContain("within 1 day on");
  });
  it("asks in warning mode, once per confirmation", () => {
    const c = settings({ conflictPeriodDays: 2, conflictMode: "warning", visits: [visit] });
    const out = runChecks(input("save", good, c));
    expect(out.ok).toBe(true);
    expect(out.conflictWarning).toBe(
      "Sam has a visit with Dr. Rao within 2 days on Nov 4, 2026. Do you want to continue?"
    );
    expect(
      runChecks(input("save", good, c, {}, { confirmedConflict: true })).conflictWarning
    ).toBeUndefined();
  });
  it("ignores the visit being edited, other accounts and visits outside the period", () => {
    const c = (visits: VisitChecks["visits"]) => settings({ conflictPeriodDays: 2, visits });
    expect(runChecks(input("save", good, c([visit]), {}, { editId: "a0X000000000009" })).ok).toBe(
      true
    );
    expect(runChecks(input("save", good, c([{ ...visit, accountId: "001000000000002" }]))).ok).toBe(
      true
    );
    expect(
      runChecks(
        input(
          "save",
          good,
          c([{ ...visit, start: "2026-11-10T16:00:00Z", end: "2026-11-10T17:00:00Z" }])
        )
      ).ok
    ).toBe(true);
  });
  it("matches 15 and 18 character ids", () => {
    const out = runChecks(
      input(
        "save",
        { ...good, AccountId: "001000000000001AAA" },
        settings({ conflictPeriodDays: 2, visits: [visit] })
      )
    );
    expect(out.ok).toBe(false);
  });
  it("includes attendees' accounts", () => {
    const rows = {
      Visit: [{ id: "x", values: { ParentVisitId: "p", AccountId: "001000000000077" } }],
    };
    const out = runChecks(
      input(
        "save",
        good,
        settings({ conflictPeriodDays: 2, visits: [{ ...visit, accountId: "001000000000077" }] }),
        { rows }
      )
    );
    expect(out.ok).toBe(false);
  });
  it("is off at period 0 or mode off", () => {
    expect(
      runChecks(input("save", good, settings({ conflictPeriodDays: 0, visits: [visit] }))).ok
    ).toBe(true);
    expect(
      runChecks(
        input(
          "save",
          good,
          settings({ conflictPeriodDays: 2, conflictMode: "off", visits: [visit] })
        )
      ).ok
    ).toBe(true);
  });
});

describe("runChecks: compliance and delay reason", () => {
  it("blocks submit until every required statement is agreed", () => {
    const c = settings({
      requiredStatements: [
        { id: "s1", text: "A" },
        { id: "s2", text: "B" },
      ],
    });
    const out = runChecks(input("submit", good, c, { compliance: { s1: true } }));
    expect(out.errors).toEqual([TEXT.compliance]);
    expect(out.messages[0].where).toBe("compliance");
    expect(runChecks(input("submit", good, c, { compliance: { s1: true, s2: true } })).ok).toBe(
      true
    );
    expect(runChecks(input("save", good, c)).ok).toBe(true);
  });
  const late = settings({
    delayReasonType: "Picklist",
    delayReasonThresholdDays: 3,
    delayReasonOptions: [{ value: "a", label: "A" }],
  });
  const old = {
    ...good,
    PlannedVisitStartTime: "2026-10-28T15:00:00Z",
    PlannedVisitEndTime: "2026-10-28T16:00:00Z",
  };
  it("asks for a delay reason past the threshold, on submit", () => {
    const out = runChecks(input("submit", old, late));
    expect(out.ok).toBe(true);
    expect(out.needsDelayReason).toBe(true);
    expect(out.delayReasonType).toBe("Picklist");
    expect(out.delayReasonOptions).toEqual([{ value: "a", label: "A" }]);
    expect(runChecks(input("save", old, late)).needsDelayReason).toBeUndefined();
  });
  it("doesn't ask within the threshold, with a reason already given, or when off", () => {
    const recent = {
      ...good,
      PlannedVisitStartTime: "2026-11-02T15:00:00Z",
      PlannedVisitEndTime: "2026-11-02T16:00:00Z",
    };
    expect(runChecks(input("submit", recent, late)).needsDelayReason).toBeUndefined();
    expect(
      runChecks(input("submit", old, late, { delayReason: "traffic" })).needsDelayReason
    ).toBeUndefined();
    expect(
      runChecks(input("submit", { ...old, SubmitDelayReason: "x" }, late)).needsDelayReason
    ).toBeUndefined();
    expect(
      runChecks(input("submit", old, { ...late, delayReasonType: "None" })).needsDelayReason
    ).toBeUndefined();
    expect(
      runChecks(input("submit", old, { ...late, delayReasonThresholdDays: 0 })).needsDelayReason
    ).toBeUndefined();
  });
  it("asks only after validation passed", () => {
    expect(
      runChecks(input("submit", { ...old, Subject__c: "" }, late)).needsDelayReason
    ).toBeUndefined();
  });
});

describe("skipped checks", () => {
  it("always says what it doesn't run", () => {
    const out = runChecks(input("save", good, settings({ script: { id: "s", name: "Gate" } })));
    const names = out.skipped.map((s) => s.check).join(" | ");
    expect(names).toContain("Gate");
    expect(names).toContain("Sample limits");
    expect(names).toContain("Geolocation");
    expect(out.skipped.every((s) => s.reason.length > 0)).toBe(true);
  });
});

describe("alert body", () => {
  it("bullets distinct lines like warningAlertBody", () => {
    expect(bullets(["a", " a ", "b", ""])).toBe("• a\n• b");
  });
});

// ── Samples, backdated inventory and time off territory ─────────────────────

const sampleSections = {
  products: [{ id: "01t000000000001", name: "Cardiol" }],
  inventory: {
    items: [{ id: "0pi000000000001", productId: "01t000000000001", quantity: 20 }],
    batches: [
      {
        id: "0pb000000000001",
        productItemId: "0pi000000000001",
        batchId: "0bt000000000001",
        remaining: 5,
      },
    ],
  },
};

function withSamples(
  mode: CheckInput["mode"],
  checks: VisitChecks,
  qty: string,
  values: Record<string, string> = good
): CheckInput {
  const base = input(mode, values, checks, {
    rows: {
      ProductDisbursement: [
        {
          id: "r1",
          values: {
            ProductItemId: "0pi000000000001",
            ProductionBatchId: "0bt000000000001",
            QuantityDisbursed: qty,
          },
        },
      ],
    },
  } as Partial<VisitDraft>);
  return {
    ...base,
    snapshot: {
      screens: { visit: { checks, sections: sampleSections } },
    } as unknown as PublishedIpad,
  };
}

const sampleChecks = (over: Partial<NonNullable<VisitChecks["sample"]>> = {}) =>
  settings({
    sample: {
      inventoryOn: false,
      inventoryMode: "error",
      limitsOn: false,
      territoryAllocationOn: false,
      limits: [],
      limitsTruncated: false,
      inventoryCountRead: false,
      ...over,
    },
  });

describe("sample inventory", () => {
  it("blocks a quantity over the lot's remaining, on submit and sign but not save", () => {
    const c = sampleChecks({ inventoryOn: true });
    const submit = runChecks(
      withSamples("submit", c, "6", { ...good, PlannedVisitStartTime: "2026-11-04T14:00:00Z" })
    );
    expect(submit.errors).toContain(TEXT.inventoryExceeds("Cardiol", 5));
    expect(runChecks(withSamples("save", c, "6")).errors).toEqual([]);
    expect(runChecks(withSamples("submit", c, "5")).errors).toEqual([]);
  });

  it("warns instead when the mode is warning", () => {
    const out = runChecks(
      withSamples("submit", sampleChecks({ inventoryOn: true, inventoryMode: "warning" }), "9")
    );
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([TEXT.inventoryExceeds("Cardiol", 5)]);
  });

  it("does nothing when the setting is off", () => {
    expect(runChecks(withSamples("submit", sampleChecks(), "99")).warnings).toEqual([]);
  });

  it("warns on a visit dated before the last inventory count, on submit only", () => {
    const c = sampleChecks({ inventoryCountRead: true, lastInventoryAt: "2026-11-04T16:00:00Z" });
    expect(runChecks(withSamples("submit", c, "1")).warnings).toContain(TEXT.backdatedInventory);
    expect(runChecks(withSamples("sign", c, "1")).warnings).toEqual([]);
  });
});

describe("sample limits", () => {
  const limit = (
    blockType: "Error" | "Warning",
    ops?: { op: "RULE" | "AND" | "OR"; rule?: string }[]
  ) => ({
    accountId: "001000000000001",
    productId: "01t000000000001",
    template: "T",
    blockType,
    operations: ops ?? [{ op: "RULE" as const, rule: "A" }],
    products: {
      "01t000000000001": {
        rules: {
          A: {
            strategy: "SKU" as const,
            remaining: 3,
            quota: 10,
            calculation: "SamplesInPeriod" as const,
          },
          B: {
            strategy: "SKU" as const,
            remaining: 9,
            quota: 2,
            calculation: "SamplesPerVisit" as const,
          },
        },
      },
    },
  });

  it("blocks over the remaining limit and names the remaining", () => {
    const out = runChecks(
      withSamples("submit", sampleChecks({ limitsOn: true, limits: [limit("Error")] }), "4")
    );
    expect(out.errors).toEqual([TEXT.limitRemaining("Cardiol", 3)]);
  });

  it("a Warning template asks to continue instead", () => {
    const out = runChecks(
      withSamples("submit", sampleChecks({ limitsOn: true, limits: [limit("Warning")] }), "4")
    );
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([TEXT.limitRemaining("Cardiol", 3)]);
  });

  it("joins rules with the template's operations", () => {
    const and = [
      { op: "RULE" as const, rule: "A" },
      { op: "RULE" as const, rule: "B" },
      { op: "AND" as const },
    ];
    const c = sampleChecks({ limitsOn: true, limits: [limit("Error", and)] });
    expect(runChecks(withSamples("submit", c, "3")).errors).toEqual([]); // only the per-visit rule is over
    expect(runChecks(withSamples("submit", c, "4")).errors).toEqual([
      TEXT.limitRemaining("Cardiol", 3),
      TEXT.limitPerVisit("Cardiol", 2),
    ]);
  });

  it("ignores another account's limits and save", () => {
    const other = { ...limit("Error"), accountId: "001000000000009" };
    expect(
      runChecks(withSamples("submit", sampleChecks({ limitsOn: true, limits: [other] }), "99"))
        .errors
    ).toEqual([]);
    expect(
      runChecks(
        withSamples("save", sampleChecks({ limitsOn: true, limits: [limit("Error")] }), "99")
      ).errors
    ).toEqual([]);
  });

  it("no longer lists limits as skipped when read", () => {
    const out = runChecks(withSamples("submit", sampleChecks({ limitsOn: true }), "1"));
    expect(out.skipped.map((s) => s.check)).not.toContain("Sample limits and inventory");
  });
});

describe("time off territory", () => {
  const tot = (over: Partial<NonNullable<VisitChecks["tot"]>> = {}) =>
    settings({
      tot: {
        on: true,
        rulesEnabled: false,
        setName: "Default",
        rules: [],
        events: [{ start: "2026-11-04T00:00:00Z", end: "2026-11-05T00:00:00Z", type: "Vacation" }],
        eventsFrom: "2025-10-01",
        eventsTo: "2027-12-01",
        dynamicRules: false,
        ...over,
      },
    });

  it("blocks any overlap when rules are off", () => {
    expect(runChecks(input("save", good, tot())).errors).toEqual([TEXT.timeOff]);
  });

  it("does nothing when the handler is off or the visit is clear of the event", () => {
    expect(runChecks(input("save", good, tot({ on: false }))).errors).toEqual([]);
    const away = {
      ...good,
      PlannedVisitStartTime: "2026-11-10T15:00:00Z",
      PlannedVisitEndTime: "2026-11-10T15:30:00Z",
    };
    expect(runChecks(input("save", away, tot())).errors).toEqual([]);
  });

  it("with rules, a parent Not Allowed blocks except the types a child allows", () => {
    const rules = (childVisit: string) => [
      { ruleSet: "Default", type: "", visit: "Not Allowed", isParent: true },
      { ruleSet: "Default", type: "Vacation", visit: childVisit, isParent: false },
    ];
    expect(
      runChecks(input("save", good, tot({ rulesEnabled: true, rules: rules("Allowed") }))).errors
    ).toEqual([]);
    expect(
      runChecks(input("save", good, tot({ rulesEnabled: true, rules: rules("Not Allowed") })))
        .errors
    ).toEqual([TEXT.timeOff]);
  });

  it("with rules on and no rule in the set, nothing is blocked", () => {
    expect(runChecks(input("save", good, tot({ rulesEnabled: true }))).errors).toEqual([]);
  });

  it("is skipped, not passed, when the rep's time off couldn't be read", () => {
    const out = runChecks(
      input("save", good, tot({ unavailable: "Time Off Territory couldn't be read." }))
    );
    expect(out.skipped.map((s) => s.reason)).toContain("Time Off Territory couldn't be read.");
  });
});
