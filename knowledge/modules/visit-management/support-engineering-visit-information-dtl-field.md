# Provider Visit Information merged fields are empty

**What you see:** On Visit Engagement, the Provider Visit Information section shows its merged fields empty. The section is there. The values are not.

`ProviderVisitProductDtlId` is on the Provider Visit page layout. That field is the product-detail lookup on discussion and message rows. It does not belong on this layout. Removing it from the layout fills the merged fields again.

## How to pin it

1. Confirm the empty values are the merged fields in **Provider Visit Information**, not a sidebar section with no related records.
2. Open the Provider Visit page layout for that record type. Find `ProviderVisitProductDtlId`.
3. Stop. That field on this layout is the cause. Remove it from the layout. The merged fields populate again.
4. Do not leave the cause as an unverified layout or rendering guess. The field on the layout is the evidence.

## Required answer

The reply must include all of:

- Cause: `ProviderVisitProductDtlId` is on the Provider Visit page layout, so the Provider Visit Information merged fields are empty.
- Evidence: the field is on that layout, in or feeding the Provider Visit Information section.
- Fix: remove `ProviderVisitProductDtlId` from the layout.

## Do not

- Do not stop after saying the section is a layout or rendering problem.
- Do not move the field onto `Visit`. Custom fields belong on `ProviderVisit`. This field does not belong on the Provider Visit layout at all.
- Do not refresh the metadata cache or regenerate label translations for this empty section.
- Do not use this leaf when the user sees a lookup whose label ends in ID and is asked to pick a parent. That is [support-engineering-visit-lookup-id-suffix.md](./support-engineering-visit-lookup-id-suffix.md).
