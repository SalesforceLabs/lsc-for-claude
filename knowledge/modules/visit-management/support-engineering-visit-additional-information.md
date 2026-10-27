# AdditionalInformation does not belong on the Visit Engagement layout

**What you see:** Visit Engagement breaks after **Additional Information** (`ProviderVisit.AdditionalInformation`, label often **Informação adicional**) is placed on the Visit Engagement layout. Typical breaks: adding an HCP fails once the field has text, participant-visit actions stop responding, and the attendee engagement screen is read-only.

This is not a metadata-cache, field-level security, or merged-layout defect. That placement is not supported.

## What the field is

`ProviderVisit.AdditionalInformation` is a system-managed JSON snapshot. It stores denormalized copies of account and provider data at visit time (name, professional designation, address, licenses) so child records do not re-query those relationships. The product writes it. Users do not edit it.

The header of an attendee visit shows the same values as the parent visit. It is not a per-HCP comment.

## What to do

1. Confirm the field on the layout is `AdditionalInformation` on `ProviderVisit`, not a customer text field the rep added for comments.
2. Remove it from the Visit Engagement layout. Participant add and the participant-visit action work again because the screen is no longer editing system JSON.
3. If the customer wants a separate editable comment per HCP on one HCO visit, say that no supported placement of `AdditionalInformation` provides that.

## Required answer

The reply must include all of:

- Cause: `ProviderVisit.AdditionalInformation` is system-managed JSON, and it was placed on the Visit Engagement layout. That placement is not supported.
- It is not a per-participant comment. Removing it from that layout restores attendee add.
- Do not move the field onto ProviderVisit. It is already there. Do not regenerate the metadata cache.

## Do not

- Do not leave cache, field-level security, and "move it to ProviderVisit" as open alternatives once the field on the layout is `AdditionalInformation`.
- Do not apply the merged-layout rule "move custom fields from Visit onto ProviderVisit." That rule is for customer fields. `AdditionalInformation` is already on `ProviderVisit`, and it still must not be on the Visit Engagement layout.
- Do not regenerate the metadata cache, or look for a `LifeSciMetadataRecord` override under `ProviderVisitSettings`. A layout edit of this field is not why the participant-visit action dies.
- Do not treat the read-only attendee screen or the failed HCP add as a product defect while this field remains on the layout.
