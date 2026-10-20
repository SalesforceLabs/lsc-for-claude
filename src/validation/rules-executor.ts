/**
 * Validation Rules Executor
 *
 * Executes validation rules against a Salesforce org and returns results.
 */

import { runSoqlQuery, runToolingQuery } from "../salesforce/cli.js";
import type { ValidationRule, CheckResult, AuditResult, RuleCheck } from "./rules-loader.js";
import { getAllRules, getRulesByGroup, getValidationGroups } from "./rules-loader.js";

// ============================================================================
// CHECK EXECUTOR
// ============================================================================

/**
 * Execute a single rule check against the org
 */
/** A check's outcome. `unavailable` = it couldn't be evaluated (query failed, unsupported type or condition). */
export interface CheckOutcome {
  passed: boolean;
  message: string;
  details?: unknown;
  unavailable?: boolean;
}

/** What a check may read beyond the org: the text a diagnosis was asked about. */
export interface CheckContext {
  symptom?: string;
}

export async function executeCheck(check: RuleCheck, targetOrg: string, context: CheckContext = {}): Promise<CheckOutcome> {
  try {
    switch (check.type) {
      case "soql":
        return await executeSoqlCheck(check, targetOrg, false);

      case "soql_count":
        return await executeSoqlCountCheck(check, targetOrg, false);

      case "tooling_soql":
        return await executeSoqlCheck(check, targetOrg, true);

      case "tooling_soql_count":
        return await executeSoqlCountCheck(check, targetOrg, true);

      case "composite":
        return await executeCompositeCheck(check, targetOrg, context);

      case "builtin": {
        const { runBuiltinCheck } = await import("./builtin-checks.js");
        return await runBuiltinCheck(check.name, targetOrg, context);
      }

      case "metadata":
      case "api":
      case "cli":
        // These types are not yet implemented
        return {
          passed: true,
          message: `Check type '${check.type}' not yet implemented - skipped`,
          unavailable: true,
        };

      default:
        return {
          passed: false,
          message: `Unknown check type: ${check.type}`,
          unavailable: true,
        };
    }
  } catch (error) {
    return {
      passed: false,
      message: `Check execution failed: ${error instanceof Error ? error.message : String(error)}`,
      unavailable: true,
    };
  }
}

/**
 * Execute a SOQL check that returns records
 */
async function executeSoqlCheck(
  check: RuleCheck,
  targetOrg: string,
  useToolingApi: boolean = false
): Promise<CheckOutcome> {
  if (!check.query) {
    return { passed: false, message: "No query specified for SOQL check", unavailable: true };
  }

  const result = useToolingApi
    ? await runToolingQuery(check.query, targetOrg)
    : await runSoqlQuery(check.query, targetOrg);

  if (!result.success) {
    // Check if it's an object not found error (object doesn't exist)
    if (result.error?.includes("sObject type") && result.error?.includes("is not supported")) {
      return {
        passed: false,
        message: `Object not found in org - this feature may not be installed`,
        details: { error: result.error },
        unavailable: true,
      };
    }
    return {
      passed: false,
      message: `Query failed: ${result.error}`,
      details: { error: result.error },
      unavailable: true,
    };
  }

  const records = result.data?.records || [];

  // Evaluate the expect condition
  const evaluated = evaluateExpectCondition(check.expect, {
    records,
    count: records.length,
  });
  if (evaluated === null) {
    return { passed: false, message: `Can't evaluate condition: ${check.expect}`, unavailable: true };
  }
  const passed = evaluated;
  // For an every(...) check, the records to show are the ones that broke it.
  const fieldTest = parseFieldTest(check.expect);
  const offending = fieldTest?.fn === "every" ? records.filter((r) => !fieldTest.test(r)) : records;

  return {
    passed,
    message: passed
      ? `Check passed (${records.length} records)`
      : `Check failed: found ${offending.length} records that don't meet criteria`,
    details: passed ? undefined : { count: offending.length, records: offending.slice(0, 10) }, // Limit detail records
  };
}

/** Expectations that only ask whether any row matches. */
const EXISTENCE_EXPECTS = new Set(["count > 0", "count >= 1", "count == 0"]);

/**
 * A plain `SELECT COUNT() FROM ...` whose rule only tests for presence is
 * answered by reading one row: counting every match can time out on a large
 * table when the answer needs only the first. Null when the query or the
 * expectation needs the real number.
 */
function existenceQuery(check: RuleCheck): string | null {
  const q = check.query?.trim().replace(/\s+/g, " ");
  if (!q || !EXISTENCE_EXPECTS.has(check.expect)) return null;
  const m = /^SELECT COUNT\(\) (FROM .+)$/i.exec(q);
  if (!m || /\b(GROUP BY|LIMIT|HAVING|OFFSET)\b/i.test(m[1])) return null;
  return `SELECT Id ${m[1]} LIMIT 1`;
}

