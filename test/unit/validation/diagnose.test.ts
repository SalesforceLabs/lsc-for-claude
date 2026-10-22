import { describe, it, expect, vi } from "vitest";
import { diagnose, diagnosisItems, formatDiagnosis } from "../../../src/validation/diagnose.js";
import type { KnownCause } from "../../../src/validation/known-causes.js";
import type { RuleCheck, ValidationRule } from "../../../src/validation/rules-loader.js";
import type { CheckOutcome } from "../../../src/validation/rules-executor.js";

const check = (query: string): RuleCheck => ({ type: "tooling_soql", query, expect: "records.length == 0" });

const causes: KnownCause[] = [
  {
    id: "present",
    title: "Present cause",
    module: "test",
    symptoms: ["Something broke badly"],
    cause: "Line one\n  line two",
    fix: ["Fix it"],
    check: check("SELECT Id FROM Present"),
  },
  {
    id: "absent",
    title: "Absent cause",
    module: "test",
    symptoms: ["Something broke badly again"],
    cause: "Why",
    fix: ["Fix it"],
    check: check("SELECT Id FROM Absent"),
    check_scope: "Only org level",
  },
  {
    id: "gated",
    title: "Gated cause",
    module: "test",
    symptoms: ["Something broke badly once more"],
    cause: "Why",
    fix: ["Fix it"],
    check: check("SELECT Id FROM Gated"),
    applies_if: { type: "tooling_soql_count", query: "SELECT COUNT() FROM Handler", expect: "count > 0" },
  },
  {
    id: "by-design",
    title: "By design",
    module: "test",
    symptoms: ["Something broke badly by design"],
    cause: "Intended",
    fix: ["Explain"],
    by_design: true,
  },
  {
    id: "linked",
    title: "Linked cause",
    module: "test",
    symptoms: ["Linked rule symptom here"],
    cause: "Why",
    fix: ["Fix it"],
    rules: ["rule-x"],
  },
];

const rules: ValidationRule[] = [
  {
    id: "rule-x",
    name: "Rule X",
    description: "Rule",
    category: "configuration",
    severity: "error",
    check: check("SELECT Id FROM RuleX"),
    symptoms: ["Linked rule symptom here"],
    resolution: { steps: ["Step"] },
  },
];

const outcomes: Record<string, CheckOutcome> = {
  "SELECT Id FROM Present": { passed: false, message: "found", details: { records: [{ DeveloperName: "DbSchema_Topic" }] } },
  "SELECT Id FROM Absent": { passed: true, message: "ok" },
  "SELECT COUNT() FROM Handler": { passed: false, message: "no handler" },
  "SELECT Id FROM Gated": { passed: false, message: "found" },
  "SELECT Id FROM RuleX": { passed: false, message: "rule failed" },
};
const run = vi.fn(async (c: RuleCheck) => outcomes[c.query!]);

describe("diagnose()", () => {
  it("runs the checks and puts what was found first", async () => {
    const d = await diagnose("Something broke badly", "org", { causes, rules, run });
    const byId = Object.fromEntries(d.findings.map((f) => [f.match.item.id, f]));
    expect(d.findings[0].match.item.id).toBe("present");
    expect(byId.present.status).toBe("found");
    expect(byId.absent.status).toBe("not-found");
    expect(byId.gated.status).toBe("not-found");
    expect(byId.gated.notApplicable).toBe(true);
    expect(byId["by-design"].status).toBe("no-check");
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ query: "SELECT Id FROM Gated" }), "org");
  });

  it("counts a failed linked rule as the cause found, and doesn't list the rule again", async () => {
    const d = await diagnose("Linked rule symptom here", "org", { causes, rules, run });
    expect(d.findings.map((f) => f.match.item.id)).toEqual(["linked"]);
    expect(d.findings[0].status).toBe("found");
    expect(d.findings[0].failedRules[0].rule.id).toBe("rule-x");
  });

  it("runs nothing without an org", async () => {
    run.mockClear();
    const d = await diagnose("Something broke badly", undefined, { causes, rules, run });
    expect(run).not.toHaveBeenCalled();
    expect(d.findings.find((f) => f.match.item.id === "present")?.status).toBe("unchecked");
  });
});

describe("formatDiagnosis()", () => {
  it("names the records to fix and keeps prose on one line", async () => {
    const text = formatDiagnosis(await diagnose("Something broke badly", "org", { causes, rules, run }));
    expect(text).toContain("1 of 4 possible causes found");
    expect(text).toContain("**Found in your org.**");
    expect(text).toContain("- DbSchema_Topic");
    expect(text).toContain("**Why:** Line one line two");
    expect(text).toContain("**This is how LSC works.**");
    expect(text).toContain("doesn't apply here");
    expect(text).toContain("_The check doesn't cover everything: Only org level_");
  });

  it("says what to try when nothing matches", async () => {
    const text = formatDiagnosis(await diagnose("the weather is nice", "org", { causes, rules, run }));
    expect(text).toContain("Nothing in the known causes or validation rules matches this.");
  });
});

describe("diagnosisItems()", () => {
  it("turns findings into plain data for Studio", async () => {
    const items = diagnosisItems(await diagnose("Something broke badly", "org", { causes, rules, run }));
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.present).toMatchObject({ kind: "cause", status: "found", area: "test", why: "Line one line two", steps: ["Fix it"], records: ["DbSchema_Topic"] });
    expect(byId.absent).toMatchObject({ status: "not-found", records: [], checkScope: "Only org level" });
    expect(byId.gated.notApplicable).toBe(true);
    expect(byId["by-design"].byDesign).toBe(true);
  });

  it("carries failed linked rules", async () => {
    const [item] = diagnosisItems(await diagnose("Linked rule symptom here", "org", { causes, rules, run }));
    expect(item.failedRules).toEqual([{ id: "rule-x", name: "Rule X", message: "rule failed" }]);
  });
});
