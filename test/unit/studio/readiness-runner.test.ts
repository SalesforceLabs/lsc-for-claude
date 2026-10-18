import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ValidationRule } from "../../../src/validation/rules-loader.js";
import type { ReadinessCheck } from "../../../src/studio/types.js";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
}));

const { runSoqlQuery } = await import("../../../src/salesforce/cli.js");
const { executeCheck } = await import("../../../src/validation/rules-executor.js");
const { runRules, runCheck, rowLabel } = await import("../../../src/studio/readiness/index.js");
const { summarize, verdictText, sortForAttention, byStage } = await import(
  "../../../src-renderer/components/studio/readiness.js"
);

/** Answers by the query's text: a number is a COUNT() total, an array is rows, a string is an error. */
let answers: Record<string, number | Record<string, unknown>[] | string>;

beforeEach(() => {
  vi.mocked(runSoqlQuery).mockReset();
  vi.mocked(runSoqlQuery).mockImplementation(async (q: string) => {
    const a = answers[q];
    if (a === undefined || typeof a === "string") return { success: false, error: a ?? "no answer" };
    const records = Array.isArray(a) ? a : [];
    return { success: true, data: { totalSize: Array.isArray(a) ? a.length : a, done: true, records } };
  });
});

function rule(id: string, query: string, over: Partial<ValidationRule> = {}): ValidationRule {
  return {
    id,
    name: `Rule ${id}`,
    description: "Why it matters.",
    category: "configuration",
    severity: "error",
    check: { type: "soql_count", query, expect: "count > 0" },
    symptoms: [],
    resolution: { steps: ["Do the thing"], ui_path: "Setup > Thing" },
    ...over,
  } as ValidationRule;
}

describe("executeCheck unavailable", () => {
  it("marks a failed query unavailable, not failed", async () => {
    answers = { Q: "INVALID_FIELD" };
    const out = await executeCheck({ type: "soql_count", query: "Q", expect: "count > 0" }, "org");
    expect(out.unavailable).toBe(true);
  });

  it("marks an expect it can't parse unavailable", async () => {
    answers = { Q: 3 };
    const out = await executeCheck({ type: "soql_count", query: "Q", expect: "result.isActive == true" }, "org");
    expect(out.unavailable).toBe(true);
  });

  it("passes and fails count checks", async () => {
    answers = { A: 2, B: 0 };
    expect((await executeCheck({ type: "soql_count", query: "A", expect: "count > 0" }, "org")).passed).toBe(true);
    const failed = await executeCheck({ type: "soql_count", query: "B", expect: "count > 0" }, "org");
    expect(failed.passed).toBe(false);
    expect(failed.unavailable).toBeUndefined();
  });

  it("composite is unavailable only when nothing definitely failed", async () => {
    answers = { OK: 1, BAD: 0, ERR: "boom" };
    const sub = (query: string) => ({ type: "soql_count" as const, query, expect: "count > 0" });
    const unknown = await executeCheck({ type: "composite", checks: [sub("OK"), sub("ERR")], expect: "" }, "org");
    expect(unknown.unavailable).toBe(true);
    const failed = await executeCheck({ type: "composite", checks: [sub("BAD"), sub("ERR")], expect: "" }, "org");
    expect(failed.passed).toBe(false);
    expect(failed.unavailable).toBeUndefined();
  });

  it("composite with a not-implemented sub-check is unknown, not passed", async () => {
    answers = { OK: 1 };
    const out = await executeCheck(
      { type: "composite", checks: [{ type: "soql_count", query: "OK", expect: "count > 0" }, { type: "cli", expect: "true" }], expect: "" },
      "org"
    );
    expect(out.unavailable).toBe(true);
  });

  it("marks a missing query or sub-checks unavailable", async () => {
    expect((await executeCheck({ type: "soql", expect: "count > 0" }, "org")).unavailable).toBe(true);
    expect((await executeCheck({ type: "composite", checks: [], expect: "" }, "org")).unavailable).toBe(true);
  });

  it("doesn't half-match an expect with extra terms", async () => {
    answers = { A: 3 };
    const out = await executeCheck({ type: "soql_count", query: "A", expect: "count > 0 && count < 2" }, "org");
    expect(out.unavailable).toBe(true);
  });
});