/**
 * Execute a SOQL COUNT check
 */
async function executeSoqlCountCheck(
  check: RuleCheck,
  targetOrg: string,
  useToolingApi: boolean = false
): Promise<CheckOutcome> {
  if (!check.query) {
    return { passed: false, message: "No query specified for SOQL count check", unavailable: true };
  }

  const exists = existenceQuery(check);
  const sql = exists ?? check.query;
  const result = useToolingApi ? await runToolingQuery(sql, targetOrg) : await runSoqlQuery(sql, targetOrg);

  if (!result.success) {
    // Check if it's an object not found error
    if (result.error?.includes("sObject type") && result.error?.includes("is not supported")) {
      return {
        passed: false,
        message: `Object not found in org - this feature may not be installed`,
        details: { error: result.error },
        unavailable: true,
      };
    }
    return {
      passed: false,
      message: `Query failed: ${result.error}`,
      details: { error: result.error },
      unavailable: true,
    };
  }

  // For COUNT() queries, the result is in totalSize
  // (An existence query reads at most one row, so its count is 0 or 1.)
  const count = exists ? Math.min(1, result.data?.totalSize || result.data?.records?.length || 0) : result.data?.totalSize || 0;

  // Evaluate the expect condition
  const evaluated = evaluateExpectCondition(check.expect, { count });
  if (evaluated === null) {
    return { passed: false, message: `Can't evaluate condition: ${check.expect}`, unavailable: true };
  }
  const passed = evaluated;

  if (exists) {
    return {
      passed,
      message: passed ? `Check passed (${count ? "found a matching record" : "no matching record"})` : `Check failed: ${count ? "a matching record exists" : "no matching record"}, expected ${check.expect}`,
      details: { exists: count > 0 },
    };
  }

  return {
    passed,
    message: passed
      ? `Check passed (count: ${count})`
      : `Check failed: count is ${count}, expected ${check.expect}`,
    details: { count },
  };
}

/**
 * Execute a composite check (multiple sub-checks)
 */
async function executeCompositeCheck(
  check: RuleCheck,
  targetOrg: string,
  context: CheckContext
): Promise<CheckOutcome> {
  if (!check.checks || check.checks.length === 0) {
    return { passed: false, message: "No sub-checks specified for composite check", unavailable: true };
  }

  const subResults: CheckOutcome[] = [];

  for (const subCheck of check.checks) {
    const subResult = await executeCheck(subCheck, targetOrg, context);
    subResults.push(subResult);
  }

  // All sub-checks must pass for composite to pass
  const allPassed = subResults.every((r) => r.passed);
  // A sub-check that couldn't run (including the not-implemented types, which report passed) leaves the whole
  // unknown — unless another sub-check definitely failed.
  const definitelyFailed = subResults.some((r) => !r.passed && !r.unavailable);

  return {
    passed: allPassed,
    unavailable: !definitelyFailed && subResults.some((r) => r.unavailable) ? true : undefined,
    message: allPassed
      ? `All ${subResults.length} sub-checks passed`
      : `${subResults.filter((r) => !r.passed).length} of ${subResults.length} sub-checks failed`,
    details: { subResults },
  };
}

/**
 * records.some / records.every with one field compared to null or a quoted literal, e.g.
 * "records.every(r => r.InternalSharingModel != 'Private')". Parsed, never evaluated as code.
 */
