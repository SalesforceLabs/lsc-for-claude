# Last Visit is missing from the HCP attendee actions menu

**What you see:** On Visit Engagement, the actions menu on an HCP attendee does not include Last Visit. Send Email, Inquiry, and Survey are often missing from that same menu.

The attendee menu reads Life Sciences actions from the account page layout, in **Salesforce Mobile and Lightning Experience Actions**. For an HCP that layout is the Person Account layout. For an HCO it is the business Account layout. An active Last Visit quick action that is not on that layout still does not appear.

## How to pin it

1. Open the HCP record type and the Person Account page layout assigned to it.
2. In Salesforce Mobile and Lightning Experience Actions, read the action list. Last Visit is not there. If the section still uses the predefined actions, it has none of the Life Sciences actions.
3. Add Last Visit and the other Life Sciences actions you want (Send Email, Inquiry, Survey) to every Person Account layout those HCPs use. For an HCO attendee, add them on the business Account layout.
4. Regenerate the metadata cache for the profiles that use those layouts, then have the reps sync.

## Required answer

The reply must include all of:

- Cause: the Person Account page layout has no Life Sciences actions in Salesforce Mobile and Lightning Experience Actions, so Last Visit is not on the HCP attendee menu.
- Evidence: that layout, and an action list that omits Last Visit.
- Fix: add Last Visit and the other Life Sciences actions to the layouts, then regenerate the profile metadata cache.

## Do not

- Do not start by comparing Quick Action records for an inactive or mis-scoped Last Visit.
- Do not stop because the quick action exists. The page layout is what the attendee menu reads.
- Do not regenerate the cache before the actions are on the layout.
