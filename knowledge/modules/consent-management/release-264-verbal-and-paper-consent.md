# Capture Consent in More Ways (Verbal and Paper) - Winter '27 (264)

Platform: iPad and Web.

## What's New

Two additional consent proof methods alongside signature and attachment:

- **Verbal consent** — rep records that consent was given verbally.
- **Document reference** — rep references an external paper consent form.

Admins can make **at least one proof a requirement** so no consent goes unbacked, while reps choose which method to use.

## Admin Setup

- Permission set: **Life Sciences Commercial Admin**. Available in Enterprise/Unlimited with Life Sciences Cloud + Customer Engagement add-on and managed package.
- Steps (Help: "Set Up Consent Management"):
  1. App Launcher > **Admin Console** > **Consent Administration**.
  2. **Apply Settings To**: org default or specific profiles (hierarchical settings).
  3. **Desktop Site Consent Proof Settings**: optionally select **Require users to add at least one of the following proofs**; set **Attachment**, **Document Reference**, **Verbal Consent** to Required or Optional.
  4. **Mobile App Consent Proof Settings**: same, plus **Signature Requirement** (Required/Optional) and **Capture geolocation during consent signing**.
  5. Save.
- Proof rules: desktop and mobile settings are independent. Each method is Required, Optional or Not Required. With "Require at least one" on, configure one or more methods as Optional and none as Required; users must supply any one Optional method. With it off, every Required method must be supplied.
- Related General Settings: allow 'Not Asked' status, lock consent capture screen, view last-captured signature, multiple channel values, skip opt-out confirmation.
- Users need access to `CommSubscriptionConsent`, `CommSubConsentCmplSnpsht`, `DigitalSignature`, `ComplianceStatementDef`, `ContentDocument`/`ContentVersion`/`ContentDocumentLink` and related objects (may not be in standard permission sets).
- Behavior: consent capture updates an existing active `CommSubscriptionConsent` (matching giver, channel type, contact point; active = `EffectiveToDate` blank or >= today) rather than creating a duplicate.
- Metadata (not confirmed in the fetched Help article): new fields on `CommSubConsentCmplSnpsht` (compliance snapshot): `IsVerbalConsent` (boolean) and `ConsentDocumentReference`.
- Regenerate the mobile metadata cache after changing proof settings; add the new snapshot fields to the DB Schema field list if you restrict synced fields.

## Related

- Existing proof model (Signature vs Attachment, `None`/`Optional`/`Required` per Module Type): [support-engineering-consent-management](./support-engineering-consent-management.md).
- Remote sessions: HCPs on phones can now also sign consent — see `remote-engagement/release-264-remote-consent-signatures-mobile.md`.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_consent_management_setup.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_customer_engagement_capture_consent_more_ways.htm&release=264.0.0&type=5 (search excerpt)
- Unverified in Help: `IsVerbalConsent` / `ConsentDocumentReference` field names, metadata cache/DB Schema advice, end-user capture flow for verbal/document reference.
