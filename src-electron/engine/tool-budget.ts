/**
 * Per-message limits on tools that are expensive per call and easy to fan out: the model checking
 * every rep in the org one by one for "reps can't see X" doesn't scale past a demo org.
 */

export const PER_MESSAGE_LIMITS: Readonly<Record<string, number>> = {
  check_user_access: 2,
};

/** The refusal for a call over its limit for this user message, or null when it may run (and is counted). */
export function spendToolBudget(name: string, counts: Map<string, number>): string | null {
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
