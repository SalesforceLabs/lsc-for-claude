# Visit Engagement lets you remove an attendee who has samples

**What you see:** On Visit Engagement, an attendee who already has samples can be removed. The visit then stays in that removed state until the user undoes the removal.

This is working as designed. The client blocks removal only for a signed visit. Sample protection runs on the server, after the client has already dropped the attendee. Visit Action Validation does not run on removal, so a script cannot block it.

## How to pin it

1. Confirm the attendee visit is unsigned and has samples (`ProductDisbursement` rows). The remove control is still enabled.
2. A selected attendee can be removed unless the visit is signed. Signing is `PhysicalForm` or `Visit.SignatureType`. Samples are not part of that check.
3. Stop. The page allowed the removal because the visit is unsigned. Save then rejects the delete because of the samples, and the page stays removed until undo.
4. Visit Action Validation runs for Save, Submit, and Sign, and the script record must use `OperationEventType = OnUpdate`. It has no removal event. `OnDelete` on `LifeScienceCustomScript` is not a hook for this action.

## Required answer

The reply must include all of:

- Status: working as designed.
- Client: removal is blocked only for a signed visit (`PhysicalForm` or `Visit.SignatureType`). An unsigned attendee with samples can be removed.
- Server: sample protection runs only on save. That failure leaves the visit removed until the user undoes it.
- Scripts: Visit Action Validation has no removal event. Do not say an `OnDelete` Visit Action Validation event exists.

## Do not

- Do not leave the cause unverified.
- Do not claim `OnDelete` is a Visit Action Validation event for this removal.
- Do not treat this as a configuration error. It is working as designed.
- Do not say the page blocks removal when the attendee has samples. That check runs on save.
