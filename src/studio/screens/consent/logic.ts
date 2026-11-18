/**
 * Capture Consent: the data model behind the sheet, ported from lifesciences-ios
 * module/OPT/Consent/CommunicationConsent (LSCCommunicationConsentDataMapper, DataManager, OCEDBOptSettingsModel).
 * Pure: the loader in consent.ts reads the org, this lines it up the way the device does.
 */

export type ConsentState = "OptIn" | "OptOut" | "NotAsked" | "Partial";
export type ProofMethod = "DigitalSignature" | "Attachment" | "DocumentReference" | "VerbalConsent";
export type Requirement = "Required" | "Optional" | "NotRequired";

export interface ConsentSettings {
  /** OCEDBOptSettingsModel.globalChannel: "Topic Only" | "Channel Only" | "Channel and Topic". */
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

export interface RawChannel {
  id: string;
  name: string;
  contactPointType?: string;
}
export interface RawSubscription {
  id: string;
  name: string;
}
export interface RawSubscriptionChannel {
  id: string;
  subscriptionId: string;
  channelId: string;
}
export interface RawContactPoint {
  id: string;
  value: string;
  /** Social platform ("Facebook") for social contact points. */
  provider?: string;
}
export interface RawConsent {
  subscriptionChannelId: string;
  channelId: string;
  contactPointId?: string;
  status?: string;
}

export interface ConsentRow {
  /** Title the device shows: the channel name and its position, "Email 2". */
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
  /** Subscriptions by name, global row excluded. */
  subscriptions: ConsentSubscription[];
  /** The global row's channels, present unless the org's setting is Topic Only. */
  global?: ConsentRow[];
  /** Channels the account has no value for yet: the "Add Channel" list (one per channel type). */
  addable: string[];
  proof: ProofMethod[];
  /** When the latest consent snapshot was captured, and whether it was verbal. */
  lastSnapshot?: { id: string; verbal: boolean; documentReference?: string };
  /** What the device does that the preview doesn't. */
  gaps: string[];
}

const STATES: ConsentState[] = ["OptIn", "OptOut", "NotAsked", "Partial"];
export const toState = (s?: string): ConsentState =>
  (STATES as string[]).includes(s ?? "") ? (s as ConsentState) : "NotAsked";

/** OCEDBOptSettingsModel: every spelling of "not required" the backend has sent counts as not required. */
export function requirement(raw: unknown, fallback: Requirement): Requirement {
  const s = String(raw ?? "").replace(/\s+/g, "");
  if (s === "Required") return "Required";
  if (s === "Optional") return "Optional";
  if (s === "NotRequired" || s === "NotRequred") return "NotRequired";
  return fallback;
}

const bool = (v: unknown, fallback: boolean): boolean =>
  v === undefined || v === null || v === "" ? fallback : String(v).toLowerCase() === "true";

/** OCEDBOptSettingsModel defaults when a key isn't saved. */
export function readSettings(fields: Record<string, unknown> | undefined): ConsentSettings {
  const f = fields ?? {};
  const g = String(f.GlobalChannelOpt ?? "");
  return {
    globalChannel: g === "Channel Only" || g === "Channel and Topic" ? g : "Topic Only",
    multipleChannelValueEnabled: bool(f.MultipleChannelValueEnabled, true),
    showRestricted: bool(f.ShowRestricted, false),
    // signatureRequirement: no value at all is "not required", an unknown one "optional".
    signature:
      f.SignatureRequirements == null || f.SignatureRequirements === ""
        ? "NotRequired"
        : requirement(f.SignatureRequirements, "Optional"),
    attachment: requirement(f.MobileAttachmentRequirements, "NotRequired"),
    documentReference: requirement(f.MobileDocumentReferenceRequirements, "NotRequired"),
    verbal: requirement(f.MobileVerbalConsentRequirements, "NotRequired"),
    canSkipTerms: bool(f.CanSkipTerms, false),
    allowNotAskedOpt: bool(f.AllowNotAskedOpt, false),
  };
}

/** The proof methods the rep can offer, in LSCConsentProofMethod order, those the org doesn't turn off. */
export function proofMethods(s: ConsentSettings): ProofMethod[] {
  const out: ProofMethod[] = [];
  if (s.signature !== "NotRequired") out.push("DigitalSignature");
  if (s.attachment !== "NotRequired") out.push("Attachment");
  if (s.documentReference !== "NotRequired") out.push("DocumentReference");
  if (s.verbal !== "NotRequired") out.push("VerbalConsent");
  return out;
}

const ci = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

export interface ConsentInput {
  settings: ConsentSettings;
  subscriptions: RawSubscription[];
  subscriptionChannels: RawSubscriptionChannel[];
  channels: RawChannel[];
  contactPoints: Record<string, RawContactPoint>;
  consents: RawConsent[];
  /** Subscriptions to show only (the quick action's subscription list); empty for all. */
  only?: string[];
}

/**
 * LSCCommunicationConsentDataMapper.transformDBDataToConsentSubscriptionViewModels: per subscription, per channel it
 * is offered on, one row for each contact point the account has active consent for on that channel (titled
 * "<channel> <n>" by contact point id order), in the state of its active consent or Not Asked. Rows without a
 * contact point value are dropped. The global row folds a channel + contact point across subscriptions: one
 * state if they agree, Partial otherwise.
 */
export function buildConsent(
  input: ConsentInput
): Pick<PublishedConsent, "subscriptions" | "global" | "addable"> {
  const { settings, consents, contactPoints } = input;
  const only = new Set(input.only ?? []);
  const subs = input.subscriptions.filter((s) => !only.size || only.has(s.id));
  const subIds = new Set(subs.map((s) => s.id));
  const scts = input.subscriptionChannels.filter((c) => subIds.has(c.subscriptionId));
  const channelIds = new Set(scts.map((c) => c.channelId));
  const channels = input.channels.filter((c) => channelIds.has(c.id));
  const channelName = new Map(channels.map((c) => [c.id, c.name]));

  // The contact points the account has active consent on, per channel, in id order (syncActiveConsents).
  const cpIdsByChannel = new Map<string, string[]>();
  for (const ch of channels) {
    const ids = [
      ...new Set(
        consents
          .filter((c) => c.channelId === ch.id && c.contactPointId)
          .map((c) => c.contactPointId!)
      ),
    ].sort();
    cpIdsByChannel.set(ch.id, ids);
  }

  const valueOf = (id: string): string | undefined => {
    const cp = contactPoints[id];
    if (!cp) return undefined;
    return cp.provider ? `${cp.provider}: ${cp.value}` : cp.value;
  };

  const subscriptions: ConsentSubscription[] = subs
    .map((s): ConsentSubscription => {
      const rows: ConsentRow[] = [];
      for (const sct of scts.filter((c) => c.subscriptionId === s.id)) {
        const ids = cpIdsByChannel.get(sct.channelId) ?? [];
        ids.forEach((cpId, i) => {
          const value = valueOf(cpId);
          if (!value) return;
          const consent = consents.find(
            (c) => c.subscriptionChannelId === sct.id && c.contactPointId === cpId
          );
          rows.push({
            title: `${channelName.get(sct.channelId) ?? ""} ${i + 1}`,
            channelId: sct.channelId,
            subscriptionChannelId: sct.id,
            contactPointId: cpId,
            value,
            state: toState(consent?.status),
          });
        });
      }
      rows.sort((a, b) => ci(a.title, b.title));
      return { id: s.id, name: s.name, rows };
    })
    .sort((a, b) => ci(a.name, b.name));

  let global: ConsentRow[] | undefined;
  if (settings.globalChannel !== "Topic Only") {
    const groups = new Map<string, ConsentRow[]>();
    for (const row of subscriptions.flatMap((s) => s.rows)) {
      const key = `${row.channelId}|${row.contactPointId}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    global = [...groups.values()]
      .map((rows): ConsentRow => {
        const states = new Set(rows.map((r) => r.state));
        return { ...rows[0], state: states.size === 1 ? rows[0].state : "Partial" };
      })
      .sort((a, b) => ci(a.title, b.title));
  }

  // Left panel (userCustomizedChannels): one blank placeholder per channel type to add another value.
  const addable = channels
    .filter((c) => settings.multipleChannelValueEnabled || !cpIdsByChannel.get(c.id)?.length)
    .map((c) => c.name);

  return { subscriptions, global, addable };
}

/** Today as yyyy-MM-dd in UTC, the device's `fetchActiveConsents` cut-off (effectiveToDate null or >= today). */
export const todayUtc = (now = new Date()): string => now.toISOString().slice(0, 10);
