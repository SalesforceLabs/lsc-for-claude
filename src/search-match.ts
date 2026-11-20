/**
 * Matching for the knowledge search. A model asks in several words ("quote approval stage path"),
 * which almost never appear together word for word, so a document matches when it holds enough of
 * the query's words, not only the exact phrase. The exact phrase still ranks first.
 */

const STOPWORDS = new Set(
  "a an and are as at be by can do does for from has have how i in is it its my of on or set the this that to up what when where which why with".split(
    " "
  )
);

/** The query's distinct search words: lowercased, stopwords and one-letter words dropped, plurals cut to the stem. */
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  const out = new Set<string>();
  for (const w of words) {
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    // "tiers" finds "tier", "schedules" finds "schedule"; "process", "class" stay whole.
    out.add(w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  }
  return [...out];
}

/** How many of `n` query words a document must hold: all of one or two, then at least half and never fewer than two. */
export function wordsNeeded(n: number): number {
  return n <= 2 ? n : Math.max(2, Math.ceil(n / 2));
}

export interface TextMatch {
  /** Higher is better: the exact phrase beats any word match, then more distinct words, then density. */
  score: number;
  /** Where the excerpt should centre. */
  index: number;
  /** Length of the matched text at `index`, for the excerpt window. */
  length: number;
}

/** Scores `content` against a query, or null when it doesn't match. `title` words count extra. */
export function matchText(content: string, query: string, title = ""): TextMatch | null {
  const lower = content.toLowerCase();
  const phrase = query.trim().toLowerCase();
  const terms = queryTerms(query);
  const titleLower = title.toLowerCase();
  const titleHits = terms.filter((t) => titleLower.includes(t)).length;

  const phraseAt = phrase ? lower.indexOf(phrase) : -1;
  if (phraseAt !== -1)
    return { score: 10_000 + titleHits * 50, index: phraseAt, length: phrase.length };
  if (terms.length === 0) return null;

  const found = terms.filter((t) => lower.includes(t));
  if (found.length < wordsNeeded(terms.length)) return null;

  let occurrences = 0;
  for (const t of found) occurrences += lower.split(t).length - 1;
  const density = Math.min(50, (occurrences * 10_000) / Math.max(lower.length, 1));

  // Centre on the markdown section holding the most of the query's distinct words (ties: more
  // occurrences), then on that section's line holding the most of them. A line alone picks a stray
  // sentence over the checklist that answers the question.
  const starts = [
    0,
    ...[...lower.matchAll(/^#{1,6} /gm)].map((m) => m.index!).filter((x) => x > 0),
  ];
  let bestSection = { distinct: -1, occ: -1, from: 0, to: lower.length };
  starts.forEach((from, k) => {
    const to = starts[k + 1] ?? lower.length;
    const text = lower.slice(from, to);
    const hit = found.filter((t) => text.includes(t));
    const occ = hit.reduce((n, t) => n + text.split(t).length - 1, 0);
    if (
      hit.length > bestSection.distinct ||
      (hit.length === bestSection.distinct && occ > bestSection.occ)
    )
      bestSection = { distinct: hit.length, occ, from, to };
  });
  let best = { hits: -1, index: bestSection.from };
  let offset = bestSection.from;
  for (const line of lower.slice(bestSection.from, bestSection.to).split("\n")) {
    const hits = found.filter((t) => line.includes(t)).length;
    if (hits > best.hits) best = { hits, index: offset };
    offset += line.length + 1;
  }
  return {
    score: found.length * 100 + titleHits * 50 + density,
    index: best.index,
    length: 0,
  };
}

/**
 * The markdown section holding `index`: from the heading at or before it to the next heading of the
 * same or a higher level. A section longer than `limit` is cut at line ends to a window that starts
 * a little before `index`, so the lines after the match (the rest of a checklist) come along.
 */
export function sectionAround(content: string, index: number, limit: number): string {
  const headings = [...content.matchAll(/^(#{1,6}) /gm)].map((m) => ({
    at: m.index!,
    level: m[1].length,
  }));
  const own = headings.filter((h) => h.at <= index).at(-1);
  const start = own?.at ?? 0;
  const next = headings.find((h) => h.at > start && (!own || h.level <= own.level));
  const end = next?.at ?? content.length;
  if (end - start <= limit) return content.slice(start, end).trim();

  const lineStart = (i: number) => content.lastIndexOf("\n", i - 1) + 1;
  const from = Math.max(start, lineStart(Math.max(start, index - Math.floor(limit / 4))));
  let to = Math.min(end, from + limit);
  if (to < end) {
    const cut = content.lastIndexOf("\n", to);
    if (cut > from) to = cut;
  }
  // Never cut off the line the match is on.
  const matchLineEnd = content.indexOf("\n", index);
  to = Math.min(end, Math.max(to, matchLineEnd === -1 ? end : matchLineEnd));
  const body = content.slice(from, to).trim();
  return `${from > start ? "..." : ""}${body}${to < end ? "\n..." : ""}`;
}
