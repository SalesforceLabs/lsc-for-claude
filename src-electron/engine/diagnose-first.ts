/**
 * Decides whether a chat message reads like an error or a symptom, so the engine can run
 * `diagnose_lsc_issue` before the model's first round. Heuristic only: the main process doesn't
 * import server code, and the tool answers with no items when nothing matches.
 */

export interface PreflightCall {
  name: string;
  input: Record<string, unknown>;
}

const MAX_SYMPTOM_CHARS = 4000;

/** Error codes, exception names, stack frames and quoted platform errors. */
const STRONG: RegExp[] = [
  // Platform error codes (INVALID_FIELD, FIELD_INTEGRITY_EXCEPTION) — not any CONSTANT_CASE name.
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:EXCEPTION|ERROR|FAILED|FAILURE|EXCEEDED|MISSING|DENIED|NOT_FOUND)\b/,
  /\b(?:INVALID|INSUFFICIENT|UNABLE|CANNOT|MALFORMED|DUPLICATE|REQUIRED|ENTITY_IS|STORAGE_LIMIT|FIELD_INTEGRITY|UNKNOWN)_[A-Z0-9_]+\b/,
  /\b\w+Exception\b/,
  /\bno such column\b/i,
  /\binsufficient access\b/i,
  /\bINVALID_SESSION_ID\b|\bUNABLE_TO_LOCK_ROW\b/,
  /\bat \S+\.\S+\(.*\)|\bat line \d+|\bstack ?trace\b|\bCaused by:/i,
  /\b(?:error|errors) code\b|\berror:\s*\S/i,
  /\bcoming soon\b/i,
  /\bsync (?:error|failed|fails|failure|stuck)\b|\bfailed to sync\b/i,
  /\b(?:http )?(?:4\d\d|5\d\d) (?:error|response)\b/i,
];

/** Everyday phrasing of something not working. */
const WEAK: RegExp[] = [
  /\b(?:can(?:'|’)?t|cannot|can not|couldn(?:'|’)?t|unable to|won(?:'|’)?t|doesn(?:'|’)?t|don(?:'|’)?t|isn(?:'|’)?t|aren(?:'|’)?t|not able to)\b/i,
  /\bnot (?:showing|working|syncing|loading|appearing|visible|displaying|available|updating|opening)\b/i,
  /\b(?:fail|fails|failed|failing|failure|error|errors|errored|broken|crash|crashes|crashed|stuck|blank|missing|disappeared|hangs|frozen)\b/i,
  /\bwhy (?:is|isn't|are|aren't|do|does|did|can't|won't|am i)\b/i,
  /\b(?:no|zero) (?:records|data|accounts|results)\b/i,
];

/** A message that starts by asking for something to be built or changed is a task, not a symptom. */
const BUILD_REQUEST = /^\s*(?:please\s+|can you\s+|could you\s+|i (?:want|need) (?:to|you to)\s+)?(?:create|build|write|generate|make|add|set up|setup|configure|enable|disable|activate|deactivate|turn (?:on|off)|switch (?:on|off)|update|change|edit|rename|move|assign|unassign|give|grant|revoke|remove|delete|deploy|retrieve|publish|regenerate|run|query|install|list|describe|export|import|draft|design|plan|summari[sz]e|compare|show me how)\b/i;

/** A how-to or definition question with no sign of something being wrong. */
const HOW_TO = /^\s*(?:how (?:do|can|should|would|to)\b|what(?:'s| is| are)\b|explain\b|tell me about\b|where (?:do|can|is)\b|which\b)/i;

export function normalizeSymptom(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** True when the message reads like an error or a symptom worth matching against known causes. */
export function readsLikeProblem(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  if (t.startsWith("/")) return false; // slash commands (/lsc:...) are instructions
  if (STRONG.some((re) => re.test(t))) return true;
  if (BUILD_REQUEST.test(t)) return false;
  const weak = WEAK.some((re) => re.test(t));
  if (!weak) return false;
  if (HOW_TO.test(t) && !/\b(?:fix|why|error|fail|failed|fails|broken|not working)\b/i.test(t)) return false;
  return true;
}

/**
 * The tools to run before the model's first round for this message. `seen` holds the messages
 * already diagnosed in this conversation (updated here), so the same text is not run twice.
 */
export function diagnosePreflight(text: string, seen?: Set<string>): PreflightCall[] {
  if (!readsLikeProblem(text)) return [];
  const key = normalizeSymptom(text);
  if (seen?.has(key)) return [];
  seen?.add(key);
  return [{ name: "diagnose_lsc_issue", input: { symptom: text.trim().slice(0, MAX_SYMPTOM_CHARS), format: "json" } }];
}
