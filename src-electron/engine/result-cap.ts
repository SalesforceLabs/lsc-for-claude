/**
 * How much of one tool result the model reads. A query over a whole table (8,416 quote lines came back
 * as 10 MB once) would otherwise go into every later round of the conversation and overflow the
 * model's context, ending the session with an error and no answer.
 */

/** Ad-hoc org reads: past this the model should narrow the query, not read on. About 25k tokens. */
export const ORG_RESULT_MAX_CHARS = 100_000;
/** Everything else (module docs run to about 1 MB): a backstop well under any model's context. */
export const RESULT_MAX_CHARS = 1_200_000;

const ORG_DATA_TOOLS = new Set(["run_soql", "describe_sobject", "get_record"]);

/** The result as the model and the history keep it: whole, or cut at a line with a note saying so. */
export function capToolResult(name: string, text: string): string {
  const max = ORG_DATA_TOOLS.has(name) ? ORG_RESULT_MAX_CHARS : RESULT_MAX_CHARS;
  if (text.length <= max) return text;
  const lastLine = text.lastIndexOf("\n", max);
  const kept = text.slice(0, lastLine > max * 0.8 ? lastLine : max);
  const pct = Math.round((kept.length / text.length) * 100);
  const hint = ORG_DATA_TOOLS.has(name)
    ? "Don't read the rest: narrow the query (a WHERE clause, fewer fields, a LIMIT, or COUNT()/GROUP BY to aggregate) and tell the user the full list was too large to read here."
    : "Answer from what is shown, and say if something you needed may have been in the part cut off.";
  return `${kept}\n\n[Result cut: only the first ${pct}% (${kept.length.toLocaleString("en-US")} of ${text.length.toLocaleString("en-US")} characters) is shown. ${hint}]`;
}