function parseFieldTest(expect: string): { fn: "some" | "every"; test: (r: unknown) => boolean } | null {
  const m = expect.match(/^records\.(some|every)\(\s*(\w+)\s*=>\s*\2\.(\w+)\s*(==|!=)\s*(null|'[^']*')\s*\)$/);
  if (!m) return null;
  const [, fn, , field, op, literal] = m;
  const want = literal === "null" ? null : literal.slice(1, -1);
  const test = (r: unknown) => {
    const value = (r as Record<string, unknown>)[field] ?? null;
    return op === "==" ? value === want : value !== want;
  };
  return { fn: fn as "some" | "every", test };
}

/**
 * Evaluate an expect condition against context data
 *
 * Supports conditions like:
 * - "count > 0"
 * - "count == 0"
 * - "records.length > 0"
 * - "records.length == 0"
 * - "true" (always pass)
 *
 * Returns null when the condition can't be evaluated.
 */
function evaluateExpectCondition(
  expect: string,
  context: { records?: unknown[]; count?: number; result?: unknown }
): boolean | null {
  try {
    // Handle simple cases first
    if (expect === "true") return true;
    if (expect === "false") return false;

    // Create a safe evaluation context
    const { records, count } = context;

    // Simple pattern matching for common conditions
    // count comparisons
    if (expect.startsWith("count")) {
      const actualCount = count ?? records?.length ?? 0;

      if (expect === "count > 0") return actualCount > 0;
      if (expect === "count >= 0") return actualCount >= 0;
      if (expect === "count == 0") return actualCount === 0;
      if (expect === "count < 10") return actualCount < 10;
      if (expect === "count < 5") return actualCount < 5;

      // Parse "count <= N" pattern
      const countLteMatch = expect.match(/^count\s*<=\s*(\d+)$/);
      if (countLteMatch) {
        return actualCount <= parseInt(countLteMatch[1], 10);
      }

      // Parse "count >= N" pattern
      const countGteMatch = expect.match(/^count\s*>=\s*(\d+)$/);
      if (countGteMatch) {
        return actualCount >= parseInt(countGteMatch[1], 10);
      }

      // Parse "count < N" pattern
      const countLtMatch = expect.match(/^count\s*<\s*(\d+)$/);
      if (countLtMatch) {
        return actualCount < parseInt(countLtMatch[1], 10);
      }

      // Parse "count > N" pattern
      const countGtMatch = expect.match(/^count\s*>\s*(\d+)$/);
      if (countGtMatch) {
        return actualCount > parseInt(countGtMatch[1], 10);
      }

      // Parse "count == N" pattern
      const countEqMatch = expect.match(/^count\s*==\s*(\d+)$/);
      if (countEqMatch) {
        return actualCount === parseInt(countEqMatch[1], 10);
      }
    }

    // records.length comparisons
    if (expect.startsWith("records.length")) {
      const len = records?.length ?? 0;

      if (expect === "records.length > 0") return len > 0;
      if (expect === "records.length == 0") return len === 0;
      if (expect === "records.length >= 0") return len >= 0;

      const lenEqMatch = expect.match(/^records\.length\s*==\s*(\d+)$/);
      if (lenEqMatch) {
        return len === parseInt(lenEqMatch[1], 10);
      }
    }

    // Complex expressions with records.some() or records.every()
    const fieldTest = parseFieldTest(expect);
    if (fieldTest) {
      const { fn, test } = fieldTest;
      return fn === "some" ? (records?.some(test) ?? false) : (records?.every(test) ?? true);
    }

    // If we can't parse the condition, log it and return false for safety
    console.error(`Unable to evaluate expect condition: ${expect}`);
    return null;
  } catch (error) {
    console.error(`Error evaluating expect condition '${expect}':`, error);
    return null;
  }
}

// ============================================================================
// AUDIT EXECUTOR
// ============================================================================

/**
 * Run a full audit with a specific group or all rules
 */
export async function runAudit(
  targetOrg: string,
  options: {
    group?: string;
    ruleIds?: string[];
    categories?: string[];
    severities?: string[];
  } = {}
): Promise<AuditResult> {
  const { group, ruleIds } = options;

  // Get rules to run
  let rulesToRun: ValidationRule[];

  if (group) {
    rulesToRun = getRulesByGroup(group);
    if (rulesToRun.length === 0) {
      // Check if group exists
      const groups = getValidationGroups();
      const groupExists = groups.some((g) => g.id === group);
      if (!groupExists) {
        throw new Error(
          `Validation group '${group}' not found. Available groups: ${groups.map((g) => g.id).join(", ")}`
        );
      }
    }
  } else if (ruleIds && ruleIds.length > 0) {
    const allRules = getAllRules();
    rulesToRun = allRules.filter((r) => ruleIds.includes(r.id));
  } else {
    // Run all rules
    rulesToRun = getAllRules();
  }

  // Execute each rule
  const results: CheckResult[] = [];
  const summary = {
    total: rulesToRun.length,
    passed: 0,
    failed: 0,
    errors: 0,
    warnings: 0,
    skipped: 0,
  };

  for (const rule of rulesToRun) {
    // Check prerequisites
    if (rule.prerequisites && rule.prerequisites.length > 0) {
      const prereqResults = results.filter((r) => rule.prerequisites!.includes(r.rule.id));
      const prereqsFailed = prereqResults.some((r) => !r.passed);

      if (prereqsFailed) {
        results.push({
          rule,
          passed: false,
          message: `Skipped: prerequisite check(s) failed`,
        });
        summary.skipped++;
        continue;
      }
    }

    // Execute the check
    const checkResult = await executeCheck(rule.check, targetOrg);

    const result: CheckResult = {
      rule,
      passed: checkResult.passed,
      message: checkResult.message,
      details: checkResult.details,
    };

    results.push(result);

    // Update summary
    if (checkResult.passed) {
      summary.passed++;
    } else {
      summary.failed++;
      if (rule.severity === "error") {
        summary.errors++;
      } else if (rule.severity === "warning") {
        summary.warnings++;
      }
    }
  }

  return {
    timestamp: new Date().toISOString(),
    group,
    targetOrg,
    summary,
    results,
  };
}

/**
 * Format audit results as markdown
 */
export function formatAuditResults(audit: AuditResult): string {
  let output = `# Mobile Configuration Audit Report\n\n`;
  output += `**Timestamp:** ${audit.timestamp}\n`;
  output += `**Target Org:** ${audit.targetOrg}\n`;
  if (audit.group) {
    output += `**Validation Group:** ${audit.group}\n`;
  }
  output += `\n`;

  // Summary
  output += `## Summary\n\n`;
  output += `| Metric | Count |\n`;
  output += `|--------|-------|\n`;
  output += `| Total Checks | ${audit.summary.total} |\n`;
  output += `| Passed | ${audit.summary.passed} |\n`;
  output += `| Failed | ${audit.summary.failed} |\n`;
  output += `| Errors | ${audit.summary.errors} |\n`;
  output += `| Warnings | ${audit.summary.warnings} |\n`;
  if (audit.summary.skipped > 0) {
    output += `| Skipped | ${audit.summary.skipped} |\n`;
  }
  output += `\n`;

  // Overall status
  if (audit.summary.errors > 0) {
    output += `### Status: FAILED\n\n`;
    output += `Found ${audit.summary.errors} error(s) that need to be fixed.\n\n`;
  } else if (audit.summary.warnings > 0) {
    output += `### Status: PASSED WITH WARNINGS\n\n`;
    output += `Found ${audit.summary.warnings} warning(s) that should be reviewed.\n\n`;
  } else {
    output += `### Status: PASSED\n\n`;
    output += `All checks passed successfully.\n\n`;
  }

  // Failed checks (errors first, then warnings)
  const failedResults = audit.results.filter((r) => !r.passed);

  if (failedResults.length > 0) {
    output += `## Issues Found\n\n`;

    // Group by severity
    const errors = failedResults.filter((r) => r.rule.severity === "error");
    const warnings = failedResults.filter((r) => r.rule.severity === "warning");
    const infos = failedResults.filter((r) => r.rule.severity === "info");

    if (errors.length > 0) {
      output += `### Errors (Must Fix)\n\n`;
      for (const result of errors) {
        output += formatFailedCheck(result);
      }
    }

    if (warnings.length > 0) {
      output += `### Warnings (Should Fix)\n\n`;
      for (const result of warnings) {
        output += formatFailedCheck(result);
      }
    }

    if (infos.length > 0) {
      output += `### Info (Consider Fixing)\n\n`;
      for (const result of infos) {
        output += formatFailedCheck(result);
      }
    }
  }

  // Passed checks summary
  const passedResults = audit.results.filter((r) => r.passed);
  if (passedResults.length > 0) {
    output += `## Passed Checks (${passedResults.length})\n\n`;
    for (const result of passedResults) {
      output += `- **${result.rule.id}**: ${result.rule.name}\n`;
    }
    output += `\n`;
  }

  return output;
}

/**
 * Format a single failed check for the report
 */
function formatFailedCheck(result: CheckResult): string {
  let output = `#### ${result.rule.id}: ${result.rule.name}\n\n`;
  output += `**Severity:** ${result.rule.severity.toUpperCase()}\n`;
  output += `**Result:** ${result.message}\n\n`;

  // Description
  output += `**What this checks:** ${result.rule.description.trim()}\n\n`;

  // Symptoms (if any)
  if (result.rule.symptoms && result.rule.symptoms.length > 0) {
    output += `**Related error messages:**\n`;
    for (const symptom of result.rule.symptoms.slice(0, 3)) {
      output += `- "${symptom}"\n`;
    }
    output += `\n`;
  }

  // Resolution steps
  output += `**How to fix:**\n`;
  for (const step of result.rule.resolution.steps) {
    output += `1. ${step}\n`;
  }

  if (result.rule.resolution.ui_path) {
    output += `\n**Navigate to:** ${result.rule.resolution.ui_path}\n`;
  }

  // Details (if available)
  if (result.details) {
    const details = result.details as Record<string, unknown>;
    if (details.records && Array.isArray(details.records)) {
      const records = details.records as Record<string, unknown>[];
      if (records.length > 0) {
        output += `\n**Records found:**\n`;
        output += "```json\n";
        output += JSON.stringify(records.slice(0, 5), null, 2);
        output += "\n```\n";
        if (records.length > 5) {
          output += `*...and ${records.length - 5} more*\n`;
        }
      }
    }
  }

  output += `\n---\n\n`;
  return output;
}

// Re-export from rules-loader for convenience
export {
  getAllRules,
  getRulesByGroup,
  getValidationGroups,
  getRuleById,
  findRulesBySymptom,
} from "./rules-loader.js";
