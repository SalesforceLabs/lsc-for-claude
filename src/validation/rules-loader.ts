/**
 * Validation Rules Loader
 *
 * Loads and parses validation rules from YAML files in the knowledge/validation-rules directory.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to validation rules directory (relative to project root)
const RULES_DIR = join(__dirname, "../../knowledge/validation-rules");

// ============================================================================
// TYPES
// ============================================================================

export type CheckType =
  | "soql"
  | "soql_count"
  | "tooling_soql"
  | "tooling_soql_count"
  | "metadata"
  | "api"
  | "cli"
  | "composite";
export type Severity = "error" | "warning" | "info";
export type Category =
  | "mobile-login"
  | "metadata-cache"
  | "sync"
  | "permissions"
  | "configuration"
  | "territory"
  | "deployment";

export interface RuleCheck {
  type: CheckType;
  query?: string;
  object?: string;
  endpoint?: string;
  command?: string;
  checks?: RuleCheck[];
  expect: string;
  error_detail_query?: string;
}

export interface RuleResolution {
  steps: string[];
  ui_path?: string;
  documentation?: string;
  auto_fix?: {
    available: boolean;
    type?: "soql_update" | "api_call" | "cli_command" | "apex";
    action?: string;
    requires_confirmation?: boolean;
  };
}

export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  category: Category;
  severity: Severity;
  check: RuleCheck;
  symptoms: string[];
  resolution: RuleResolution;
  issue_ref?: string;
  prerequisites?: string[];
  tags?: string[];
  /** LSC Studio readiness stage; inferred from `category` when left out. */
  stage?: "enabled" | "access" | "data" | "config" | "mobile";
  /** LSC Studio board surface that shows the records this rule checks (e.g. "dbSchema"). */
  studio_surface?: string;
}

export interface ValidationGroup {
  name: string;
  description: string;
  rules: string[];
}

export interface ValidationRuleFile {
  /** File name the rules were read from, e.g. "visit-management-config.yaml". */
  file: string;
  schema_version: string;
  category_name: string;
  description: string;
  rules: ValidationRule[];
  groups: Record<string, ValidationGroup>;
}

export interface CheckResult {
  rule: ValidationRule;
  passed: boolean;
  message: string;
  details?: unknown;
  error?: string;
}

export interface AuditResult {
  timestamp: string;
  group?: string;
  targetOrg: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    warnings: number;
    skipped: number;
  };
  results: CheckResult[];
}

// ============================================================================
// LOADER FUNCTIONS
// ============================================================================

/**
 * Load all validation rule files from the rules directory
 */
export function loadAllRules(): ValidationRuleFile[] {
  const ruleFiles: ValidationRuleFile[] = [];

  if (!existsSync(RULES_DIR)) {
    console.error(`Rules directory not found: ${RULES_DIR}`);
    return ruleFiles;
  }

  const files = readdirSync(RULES_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  for (const file of files) {
    // Skip schema file
    if (file.startsWith("_")) continue;

    try {
      const content = readFileSync(join(RULES_DIR, file), "utf-8");
      const parsed = parseYaml(content) as ValidationRuleFile;
      ruleFiles.push({ ...parsed, file });
    } catch (error) {
      console.error(`Failed to parse ${file}:`, error);
    }
  }

  return ruleFiles;
}

/**
 * Rules from the named files (e.g. "visit-management-config.yaml"), in file order
 */
export function getRulesFromFiles(files: string[]): ValidationRule[] {
  const byFile = new Map(loadAllRules().map((rf) => [rf.file, rf.rules || []]));
  return files.flatMap((f) => byFile.get(f) ?? []);
}

/**
 * Get all rules flattened into a single array
 */
export function getAllRules(): ValidationRule[] {
  const ruleFiles = loadAllRules();
  return ruleFiles.flatMap((rf) => rf.rules || []);
}

/**
 * Get rules by group name
 */
export function getRulesByGroup(groupName: string): ValidationRule[] {
  const ruleFiles = loadAllRules();
  const allRules = getAllRules();

  // Find the group definition
  for (const ruleFile of ruleFiles) {
    if (ruleFile.groups && ruleFile.groups[groupName]) {
      const group = ruleFile.groups[groupName];
      return allRules.filter((r) => group.rules.includes(r.id));
    }
  }

  return [];
}

/**
 * Get available validation groups
 */
export function getValidationGroups(): Array<{
  id: string;
  name: string;
  description: string;
  ruleCount: number;
}> {
  const ruleFiles = loadAllRules();
  const groups: Array<{
    id: string;
    name: string;
    description: string;
    ruleCount: number;
  }> = [];

  for (const ruleFile of ruleFiles) {
    if (ruleFile.groups) {
      for (const [id, group] of Object.entries(ruleFile.groups)) {
        groups.push({
          id,
          name: group.name,
          description: group.description,
          ruleCount: group.rules.length,
        });
      }
    }
  }

  return groups;
}

/**
 * Get a specific rule by ID
 */
export function getRuleById(ruleId: string): ValidationRule | undefined {
  const allRules = getAllRules();
  return allRules.find((r) => r.id === ruleId);
}

/**
 * Find rules that match a symptom (for diagnostic purposes)
 */
export function findRulesBySymptom(symptom: string): ValidationRule[] {
  const allRules = getAllRules();
  const lowerSymptom = symptom.toLowerCase();

  return allRules.filter((rule) =>
    rule.symptoms.some((s) => s.toLowerCase().includes(lowerSymptom))
  );
}

/**
 * Get rules by category
 */
export function getRulesByCategory(category: Category): ValidationRule[] {
  const allRules = getAllRules();
  return allRules.filter((r) => r.category === category);
}

/**
 * Get rules by severity
 */
export function getRulesBySeverity(severity: Severity): ValidationRule[] {
  const allRules = getAllRules();
  return allRules.filter((r) => r.severity === severity);
}

/**
 * Get rules by tag
 */
export function getRulesByTag(tag: string): ValidationRule[] {
  const allRules = getAllRules();
  return allRules.filter((r) => r.tags?.includes(tag));
}
