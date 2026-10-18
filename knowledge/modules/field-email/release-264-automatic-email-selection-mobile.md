# Automatic Email Selection on Mobile - Winter '27 (264)

Platform: iPad. Available starting the week of October 5, 2026. Requires the Agentforce for Life Sciences Cloud add-on.

## What's New

- The mobile app **automatically selects the best opted-in email address** for the HCP.
- Recipients appear in the **same order as on the desktop site**: ordered by the preference rank on Contact Point Email records — ranked addresses first (ascending), then unranked addresses, ties broken alphabetically.
- Reps can pick a different available address, subject to the org's **consent settings** (only opted-in addresses are selectable).

## Admin Tips

- Set preference rank on `ContactPointEmail` records to control the default recipient.
- Consent configuration (channels, opt-in) drives which addresses qualify: see `consent-management`.
- Official help: "Customize and Send Emails".

## Send Email Flow (Help: "Customize and Send Emails")

- Prerequisite: Life Sciences Emails requires **domain-level and user-level email verification**; delivery fails if the user's address or sending domain is unverified.
- Mobile app entry points: home page, visit and account records, content library, presentation player, Next Best Action and Next Best Customer components, Accounts lists and filters page, remote engagements. Desktop: accounts, visits, and Accounts lists and filters.
- Send Email window: filter/select/preview templates (by brand, category, product, topic, language; auto-filtered by context), attachments (PDF/JPG preview, **up to 12**; attachments with the `required` prefix are added by default and can't be removed), presentation links (reorder/delete), subject, fragments, preview, recipients (HCP/HCO, colleagues as CC, manual addresses if admin allows), consent verification/capture, send or schedule.
- After sending, consent is validated; emails to opted-out recipients are canceled automatically. Sent emails: App Launcher > **Life Sciences Emails**; history in the account Activity Timeline.
- Queue behavior: sent/scheduled emails enter the email queue with **Urgency Type = Scheduled** on the Life Science Email record and go out on the next Send Email job run (after the scheduled time, if set). Only remote engagement invitation emails use Immediate and bypass the queue.
- Help does not describe the preference-rank ordering or automatic address selection; those details come from the release deck.

## Related

- [release-264-email-fragment-tracking](./release-264-email-fragment-tracking.md)

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_email_customize_send.htm&release=264.0.0&type=5
