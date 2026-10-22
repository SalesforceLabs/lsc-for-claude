import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MOCK_VALIDATION_RULE,
  MOCK_VALIDATION_RULE_WARNING,
  MOCK_VALIDATION_RULE_FILE,
  MOCK_SOQL_RESULT,
  MOCK_EMPTY_SOQL_RESULT,
} from "../../helpers/fixtures.js";

// Mock the salesforce CLI
vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
}));

// Mock the rules-loader to return controlled data
vi.mock("../../../src/validation/rules-loader.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../src/validation/rules-loader.js")
  >();
  return {
    ...actual,
    loadAllRules: vi.fn(),
    getAllRules: vi.fn(),
    getRulesByGroup: vi.fn(),
    getValidationGroups: vi.fn(),
    getRuleById: vi.fn(),
    findRulesBySymptom: vi.fn(),
  };
});

const { runSoqlQuery, runToolingQuery } = await import(
  "../../../src/salesforce/cli.js"
);
const { getAllRules, getRulesByGroup, getValidationGroups } = await import(
  "../../../src/validation/rules-loader.js"
);
const { runAudit, formatAuditResults, executeCheck } = await import(
  "../../../src/validation/rules-executor.js"
);

describe("rules-executor.ts", () => {
  beforeEach(() => {
    vi.mocked(runSoqlQuery).mockReset();
    vi.mocked(runToolingQuery).mockReset();
    vi.mocked(getAllRules).mockReset();
    vi.mocked(getRulesByGroup).mockReset();
    vi.mocked(getValidationGroups).mockReset();
  });

  // ==========================================================================
  // runAudit — SOQL count checks
  // ==========================================================================
  describe("existence-only count checks", () => {
    const rule = (query: string, expect: string, type: "soql_count" | "tooling_soql_count" = "soql_count") => ({
      ...MOCK_VALIDATION_RULE,
      check: { type, query, expect },
    });

    it("reads one row instead of counting when the rule only asks for presence", async () => {
      vi.mocked(getAllRules).mockReturnValue([rule("SELECT COUNT() FROM Account WHERE IsActive = true", "count > 0")]);
      vi.mocked(runSoqlQuery).mockResolvedValue({ success: true, data: { totalSize: 1, done: true, records: [{ Id: "001" }] } });
      const audit = await runAudit("my-org");
      expect(vi.mocked(runSoqlQuery).mock.calls[0][0]).toBe("SELECT Id FROM Account WHERE IsActive = true LIMIT 1");
      expect(audit.summary.passed).toBe(1);
    });

    it("applies to count == 0 and to the Tooling API", async () => {
      vi.mocked(getAllRules).mockReturnValue([rule("SELECT COUNT() FROM Flow", "count == 0", "tooling_soql_count")]);
      vi.mocked(runToolingQuery).mockResolvedValue({ success: true, data: { totalSize: 1, done: true, records: [{ Id: "301" }] } });
      const audit = await runAudit("my-org");
      expect(vi.mocked(runToolingQuery).mock.calls[0][0]).toBe("SELECT Id FROM Flow LIMIT 1");
      expect(audit.summary.failed).toBe(1);
    });

    it("keeps the real COUNT() when the number matters or the query is not plain", async () => {
      vi.mocked(getAllRules).mockReturnValue([rule("SELECT COUNT() FROM Account", "count < 50")]);
      vi.mocked(runSoqlQuery).mockResolvedValue({ success: true, data: { totalSize: 3, done: true, records: [] } });
      await runAudit("my-org");
      expect(vi.mocked(runSoqlQuery).mock.calls[0][0]).toBe("SELECT COUNT() FROM Account");

      vi.mocked(runSoqlQuery).mockClear();
      vi.mocked(getAllRules).mockReturnValue([rule("SELECT COUNT() FROM Account LIMIT 10", "count > 0")]);
      await runAudit("my-org");
      expect(vi.mocked(runSoqlQuery).mock.calls[0][0]).toBe("SELECT COUNT() FROM Account LIMIT 10");
    });

    it("reports a timed-out check as unavailable, never failed", async () => {
      vi.mocked(runSoqlQuery).mockResolvedValue({ success: false, error: "Query timed out after 120s" });
      const outcome = await executeCheck(rule("SELECT COUNT() FROM Account", "count > 0").check, "my-org");
      expect(outcome.unavailable).toBe(true);
      expect(outcome.message).toContain("timed out");
    });
  });

  describe("records.some / records.every field tests", () => {
    const rows = [
      { QualifiedApiName: "LifeSciStageObject", InternalSharingModel: "Private" },
      { QualifiedApiName: "LifeSciStageAction", InternalSharingModel: "Read" },
    ];
    const check = (expect: string) => ({ type: "tooling_soql" as const, query: "SELECT QualifiedApiName FROM EntityDefinition", expect });

    it("lists only the records that break an every() test", async () => {
      vi.mocked(runToolingQuery).mockResolvedValue({ success: true, data: { totalSize: 2, done: true, records: rows } });
      const outcome = await executeCheck(check("records.every(r => r.InternalSharingModel != 'Private')"), "my-org");
      expect(outcome.passed).toBe(false);
      expect(outcome.details).toEqual({ count: 1, records: [rows[0]] });
    });

    it("evaluates some() and null comparisons", async () => {
      vi.mocked(runToolingQuery).mockResolvedValue({ success: true, data: { totalSize: 2, done: true, records: rows } });
      expect((await executeCheck(check("records.some(r => r.InternalSharingModel == 'Read')"), "my-org")).passed).toBe(true);
      expect((await executeCheck(check("records.every(r => r.InternalSharingModel != null)"), "my-org")).passed).toBe(true);
    });

    it("reports a condition it can't parse as unavailable", async () => {
      vi.mocked(runToolingQuery).mockResolvedValue({ success: true, data: { totalSize: 2, done: true, records: rows } });
      const outcome = await executeCheck(check("records.every(r => r.Name.startsWith('x'))"), "my-org");
      expect(outcome.unavailable).toBe(true);
    });
  });

  describe("runAudit() with soql_count check", () => {
    it("passes when count > 0 condition is met", async () => {
      const rule = {
        ...MOCK_VALIDATION_RULE,
        check: {
          type: "soql_count" as const,
          query: "SELECT COUNT() FROM Account",
          expect: "count > 0",
        },
      };
      vi.mocked(getAllRules).mockReturnValue([rule]);

      vi.mocked(runSoqlQuery).mockResolvedValue({
        success: true,
        data: { totalSize: 5, done: true, records: [] },
      });

      const audit = await runAudit("my-org");
      expect(audit.summary.passed).toBe(1);
      expect(audit.summary.failed).toBe(0);
    });

    it("fails when count > 0 condition is not met", async () => {
      const rule = {
        ...MOCK_VALIDATION_RULE,
        check: {
          type: "soql_count" as const,
          query: "SELECT COUNT() FROM Account",
          expect: "count > 0",
        },
      };
      vi.mocked(getAllRules).mockReturnValue([rule]);

      vi.mocked(runSoqlQuery).mockResolvedValue({
        success: true,
        data: { totalSize: 0, done: true, records: [] },
      });

      const audit = await runAudit("my-org");
      expect(audit.summary.failed).toBe(1);
      expect(audit.summary.errors).toBe(1); // severity is "error"
    });

    it("fails with detail when sObject not supported", async () => {
      const rule = {
        ...MOCK_VALIDATION_RULE,
        check: {
          type: "soql_count" as const,
          query: "SELECT COUNT() FROM FakeObject",
          expect: "count > 0",
        },
      };
      vi.mocked(getAllRules).mockReturnValue([rule]);

      vi.mocked(runSoqlQuery).mockResolvedValue({
        success: false,
        error: "sObject type 'FakeObject' is not supported",
      });

      const audit = await runAudit("my-org");
      expect(audit.summary.failed).toBe(1);
      expect(audit.results[0].message).toContain("not found in org");
    });
  });

  // ==========================================================================
  // runAudit — SOQL record checks
  // ==========================================================================
  describe("runAudit() with soql check", () => {
    it("passes when records.length > 0 condition is met", async () => {
      const rule = {
        ...MOCK_VALIDATION_RULE,
        check: {
          type: "soql" as const,
          query: "SELECT Id FROM Account LIMIT 5",
          expect: "records.length > 0",
        },
      };
      vi.mocked(getAllRules).mockReturnValue([rule]);

      vi.mocked(runSoqlQuery).mockResolvedValue({
        success: true,
        data: MOCK_SOQL_RESULT,
      });

      const audit = await runAudit("my-org");
      expect(audit.summary.passed).toBe(1);
    });

    it("fails when records.length == 0 expected but records found", async () => {
      const rule = {
        ...MOCK_VALIDATION_RULE,
        check: {
          type: "soql" as const,
          query: "SELECT Id FROM Account",
          expect: "records.length == 0",
        },
      };
      vi.mocked(getAllRules).mockReturnValue([rule]);

      vi.mocked(runSoqlQuery).mockResolvedValue({
        success: true,
        data: MOCK_SOQL_RESULT,
      });

      const audit = await runAudit("my-org");
      expect(audit.summary.failed).toBe(1);
    });
  });

  // ==========================================================================
  // runAudit — composite check
  // ==========================================================================
  describe("runAudit() with composite check", () => {
    it("passes when all sub-checks pass", async () => {
      const rule = {
        ...MOCK_VALIDATION_RULE,
        check: {
          type: "composite" as const,
          expect: "true",
          checks: [
            {
              type: "soql_count" as const,
              query: "SELECT COUNT() FROM Account",
              expect: "count > 0",
            },
            {
              type: "soql_count" as const,
              query: "SELECT COUNT() FROM Contact",
              expect: "count > 0",
            },
          ],
        },
      };
      vi.mocked(getAllRules).mockReturnValue([rule]);

      vi.mocked(runSoqlQuery).mockResolvedValue({
        success: true,
        data: { totalSize: 5, done: true, records: [] },
      });

      const audit = await runAudit("my-org");
      expect(audit.summary.passed).toBe(1);
    });

    it("fails when one sub-check fails", async () => {
      const rule = {
        ...MOCK_VALIDATION_RULE,
        check: {
          type: "composite" as const,
          expect: "true",
          checks: [
            {
              type: "soql_count" as const,
              query: "SELECT COUNT() FROM Account",
              expect: "count > 0",
            },
            {
              type: "soql_count" as const,
              query: "SELECT COUNT() FROM Contact",
              expect: "count > 0",
            },
          ],
        },
      };
      vi.mocked(getAllRules).mockReturnValue([rule]);

      // First call succeeds, second fails
      vi.mocked(runSoqlQuery)
        .mockResolvedValueOnce({
          success: true,
          data: { totalSize: 5, done: true, records: [] },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { totalSize: 0, done: true, records: [] },
        });

      const audit = await runAudit("my-org");
      expect(audit.summary.failed).toBe(1);
    });
  });

  // ==========================================================================
  // runAudit — group filtering
  // ==========================================================================
  describe("runAudit() group filtering", () => {
    it("runs only rules in specified group", async () => {
      vi.mocked(getRulesByGroup).mockReturnValue([MOCK_VALIDATION_RULE]);
      vi.mocked(getValidationGroups).mockReturnValue([
        {
          id: "test-group",
          name: "Test",
          description: "Test group",
          ruleCount: 1,
        },
      ]);

      vi.mocked(runSoqlQuery).mockResolvedValue({
        success: true,
        data: { totalSize: 5, done: true, records: [] },
      });

      const audit = await runAudit("my-org", { group: "test-group" });
      expect(audit.summary.total).toBe(1);
      expect(audit.group).toBe("test-group");
    });

    it("throws for nonexistent group", async () => {
      vi.mocked(getRulesByGroup).mockReturnValue([]);
      vi.mocked(getValidationGroups).mockReturnValue([]);

      await expect(
        runAudit("my-org", { group: "no-such-group" })
      ).rejects.toThrow("not found");
    });
  });

  // ==========================================================================
  // runAudit — prerequisite skipping
  // ==========================================================================
  describe("runAudit() prerequisite skipping", () => {
    it("skips rule when prerequisite fails", async () => {
      const prereqRule = {
        ...MOCK_VALIDATION_RULE,
        id: "prereq-001",
        check: {
          type: "soql_count" as const,
          query: "SELECT COUNT() FROM Account",
          expect: "count > 0",
        },
      };
      const dependentRule = {
        ...MOCK_VALIDATION_RULE_WARNING,
        id: "dep-001",
        prerequisites: ["prereq-001"],
        check: {
          type: "soql_count" as const,
          query: "SELECT COUNT() FROM Contact",
          expect: "count > 0",
        },
      };

      vi.mocked(getAllRules).mockReturnValue([prereqRule, dependentRule]);

      // Prereq fails
      vi.mocked(runSoqlQuery).mockResolvedValue({
        success: true,
        data: { totalSize: 0, done: true, records: [] },
      });

      const audit = await runAudit("my-org");
      expect(audit.summary.skipped).toBe(1);
      expect(audit.results[1].message).toContain("Skipped");
    });
  });

  // ==========================================================================
  // formatAuditResults
  // ==========================================================================
  describe("formatAuditResults()", () => {
    it("shows FAILED status when errors exist", () => {
      const audit = {
        timestamp: "2024-01-01T00:00:00Z",
        targetOrg: "my-org",
        summary: {
          total: 2,
          passed: 1,
          failed: 1,
          errors: 1,
          warnings: 0,
          skipped: 0,
        },
        results: [
          {
            rule: MOCK_VALIDATION_RULE,
            passed: false,
            message: "Check failed",
          },
          {
            rule: MOCK_VALIDATION_RULE_WARNING,
            passed: true,
            message: "Check passed",
          },
        ],
      };

      const output = formatAuditResults(audit);
      expect(output).toContain("FAILED");
      expect(output).toContain("Errors (Must Fix)");
      expect(output).toContain("test-001");
    });

    it("shows PASSED status when all pass", () => {
      const audit = {
        timestamp: "2024-01-01T00:00:00Z",
        targetOrg: "my-org",
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          errors: 0,
          warnings: 0,
          skipped: 0,
        },
        results: [
          {
            rule: MOCK_VALIDATION_RULE,
            passed: true,
            message: "Check passed",
          },
        ],
      };

      const output = formatAuditResults(audit);
      expect(output).toContain("PASSED");
      expect(output).not.toContain("FAILED");
    });

    it("shows PASSED WITH WARNINGS when only warnings fail", () => {
      const audit = {
        timestamp: "2024-01-01T00:00:00Z",
        targetOrg: "my-org",
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          errors: 0,
          warnings: 1,
          skipped: 0,
        },
        results: [
          {
            rule: MOCK_VALIDATION_RULE_WARNING,
            passed: false,
            message: "Check failed",
          },
        ],
      };

      const output = formatAuditResults(audit);
      expect(output).toContain("PASSED WITH WARNINGS");
      expect(output).toContain("Warnings (Should Fix)");
    });

    it("includes group name when provided", () => {
      const audit = {
        timestamp: "2024-01-01T00:00:00Z",
        group: "mobile-check",
        targetOrg: "my-org",
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          errors: 0,
          warnings: 0,
          skipped: 0,
        },
        results: [],
      };

      const output = formatAuditResults(audit);
      expect(output).toContain("mobile-check");
    });
  });
});
