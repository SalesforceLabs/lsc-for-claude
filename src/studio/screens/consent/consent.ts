/**
 * Capture Consent, read on demand when the sheet opens (module/OPT/Consent/CommunicationConsent).
 * iOS: LSCCommunicationConsentDataManager.fetchDBDataModel — subscriptions, their channel types, the engagement
 * channels, the account's contact points, and the account's active CommSubscriptionConsent rows (EffectiveToDate
 * empty or today or later) cut down to the latest CommSubConsentCmplSnpsht. Read-only.
 */

import { fetchCategories } from "../../collectors/shared.js";
import { inList, query, type Row } from "../../helpers.js";
import {
  buildConsent,
  proofMethods,
  readSettings,
  todayUtc,
  type ConsentInput,
  type PublishedConsent,
  type RawContactPoint,
} from "./logic.js";

const s = (v: unknown): string => (v == null ? "" : String(v));

async function tryQuery(soql: string, org: string): Promise<Row[]> {
  try {
    return await query(soql, org);
  } catch {
    return [];
  }
}

export async function loadConsent(
  org: string,
  accountId: string,
  now = new Date()
): Promise<PublishedConsent> {
  const acct = inList([accountId]);
  const today = todayUtc(now);
  const [config, subs, scts, channels, consentRows, snapshots, emails, phones, socials, addresses] =
    await Promise.all([
      fetchCategories(org, ["OptAdministration"]).catch(() => []),
      query(`SELECT Id, Name FROM CommSubscription ORDER BY Name LIMIT 200`, org),
      query(
        `SELECT Id, CommunicationSubscriptionId, EngagementChannelTypeId FROM CommSubscriptionChannelType LIMIT 1000`,
        org
      ),
      query(
        `SELECT Id, Name, ContactPointType FROM EngagementChannelType WHERE IsActive = true LIMIT 100`,
        org
      ),
      query(
        `SELECT Id, CommSubscriptionChannelTypeId, EngagementChannelTypeId, ContactPointId, PrivacyConsentStatus, CommSubConsentCmplSnpshtId FROM CommSubscriptionConsent WHERE ConsentGiverId IN (${acct}) AND (EffectiveToDate = null OR EffectiveToDate >= ${today}) LIMIT 500`,
        org
      ),
      tryQuery(
        `SELECT Id, IsVerbalConsent, ConsentDocumentReference FROM CommSubConsentCmplSnpsht WHERE ConsentGiverId IN (${acct}) ORDER BY CreatedDate DESC LIMIT 1`,
        org
      ),
      tryQuery(
        `SELECT Id, EmailAddress FROM ContactPointEmail WHERE ParentId IN (${acct}) LIMIT 100`,
        org
      ),
      tryQuery(
        `SELECT Id, TelephoneNumber FROM ContactPointPhone WHERE ParentId IN (${acct}) LIMIT 100`,
        org
      ),
      tryQuery(
        `SELECT Id, SocialHandleIdentifier, SocialPlatformProvider FROM ContactPointSocial WHERE ParentReferenceRecordId IN (${acct}) LIMIT 100`,
        org
      ),
      tryQuery(
        `SELECT Id, FullAddress, Street, City, State, PostalCode FROM ContactPointAddress WHERE ParentId IN (${acct}) AND IsActive = true LIMIT 100`,
        org
      ),
    ]);

  const active = config.filter((r) => r.isActive);
  const record = active.find((r) => r.isOrgLevel) ?? active[0];
  const settings = readSettings(record?.fields);

  const contactPoints: Record<string, RawContactPoint> = {};
  for (const r of emails)
    if (r.EmailAddress) contactPoints[s(r.Id)] = { id: s(r.Id), value: s(r.EmailAddress) };
  for (const r of phones)
    if (r.TelephoneNumber) contactPoints[s(r.Id)] = { id: s(r.Id), value: s(r.TelephoneNumber) };
  for (const r of socials)
    if (r.SocialHandleIdentifier)
      contactPoints[s(r.Id)] = {
        id: s(r.Id),
        value: s(r.SocialHandleIdentifier),
        provider: s(r.SocialPlatformProvider) || undefined,
      };
  for (const r of addresses) {
    const full =
      s(r.FullAddress) ||
      [r.Street, r.City, r.State, r.PostalCode].map(s).filter(Boolean).join(", ");
    if (full) contactPoints[s(r.Id)] = { id: s(r.Id), value: full };
  }

  const snapshot = snapshots[0];
  const snapshotId = snapshot ? s(snapshot.Id) : undefined;
  // DataManager:119 — when the account has a snapshot, only the consents captured with it count.
  const consents: ConsentInput["consents"] = consentRows
    .filter((r) => !snapshotId || s(r.CommSubConsentCmplSnpshtId) === snapshotId)
    .map((r) => ({
      subscriptionChannelId: s(r.CommSubscriptionChannelTypeId),
      channelId: s(r.EngagementChannelTypeId),
      contactPointId: s(r.ContactPointId) || undefined,
      status: s(r.PrivacyConsentStatus) || undefined,
    }));

  const built = buildConsent({
    settings,
    subscriptions: subs.map((r) => ({ id: s(r.Id), name: s(r.Name) })),
    subscriptionChannels: scts.map((r) => ({
      id: s(r.Id),
      subscriptionId: s(r.CommunicationSubscriptionId),
      channelId: s(r.EngagementChannelTypeId),
    })),
    channels: channels.map((r) => ({
      id: s(r.Id),
      name: s(r.Name),
      contactPointType: s(r.ContactPointType) || undefined,
    })),
    contactPoints,
    consents,
  });

  return {
    settings,
    ...built,
    proof: proofMethods(settings),
    lastSnapshot: snapshot
      ? {
          id: snapshotId!,
          verbal: String(snapshot.IsVerbalConsent) === "true",
          documentReference: s(snapshot.ConsentDocumentReference) || undefined,
        }
      : undefined,
    gaps: [
      "subscriptions the device hides for restricted products or the account's attributes",
      "signatures, attachments and saving",
    ],
  };
}