describe("runRules", () => {
  it("maps rule results to checks with stage inferred from category", async () => {
    answers = { A: 2, B: 0 };
    const [a, b] = await runRules(
      [rule("a", "A", { category: "permissions" }), rule("b", "B", { stage: "mobile", studio_surface: "dbSchema" })],
      "org"
    );
    expect(a).toMatchObject({ id: "a", stage: "access", status: "pass", detail: "Found 2.", source: "rule", uiPath: "Setup > Thing" });
    expect(b).toMatchObject({ id: "b", stage: "mobile", status: "fail", surface: "dbSchema", steps: ["Do the thing"] });
  });

  it("skips a rule whose prerequisite didn't pass, and runs it when it did", async () => {
    answers = { A: 0, B: 1, C: 1 };
    const [, b, c] = await runRules(
      [rule("a", "A"), rule("b", "B", { prerequisites: ["a"] }), rule("c", "C", { prerequisites: ["missing-rule"] })],
      "org"
    );
    expect(b.status).toBe("skipped");
    expect(b.detail).toContain("Rule a");
    expect(c.status).toBe("pass");
    // The skipped rule's query never ran.
    expect(vi.mocked(runSoqlQuery).mock.calls.map((c) => c[0])).not.toContain("B");
  });

  it("reports a rule that can't run as unknown", async () => {
    answers = { A: "sObject type 'Nope' is not supported" };
    const [a] = await runRules([rule("a", "A")], "org");
    expect(a.status).toBe("unknown");
  });

  it("lists examples from the error detail query on failure", async () => {
    answers = { A: 0, D: [{ Id: "001", Name: "Acme" }, { Id: "002" }] };
    const [a] = await runRules([rule("a", "A", { check: { type: "soql_count", query: "A", expect: "count > 0", error_detail_query: "D" } })], "org");
    expect(a.examples).toEqual(["Acme", "002"]);
  });
});

describe("runCheck", () => {
  const meta = { id: "x.data.y", stage: "data" as const, title: "Y holds", severity: "warning" as const };

  it("turns a thrown error into unknown", async () => {
    const c = await runCheck(meta, async () => {
      throw new Error("query failed");
    });
    expect(c).toMatchObject({ status: "unknown", detail: "query failed", source: "studio" });
  });

  it("keeps fixes only when failing, and honours skip", async () => {
    const fix = { kind: "setActive", label: "Turn on" } as unknown as NonNullable<ReadinessCheck["fixes"]>[number];
    expect((await runCheck(meta, async () => ({ pass: true, fixes: [fix] }))).fixes).toBeUndefined();
    expect((await runCheck(meta, async () => ({ pass: false, fixes: [fix] }))).fixes).toEqual([fix]);
    expect((await runCheck(meta, async () => ({ pass: false, skip: true }))).status).toBe("skipped");
  });

  it("caps examples", async () => {
    const c = await runCheck(meta, async () => ({ pass: false, examples: ["1", "2", "3", "4", "5", "6", "7"] }));
    expect(c.examples).toHaveLength(5);
  });
});

describe("rowLabel", () => {
  it("prefers a name-like field over the Id", () => {
    expect(rowLabel({ Id: "1", DeveloperName: "Dev" })).toBe("Dev");
    expect(rowLabel({ Id: "1" })).toBe("1");
  });
});

describe("renderer summarize", () => {
  const check = (id: string, status: ReadinessCheck["status"], severity: ReadinessCheck["severity"] = "error", stage: ReadinessCheck["stage"] = "config"): ReadinessCheck =>
    ({ id, stage, title: id, status, severity, source: "studio" }) as ReadinessCheck;

  it("is blocked by an error, has issues with only warnings, and ignores info", () => {
    expect(summarize([check("a", "fail"), check("b", "pass")]).verdict).toBe("blocked");
    expect(summarize([check("a", "fail", "warning"), check("b", "pass")]).verdict).toBe("issues");
    const s = summarize([check("a", "fail", "info"), check("b", "pass")]);
    expect(s.verdict).toBe("ready");
    expect(s.suggestions).toHaveLength(1);
  });

  it("doesn't count unknown or skipped checks for or against", () => {
    const s = summarize([check("a", "unknown"), check("b", "skipped")]);
    expect(s).toMatchObject({ verdict: "unknown", ran: 0, unknown: 1, skipped: 1 });
    expect(verdictText(s)).toBe("Couldn't check this feature");
  });

  it("sorts failing first by severity and groups by stage order", () => {
    const sorted = sortForAttention([check("p", "pass"), check("i", "fail", "info"), check("e", "fail"), check("u", "unknown")]);
    expect(sorted.map((c) => c.id)).toEqual(["e", "i", "u", "p"]);
    const groups = byStage([check("m", "pass", "error", "mobile"), check("e", "pass", "error", "enabled")]);
    expect(groups.map((g) => g.stage.id)).toEqual(["enabled", "mobile"]);
  });
});
