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
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "be",
  "it",
  "not",
  "no",
  "but",
  "with",
  "as",
  "at",
  "by",
  "from",
  "this",
  "that",
  "my",
  "our",
  "i",
  "we",
  "can",
  "can't",
  "cant",
  "cannot",
  "don't",
  "dont",
  "doesn't",
  "doesnt",
  "won't",
  "wont",
  "isn't",
  "after",
  "when",
  "while",
  "all",
  "any",
  "some",
  "only",
  "get",
  "got",
  "shows",
  "show",
  "showing",
  "error",
  "errors",
  "issue",
  "problem",
  "fails",
  "failed",
  "fail",
  "failing",
  "working",
  "work",
  "works",
  "missing",
  "lsc",
  "ipad",
  "mobile",
  "app",
  "user",
  "users",
  "rep",
  "reps",
  "record",
  "records",
  "please",
  "there",
  "you",
  "your",
  "have",
  "has",
  "had",
  "does",
  "do",
  "did",
  "x",
]);

/** Lower case, straight quotes, Salesforce ids and numbers removed, whitespace collapsed. */
export function normalizeText(text: string): string {
  return (
    text
      // Errors pasted from JSON keep their escapes ("...Column:42\nNo such column").
      .replace(/\\[nrt]/g, " ")
      .toLowerCase()
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/\b[a-z0-9]{3}[a-z0-9]{12}(?:[a-z0-9]{3})?\b/g, (m) => (/\d/.test(m) ? " " : m))
      .replace(/\d+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Product terms of two words. Each names one topic, so sharing one is one shared word, not two:
 * "Store Check" alone in a query and a symptom says they are about the same area, not the
 * same problem.
 */
const TERMS = [
  "store check",
  "order management",
  "price book",
  "action plan",
  "quoted order",
  "line item",
  "metadata cache",
  "record type",
  "visit engagement",
  "add products",
  "last order",
  "pricing procedure",
  "admin console",
  "product catalog",
  "browse catalog",
  "store assortment",
].map((t) => [new RegExp(`\\b${t}\\b`, "g"), t.replace(" ", "_")] as const);

function joinTerms(text: string): string {
  return TERMS.reduce((t, [re, joined]) => t.replace(re, joined), text);
}

/** Everyday words for the same thing; the right side is the word causes use. */
const SYNONYMS: Record<string, string> = {
  tablet: "ipad",
  device: "ipad",
  browser: "web",
  desktop: "web",
  spins: "spinner",
  spinning: "spinner",
};

/** Light suffix stripping so "tiered" meets "tier" and "ordering" meets "order". */
export function stem(t: string): string {
  if (t.includes("_") || t.length <= 4) return t;
  if (t.endsWith("ies") && t.length > 5) return t.slice(0, -3) + "y";
  if (t.endsWith("ing") && t.length > 6) return t.slice(0, -3);
  if (t.endsWith("ed") && t.length > 5 && !t.endsWith("eed")) return t.slice(0, -2);
  if (t.endsWith("es") && /(ss|x|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function tokens(text: string): string[] {
  return (
    joinTerms(normalizeText(text))
      .split(/[^a-z0-9_'.]+/)
      .map((t) => t.replace(/^[.']+|[.']+$/g, ""))
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
      // Plurals match their singular ("accounts" / "account").
      .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
  );
}

/**
 * Looser words for the shared-word score only: synonyms mapped and suffixes stripped, so a
 * paraphrase ("tablet", "tiered") meets the words a cause uses ("iPad", "tier"). Phrase scores
 * keep `tokens`, so a near-copy of a symptom still needs the same words.
 */
export function looseTokens(text: string): string[] {
  return joinTerms(normalizeText(text))
    .split(/[^a-z0-9_'.]+/)
    .map((t) => t.replace(/^[.']+|[.']+$/g, ""))
    .map((t) => SYNONYMS[t] ?? t)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
    .map(stem);
}

/** `phrase` appears in `text` as whole words. Both already normalized. */
function containsWords(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_])${escaped}($|[^a-z0-9_])`).test(text);
}

/** Share of its score a two-word overlap keeps. */
export const TWO_WORD_WEIGHT = 0.65;

/**
 * How well `query` matches one phrase, 0 to 1. A phrase found whole in the query (or the
 * query whole in the phrase) is 1 or 0.9; otherwise it grows with the distinctive words they
 * share, as a share of the phrase or of the query, whichever is larger.
 */
export function phraseScore(query: string, phrase: string, phraseOnly = false): number {
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
  const coverage =
    0.8 *
    (phraseOnly
      ? shared / pTokens.size
      : Math.max(shared / pTokens.size, (0.9 * shared) / qTokens.size));
  // Two shared words ("action plan", "price book") are often just the topic both are about.
  return shared === 2 ? coverage * TWO_WORD_WEIGHT : coverage;
}

function best(
  query: string,
  phrases: string[],
  weight = 1,
  phraseOnly = false
): { score: number; matched: string } {
  let top = { score: 0, matched: "" };
  for (const phrase of phrases) {
    const score = phraseScore(query, phrase, phraseOnly) * weight;
    if (score > top.score) top = { score, matched: phrase };
  }
  return top;
}

/**
 * `query` shares two distinctive words with one of `phrases` besides the keywords it names.
 * A cause's symptoms repeat its keywords, so overlap on those words alone proves nothing new.
 */
function overlapsBeyondKeywords(query: string, phrases: string[], keywords: string[]): boolean {
  const named = new Set(
    keywords.filter((k) => phraseScore(query, k) >= 0.8).flatMap((k) => tokens(k))
  );
  const rest = new Set(tokens(query).filter((t) => !named.has(t)));
  return phrases.some((p) => new Set(tokens(p).filter((t) => rest.has(t))).size >= 2);
}

/**
 * How many causes use each word in their symptoms, title or keywords. A word only one or two
 * causes use ("last_order", "quotedocumentcreationevent") points at them; one most causes of a
 * module use ("quote", "price") only names the area.
 */
const docFreq = new WeakMap<KnownCause[], Map<string, number>>();
function wordCauses(causes: KnownCause[]): Map<string, number> {
  let df = docFreq.get(causes);
  if (df) return df;
  df = new Map();
  for (const c of causes) {
    const words = new Set(looseTokens([...c.symptoms, c.title, ...(c.keywords ?? [])].join(" | ")));
    for (const w of words) df.set(w, (df.get(w) ?? 0) + 1);
  }
  docFreq.set(causes, df);
  return df;
}

/**
 * Weighted word overlap with everything a cause says it looks like (symptoms, title, keywords):
 * each shared word counts by how few causes use it, as a share of the query's own weight.
 * Paraphrases rarely share a whole symptom, but they do share its rare words.
 */
function rareOverlap(query: string, cause: KnownCause, df: Map<string, number>, n: number): number {
  const q = [...new Set(looseTokens(query))];
  if (q.length === 0) return 0;
  // Shared words must come from one phrase: two words from two unrelated symptoms aren't a match.
  const phrases = [...cause.symptoms, cause.title].map((p) => new Set(looseTokens(p)));
  let own = new Set<string>();
  let ownShared = -1;
  for (const p of phrases) {
    const n = q.filter((t) => p.has(t)).length;
    if (n > ownShared) {
      own = p;
      ownShared = n;
    }
  }
  const phraseWords = new Set(own);
  for (const k of cause.keywords ?? []) for (const t of looseTokens(k)) own.add(t);
  const idf = (t: string) => Math.log(1 + n / (1 + (df.get(t) ?? 0)));
  let shared = 0;
  let sharedCount = 0;
  let sharedRare = 0;
  let total = 0;
  for (const t of q) {
    // A word no cause uses ("forever", "ten") says nothing for or against any of them.
    if (!df.has(t)) continue;
    total += idf(t);
    if (own.has(t)) {
      shared += idf(t);
      // Keyword words add to the score but not to the counts: a keyword alone names a topic.
      if (phraseWords.has(t)) sharedCount++;
      if (phraseWords.has(t) && (df.get(t) ?? 0) <= RARE_WORD_CAUSES) sharedRare++;
    }
  }
  // Topic words ("quote", "price") are shared by many causes: three words of one phrase, one of them rare.
  if (sharedCount < MIN_SHARED || sharedRare < MIN_RARE || total === 0) return 0;
  return shared / total;
}

/** Shared words a paraphrase needs with one symptom or the title, and how many of them rare. */
export const MIN_SHARED = 3;
export const MIN_RARE = 1;

/** Share of its overlap score a paraphrase match keeps, so whole symptoms still rank first. */
export const OVERLAP_WEIGHT = 0.6;

/** Words used by at most this many causes are distinctive. */
export const RARE_WORD_CAUSES = 2;

/** Score for a cause: its symptoms count fully, its keywords and title less. */
function scoreCause(
  query: string,
  cause: KnownCause,
  df: Map<string, number> = new Map(),
  nCauses = 1
): { score: number; matched: string } {
  const bySymptom = best(query, cause.symptoms);
  const byTitle = best(query, [cause.title], 0.7, true);
  // Several keywords named in one query (object and field, say) point at the cause more surely.
  const keywordHits = (cause.keywords ?? []).filter((k) => phraseScore(query, k) >= 0.8).length;
  // One keyword names a topic ("territory", "Store Check"), not a problem: alone it is not a
  // match. It counts beside a second keyword or when a symptom or the title also overlaps
  // on other words.
  const rareKeyword = (cause.keywords ?? []).some(
    (k) =>
      phraseScore(query, k) >= 0.8 &&
      looseTokens(k).length > 0 &&
      looseTokens(k).every((t) => (df.get(t) ?? 0) <= RARE_WORD_CAUSES) &&
      // The rare keyword is most of what the query says, not one word in a longer story.
      looseTokens(k).length * 2 >= new Set(looseTokens(query)).size
  );
  const corroborated =
    keywordHits >= 2 ||
    rareKeyword ||
    overlapsBeyondKeywords(query, [...cause.symptoms, cause.title], cause.keywords ?? []);
  const byKeyword = corroborated
    ? best(query, cause.keywords ?? [], 0.6)
    : { score: 0, matched: "" };
  const byOverlap = {
    score: OVERLAP_WEIGHT * rareOverlap(query, cause, df, nCauses),
    matched: "(shared words)",
  };
  const top = [bySymptom, byKeyword, byTitle, byOverlap].reduce((a, b) =>
    b.score > a.score ? b : a
  );
  return {
    score: Math.min(1, top.score + 0.1 * Math.max(0, keywordHits - 1)),
    matched: top.matched,
  };
}

/**
 * Rules weigh less than causes: their symptoms are broad ("No products showing") and a rule
 * says what to check, not why it broke, so a loose rule match should not outrank a cause.
 */
export const RULE_WEIGHT = 0.8;

function scoreRule(query: string, rule: ValidationRule): { score: number; matched: string } {
  const bySymptom = best(query, rule.symptoms ?? []);
  const byName = best(query, [rule.name], 0.7);
  const byDescription = best(query, [rule.description], 0.5);
  const top = [bySymptom, byName, byDescription].reduce((a, b) => (b.score > a.score ? b : a));
  return { score: top.score * RULE_WEIGHT, matched: top.matched };
}

export const MIN_MATCH_SCORE = 0.35;
/** Matches scoring under this share of the best one are dropped. */
export const RELATIVE_FLOOR = 0.6;

/** Causes and rules that match `query`, best first. */
/** Every cause and rule scoring at least `minScore`, best first. */
function scoreAll(
  query: string,
  causes: KnownCause[],
  rules: ValidationRule[],
  minScore: number
): SymptomMatch[] {
  const matches: SymptomMatch[] = [];
  const df = wordCauses(causes);
  for (const cause of causes) {
    const { score, matched } = scoreCause(query, cause, df, causes.length);
    if (score >= minScore) matches.push({ kind: "cause", item: cause, score, matched });
  }
  for (const rule of rules) {
    const { score, matched } = scoreRule(query, rule);
    if (score >= minScore) matches.push({ kind: "rule", item: rule, score, matched });
  }
  // Ties go to causes: they say why and how to fix it, not only what to check.
  return matches.sort(
    (a, b) => b.score - a.score || (a.kind === b.kind ? 0 : a.kind === "cause" ? -1 : 1)
  );
}

export function matchSymptom(
  query: string,
  causes: KnownCause[],
  rules: ValidationRule[],
  minScore = MIN_MATCH_SCORE
): SymptomMatch[] {
  const matches = scoreAll(query, causes, rules, minScore);
  // Next to an exact match, loose word overlaps are noise.
  const floor = (matches[0]?.score ?? 0) * RELATIVE_FLOOR;
  return matches.filter((m) => m.score >= floor);
}

/** Weakest score a cause can have and still be offered as a possible cause. */
export const POSSIBLE_MIN_SCORE = 0.2;
/** Possible causes offered beside the matches. */
export const MAX_POSSIBLE = 3;

/**
 * Causes worth a look that didn't make `matchSymptom`'s list: they scored too low, or well
 * below the best match. Known causes only (rules have generic symptoms), best first. Callers
 * show them apart from the matches, as possible causes, never as an answer.
 */
export function possibleCauses(
  query: string,
  causes: KnownCause[],
  matched: SymptomMatch[],
  max = MAX_POSSIBLE,
  minScore = POSSIBLE_MIN_SCORE
): SymptomMatch[] {
  const taken = new Set(matched.map((m) => m.item.id));
  return scoreAll(query, causes, [], minScore)
    .filter((m) => !taken.has(m.item.id))
    .slice(0, max);
}
