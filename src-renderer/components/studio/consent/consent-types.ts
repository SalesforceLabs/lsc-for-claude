/** Structural copy of PublishedConsent in src/studio/screens/consent/logic.ts. */
export type ConsentState = "OptIn" | "OptOut" | "NotAsked" | "Partial";
export type ProofMethod = "DigitalSignature" | "Attachment" | "DocumentReference" | "VerbalConsent";
export type Requirement = "Required" | "Optional" | "NotRequired";

export interface ConsentSettings {
  globalChannel: "Topic Only" | "Channel Only" | "Channel and Topic";
  multipleChannelValueEnabled: boolean;
  showRestricted: boolean;
  signature: Requirement;
  attachment: Requirement;
  documentReference: Requirement;
  verbal: Requirement;
  canSkipTerms: boolean;
  allowNotAskedOpt: boolean;
}

export interface ConsentRow {
  title: string;
  channelId: string;
  subscriptionChannelId: string;
  contactPointId: string;
  value: string;
  state: ConsentState;
}

export interface ConsentSubscription {
  id: string;
  name: string;
  rows: ConsentRow[];
}

export interface PublishedConsent {
  settings: ConsentSettings;
  subscriptions: ConsentSubscription[];
  global?: ConsentRow[];
  addable: string[];
  proof: ProofMethod[];
  lastSnapshot?: { id: string; verbal: boolean; documentReference?: string };
  gaps: string[];
}
