# Remote Engagement on Web (Twilio) - Winter '27 (264)

## What's New

Reps, MSLs, and KAMs can launch and conduct scheduled, Twilio-powered Remote Engagement sessions directly from Salesforce Web (previously mobile only). They can share approved content, track engagement, and collect remote signatures, with the same core Remote Player experience as mobile.

## Admin Setup & Configuration

No separate Remote Engagement configuration is required for Web. The existing Twilio setup, permissions, and supported capabilities from the mobile experience are reused.

One additional step: extend the existing Twilio Trusted URLs to cover **Lightning Experience Pages** in the CSP Context.

| Twilio Trusted URL | CSP Context | Status |
|---|---|---|
| `wss://global.vss.twilio.com` | Experience Builder Sites | Existing |
| `wss://sdkgw.us1.twilio.com` | Experience Builder Sites | Existing |
| `wss://global.vss.twilio.com` | Lightning Experience Pages | New - required for Web |
| `wss://sdkgw.us1.twilio.com` | Lightning Experience Pages | New - required for Web |

Steps:
1. Setup > Trusted URLs.
2. Create additional entries for both Twilio endpoints.
3. Set CSP Context to **Lightning Experience Pages**.
4. Set CSP Directive to **connect-src (scripts)**.
5. Ensure the URLs are active and save.

Keep the existing Experience Builder Sites entries so HCPs can still join remote sessions. Alternative: set the CSP Context of the existing Twilio Trusted URLs to **All** to cover both experiences without extra entries.

### Existing Twilio setup being reused (Help: "Set Up Twilio for Remote Engagement")

Permission set: **Life Sciences Commercial Admin** (Trusted URLs need Customize Application + Modify All Data). Components:
1. Configure Twilio credentials (named/external credentials shipped in the managed package: account ID, auth token, API key, secrets).
2. Experience Cloud site so HCPs can join; grant **Access Remote Engagement for Digital Experience** permission set to the site's guest user profile.
3. Add the Video Call Recordings related list to the Visit record page.
4. Trusted URLs (`wss://global.vss.twilio.com`, `wss://sdkgw.us1.twilio.com`; Help documents only the Experience Builder Sites context, the Lightning Experience Pages entries come from the release note).
5. Admin Console > **Remote Engagement** > **Twilio Settings**: Remote Visit Channel, Video Call Link (Experience Cloud page URL), Customer Video Call Link; invitation options (WhatsApp, no invitations for ad-hoc or past visits); attendee options (screen share, host recording, mic/camera default on, unsupported browsers); **Remote signatures** and **Remote consent**.
6. Video call phone numbers (dial-in) and terms and conditions.

## End-User Flow (Web)

1. Create and schedule a Remote Visit from Salesforce Web; invitations are sent automatically.
2. From the Visit, select **Start Remote Engagement** (new).
3. The Remote Player opens directly in the browser (new).
4. During the session the rep can share approved content, request DTP / Sample signatures, and request Consent signatures.

Use case: a rep launches a planned remote visit from the browser, presents approved content, discusses it with the HCP, and captures a required signature in the same session.

## Limitations / Gotchas

Not available on Web (compared with mobile):
- Session recording
- Share via the rep's WhatsApp from the Remote Player
- Starting an ad-hoc Remote Engagement session (only scheduled Remote Visits)

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_remote_engagement_twilio.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_remote_engagement_assign_trusted_twilio_urls.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_remote_engagement_configure_video_call_settings.htm&release=264.0.0&type=5
- Unverified in Help: the Web (Lightning Experience Pages) Trusted URL step, Start Remote Engagement flow and Web limitations (existing content from the release note/deck).
