# Samples disabled for an HCP attendee on an HCO visit

**What you see:** On an HCO visit, Samples (Product Disbursements) are disabled for an HCP attendee. `HcoTypesForSamplesAndItems` already includes the HCO record type, and the profile setting is not the cause.

This is working as designed. Samples are disabled on the attendee visit when the attendee's primary address does not match the parent visit's address. The fix is a documentation update, not a configuration change and not a defect.

When the addresses differ, the child visit's `PlaceId` is set to the parent visit's `PlaceId`. The samples sidebar then disables because the child location equals the parent location. When the primary address matches, the child keeps its own address and Samples stay available.

## How to pin it

1. Confirm the disabled section is Samples on an HCP attendee visit whose parent visit account is an HCO. The HCO record type is already in `HcoTypesForSamplesAndItems`.
2. Read the attendee's primary `ContactPointAddress` and the parent `Visit.PlaceId`. Compare them. Stop when they do not match.
3. That mismatch is the cause. Do not continue to the HCO allow-list or a profile-level override.
4. If Samples are disabled on the HCO account itself, and there is no attendee visit, use `HcoTypesForSamplesAndItems`. That gate is not this leaf.

## Required answer

The reply must include all of:

- Cause: the attendee's primary address does not match the parent visit's address, so Samples are disabled on the attendee visit.
- Status: working as designed. The change is a documentation update.
- Evidence: the attendee primary `ContactPointAddress` and the parent `Visit.PlaceId` do not match.
- Boundary: `HcoTypesForSamplesAndItems` and a profile-level override are not the cause once that address mismatch is present.

## Do not

- Do not rank an HCO allow-list value or a profile-level override ahead of the address check.
- Do not leave the address rule as one of several open leads.
- Do not add the HCO record type again when it is already configured.
- Do not use this leaf when Samples are disabled on the HCO account itself. That is `HcoTypesForSamplesAndItems`.
