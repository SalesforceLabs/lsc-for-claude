import { describe, it, expect } from "vitest";
import {
  duplicatePlans,
  missingFlows,
  plansWithoutCycles,
  renderEppvReport,
  EPPV_DB_SCHEMA_OBJECTS,
} from "../../../src/tools/eppv-config.js";

describe("eppv-config", () => {
  it("flags In Progress plans with no cycles only", () => {
    const plans = [
      { Id: "a", ActionPlanState: "In Progress" },
      { Id: "b", ActionPlanState: "In Progress" },
      { Id: "c", ActionPlanState: "Not Started" },
    ];
    expect(plansWithoutCycles(plans, new Map([["a", 8]]))).toEqual(["b"]);
  });

  it("finds duplicate plans per HCO and program, ignoring plans with no target", () => {
    const dups = duplicatePlans([
      { Id: "1", TargetId: "h1", TargetReferenceRecordId: "p1" },
      { Id: "2", TargetId: "h1", TargetReferenceRecordId: "p1" },
      { Id: "3", TargetId: "h1", TargetReferenceRecordId: "p2" },
      { Id: "4", TargetId: null },
      { Id: "5", TargetId: null },
    ]);
    expect(dups).toEqual([["1", "2"]]);
  });

  it("reports missing and inactive flows, ignoring managed copies", () => {
    const missing = missingFlows([
      { ApiName: "Schedule_Action_Plan_Sharing_Clone", IsActive: true, NamespacePrefix: null },
      { ApiName: "Schedule_Care_Program_Sharing_Clone", IsActive: false, NamespacePrefix: null },
      { ApiName: "Schedule_Assessment_Task_Update", IsActive: true, NamespacePrefix: "lsc4ce" },
    ]);
    const byPrefix = Object.fromEntries(missing.map((m) => [m.prefix, m.state]));
    expect(byPrefix["Schedule_Action_Plan_Sharing"]).toBeUndefined();
    expect(byPrefix["Schedule_Care_Program_Sharing"]).toMatch(/not active/);
    expect(byPrefix["Schedule_Assessment_Task_Update"]).toMatch(/not found/);
    expect(byPrefix["Update_Assessment_Task_On_Visit_Completion"]).toMatch(/not found/);
  });

  it("needs 11 DB Schema objects", () => {
    expect(EPPV_DB_SCHEMA_OBJECTS).toHaveLength(11);
  });

  it("never reports READY when a check could not run", () => {
    const text = renderEppvReport("org", [
      { id: "x", title: "X", status: "skip", detail: "Couldn't check: boom" },
    ]);
    expect(text).toContain("SKIP");
    expect(text).toContain("not passes");
  });
});
