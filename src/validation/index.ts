/**
 * Validation module exports
 */

export {
  // Types
  type ValidationRule,
  type ValidationGroup,
  type CheckResult,
  type AuditResult,
  type Severity,
  type Category,
  // Loader functions
  loadAllRules,
  getAllRules,
  getRulesByGroup,
  getValidationGroups,
  getRuleById,
  findRulesBySymptom,
  getRulesByCategory,
  getRulesBySeverity,
  getRulesByTag,
} from "./rules-loader.js";

export {
  // Executor functions
  runAudit,
  formatAuditResults,
} from "./rules-executor.js";

export { executeCheck, type CheckOutcome } from "./rules-executor.js";

export { type KnownCause, getKnownCauses, getKnownCauseById } from "./known-causes.js";

export { matchSymptom, normalizeText, type SymptomMatch } from "./symptom-match.js";

export {
  diagnose,
  diagnosisItems,
  formatDiagnosis,
  type Diagnosis,
  type CauseFinding,
  type DiagnosisItem,
} from "./diagnose.js";
