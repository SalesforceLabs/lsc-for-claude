import { describe, it, expect } from "vitest";
import { diagnosisVerdict, toCheck, type DiagnosisItem, type DiagnosisResult } from "../../../src-renderer/components/studio/diagnose-logic.js";
import { failedPublishPrompt } from "../../../src-renderer/components/studio/metadata-cache-types.js";

const item = (over: Partial<DiagnosisItem>): DiagnosisItem => ({
  id: "c1",
  kind: "cause",
  title: "Topic sync record has a bad filter",
  area: "mobile",
  status: "found",
  byDesign: false,
  notApplicable: false,
  why: "Why",
  steps: ["Fix the filter"],
  records: [],
  failedRules: [],
  matched: "bad filter",
  score: 0.8,
  ...over,
});

describe("toCheck()", () => {
  it("shows a cause found in the org as a fix, never as blocking, with its records", () => {
    const c = toCheck(item({ records: ["DbSchema_Topic"] }), true);
    expect(c).toMatchObject({ status: "fail", severity: "warning", source: "cause", examples: ["DbSchema_Topic"] });
    expect(c.detail).toBe("Found in your org: 1 record to fix");
  });

  it("maps the other statuses", () => {
    expect(toCheck(item({ status: "not-found", checkScope: "Only org level" }), true)).toMatchObject({ status: "pass", detail: "Not in your org. The check doesn't cover everything: Only org level" });
    expect(toCheck(item({ status: "not-found", notApplicable: true }), true).detail).toMatch(/^Doesn't apply here/);
    expect(toCheck(item({ status: "unchecked", message: "no access" }), true)).toMatchObject({ status: "unknown", detail: "Couldn't check: no access" });
    expect(toCheck(item({ status: "unchecked" }), false).detail).toBe("Not checked: no org connected");
    expect(toCheck(item({ status: "no-check", byDesign: true }), true)).toMatchObject({ status: "skipped", detail: "This is how LSC works, not a setup mistake." });
    expect(toCheck(item({ kind: "rule" }), true).source).toBe("rule");
  });

  it("adds failed linked rules to why", () => {
    const c = toCheck(item({ failedRules: [{ id: "r", name: "Rule R", message: "2 records" }] }), true);
    expect(c.detail).toBe("Found in your org: 2 records");
    expect(c.why).toBe("Why Rule R failed: 2 records");
  });
});

describe("diagnosisVerdict()", () => {
  const result = (items: DiagnosisItem[], checkedOrg: string | null = "demo"): DiagnosisResult => ({ items, checkedOrg });

  it("counts what was found", () => {
    expect(diagnosisVerdict(result([item({}), item({ id: "c2", status: "not-found" })]))).toEqual({ tone: "warning", title: "1 of 2 possible causes found in demo" });
  });

  it("says when nothing was found, and what's left to look at by hand", () => {
    expect(diagnosisVerdict(result([item({ status: "not-found" })])).tone).toBe("pass");
    expect(diagnosisVerdict(result([item({ status: "not-found" }), item({ id: "c2", status: "no-check" })])).title).toBe(
      "None of the checked causes are in demo. 1 needs a look by hand."
    );
    expect(diagnosisVerdict(result([item({})], null)).title).toBe("1 possible cause. Connect an org to check which apply.");
  });
});

describe("failed publish prompt", () => {
  const result: DiagnosisResult = { items: [item({ records: ["DbSchema_Topic"] }), item({ id: "c2", title: "Other", status: "not-found" })], checkedOrg: "demo" };

  it("adds known causes found to a failed publish prompt", () => {
    const p = failedPublishPrompt({ profiles: ["Rep"], startedAt: "2026-10-20T10:00:00Z", startedBy: null, error: "Bad filter", logs: [], causes: result });
    expect(p).toContain("- Topic sync record has a bad filter (c1): found in the org (DbSchema_Topic)");
    expect(p).not.toContain("(c2)");
    expect(failedPublishPrompt({ profiles: ["Rep"], startedAt: "2026-10-20T10:00:00Z", startedBy: null, error: "x", logs: [], causes: { items: [], checkedOrg: "demo" } })).toContain(
      "None of Studio's known setup mistakes match this error."
    );
  });
});
