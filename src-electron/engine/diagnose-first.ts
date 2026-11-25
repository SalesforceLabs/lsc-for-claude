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

/**
 * Looser everyday phrasing. It lets through more real problems, and more messages that aren't
 * one, so when nothing matches chat doesn't show an empty diagnosis for it (`quietWhenEmpty`).
 */
const LOOSE: RegExp[] = [
  /\b(?:could|would|did|does|do|is|are|was|were|has|have|had|will) not\b|\b(?:didn|wasn|weren|hasn|haven)(?:'|’)?t\b/i,
  /\b(?:vanish(?:es|ed)?|disappear(?:s|ing)?|greyed out|grayed out|expired|duplicated|refused|bounces|spins forever|takes? (?:hours|forever|ages))\b/i,
  /\b(?:no|zero) (?:\w+ )?(?:rows?|customers?|choices|columns?|values?|options?|items?|products?|catalogs?|calendar|targets?|status|warning|approver|period|lines?|entries)\b/i,
];

/**
 * Words that point at a symptom only when the message reports what the app or the reps do
 * ("ipad shows no customers… even though the rep is aligned", "list opens empty"), not in a
 * question, a wish or a request ("is it wrong to…", "we still need to…").
 */
const OBSERVED_SIGN = /\b(?:never|nothing|nobody|no one|empty|blank|wrong|twice|ignores|blocked|clash(?:es)?|forever|huge|odd|strange|raw|fewer|still|always|whenever|instead of|even though|though|although|went through|(?:is|are|went|goes) down|different \w+ than|but not (?:when|on|in|for))\b/i;
const OBSERVED_VERB = /\b(?:shows?|showing|shown|displays?|appears?|lists?|opens?|stays?|keeps?|says?|said|gets?|got|returns?|pops? up|comes? up|loads?|finishes|downloads?|counted|calculat\w*|lets?|stored|reaches|behaves|logged|aligned|created|updated|synced|syncing|is|are|looks?|gives?|stops?|typed|built|generated|after (?:\w+ )?(?:sync|syncing|publish|refresh|importing|bringing))\b/i;
const NOT_A_REPORT = /^\s*(?:is it|should|would|could|can|do|does|are there|i(?:'d| would) like|i want|we (?:still )?need|help me|nothing urgent|remind me)\b|\bshould (?:say|show|be|look|have)\b|\?\s*$/i;

/** A message that starts by asking for something to be built or changed is a task, not a symptom. */
const BUILD_REQUEST = /^\s*(?:please\s+|can you\s+|could you\s+|i (?:want|need) (?:to|you to)\s+)?(?:create|build|write|generate|make|add|set up|setup|configure|enable|disable|activate|deactivate|turn (?:on|off)|switch (?:on|off)|update|change|edit|rename|move|assign|unassign|give|grant|revoke|remove|delete|deploy|retrieve|publish|regenerate|run|query|install|list|describe|export|import|draft|design|plan|summari[sz]e|compare|show me how)\b/i;

/**
 * A first word that is the subject, not a request: "plan progress numbers frozen", "publish fails
 * saying…", "list on the ipad is empty".
 */
const NOUN_START = /^\s*(?:publish|plan|list|run|query|update|change|import|export|design|draft|move)\b(?!\s+(?:the|this|that|these|those|a|an|my|our|all|it|them|me)\b)(?:\s+[\w'’]+){0,3}?\s+(?:fails?|failed|failing|is|are|was|were|shows?|showing|says?|numbers?|progress|stuck|frozen|spins?|takes?|returns?|doesn(?:'|’)?t|didn(?:'|’)?t|won(?:'|’)?t|never|keeps?)\b/i;

/**
 * A request to pull or audit data ("Audit visit data…", "Count the accounts…", "For every quote,
 * list…"): its "no territory" or "doesn't match" names what to look for, not a symptom.
 * Nouns ("Count of visits is wrong", "Audit trail shows…") and "For every visit I save, the iPad
 * shows an error" don't match.
 */
const DATA_REQUEST = [
  /^\s*(?:please\s+|can you\s+|could you\s+)?(?:audit|count|tally|reconcile)\s+(?!(?:of|trail|log|history|is|was|shows?|says?)\b)/i,
  /^\s*for (?:every|each|all)\b[^.?!]*?(?:,\s*|\bin (?:this|the) org\b[^.?!]*?)(?:list|show|count|find|give|flag|tell|return|report)\b/i,
];

/** A how-to or definition question with no sign of something being wrong. */
const HOW_TO = /^\s*(?:how (?:do|can|should|would|to)\b|what(?:'s| is| are)\b|explain\b|tell me about\b|where (?:do|can|is)\b|which\b)/i;

export function normalizeSymptom(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Messages that are never a problem report, whatever the cause picker makes of them: too short,
 * slash commands, requests to build or change something, data pulls, and how-to questions with
 * no sign of something wrong.
 */
function notAReport(t: string): boolean {
  if (t.length < 8) return true;
  if (t.startsWith("/")) return true; // slash commands (/lsc:...) are instructions
  if (BUILD_REQUEST.test(t) && !NOUN_START.test(t)) return true;
  if (DATA_REQUEST.some((r) => r.test(t))) return true;
  return HOW_TO.test(t) && !/\b(?:fix|why|error|fail|failed|fails|broken|not working)\b/i.test(t);
}

/**
 * How the message reads: `clear` (an error, or plain words for something not working), `loose`
 * (only the looser wording), or null when it doesn't read like a problem.
 */
export function problemReading(text: string): "clear" | "loose" | null {
  const t = text.trim();
  if (t.length < 8 || t.startsWith("/")) return null;
  if (STRONG.some((re) => re.test(t))) return "clear";
  if (notAReport(t)) return null;
  if (WEAK.some((re) => re.test(t))) return "clear";
  const loose =
    LOOSE.some((re) => re.test(t)) ||
    (OBSERVED_SIGN.test(t) && OBSERVED_VERB.test(t) && !NOT_A_REPORT.test(t));
  return loose ? "loose" : null;
}

/**
 * True when the word check doesn't take the message for a problem but it could still be one,
 * so the cause picker is asked (`diagnosePreflightWithPicks`).
 */
export function pickerMayRead(text: string): boolean {
  const t = text.trim();
  return problemReading(t) === null && !notAReport(t);
}

/** True when the message reads like an error or a symptom worth matching against known causes. */
export function readsLikeProblem(text: string): boolean {
  return problemReading(text) !== null;
}

/**
 * The tools to run before the model's first round for this message. `seen` holds the messages
 * already diagnosed in this conversation (updated here), so the same text is not run twice.
 */
export function diagnosePreflight(text: string, seen?: Set<string>): PreflightCall[] {
  const reading = problemReading(text);
  if (!reading) return [];
  const key = normalizeSymptom(text);
  if (seen?.has(key)) return [];
  seen?.add(key);
  const input: Record<string, unknown> = { symptom: text.trim().slice(0, MAX_SYMPTOM_CHARS), format: "json" };
  if (reading === "loose") input.quietWhenEmpty = true;
  return [{ name: "diagnose_lsc_issue", input }];
}

/** A cause the picker named (`cause-picker.ts`): `explains` when it would produce what the user describes. */
export interface PickedCause {
  id: string;
  fit: "explains" | "related";
}

/**
 * `diagnosePreflight`, with the causes `pick` names (the chat model choosing from the cause
 * titles, `cause-picker.ts`) passed to diagnose as `suggested`. A pick that fails or finds
 * nothing leaves the call as word matching alone.
 *
 * Plain wording often shares no words with a problem ("the body is just white"), so a message
 * the word check lets go is still given to the picker unless it is a request or a how-to
 * question. Such a message is diagnosed only when the picker says a cause would produce what
 * it describes (`explains`), with only those causes, and stays out of the chat when diagnose
 * has nothing: a cause that is only nearby would be a wrong answer.
 */
export async function diagnosePreflightWithPicks(
  text: string,
  seen: Set<string> | undefined,
  pick: ((text: string) => Promise<PickedCause[]>) | undefined
): Promise<PreflightCall[]> {
  const calls = diagnosePreflight(text, seen);
  if (!pick) return calls;
  if (!calls.length && !pickerMayRead(text)) return calls;
  const key = normalizeSymptom(text);
  if (!calls.length && seen?.has(key)) return [];
  let picks: PickedCause[] = [];
  try {
    picks = await pick(text);
  } catch {
    picks = [];
  }
  if (calls.length) {
    if (!picks.length) return calls;
    return calls.map((c) => ({ ...c, input: { ...c.input, suggested: picks.map((p) => p.id) } }));
  }
  seen?.add(key);
  const explains = picks.filter((p) => p.fit === "explains").map((p) => p.id);
  if (!explains.length) return [];
  return [
    {
      name: "diagnose_lsc_issue",
      input: {
        symptom: text.trim().slice(0, MAX_SYMPTOM_CHARS),
        format: "json",
        suggested: explains,
        quietWhenEmpty: true,
      },
    },
  ];
}
