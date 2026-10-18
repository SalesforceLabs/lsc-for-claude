# Remote Consent Signatures on Mobile Phones - Winter '27 (264)

Platform: iPad (rep) + HCP's phone (participant).

## What's New

During a Twilio remote session, reps can request **consent signatures** from HCPs who join **on a phone**, in addition to product and sample signatures. HCPs review the consent topics, opt in or out, and sign electronically. Before Winter '27, requesting consent signatures required the HCP to join from a laptop or desktop.

Available starting the week of October 5, 2026.

## Setup

- Permission set: **Life Sciences Commercial Admin**. Remote signatures work **only with Twilio**, not Microsoft Teams.
- Steps (Help: "Set Up Remote Signatures for Remote Engagement"):
  1. App Launcher > **Life Sciences Commercial** > **Admin Console** > **Remote Engagement** > **Twilio Settings**.
  2. Select **Remote signatures** (DTP products, samples, product discussions; requires product management setup).
  3. Select **Remote consent** (requires consent management setup). Save.
  4. Products: **Products** > **Product Hierarchy** > edit product > **Signature Requirement Level** = Optional or Mandatory (add the field to the Life Science Marketable Product page layout if missing).
  5. Disclaimers: create **Compliance Statement Definition** with Module Type `Remote Engagement`, Statement Type `Disclaimer`, Statement Text, Display Order; then share the records with the reps' territories, otherwise disclaimers do not appear on the signature page.
  6. **Products** > **Product Alignment**: verify products are aligned to the reps' territories.
  7. Optional: set up confirmation emails for follow-ups after signatures.
- HCP experience: HCPs get a browser notification, review consent topics, opt in/out and sign electronically without leaving the visit.
- The Help article does not describe the phone-specific (Winter '27) behavior; phone support is from the release note only (unverified in Help).
- Builds on Twilio remote engagement setup and Consent Management configuration (consent topics, proof settings). See [release-264-remote-engagement-web-twilio](./release-264-remote-engagement-web-twilio.md) for the desktop-site Twilio experience and `consent-management/release-264-verbal-and-paper-consent.md` for new consent proof methods.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_remote_engagement_set_up_signatures.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_remote_engagement_configure_video_call_settings.htm&release=264.0.0&type=5
