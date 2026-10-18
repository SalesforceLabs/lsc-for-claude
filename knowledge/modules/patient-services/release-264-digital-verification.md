# Digital Verification Setup Changes - Winter '27 (264)

Applies to: Life Sciences Advanced Therapy Management add-on license (Lightning Experience, Enterprise/Unlimited). The general "Set Up Electronic Signatures" article is available with Health Cloud or Life Sciences Cloud.

## What Changed

Digital Verification manages electronic signatures in Salesforce instead of a third-party app.

- **Internal users:** starting in Winter '27 no connected app or external client app is required. (Previously a connected app was required.)
- **Portal users (Experience Cloud):** configure an **external client app** (connected app creation is restricted as of Spring '26; existing connected apps keep working, but Help recommends external client apps).

## Prerequisites / Permissions

| Task | Permission |
|------|-----------|
| Set up and manage electronic signatures | Health Cloud Advanced Therapy Orchestration or Chain of Custody User permission set |
| Create/activate decision table | System Administrator profile |
| Flow Builder | Manage Flow |
| Create/configure external client apps and OAuth settings | Create, edit, and delete External Client Apps |
| Edit auth provider settings | Customize Application AND Manage Auth. Providers |
| Named credentials | Manage Named Credentials or Customize Applications |

## End-to-End Setup (Help: "Set Up Electronic Signatures")

1. Add users to a user group or assign a participant role (any member of a designated verifier group/role can sign).
2. Create a signature trail.
3. Define the signature (e.g. designated verifiers).
4. Validate signers' CRM credentials, **only for Experience Cloud site users** (internal users skip this):
   1. Create an external client app (OAuth client) and configure its OAuth settings.
   2. Create an authentication provider using the app's Consumer Key and Consumer Secret.
   3. Create a named credential referencing the auth provider. For Advanced Therapy Management select **New Legacy**.
   4. Configure the Experience Cloud site (published) for headless login.
   5. Add the site domain to Remote Site Settings.
   6. Setup > **Advanced Therapy Management Settings**: set the named credential record ID for digital verification.
   7. Setup > **OAuth and OpenID Connect Settings**: enable **Allow OAuth Username-Password Flows**.
5. Configure a decision table holding setup info such as required number of signatures and verification process type.
6. Create digital verification records with a new flow or by overriding a managed flow; optionally a subflow confirming all signatures on a trail are complete.
7. Add the **Digital Verification List** component to the Home page or a record page (e.g. Care Program Enrollee).

## Gotchas

- Steps 4.x apply only to portal/Experience Cloud signers.
- Items 4.6 and 4.7 (settings page, username-password flow) come from the general setup article; the Winter '27 release note does not mention them. Confirm they still apply to the external-client-app path.

## Sources

- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_patient_engagement_atm_digital_verification.htm&release=264.0.0&type=5 (search excerpt)
- https://help.salesforce.com/s/articleView?id=ind.hc_admin_digital_verification_setup.htm&release=264.0.0&type=5
