# Visit Agent: Voice-Based Visit Logging - Winter '27 (264)

Platform: iPad (Life Sciences Cloud mobile app for iOS). Generally available in Winter '27 (the Summer '26 pilot is covered in [release-262-voice-visit-logging](./release-262-voice-visit-logging.md)). Requires Life Sciences Cloud plus the **Agentforce for Life Sciences Cloud add-on** (license `AgentforceForLifeSciencesCloudAddOn`), Enterprise or Unlimited edition.

## What's New

Visit Agent is a local-first, AI-powered voice logging capability in the iPad app. The rep selects an HCP first (priming the AI so the Account maps correctly), then dictates the visit summary. Speech-to-text, entity extraction and HCP reaction inference all run **on device** (Whisper model), so it works offline. A visit thumbnail opens the pre-populated Visit Engagement screen for review and submission.

Use case: after an HCP meeting the rep opens Visit Agent, selects the account, dictates the summary; the AI maps products, messages and presentations and generates a visit. The rep reviews and submits (target: under two minutes).

## What Gets Populated (all drafts - the rep reviews every value)

| Field | How it is populated |
|-------|---------------------|
| Account | Carried from the account the rep selected before recording |
| Products Discussed | Matched against the rep's territory-aligned (active company) product list |
| Product Messages | Matched from active ProductMessage records for each discussed product |
| HCP Reactions | AI draft label per product message: positive, negative or neutral (decision-support only, not used downstream for scoring/targeting/NBA) |
| Presentations Shown | Matched from marketing presentations associated with discussed products |
| Contact Point Address | Matched against ContactPointAddress records for the account |
| Visit Start / End Time | Extracted from the recording, or device clock if no time is spoken |

Object-level mapping (from the original release note): Visit (AccountID, PlaceID, PlannedVisitStartTime, PlannedVisitEndTime), Provider Visit Product Detailing (ProductID), Provider Visit Detailing Product Messages (Message ID, Captured Reaction), Presentation Forum (PresentationID).

Reps must enter manually: **Channel** (Face-to-face, Remote, Video, Phone; default comes from the picklist configuration), other HCP attendees, samples distributed, Direct to Practitioner requests, promotional materials left behind, Record Type, and any custom or required custom fields on Visit.

## Admin Setup

Required permission: **Life Sciences Commercial Admin** (set up) and **Access Custom Agents** (assignment).

1. Verify the org has the Life Sciences Cloud license and the `AgentforceForLifeSciencesCloudAddOn` add-on license.
2. Enable Einstein and turn on Agentforce Agents (existing prerequisite from the original note).
3. Setup > Quick Find > **Life Sciences for Customer Engagement Setup** > **Set Up Custom Agents**.
4. Turn on **Visit Agent**.
5. Select **Assign Permissions to Users** and assign the **Access Custom Agents** permission set to field reps. (If the Summer '26 pilot was enabled, **reassign users the new Access Custom Agents permission set**.)
6. Generate the Metadata Cache.

Before enabling per territory: confirm territory-aligned products are correct and current, mobile sync completes and metadata is current, and reps are trained to review all values. Configure account-to-visit **record type mappings** and profile default record types first, because Visit Agent does not infer the record type (precedence: account-to-visit record type mapping, profile default, record type of an existing unsubmitted planned visit).

## Field Rep Prerequisites

1. Turn on **Apple Intelligence** (physical Apple Silicon iPad; cannot be tested in a simulator or browser).
2. At login after Visit Agent is enabled, the app downloads the Whisper speech-to-text model (~632 MB). The first download needs internet; afterwards Visit Agent works offline. The model is downloaded again after a major app update. Voice transcription does not work until the model is downloaded (Visit Agent chat still works meanwhile).

## End-User Flow

1. Home tab > tap the **Agentforce** icon > select **Visit Agent**.
2. Select a recent account from the list above the chat (territory product names are loaded automatically to prime transcription).
3. Tap the microphone, dictate in English (speak product names clearly). **Pause** / **Continue** as needed, then **Done**.
4. Tap **View Details** to review. Verify products, messages, reactions and start/end time (especially near midnight or across time zones).
5. Correct the record and **Save**. Save before closing the agent or clearing chat - otherwise the transcription is discarded.

## Limitations

- English only.
- Notes are NOT retained / NOT mapped to text fields.
- Compliance checks are NOT supported.
- No Group Visit support: one primary account per session; attendees are not expanded or resolved from the recording.
- Priming vocabulary is derived automatically (territory products + selected account); admins cannot add synonyms or brand aliases. Max ~8 products per territory for priming (from the original release note; not restated in Help).
- On-device process, not a cloud subagent: cannot be called from a cloud Agentforce orchestrator and exposes no hooks for custom automation.
- Audio is not retained and transcripts are not stored separately after the visit is saved.

## Troubleshooting

- Agent missing/disabled: ask admin to turn on Visit Agent in Set Up Custom Agents and assign Access Custom Agents (plus Field Sales Representative, Key Account Management or Field Medical permission set for the role).
- Progress bar on microphone tap: Whisper model still downloading; connect to internet.
- "Loading Model" message: model loading into memory; wait.
- Review page shows only the account: recording unclear or no products recognized; enter remaining fields manually.
- Leaving the agent before stopping the recording discards the audio; nothing is saved.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_visit_management_visit_agent_overview.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_visit_management_config_voice_logging.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_visit_management_use_voice_logging.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_customer_engagement_execution_visit_agent.htm&release=264.0.0&type=5
