/**
 * Per-message limits on tools that are expensive per call and easy to fan out: the model checking
 * every rep in the org one by one for "reps can't see X" doesn't scale past a demo org, and a
 * troubleshooting answer that runs 30 ad-hoc queries keeps the user waiting minutes for detail
 * they didn't ask for.
 */

export const PER_MESSAGE_LIMITS: Readonly<Record<string, number>> = {
  check_user_access: 2,
};

/** Ad-hoc org reads share one count per message: past it, answer from what was found. */
export const ORG_QUERY_TOOLS: ReadonlySet<string> = new Set([
  "run_soql",
  "describe_sobject",
  "get_record",
]);
export const ORG_QUERY_LIMIT = 12;
const ORG_QUERY_KEY = "org-queries";

export const ORG_QUERY_REFUSAL =
  `You have run ${ORG_QUERY_LIMIT} ad-hoc org queries (run_soql, describe_sobject, get_record) for this message, ` +
  "the most one message may, and no more will run. Answer the user now from what you have found: lead with the likeliest " +
  "cause and the fix, say plainly which points you couldn't check in the org, and offer to check them if they reply. " +
  "Don't retry the query or work around this with other tools.";

/**
 * A query the org rejected for its shape (a field or object that doesn't exist, bad syntax) read
 * nothing, so it shouldn't use up the budget meant for reads. At most ORG_QUERY_REFUNDS a message are
 * given back, so a model that keeps guessing names still reaches the limit.
 */
export const ORG_QUERY_REFUNDS = 6;
const REFUND_KEY = "org-query-refunds";
const REJECTED_QUERY =
  /INVALID_FIELD|MALFORMED_QUERY|INVALID_TYPE|INVALID_QUERY_FILTER_OPERATOR|No such column|is not supported|can not be filtered|duplicate (field|alias)/;

export function isRejectedQuery(text: string): boolean {
  const head = text.slice(0, 600);
  return /^#\s*Query Failed|^Error:/.test(head.trimStart()) && REJECTED_QUERY.test(head);
}

/** Give back the count for an org query the org rejected for its shape. Returns whether it did. */
export function refundToolBudget(
  name: string,
  resultText: string,
  counts: Map<string, number>
): boolean {
  if (!ORG_QUERY_TOOLS.has(name) || !isRejectedQuery(resultText)) return false;
  const refunds = counts.get(REFUND_KEY) ?? 0;
  const used = counts.get(ORG_QUERY_KEY) ?? 0;
  if (refunds >= ORG_QUERY_REFUNDS || used === 0) return false;
  counts.set(REFUND_KEY, refunds + 1);
  counts.set(ORG_QUERY_KEY, used - 1);
  return true;
}

/** The refusal for a call over its limit for this user message, or null when it may run (and is counted). */
export function spendToolBudget(name: string, counts: Map<string, number>): string | null {
  if (ORG_QUERY_TOOLS.has(name)) {
    const used = counts.get(ORG_QUERY_KEY) ?? 0;
    if (used >= ORG_QUERY_LIMIT) return ORG_QUERY_REFUSAL;
    counts.set(ORG_QUERY_KEY, used + 1);
    return null;
  }
  const limit = PER_MESSAGE_LIMITS[name];
  if (limit === undefined) return null;
  const used = counts.get(name) ?? 0;
  if (used >= limit) {
    return (
      `Already checked ${limit} reps for this message, the most one message may. Don't check reps one by one: ` +
      "say what the checks so far found, look at what the reps share instead (their profile's navigation tabs, DB Schema, " +
      "permission sets, metadata cache), or ask the user which rep to check next."
    );
  }
  counts.set(name, used + 1);
  return null;
}
