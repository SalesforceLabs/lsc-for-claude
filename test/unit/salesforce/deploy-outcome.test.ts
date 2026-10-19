import { describe, it, expect } from "vitest";
import { deployOutcome } from "../../../src/salesforce/cli.js";

describe("deployOutcome", () => {
  it("passes a successful deploy through", () => {
    const res = { success: true, data: { status: "Succeeded", success: true } };
    expect(deployOutcome(res)).toBe(res);
  });

  it("turns a Failed deploy inside a parsed result into a failure naming the problem", () => {
    const out = deployOutcome({
      success: true,
      data: {
        status: "Failed",
        success: false,
        details: { componentFailures: [{ problem: "Field:CaseNumber must be Readonly", fullName: "Case-Layout" }] },
      },
    });
    expect(out.success).toBe(false);
    expect(out.error).toContain("Field:CaseNumber must be Readonly");
    expect(out.rejected).toBe(true);
  });

  it("handles a single (non-array) component failure and a bare failed status", () => {
    expect(deployOutcome({ success: true, data: { details: { componentFailures: { problem: "boom" } } } }).error).toBe("boom");
    expect(deployOutcome({ success: true, data: { status: "Failed" } })).toMatchObject({ success: false, error: "The deploy failed." });
  });

  it("reads the reasons from a failure the CLI already flagged, and leaves unparsed failures alone", () => {
    const failed = { success: false, data: { status: "Failed", details: { componentFailures: [{ problem: "Cannot find related list:X" }] } } };
    expect(deployOutcome(failed)).toMatchObject({ success: false, rejected: true, error: "Cannot find related list:X" });
    expect(deployOutcome({ success: false, data: { status: "Failed" } }).rejected).toBeUndefined();
  });

  it("keeps an existing failure as is", () => {
    const res = { success: false, error: "x" };
    expect(deployOutcome(res)).toBe(res);
  });
});
