# Presentation metrics missing because tracking starts paused

**What you see:** A rep launches Intelligent Content from a Visit on the mobile app. The player opens, but the session is not recorded: no Presentation Forum and no Presentation Click Stream Entry (`PresentationClickStreamEntry`) for that launch.

Check **Pause tracking when player launches** before metadata cache, DB Schema, or a missing content bundle. Those explain content that will not open or will not sync. They do not explain a player that opened with tracking paused.

## What the setting does

Admin Console → **Intelligent Content** → **Presentation Settings** → **Tracking Settings** → **Pause tracking when player launches**.

When it is on, the player starts paused. Metrics are not captured until the rep taps the play icon in the player. The setting exists so a training session is not recorded. It applies when the player starts from a Visit, not only from the content library.

Presentation Settings can be set for the org, a profile, or a user. The value that applies to the rep wins: user, then profile, then org.

## What to check

1. Call `list_admin_settings({ category: "IntelligentContent" })`. Find **Pause tracking when player launches** on the record assigned to that rep.
2. If it is on, stop. The session was paused at launch, so nothing was written. This is the product behavior.
3. If it is off, check **Turn off participant tracking** (`DisableParticipantTracking`). That setting skips participant metrics (content viewed, time on each page, products and messages) even when the player is not paused.
4. Click-stream metrics are saved only when the presentation is associated with a Visit and the Visit is saved. Cancel discards them.
5. Only after those checks, if the rep did track and then submitted, follow [support-engineering-visit-sync-not-data-loss.md](../visit-management/support-engineering-visit-sync-not-data-loss.md). A failed Device Sync Transaction is a different problem from a session that never started recording.

## What to tell the user

With **Pause tracking when player launches** on, the Intelligent Content session is paused as soon as the player opens, including from a Visit. It is not recorded until the rep resumes tracking. Turn the setting off when metrics should start at launch, or have the rep tap play before presenting. Do not regenerate the metadata cache for this symptom.

## Required answer

The reply must include all of:

- Cause: **Pause tracking when player launches** is on for that rep (user, then profile, then org). The player starts paused, so a Visit launch writes no Presentation Forum and no click stream until the rep taps play.
- The setting value that applies to the rep, from `list_admin_settings({ category: "IntelligentContent" })`.
- This is not a metadata-cache gap and not a failed sync.

## Do not

- Do not leave cache, a missing bundle, and a sync failure as open alternatives once the setting is on.
- Do not open a metadata-cache or missing-bundle investigation while this setting is on for the rep.
- Do not treat a paused launch as a sync failure or as missing Presentation Forum rows that the client failed to upload.
- Do not confuse this with a content-library preview. Preview also skips tracking, but this setting pauses a real player session.
