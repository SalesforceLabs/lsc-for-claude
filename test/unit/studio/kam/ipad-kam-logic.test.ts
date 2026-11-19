import { describe, it, expect } from "vitest";
import {
  actionPlanCount,
  badgeVariant,
  completion,
  dueLabel,
  emptyObjectives,
  kamPart,
  objectiveFor,
  taskCompletion,
  tacticCount,
} from "../../../../src-renderer/components/studio/kam/ipad-kam-logic";

describe("ipad kam logic", () => {
  it("maps badge variants", () => {
    expect(badgeVariant("inProgress")).toBe("info");
    expect(badgeVariant("completed")).toBe("success");
    expect(badgeVariant("notStarted")).toBe("base");
  });
  it("draws a percentage bar in Percentage mode, 100 when completed", () => {
    expect(completion("inProgress", 40, "In Progress", "percentage")).toEqual({
      type: "progress",
      percent: 40,
    });
    expect(completion("completed", 10, "Completed", "percentage")).toEqual({
      type: "progress",
      percent: 100,
    });
    expect(completion("notStarted", 0, null, "status")).toMatchObject({
      type: "badge",
      text: "Not Started",
      variant: "base",
    });
  });
  it("offers Mark as Complete on tactics that aren't completed", () => {
    const t = {
      id: "1",
      name: "t",
      status: "Open",
      kind: "other" as const,
      owner: null,
      assignedTo: null,
      dueDate: null,
    };
    expect(taskCompletion(t)).toEqual({ type: "markComplete", title: "Mark as Complete" });
    expect(taskCompletion({ ...t, kind: "completed", status: "Completed" })).toMatchObject({
      type: "badge",
      variant: "success",
    });
  });
  it("counts with the org's terms", () => {
    expect(actionPlanCount(1, {})).toBe("1 Action Plan");
    expect(actionPlanCount(3, {})).toBe("3 Action Plans");
    expect(actionPlanCount(2, { actionPlanPlural: "Plays" })).toBe("2 Plays");
    expect(tacticCount(1, {})).toBe("1 tactic");
  });
  it("formats due dates and the empty state", () => {
    expect(dueLabel(null, "en-US")).toBe("—");
    expect(dueLabel("2026-11-04", "en-US")).toBe("11/4/26");
    expect(emptyObjectives({})).toBe("Add an objective to get started");
    expect(emptyObjectives({ objective: "Goal" })).toBe("Add a new Goal to get started");
  });
  it("identifies KAM components", () => {
    expect(kamPart("c:kamObjectivesList", undefined)).toEqual({
      part: "objectives",
      legacy: false,
    });
    expect(kamPart("flexipage:relatedListSingleContainer", "AccountPlanStakeholders")?.part).toBe(
      "stakeholders"
    );
    expect(kamPart("flexipage:relatedListSingleContainer", "Contacts")).toBeNull();
    expect(kamPart("runtime_industries_actionplan:listCard", undefined)?.part).toBe("actionPlans");
  });
  it("finds an objective across plans", () => {
    const obj = { id: "O1" } as never;
    const kam = { plans: { P1: { objectives: [obj] } } } as never;
    expect(objectiveFor(kam, "O1")).toBe(obj);
    expect(objectiveFor(kam, "zz")).toBeUndefined();
  });
});
