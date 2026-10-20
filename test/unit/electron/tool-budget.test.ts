import { describe, it, expect } from "vitest";
import { spendToolBudget } from "../../../src-electron/engine/tool-budget.js";

describe("spendToolBudget", () => {
  it("counts limited tools and refuses past the limit", () => {
    const counts = new Map<string, number>();
    expect(spendToolBudget("check_user_access", counts)).toBeNull();
    expect(spendToolBudget("check_user_access", counts)).toBeNull();
    expect(spendToolBudget("check_user_access", counts)).toMatch(/Don't check reps one by one/);
    expect(counts.get("check_user_access")).toBe(2);
  });

  it("leaves other tools alone", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 10; i++) expect(spendToolBudget("run_soql", counts)).toBeNull();
    expect(counts.size).toBe(0);
  });
});
