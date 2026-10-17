import { describe, expect, it } from "vitest";
import { evalProfileFormula, usesProfileName } from "../../../../src/studio/screens/record-formula";

const F = 'IF(OR($Profile.Name = "LS PH Field Medical",$Profile.Name = "LS System Admin"), "Responder", IF($Profile.Name = "LS PH Field Sales Representative","Creator",""))';

describe("evalProfileFormula", () => {
  it("evaluates the Inquiry creator/responder formula for the viewer's profile", () => {
    expect(usesProfileName(F)).toBe(true);
    expect(evalProfileFormula(F, "LS PH Field Sales Representative")).toBe("Creator");
    expect(evalProfileFormula(F, "LS System Admin")).toBe("Responder");
    expect(evalProfileFormula(F, "Other")).toBe("");
  });

  it("returns null for formulas it does not understand", () => {
    expect(evalProfileFormula("TEXT(Amount) & $Profile.Name", "x")).toBeNull();
  });
});
