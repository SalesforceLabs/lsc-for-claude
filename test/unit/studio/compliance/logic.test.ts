import { describe, it, expect } from "vitest";
import {
  buildPlan,
  cycleAction,
  cycleStatus,
  mapPlanState,
  sortPlanIds,
  type RawCycle,
} from "../../../../src/studio/screens/compliance/logic.js";

const today = "2026-11-04";
const cyc = (
  id: string,
  start: string,
  end: string,
  status: string | null = null,
  delayReason: string | null = null
): RawCycle => ({ id, name: id, start, end, status, delayReason, completionTaskId: null });

describe("mapPlanState", () => {
  it("matches defaults case-insensitively and honors overrides", () => {
    expect(mapPlanState(" in progress ")).toBe("inProgress");
    expect(mapPlanState("Active", { inProgress: "active" })).toBe("inProgress");
    expect(mapPlanState("weird")).toBe("other");
  });
});

describe("cycleStatus", () => {
  it("uses the raw status first, then the end date", () => {
    expect(
      cycleStatus({ start: "2026-01-01", end: "2026-01-02", status: "Completed" }, today)
    ).toBe("complete");
    expect(cycleStatus({ start: "2026-01-01", end: "2026-01-02", status: null }, today)).toBe(
      "overDue"
    );
    expect(cycleStatus({ start: "2026-10-01", end: "2026-11-06", status: null }, today)).toBe(
      "dueSoon"
    );
    expect(cycleStatus({ start: "2026-10-01", end: "2026-11-10", status: null }, today)).toBe(
      "upcoming"
    );
    expect(cycleStatus({ start: "2026-12-01", end: "2027-01-10", status: null }, today)).toBe(
      "notStarted"
    );
    expect(cycleStatus({ start: null, end: null, status: null }, today)).toBe("upcoming");
  });
});

describe("cycleAction", () => {
  it("follows the iOS table", () => {
    expect(cycleAction("overDue", undefined, null)).toBe("createVisit");
    expect(cycleAction("overDue", "v1", null)).toBe("viewVisit");
    expect(cycleAction("complete", undefined, null)).toBe("none");
    expect(cycleAction("skipped", undefined, "")).toBe("addSkipReason");
    expect(cycleAction("skipped", undefined, "busy")).toBe("viewSkipReason");
  });
});

describe("buildPlan", () => {
  it("counts cycles, drops the pre-delivery cycle and finds the current one", () => {
    const raw = [
      cyc("a", "2026-01-01", "2026-02-01", "Completed"),
      cyc("b", "2026-02-02", "2026-03-01"),
      cyc("c", "2026-10-01", "2026-12-01"),
      cyc("d", "2027-01-01", "2027-02-01"),
    ];
    const p = buildPlan("inProgress", raw, true, today, new Map());
    expect(p.total).toBe(3);
    expect(p.completeCount).toBe(0);
    expect(p.cycles[0].number).toBe(0);
    expect(p.currentIndex).toBe(2);
    expect(p.previousOverdue).toBe(true);
    expect(p.cycles[1].secondaryAction).toBe("addSkipReason");
    const q = buildPlan("inProgress", raw, false, today, new Map());
    expect(q.total).toBe(4);
    expect(q.completeCount).toBe(1);
    expect(q.cycles[0].number).toBe(1);
  });
  it("not started plans offer View on Web, completed ones nothing", () => {
    expect(buildPlan("notStarted", [], false, today, new Map()).action).toBe("viewOnWeb");
    expect(
      buildPlan(
        "completed",
        [cyc("a", "2026-01-01", "2026-02-01", "Completed")],
        false,
        today,
        new Map()
      ).action
    ).toBe("none");
  });
  it("uses the last cycle when all are past", () => {
    const p = buildPlan(
      "inProgress",
      [
        cyc("a", "2026-01-01", "2026-02-01", "Completed"),
        cyc("b", "2026-02-02", "2026-03-01", "Skipped"),
      ],
      false,
      today,
      new Map()
    );
    expect(p.allCyclesPast).toBe(true);
    expect(p.currentIndex).toBe(1);
    expect(p.progress).toBe(1);
  });
});

describe("sortPlanIds", () => {
  it("orders by priority, soonest open end, then name; plans without cycles last", () => {
    const plans = [
      { id: "n", name: "None" },
      { id: "d", name: "Done" },
      { id: "o", name: "Over" },
      { id: "s", name: "Soon" },
    ];
    const by = new Map([
      ["d", [{ end: "2026-01-01", status: "Completed" }]],
      ["o", [{ end: "2026-10-01", status: null }]],
      ["s", [{ end: "2026-11-05", status: null }]],
    ]);
    expect(sortPlanIds(plans, by, today)).toEqual(["o", "s", "d", "n"]);
  });
});
