import { describe, it, expect } from "vitest";
import {
  dueDay,
  newestFirst,
  nomenclatureOf,
  progressMode,
  statusKind,
} from "../../../../src/studio/screens/kam/logic.js";

describe("kam logic", () => {
  it("normalizes statuses like PlanStatusKind", () => {
    expect(statusKind("In Progress")).toBe("inProgress");
    expect(statusKind("COMPLETED")).toBe("completed");
    expect(statusKind("Not Started")).toBe("notStarted");
    expect(statusKind("Blocked")).toBe("other");
    expect(statusKind(null)).toBe("other");
  });
  it("progress mode is Percentage only when set exactly", () => {
    expect(progressMode("Percentage")).toBe("percentage");
    expect(progressMode("percentage")).toBe("status");
    expect(progressMode(undefined)).toBe("status");
  });
  it("keeps only non-blank nomenclature terms, trimmed", () => {
    expect(nomenclatureOf({ NomenclatureObjective: " Goal ", NomenclatureTactic: "  " })).toEqual({
      objective: "Goal",
    });
    expect(nomenclatureOf(undefined)).toEqual({});
  });
  it("keeps the ISO day of a due date", () => {
    expect(dueDay("2026-11-04T10:00:00.000Z")).toBe("2026-11-04");
    expect(dueDay("soon")).toBeNull();
  });
  it("sorts newest change first", () => {
    expect(
      newestFirst([{ modified: "2026-01-01" }, { modified: "2026-03-01" }]).map((r) => r.modified)
    ).toEqual(["2026-03-01", "2026-01-01"]);
  });
});
