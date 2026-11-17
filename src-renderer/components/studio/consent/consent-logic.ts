import type {
  ConsentRow,
  ConsentState,
  ConsentSubscription,
  ProofMethod,
  PublishedConsent,
} from "./consent-types";

/** LSCConsentLocalizedString / LSCConsentProofMethod titles. */
export const PROOF_TITLES: Record<ProofMethod, string> = {
  DigitalSignature: "Digital Signature",
  Attachment: "Attachments",
  DocumentReference: "Document Ref",
  VerbalConsent: "Verbal Consent",
};

export const STATE_TITLES: Record<ConsentState, string> = {
  OptIn: "Opt In",
  OptOut: "Opt Out",
  NotAsked: "Not Asked",
  Partial: "Partial",
};

/** The draft a rep makes on screen: row key -> chosen state. Never saved. */
export type Draft = Record<string, ConsentState>;

export const rowKey = (subscriptionId: string, r: ConsentRow): string =>
  `${subscriptionId}|${r.subscriptionChannelId}|${r.contactPointId}`;
export const globalKey = (r: ConsentRow): string => `global|${r.channelId}|${r.contactPointId}`;

export const stateOf = (draft: Draft, key: string, saved: ConsentState): ConsentState =>
  draft[key] ?? saved;

/** Whether the subscription rows show: not when the org's global setting is Channel Only. */
export const showTopics = (d: PublishedConsent): boolean =>
  d.settings.globalChannel !== "Channel Only";

/**
 * The global row's state after a subscription change: the same state in every subscription for that channel and
 * contact point, Partial when they differ (LSCCommunicationConsentViewModel.switchGlobalChannelState).
 */
export function globalState(
  subs: ConsentSubscription[],
  draft: Draft,
  g: ConsentRow
): ConsentState {
  const states = new Set<ConsentState>();
  for (const s of subs)
    for (const r of s.rows)
      if (r.channelId === g.channelId && r.contactPointId === g.contactPointId)
        states.add(stateOf(draft, rowKey(s.id, r), r.state));
  if (states.size === 0) return g.state;
  return states.size === 1 ? [...states][0] : "Partial";
}

/** Choosing a state on the global row sets every subscription's row for that channel value (switchAllSubscriptionsToState). */
export function setGlobal(
  subs: ConsentSubscription[],
  draft: Draft,
  g: ConsentRow,
  state: ConsentState
): Draft {
  const next = { ...draft };
  for (const s of subs)
    for (const r of s.rows)
      if (r.channelId === g.channelId && r.contactPointId === g.contactPointId)
        next[rowKey(s.id, r)] = state;
  return next;
}
