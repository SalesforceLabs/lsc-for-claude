/**
 * Symptom matching
 *
 * Ranks validation rules and known causes against what a user pastes: a full error message
 * (often longer than any symptom we store, with ids and stack lines around it) or a short
 * description ("visits missing on iPad"). Exact fragments score highest, then shared
 * distinctive words.
 */

import type { ValidationRule } from "./rules-loader.js";
import type { KnownCause } from "./known-causes.js";

export type SymptomMatch =
  | { kind: "cause"; item: KnownCause; score: number; matched: string }
  | { kind: "rule"; item: ValidationRule; score: number; matched: string };

// Words too common in LSC errors and descriptions to tell causes apart.
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was", "be", "it",
  "not", "no", "but", "with", "as", "at", "by", "from", "this", "that", "my", "our", "i", "we",
  "can", "can't", "cant", "cannot", "don't", "dont", "doesn't", "doesnt", "won't", "wont", "isn't",
  "after", "when", "while", "all", "any", "some", "only", "get", "got", "shows", "show", "showing",
  "error", "errors", "issue", "problem", "fails", "failed", "fail", "failing", "working", "work",
  "works", "missing", "lsc", "ipad", "mobile", "app", "user", "users", "rep", "reps", "record",
  "records", "please", "there", "you", "your", "have", "has", "had", "does", "do", "did", "x",
]);

/** Lower case, straight quotes, Salesforce ids and numbers removed, whitespace collapsed. */
export function normalizeText(text: string): string {
  return text
    // Errors pasted from JSON keep their escapes ("...Column:42\nNo such column").
    .replace(/\\[nrt]/g, " ")
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\b[a-z0-9]{3}[a-z0-9]{12}(?:[a-z0-9]{3})?\b/g, (m) => (/\d/.test(m) ? " " : m))
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9_'.]+/)
    .map((t) => t.replace(/^[.']+|[.']+$/g, ""))
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
    // Plurals match their singular ("accounts" / "account").
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

/** `phrase` appears in `text` as whole words. Both already normalized. */
function containsWords(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_])${escaped}($|[^a-z0-9_])`).test(text);
}

/**
 * How well `query` matches one phrase, 0 to 1. A phrase found whole in the query (or the
 * query whole in the phrase) is 1 or 0.9; otherwise it grows with the distinctive words they
 * share, as a share of the phrase or of the query, whichever is larger.
 */
export function phraseScore(query: string, phrase: string): number {
  const q = normalizeText(query);
  const p = normalizeText(phrase);
  if (!q || !p) return 0;
  if (p.length >= 8 && containsWords(q, p)) return 1;
  if (q.length >= 8 && containsWords(p, q)) return 0.9;

  const pTokens = new Set(tokens(phrase));
  if (pTokens.size === 0) return 0;
  const qTokens = new Set(tokens(query));
  let shared = 0;
  for (const t of pTokens) if (qTokens.has(t)) shared++;
  if (shared === 0) return 0;
  // One shared word is noise unless the phrase is that one word, and then it counts only as
  // much as the word is of a short query.
  if (shared === 1) return pTokens.size > 1 ? 0 : (0.8 * 0.9) / qTokens.size;
  // Long pasted errors cover a stored phrase; short descriptions are covered by one.
  return 0.8 * Math.max(shared / pTokens.size, (0.9 * shared) / qTokens.size);
}

function best(query: string, phrases: string[], weight = 1): { score: number; matched: string } {
  let top = { score: 0, matched: "" };
  for (const phrase of phrases) {
    const score = phraseScore(query, phrase) * weight;
    if (score > top.score) top = { score, matched: phrase };
  }
  return top;
}

/** Score for a cause: its symptoms count fully, its keywords and title less. */
function scoreCause(query: string, cause: KnownCause): { score: number; matched: string } {
  const bySymptom = best(query, cause.symptoms);
  const byKeyword = best(query, cause.keywords ?? [], 0.6);
  const byTitle = best(query, [cause.title], 0.7);
  const top = [bySymptom, byKeyword, byTitle].reduce((a, b) => (b.score > a.score ? b : a));
  // Several keywords named in one query (object and field, say) point at the cause more surely.
  const keywordHits = (cause.keywords ?? []).filter((k) => phraseScore(query, k) >= 0.8).length;
  return { score: Math.min(1, top.score + 0.1 * Math.max(0, keywordHits - 1)), matched: top.matched };
}

function scoreRule(query: string, rule: ValidationRule): { score: number; matched: string } {
  const bySymptom = best(query, rule.symptoms ?? []);
  const byName = best(query, [rule.name], 0.7);
  const byDescription = best(query, [rule.description], 0.5);
  return [bySymptom, byName, byDescription].reduce((a, b) => (b.score > a.score ? b : a));
}

export const MIN_MATCH_SCORE = 0.35;
/** Matches scoring under this share of the best one are dropped. */
export const RELATIVE_FLOOR = 0.6;

/** Causes and rules that match `query`, best first. */
export function matchSymptom(
  query: string,
  causes: KnownCause[],
  rules: ValidationRule[],
  minScore = MIN_MATCH_SCORE
): SymptomMatch[] {
  const matches: SymptomMatch[] = [];
  for (const cause of causes) {
    const { score, matched } = scoreCause(query, cause);
    if (score >= minScore) matches.push({ kind: "cause", item: cause, score, matched });
  }
  for (const rule of rules) {
    const { score, matched } = scoreRule(query, rule);
    if (score >= minScore) matches.push({ kind: "rule", item: rule, score, matched });
  }
  // Ties go to causes: they say why and how to fix it, not only what to check.
  matches.sort((a, b) => b.score - a.score || (a.kind === b.kind ? 0 : a.kind === "cause" ? -1 : 1));
  // Next to an exact match, loose word overlaps are noise.
  const floor = (matches[0]?.score ?? 0) * RELATIVE_FLOOR;
  return matches.filter((m) => m.score >= floor);
}
